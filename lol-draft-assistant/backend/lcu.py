import json
import asyncio
import httpx
from pathlib import Path

LOCKFILE_PATHS = [
    r"C:\Riot Games\League of Legends\lockfile",
    r"C:\Program Files\Riot Games\League of Legends\lockfile",
    r"C:\Program Files (x86)\Riot Games\League of Legends\lockfile",
]

def find_lockfile() -> Path | None:
    for path in LOCKFILE_PATHS:
        p = Path(path)
        if p.exists():
            return p
    return None

def parse_lockfile(path: Path) -> dict | None:
    try:
        content = path.read_text()
        parts = content.strip().split(":")
        if len(parts) < 5:
            return None
        return {"port": parts[2], "password": parts[3]}
    except Exception:
        return None

def get_lcu_client() -> httpx.AsyncClient | None:
    lockfile = find_lockfile()
    if not lockfile:
        return None
    data = parse_lockfile(lockfile)
    if not data:
        return None
    return httpx.AsyncClient(
        base_url=f"https://127.0.0.1:{data['port']}",
        auth=("riot", data["password"]),
        verify=False,
        timeout=2.0,
    )

async def lcu_get(client: httpx.AsyncClient, path: str) -> dict | list | None:
    try:
        r = await client.get(path)
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None

async def get_champ_select_session(client: httpx.AsyncClient) -> dict | None:
    return await lcu_get(client, "/lol-champ-select/v1/session")

async def get_summoner_by_id(client: httpx.AsyncClient, summoner_id: int) -> dict | None:
    return await lcu_get(client, f"/lol-summoner/v1/summoners/{summoner_id}")

async def get_champion_mastery(client: httpx.AsyncClient, puuid: str) -> list:
    result = await lcu_get(client, f"/lol-collections/v1/inventories/by-puuid/{puuid}/champion-mastery")
    if isinstance(result, list):
        return sorted(result, key=lambda x: x.get("championPoints", 0), reverse=True)[:20]
    return []

async def get_ranked_stats(client: httpx.AsyncClient, puuid: str) -> dict | None:
    return await lcu_get(client, f"/lol-ranked/v1/ranked-stats/{puuid}")

async def get_full_summoner_data(client: httpx.AsyncClient, summoner_id: int) -> dict | None:
    """Pull everything we need from LCU for one summoner — no Riot API key needed."""
    summoner = await get_summoner_by_id(client, summoner_id)
    if not summoner:
        return None
    puuid = summoner.get("puuid", "")
    mastery, ranked = await asyncio.gather(
        get_champion_mastery(client, puuid),
        get_ranked_stats(client, puuid),
    )
    solo = {}
    if ranked:
        for queue in ranked.get("queues", []):
            if queue.get("queueType") == "RANKED_SOLO_5x5":
                solo = queue
                break
    return {
        "summonerId": summoner_id,
        "puuid": puuid,
        "gameName": summoner.get("gameName", ""),
        "tagLine": summoner.get("tagLine", ""),
        "summonerLevel": summoner.get("summonerLevel", 0),
        "profileIconId": summoner.get("profileIconId", 0),
        "mastery": mastery,
        "ranked": solo,
    }

def parse_draft_state(session: dict) -> dict:
    picks, bans = [], []
    for action_group in session.get("actions", []):
        for action in action_group:
            champ_id = action.get("championId", 0)
            cell_id = action.get("actorCellId", -1)
            atype = action.get("type", "")
            completed = action.get("completed", False)
            if atype == "ban" and completed and champ_id:
                bans.append({"championId": champ_id, "team": "blue" if cell_id < 5 else "red", "cellId": cell_id})
            elif atype == "pick" and completed and champ_id:
                picks.append({"championId": champ_id, "team": "blue" if cell_id < 5 else "red", "cellId": cell_id})

    current_action = None
    for action_group in session.get("actions", []):
        for action in action_group:
            if action.get("isInProgress"):
                current_action = action
                break

    local_cell = session.get("localPlayerCellId", 0)
    my_team = "blue" if local_cell < 5 else "red"

    blue_team = sorted(session.get("myTeam", []) + session.get("theirTeam", []), key=lambda m: m.get("cellId", 0))
    blue_team = [m for m in blue_team if m.get("cellId", 0) < 5]
    red_team = [m for m in (session.get("myTeam", []) + session.get("theirTeam", [])) if m.get("cellId", 10) >= 5]
    red_team.sort(key=lambda m: m.get("cellId", 0))

    return {
        "picks": picks,
        "bans": bans,
        "blueTeam": blue_team,
        "redTeam": red_team,
        "myTeam": my_team,
        "localPlayerCellId": local_cell,
        "currentAction": current_action,
        "timer": session.get("timer", {}),
    }
