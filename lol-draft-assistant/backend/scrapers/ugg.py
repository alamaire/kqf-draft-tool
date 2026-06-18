"""
U.GG data fetcher — pulls tier list and matchup data from U.GG's JSON endpoints.
Data is cached per patch to avoid hammering their servers.
"""
import httpx
import json
import os
from pathlib import Path

CACHE_DIR = Path(__file__).parent.parent / "data_cache"
CACHE_DIR.mkdir(exist_ok=True)

UGG_BASE = "https://stats2.u.gg/lol"
CURRENT_PATCH = "14_24"  # Updated manually or fetched dynamically

TIER_MAP = {1: "Challenger", 2: "Master+", 3: "Diamond+", 4: "Platinum+", 5: "Gold+", 6: "All"}
ROLE_MAP = {1: "jungle", 2: "support", 3: "adc", 4: "top", 5: "mid", 6: "none"}

async def fetch_ugg_overview(patch: str = CURRENT_PATCH, tier: int = 4, region: str = "na1") -> dict:
    cache_path = CACHE_DIR / f"ugg_{patch}_{tier}_{region}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    url = f"{UGG_BASE}/1.5/table/champions/{patch}/ranked_solo_5x5/{tier}/{region}/1.json"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(url)
            if r.status_code == 200:
                data = r.json()
                cache_path.write_text(json.dumps(data))
                return data
        except Exception:
            pass
    return {}

async def fetch_ugg_matchups(champion_id: int, role: int, patch: str = CURRENT_PATCH) -> dict:
    cache_path = CACHE_DIR / f"ugg_matchup_{champion_id}_{role}_{patch}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    url = f"{UGG_BASE}/1.5/table/matchups/{patch}/ranked_solo_5x5/{champion_id}/{role}/na1/1.json"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(url)
            if r.status_code == 200:
                data = r.json()
                cache_path.write_text(json.dumps(data))
                return data
        except Exception:
            pass
    return {}

def parse_champion_stats(raw: dict) -> dict:
    """Parse U.GG overview JSON into champion_id -> stats per role."""
    result = {}
    for champ_id_str, role_data in raw.items():
        try:
            champ_id = int(champ_id_str)
            result[champ_id] = {}
            for role_id_str, stats in role_data.items():
                role_id = int(role_id_str)
                if not stats or len(stats) < 2:
                    continue
                data = stats[0]
                result[champ_id][ROLE_MAP.get(role_id, "none")] = {
                    "wins": data[0] if len(data) > 0 else 0,
                    "games": data[1] if len(data) > 1 else 0,
                    "winRate": round(data[0] / data[1] * 100, 1) if data[1] > 0 else 0,
                    "tier": data[4] if len(data) > 4 else 5,
                }
        except (ValueError, TypeError, IndexError):
            continue
    return result

def parse_matchup_stats(raw: dict) -> dict:
    """Parse U.GG matchup JSON into opponent_id -> win_rate."""
    result = {}
    for opp_id_str, data in raw.items():
        try:
            opp_id = int(opp_id_str)
            if not data or len(data) < 2:
                continue
            wins = data[0]
            games = data[1]
            result[opp_id] = {
                "wins": wins,
                "games": games,
                "winRate": round(wins / games * 100, 1) if games > 0 else 50.0,
            }
        except (ValueError, TypeError):
            continue
    return result
