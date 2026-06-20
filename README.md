# KQF Draft Tool

A League of Legends draft assistant for the KQF roster — live pick/ban suggestions,
detailed comp analysis, and draft history. Single-file web app ([draft-tool.html](draft-tool.html)).

**Live site:** https://monkeydadamlol.github.io/kqf-draft-tool/

## Features
- Solo Queue / Flex / Ranked 5's modes, with blue/red side selection
- Suggestions blend: roster mastery (OP.GG), solo-queue win rates, pro pick/ban
  priority, lane matchup, comp fit, and draftability (when a champ can be picked)
- Detailed comp analysis: AD/AP damage split, CC, engage, peel, poke, scaling
- Draft history with bans + pick/ban order; the engine learns from saved W/L drafts

## Data
- Solo-queue win/pick rates: [op.gg](https://op.gg/lol/champions) (per role)
- Pro pick/ban priority: [gol.gg](https://gol.gg) — aggregated across LCK / LPL / LEC
- Champion data: Data Dragon (fetched live in the browser)

Data is refreshed daily (see the scheduled updater). To refresh by hand, re-pull the
per-role op.gg tables into `PATCH_DATA` and the gol.gg tournament pick/bans into `PRO`.

## Run locally
Node is required (no Python needed):

```
node .claude/serve.js   # plain preview at http://localhost:5500
```

## Live mode (auto-fill champ select)
Run the **companion** during games — it reads your live champ select from the League
client (LCU) and auto-fills picks/bans as they happen, with suggestions updating live:

```
node companion.js       # then open http://localhost:5500 while in champ select
```

The public website can't do this (browsers can't read your client) — only this local
app can. A "● LIVE" pill shows when it's syncing. Enemy names are hidden by Riot in
ranked champ select, so enemy-specific op.gg only works in Clash/customs.

## Roster match-history (Riot)
`node scripts/refresh-roster.js` with a daily Riot key (`RIOT_KEY=RGAPI-… node
scripts/refresh-roster.js`) pulls full-roster games per mode into `roster-data.js`.
Keys expire ~24h; the tool pops a reminder + link when the data is stale.
