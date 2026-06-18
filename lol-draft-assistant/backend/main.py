import asyncio
import json
import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import lcu
import champion_data
import suggestion_engine
from scrapers import ugg as ugg_scraper
from scrapers import mobalytics

# ── State ──────────────────────────────────────────────────────────────────────

draft_state: dict = {}
summoner_cache: dict[str, dict] = {}
connected_clients: list[WebSocket] = []
ugg_stats: dict = {}
all_champions: dict = {}

# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global all_champions, ugg_stats
    print("Loading champion data...")
    all_champions = await champion_data.get_all_champions()
    print(f"Loaded {len(all_champions)} champions")

    print("Loading U.GG tier data...")
    raw_ugg = await ugg_scraper.fetch_ugg_overview()
    ugg_stats = ugg_scraper.parse_champion_stats(raw_ugg)
    print(f"Loaded U.GG data for {len(ugg_stats)} champions")

    asyncio.create_task(lcu_poll_loop())
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── LCU polling ────────────────────────────────────────────────────────────────

POLL_INTERVAL = 0.5
_last_draft_hash: str = ""

async def lcu_poll_loop():
    global draft_state, _last_draft_hash
    print("LCU poll loop started")
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        client = lcu.get_lcu_client()
        if not client:
            if draft_state.get("status") != "disconnected":
                draft_state = {"status": "disconnected"}
                await broadcast({"type": "status", "payload": "disconnected"})
            continue

        async with client:
            session = await lcu.get_champ_select_session(client)
            if not session:
                if draft_state.get("status") != "idle":
                    draft_state = {"status": "idle"}
                    await broadcast({"type": "status", "payload": "idle"})
                continue

            parsed = lcu.parse_draft_state(session)
            state_hash = json.dumps(parsed, sort_keys=True)
            if state_hash == _last_draft_hash:
                continue
            _last_draft_hash = state_hash

            draft_state = {"status": "in_draft", **parsed}

            # Resolve summoner names for any un-cached members
            await resolve_summoners(client, parsed)

            # Build suggestions
            suggestions = await build_suggestions(parsed)

            await broadcast({
                "type": "draft_update",
                "payload": {
                    "draft": draft_state,
                    "summoners": summoner_cache,
                    "suggestions": suggestions,
                },
            })

async def resolve_summoners(client: httpx.AsyncClient, parsed: dict):
    all_members = parsed["blueTeam"] + parsed["redTeam"]
    for member in all_members:
        summoner_id = member.get("summonerId") or member.get("puuid")
        if not summoner_id or summoner_id in summoner_cache:
            continue
        lcu_summoner = await lcu.get_summoner_by_id(client, str(summoner_id))
        if not lcu_summoner:
            continue

        game_name = lcu_summoner.get("gameName", "")
        tag_line = lcu_summoner.get("tagLine", "")
        region = os.getenv("REGION", "na1")

        riot_client = riot.RiotAPI(region)
        profile = await riot_client.get_summoner_profile(game_name, tag_line)

        mobalytics_data = None
        if game_name and tag_line:
            mobalytics_data = await mobalytics.get_summoner_profile(game_name, tag_line)

        summoner_cache[summoner_id] = {
            "summonerId": summoner_id,
            "gameName": game_name,
            "tagLine": tag_line,
            "profile": profile,
            "mobalytics": mobalytics_data,
            "championPool": mobalytics.extract_champion_pool(mobalytics_data) if mobalytics_data else [],
            "mastery": profile.get("mastery", []) if profile else [],
            "ranked": profile.get("ranked", []) if profile else [],
        }

async def build_suggestions(parsed: dict) -> dict:
    ally_picks = [p["championId"] for p in parsed["picks"] if p["team"] == parsed["myTeam"]]
    enemy_picks = [p["championId"] for p in parsed["picks"] if p["team"] != parsed["myTeam"]]
    banned_ids = {b["championId"] for b in parsed["bans"]}
    all_champ_ids = list(all_champions.keys())

    # Find whose turn it is — use their mastery
    current_action = parsed.get("currentAction")
    summoner_masteries = []
    if current_action:
        cell_id = current_action.get("actorCellId", -1)
        team_members = parsed["blueTeam"] if cell_id < 5 else parsed["redTeam"]
        for m in team_members:
            if m.get("cellId") == cell_id:
                sid = m.get("summonerId") or m.get("puuid")
                cached = summoner_cache.get(str(sid), {})
                summoner_masteries = cached.get("mastery", [])
                break

    # Enemy masteries for ban suggestions
    enemy_team_key = "redTeam" if parsed["myTeam"] == "blue" else "blueTeam"
    enemy_masteries = []
    for m in parsed[enemy_team_key]:
        sid = m.get("summonerId") or m.get("puuid")
        cached = summoner_cache.get(str(sid), {})
        if cached.get("mastery"):
            enemy_masteries.append(cached["mastery"])

    role = "mid"  # Default; expand to detect from cell position
    pick_suggestions = suggestion_engine.get_suggestions(
        role=role,
        ally_picks=ally_picks,
        enemy_picks=enemy_picks,
        banned_ids=banned_ids,
        all_champion_ids=all_champ_ids,
        ugg_stats=ugg_stats,
        matchup_data={},
        summoner_masteries=summoner_masteries,
        champions=all_champions,
        top_n=10,
    )
    ban_suggestions = suggestion_engine.get_ban_suggestions(
        enemy_summoner_masteries=enemy_masteries,
        ally_picks=ally_picks,
        banned_ids=banned_ids,
        ugg_stats=ugg_stats,
        champions=all_champions,
        top_n=5,
    )
    return {"picks": pick_suggestions, "bans": ban_suggestions}

# ── WebSocket ──────────────────────────────────────────────────────────────────

async def broadcast(message: dict):
    dead = []
    for ws in connected_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        connected_clients.remove(ws)

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    # Send current state immediately on connect
    await ws.send_json({"type": "status", "payload": draft_state.get("status", "disconnected")})
    try:
        while True:
            await ws.receive_text()  # keep alive
    except WebSocketDisconnect:
        connected_clients.remove(ws)

# ── REST endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/champions")
async def get_champions():
    return list(all_champions.values())

@app.get("/api/draft")
async def get_draft():
    return {"draft": draft_state, "summoners": summoner_cache}

@app.get("/api/summoner/{game_name}/{tag_line}")
async def lookup_summoner(game_name: str, tag_line: str):
    region = os.getenv("REGION", "na1")
    client = riot.RiotAPI(region)
    profile = await client.get_summoner_profile(game_name, tag_line)
    mob = await mobalytics.get_summoner_profile(game_name, tag_line)
    return {"profile": profile, "mobalytics": mob}

@app.get("/api/health")
async def health():
    lockfile = lcu.find_lockfile()
    return {
        "lcu_connected": lockfile is not None,
        "champions_loaded": len(all_champions),
        "ugg_data_loaded": len(ugg_stats),
    }

# ── Serve frontend ──────────────────────────────────────────────────────────────

frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
