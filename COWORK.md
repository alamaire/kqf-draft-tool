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

## 1) Per-player Stats → POST /api/set-roster-stats
Compute each player's averages **over our recorded games for that mode** (match op.gg games to the
gameIds/dates from `/api/live-drafts`). Send numbers only (no `%`/units). Omit any field you can't read.

```
POST http://localhost:5500/api/set-roster-stats
Content-Type: application/json
{
  "mode": "flex",            // or "ranked5"
  "stats": {
    "monkeydadam": { "kda": 3.1, "avgK": 6.2, "avgD": 4.1, "avgA": 8.0, "csm": 7.4, "gpm": 410, "kp": 62, "dmg": 28, "vspm": 1.1 },
    "yoitssam":    { "kda": 2.6, "avgK": 2.4, "avgD": 5.8, "avgA": 12.4, "csm": 1.1, "gpm": 250, "kp": 64, "dmg": 9, "vspm": 2.3 }
  }
}
```
Keys are the **lowercase account name** (left column above, lowercased: `thedrunkofrivia`,
`teemoboy2011`, `styiebender`, `monkeydadam`, `yoitssam`, `lp fisherman`, `maul me maybe`).
Fields shown in the Stats tab: `kda, avgK, avgD, avgA, csm, gpm, kp, dmg, vspm`. Send what op.gg
shows; missing ones display as "—". POST again anytime to update (it merges by player).

## 2) Backfill a missing game → POST /api/add-game
For Ranked 5's games Riot stripped locally (or any full-roster game missing from the tracker), read
the op.gg match page and send the full draft. `ourSide` = the side our roster was on.

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
