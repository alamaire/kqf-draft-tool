import httpx
import os
from typing import Optional

RIOT_API_KEY = os.getenv("RIOT_API_KEY", "")
RIOT_REGIONS = {
    "na": "na1",
    "euw": "euw1",
    "eune": "eun1",
    "kr": "kr",
    "br": "br1",
    "lan": "la1",
    "las": "la2",
    "oce": "oc1",
    "tr": "tr1",
    "ru": "ru",
    "jp": "jp1",
}
ROUTING = {
    "na1": "americas", "br1": "americas", "la1": "americas", "la2": "americas",
    "euw1": "europe", "eun1": "europe", "tr1": "europe", "ru": "europe",
    "kr": "asia", "jp1": "asia",
    "oc1": "sea",
}


class RiotAPI:
    def __init__(self, region: str = "na1"):
        self.region = region
        self.routing = ROUTING.get(region, "americas")
        self.headers = {"X-Riot-Token": RIOT_API_KEY}

    async def get_account_by_riot_id(self, game_name: str, tag_line: str) -> Optional[dict]:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://{self.routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}",
                headers=self.headers,
                timeout=5.0,
            )
            return r.json() if r.status_code == 200 else None

    async def get_summoner_by_puuid(self, puuid: str) -> Optional[dict]:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://{self.region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{puuid}",
                headers=self.headers,
                timeout=5.0,
            )
            return r.json() if r.status_code == 200 else None

    async def get_champion_mastery(self, puuid: str, top_n: int = 20) -> list:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://{self.region}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top?count={top_n}",
                headers=self.headers,
                timeout=5.0,
            )
            return r.json() if r.status_code == 200 else []

    async def get_ranked_stats(self, summoner_id: str) -> list:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://{self.region}.api.riotgames.com/lol/league/v4/entries/by-summoner/{summoner_id}",
                headers=self.headers,
                timeout=5.0,
            )
            return r.json() if r.status_code == 200 else []

    async def get_recent_matches(self, puuid: str, count: int = 20, queue: int = 420) -> list:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://{self.routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?queue={queue}&count={count}",
                headers=self.headers,
                timeout=5.0,
            )
            if r.status_code != 200:
                return []
            match_ids = r.json()
            matches = []
            for mid in match_ids[:10]:
                mr = await client.get(
                    f"https://{self.routing}.api.riotgames.com/lol/match/v5/matches/{mid}",
                    headers=self.headers,
                    timeout=5.0,
                )
                if mr.status_code == 200:
                    matches.append(mr.json())
            return matches

    async def get_summoner_profile(self, game_name: str, tag_line: str) -> Optional[dict]:
        """Full profile: account + summoner + mastery + ranked."""
        account = await self.get_account_by_riot_id(game_name, tag_line)
        if not account:
            return None
        puuid = account["puuid"]
        summoner = await self.get_summoner_by_puuid(puuid)
        if not summoner:
            return None
        mastery = await self.get_champion_mastery(puuid)
        ranked = await self.get_ranked_stats(summoner["id"])
        return {
            "gameName": account["gameName"],
            "tagLine": account["tagLine"],
            "puuid": puuid,
            "summonerId": summoner["id"],
            "summonerLevel": summoner["summonerLevel"],
            "profileIconId": summoner["profileIconId"],
            "mastery": mastery,
            "ranked": ranked,
        }
