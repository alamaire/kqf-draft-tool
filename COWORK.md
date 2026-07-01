# Cowork ↔ KQF Draft Tool — data bridge

You (Cowork, a Claude with browser access) and Claude Code work as a team. Claude Code built the
tool + the receiving endpoints below; **your job is to read op.gg in the browser** (which the API/
scrape can't reliably give us) **and POST accurate data** to the companion. The tool reads it back
and fills the Stats tab + backfills missing games automatically.

The companion runs at **http://localhost:5500** (must be running — it serves the tool too).

## Team protocol (read first)
- **Don't start or restart the companion.** It's already running the current code (Claude Code keeps it
  up). If you run `node companion.js` you'll get `EADDRINUSE :::5500` — that's expected and means it's
  already up. Just use the endpoints; don't touch the process.
- **Handshake:** `GET http://localhost:5500/api/status` confirms you're connected to the right
  companion and shows the live state (recorded games per mode, how many players have stats, last
  update). If it responds with `ok:true`, you're good to go.
- **Division of labor:** Claude Code owns the tool, companion, endpoints, and live game capture.
  **You own reading op.gg in the browser and POSTing accurate data.** Don't edit files or code.
- **Loop:** capture happens automatically when a game ends → you read op.gg → POST stats/games →
  the user hits "⟳ Sync from Cowork" on the Stats tab (or reopens it) to see your numbers.
- **If something's off** (a field maps wrong, an endpoint rejects your payload), report exactly what
  you sent and what happened back through the user, and Claude Code will fix the mapping.

## The roster (read these op.gg accounts)
| Player | op.gg URL | role |
|---|---|---|
| TheDrunkOfRivia | https://op.gg/summoners/na/TheDrunkOfRivia-NA1 | top |
| Teemoboy2011 | https://op.gg/summoners/na/Teemoboy2011-Smile | jungle |
| StyIebender | https://op.gg/summoners/na/StyIebender-NA1 | mid |
| MonkeyDAdam | https://op.gg/summoners/na/MonkeyDAdam-NA1 | adc |
| YoitsSam | https://op.gg/summoners/na/YoitsSam-NA1 | support |
| LP Fisherman | https://op.gg/summoners/na/LP%20Fisherman-NA1 | sub (adc) |
| Maul Me Maybe | https://op.gg/summoners/na/Maul%20Me%20Maybe-NA1 | sub (mid) |

Note the tag on Teemoboy2011 is **Smile**, not NA1. Names with spaces are URL-encoded.

## What games count
We only track **Flex** ("ranked flex" on op.gg) and **Ranked 5's** ("featured" on op.gg), and only
**full-roster** games (5 of the 7 players above on the same team). Ignore everything else.

See which games we've already recorded: `GET http://localhost:5500/api/live-drafts` (array of
games with `gameId`, `queueId` **440=Flex / 710=Ranked 5's** (op.gg "Featured", tournament draft),
`result`, and per-side `picks`/`bans`/`names`).

**Queue IDs (Cowork's catch — confirmed):** Flex = **440**, Ranked 5's/scrims = **710** (op.gg
"Featured"). **2400 = ARAM Mayhem — do NOT track it.** When you backfill via `/api/add-game`, send
`queueId: 710` for scrims so they bucket as ranked5.

## Sync workflow — what to do when Adam says "sync"
Do these in order, **incrementally** (only touch what's changed — don't redo work):

1. **Reconcile games.** `GET /api/live-drafts` and `GET /api/status`. For each mode, list the
   roster's full-roster games on op.gg (Flex = "ranked flex", Ranked 5's = "featured"). **Verify the
   op.gg games match what's recorded.** For any op.gg full-roster game **missing** from
   `/api/live-drafts`, `POST /api/add-game` to add it (`queueId` 440/710, role-ordered our picks,
   result). If the store has a game that's NOT on op.gg, flag it to Adam (don't delete).
2. **Update only missing/changed stats.** Compare op.gg to `GET /api/roster-stats`. Only push stats
   that **aren't already present or have changed** because of new games:
   - A player/mode with **no stats yet** → compute and POST.
   - A mode that got **new games since the last sync** → recompute that mode's per-player aggregate
     over our recorded games and POST it.
   - A mode with **no new games** → skip it (leave existing stats as-is; don't re-push).
3. Report what you added (games + which stats) so Adam can hit "⟳ Sync from Cowork" and see it.

Net: every sync makes the recorded games match op.gg and fills in only the stats that are new.

## 1) Per-player Stats → POST /api/set-roster-stats
**Read match-by-match. Full-roster games only. Keep Flex and Ranked 5's separate.**
- Do NOT use op.gg's champions-page whole-queue aggregate — it includes games without our team.
- For each player, go through their match history, keep only games where **5 of our 7 roster were on
  the same team**, and average that player's stats over just those games.
- Compute Flex and Ranked 5's **separately** and POST each as its own call (`"mode":"flex"` and
  `"mode":"ranked5"`). The tool shows them on the matching main tab — never mixed.
- Cross-reference `/api/live-drafts` for the gameIds/dates of games we've recorded.
- Send numbers only (no `%`/units). **Reliable from collapsed cards:** `kda, avgK, avgD, avgA, kp,
  csm`. **From expanding each match:** `dmg, goldp, vsp, wards`. Field meanings:
  - `dmg` = **damage share %** — player's damage to champions ÷ team's total (×100)
  - `goldp` = **gold share %** — player's gold ÷ team's total (×100)
  - `vsp` = **vision share %** — player's vision score ÷ team's total (×100)
  - `wards` = **avg wards placed** per game (raw count, not a %)
  Don't send `gpm` (dropped) or `vspm` (not exposed). Missing fields just show "—".

```
POST http://localhost:5500/api/set-roster-stats
Content-Type: application/json
{
  "mode": "flex",            // or "ranked5"
  "stats": {
    "monkeydadam": { "kda": 3.1, "avgK": 6.2, "avgD": 4.1, "avgA": 8.0, "csm": 7.4, "kp": 62, "dmg": 28, "goldp": 24, "vsp": 15, "wards": 12 },
    "yoitssam":    { "kda": 2.6, "avgK": 2.4, "avgD": 5.8, "avgA": 12.4, "csm": 1.1, "kp": 64, "dmg": 9, "goldp": 15, "vsp": 30, "wards": 34 }
  }
}
```
Keys are the **lowercase account name** (left column above, lowercased: `thedrunkofrivia`,
`teemoboy2011`, `styiebender`, `monkeydadam`, `yoitssam`, `lp fisherman`, `maul me maybe`).
Fields shown in the Stats tab: `kda, avgK, avgD, avgA, csm, kp, dmg, goldp, vsp, wards`. Send what op.gg
shows; missing ones display as "—". POST again anytime to update (it merges by player).

## 2) Backfill a missing game → POST /api/add-game
For Ranked 5's games Riot stripped locally (or any full-roster game missing from the tracker), read
the op.gg match page and send the full draft. `ourSide` = the side our roster was on.

**gameId:** op.gg (Next app-router) doesn't expose the real Riot matchId, so send a **deterministic
synthetic id** like `"gameId": "opgg-2026-06-27-ahri_jinx_ornn_sivir_thresh"` (date + sorted our
champs). The companion dedupes by a **fingerprint** (mode + our sorted champs + day), so your backfill
won't double a live capture of the same game — and if both exist, the live one (real id + bans) wins.
Re-sending the same synthetic id is safe.

**Include both teams' picks + bans** (expand the match for the full draft) — Enemy Champions and Picks
& Bans need the enemy champs + our bans. If a match won't expand, send at least both teams' picks.

**Order picks by role: top, jungle, mid, adc, support** — for BOTH `blue.picks` and `red.picks`. The
Enemy Champions tab now buckets each enemy champ by the role it played, read from its slot in
`red.picks` (index 0 = top … 4 = support). Wrong order → wrong role bucket.

**Going forward, you don't need to backfill picks/bans for new games** — the Riot client auto-captures
the full draft (picks + bans + result) live when each game completes. Your job for new games is just
the op.gg **stats** (`/api/set-roster-stats`) + verification. Backfill is only for past/missing games.

```
POST http://localhost:5500/api/add-game
Content-Type: application/json
{
  "gameId": 5589810127, "queueId": 2400, "date": "2026-06-27T01:25:00Z",
  "ourSide": "blue", "result": "loss",
  "blue": { "picks": ["Ornn","Sejuani","Ahri","Sivir","Thresh"], "bans": ["Zed","Lux"],
            "names": ["TheDrunkOfRivia","Teemoboy2011","StyIebender","MonkeyDAdam","YoitsSam"] },
  "red":  { "picks": ["Garen","Lee Sin","Syndra","Caitlyn","Nautilus"], "bans": ["Kassadin","Vi"],
            "names": ["","","","",""] }
}
```
Champion + summoner names are exact display names. `picks`/`bans` are arrays (order = top→support for
picks; ban order for bans). It dedupes by `gameId`, so re-sending is safe. The tracker, Enemy
Champions, and Picks & Bans tabs update automatically.

## Verify
- After POSTing stats: `GET http://localhost:5500/api/roster-stats` → echoes what's stored.
- After adding games: `GET http://localhost:5500/api/live-drafts` → should include the new gameId.
- In the tool, the **Stats** tab shows the numbers; **Tracker / Picks & Bans / Enemy Champs** reflect added games.

Accuracy first — if op.gg shows it, send it; if not, leave it out.
