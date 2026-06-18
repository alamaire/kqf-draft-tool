"""
Mobalytics GraphQL API — fetches summoner profiles and champion performance.
Uses the public (no-auth) endpoints for profile data.
"""
import httpx
from typing import Optional

GQL_URL = "https://app.mobalytics.gg/api/lol/graphql/v1/query"

HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Origin": "https://app.mobalytics.gg",
    "Referer": "https://app.mobalytics.gg/",
}

SUMMONER_OVERVIEW_QUERY = """
query SummonerOverview($gameName: String!, $tagLine: String!, $region: Region!) {
  lol {
    summoner(gameName: $gameName, tagLine: $tagLine, region: $region) {
      gameName
      tagLine
      region
      summonerLevel
      profileIconId
      ranking {
        tier
        division
        lp
        wins
        losses
      }
      champions(limit: 20, queue: RANKED_SOLO) {
        championId
        championName
        games
        wins
        winRate
        kda
        grade
        role
      }
    }
  }
}
"""

CHAMPION_INSIGHTS_QUERY = """
query ChampionInsights($championId: Int!, $role: String!, $region: Region!, $tier: Tier!) {
  lol {
    championInsights(championId: $championId, role: $role, region: $region, tier: $tier) {
      synergies {
        championId
        winRate
        games
      }
      counters {
        championId
        winRate
        games
        disadvantage
      }
    }
  }
}
"""

async def get_summoner_profile(game_name: str, tag_line: str, region: str = "NA") -> Optional[dict]:
    payload = {
        "operationName": "SummonerOverview",
        "query": SUMMONER_OVERVIEW_QUERY,
        "variables": {
            "gameName": game_name,
            "tagLine": tag_line,
            "region": region.upper(),
        },
    }
    async with httpx.AsyncClient(headers=HEADERS, timeout=8.0) as client:
        try:
            r = await client.post(GQL_URL, json=payload)
            if r.status_code == 200:
                data = r.json()
                summoner = data.get("data", {}).get("lol", {}).get("summoner")
                return summoner
        except Exception:
            pass
    return None

async def get_champion_insights(champion_id: int, role: str, region: str = "NA", tier: str = "PLATINUM_PLUS") -> Optional[dict]:
    payload = {
        "operationName": "ChampionInsights",
        "query": CHAMPION_INSIGHTS_QUERY,
        "variables": {
            "championId": champion_id,
            "role": role.upper(),
            "region": region.upper(),
            "tier": tier,
        },
    }
    async with httpx.AsyncClient(headers=HEADERS, timeout=8.0) as client:
        try:
            r = await client.post(GQL_URL, json=payload)
            if r.status_code == 200:
                data = r.json()
                return data.get("data", {}).get("lol", {}).get("championInsights")
        except Exception:
            pass
    return None

def extract_champion_pool(summoner_data: dict) -> list[dict]:
    """Extract top champion pool from Mobalytics summoner data."""
    if not summoner_data:
        return []
    champs = summoner_data.get("champions", [])
    return sorted(champs, key=lambda c: c.get("games", 0), reverse=True)
