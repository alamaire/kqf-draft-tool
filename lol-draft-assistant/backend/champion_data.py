"""
Riot Data Dragon — static champion data (names, roles, images).
Fetched once and cached locally.
"""
import httpx
import json
from pathlib import Path

CACHE_DIR = Path(__file__).parent / "data_cache"
CACHE_DIR.mkdir(exist_ok=True)

DDRAGON_BASE = "https://ddragon.leagueoflegends.com"

_champion_cache: dict | None = None
_version_cache: str | None = None

async def get_latest_version() -> str:
    global _version_cache
    if _version_cache:
        return _version_cache
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(f"{DDRAGON_BASE}/api/versions.json")
        versions = r.json()
        _version_cache = versions[0]
        return _version_cache

async def get_all_champions() -> dict:
    global _champion_cache
    if _champion_cache:
        return _champion_cache

    cache_path = CACHE_DIR / "champions.json"
    if cache_path.exists():
        _champion_cache = json.loads(cache_path.read_text())
        return _champion_cache

    version = await get_latest_version()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{DDRAGON_BASE}/cdn/{version}/data/en_US/champion.json")
        raw = r.json()

    champions = {}
    for key, champ in raw["data"].items():
        champ_id = int(champ["key"])
        champions[champ_id] = {
            "id": champ_id,
            "key": key,
            "name": champ["name"],
            "title": champ["title"],
            "tags": champ["tags"],
            "image": f"{DDRAGON_BASE}/cdn/{version}/img/champion/{key}.png",
            "squareImage": f"https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/{champ_id}.png",
        }

    _champion_cache = champions
    cache_path.write_text(json.dumps(champions))
    return champions

def get_champion_by_id(champions: dict, champ_id: int) -> dict | None:
    return champions.get(champ_id)

def get_champion_by_name(champions: dict, name: str) -> dict | None:
    name_lower = name.lower()
    for champ in champions.values():
        if champ["name"].lower() == name_lower or champ["key"].lower() == name_lower:
            return champ
    return None

# Role inference from champion tags
ROLE_TAGS = {
    "top": ["Fighter", "Tank"],
    "jungle": ["Fighter", "Assassin", "Tank"],
    "mid": ["Mage", "Assassin"],
    "adc": ["Marksman"],
    "support": ["Support", "Tank", "Mage"],
}

COMP_ARCHETYPES = {
    "engage": ["Tank", "Fighter"],
    "poke": ["Mage", "Marksman"],
    "assassin": ["Assassin"],
    "peel": ["Support"],
    "scaling": ["Mage", "Marksman"],
}

def analyze_comp(champion_ids: list[int], champions: dict) -> dict:
    """Analyze team comp archetype from champion IDs."""
    tags_count: dict[str, int] = {}
    for cid in champion_ids:
        champ = champions.get(cid)
        if champ:
            for tag in champ["tags"]:
                tags_count[tag] = tags_count.get(tag, 0) + 1

    archetype_scores = {arch: 0 for arch in COMP_ARCHETYPES}
    for arch, arch_tags in COMP_ARCHETYPES.items():
        for tag in arch_tags:
            archetype_scores[arch] += tags_count.get(tag, 0)

    dominant = max(archetype_scores, key=lambda k: archetype_scores[k]) if archetype_scores else "unknown"

    return {
        "tagCounts": tags_count,
        "archetypeScores": archetype_scores,
        "dominant": dominant,
        "hasTank": tags_count.get("Tank", 0) > 0,
        "hasADC": tags_count.get("Marksman", 0) > 0,
        "hasEngage": tags_count.get("Tank", 0) + tags_count.get("Fighter", 0) > 1,
    }
