# KQF Draft Tool

A League of Legends draft assistant for the KQF roster — live pick/ban suggestions,
detailed comp analysis, and draft history. Single-file web app ([draft-tool.html](draft-tool.html)).

**Live site:** _(GitHub Pages URL goes here once deployed)_

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
node .claude/serve.js   # serves at http://localhost:5500
```
