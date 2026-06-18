"""
Suggestion engine — ranks available champions based on:
1. Meta tier (U.GG win rate + tier)
2. Counter score vs enemy picks
3. Synergy score with ally picks
4. Summoner familiarity (mastery + recent ranked games)
5. Comp needs (what the team comp is missing)
"""
from champion_data import analyze_comp

WEIGHT_TIER = 0.25
WEIGHT_COUNTER = 0.30
WEIGHT_SYNERGY = 0.15
WEIGHT_FAMILIARITY = 0.20
WEIGHT_COMP = 0.10

# Tier score: U.GG tier 1=best, 5=worst
TIER_SCORES = {1: 1.0, 2: 0.85, 3: 0.7, 4: 0.55, 5: 0.4}

def score_champion(
    champ_id: int,
    role: str,
    ally_picks: list[int],
    enemy_picks: list[int],
    banned_ids: set[int],
    ugg_stats: dict,
    matchup_data: dict,
    summoner_masteries: list[dict],
    champions: dict,
) -> dict:
    if champ_id in banned_ids or champ_id in ally_picks or champ_id in enemy_picks:
        return None

    scores = {}

    # --- Tier score ---
    champ_ugg = ugg_stats.get(champ_id, {})
    role_stats = champ_ugg.get(role) or next(iter(champ_ugg.values()), None)
    if role_stats:
        tier = role_stats.get("tier", 5)
        win_rate = role_stats.get("winRate", 50.0)
        tier_score = TIER_SCORES.get(tier, 0.4) * 0.5 + max(0, (win_rate - 45) / 15) * 0.5
    else:
        tier_score = 0.3
    scores["tier"] = min(1.0, max(0.0, tier_score))

    # --- Counter score vs enemies ---
    counter_score = 0.5
    if matchup_data and enemy_picks:
        matchup_scores = []
        for enemy_id in enemy_picks:
            mu = matchup_data.get(champ_id, {}).get(enemy_id)
            if mu:
                wr = mu.get("winRate", 50.0)
                matchup_scores.append(max(0, (wr - 40) / 20))
        if matchup_scores:
            counter_score = sum(matchup_scores) / len(matchup_scores)
    scores["counter"] = min(1.0, max(0.0, counter_score))

    # --- Synergy score with allies ---
    synergy_score = 0.5
    scores["synergy"] = synergy_score  # Placeholder — expand with Mobalytics synergy data

    # --- Summoner familiarity ---
    familiarity = 0.0
    for m in summoner_masteries:
        if m.get("championId") == champ_id:
            mastery_pts = m.get("championPoints", 0)
            mastery_level = m.get("championLevel", 0)
            familiarity = min(1.0, mastery_pts / 200000) * 0.6 + min(1.0, mastery_level / 7) * 0.4
            break
    scores["familiarity"] = familiarity

    # --- Comp need ---
    comp_analysis = analyze_comp(ally_picks, champions)
    champ_info = champions.get(champ_id, {})
    champ_tags = champ_info.get("tags", [])
    comp_need = 0.5
    if not comp_analysis["hasTank"] and "Tank" in champ_tags:
        comp_need = 0.9
    elif not comp_analysis["hasADC"] and "Marksman" in champ_tags:
        comp_need = 0.85
    elif not comp_analysis["hasEngage"] and "Fighter" in champ_tags:
        comp_need = 0.75
    scores["compNeed"] = comp_need

    total = (
        scores["tier"] * WEIGHT_TIER +
        scores["counter"] * WEIGHT_COUNTER +
        scores["synergy"] * WEIGHT_SYNERGY +
        scores["familiarity"] * WEIGHT_FAMILIARITY +
        scores["compNeed"] * WEIGHT_COMP
    )

    return {
        "championId": champ_id,
        "totalScore": round(total, 4),
        "scores": scores,
        "role": role,
    }

def get_suggestions(
    role: str,
    ally_picks: list[int],
    enemy_picks: list[int],
    banned_ids: set[int],
    all_champion_ids: list[int],
    ugg_stats: dict,
    matchup_data: dict,
    summoner_masteries: list[dict],
    champions: dict,
    top_n: int = 10,
) -> list[dict]:
    results = []
    for champ_id in all_champion_ids:
        result = score_champion(
            champ_id, role, ally_picks, enemy_picks, banned_ids,
            ugg_stats, matchup_data, summoner_masteries, champions,
        )
        if result:
            results.append(result)
    results.sort(key=lambda x: x["totalScore"], reverse=True)
    return results[:top_n]

def get_ban_suggestions(
    enemy_summoner_masteries: list[list[dict]],
    ally_picks: list[int],
    banned_ids: set[int],
    ugg_stats: dict,
    champions: dict,
    top_n: int = 5,
) -> list[dict]:
    """Suggest bans based on what enemies are likely to play."""
    threat_scores: dict[int, float] = {}
    for summoner_masteries in enemy_summoner_masteries:
        for i, mastery in enumerate(summoner_masteries[:5]):
            champ_id = mastery.get("championId")
            if not champ_id or champ_id in banned_ids or champ_id in ally_picks:
                continue
            # Weight by mastery rank (1st pick = most likely)
            weight = 1.0 / (i + 1)
            champ_ugg = ugg_stats.get(champ_id, {})
            best_stats = max(champ_ugg.values(), key=lambda s: s.get("winRate", 0), default={})
            tier = best_stats.get("tier", 5)
            tier_weight = TIER_SCORES.get(tier, 0.4)
            threat_scores[champ_id] = threat_scores.get(champ_id, 0) + weight * tier_weight

    sorted_threats = sorted(threat_scores.items(), key=lambda x: x[1], reverse=True)
    return [{"championId": cid, "threatScore": round(score, 4)} for cid, score in sorted_threats[:top_n]]
