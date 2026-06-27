// KQF Draft Tool — LIVE COMPANION (run on your PC during games).
//   node companion.js      → open http://localhost:5500
//
// Serves the draft tool AND reads your live champ select from the League client
// (LCU API) so picks/bans auto-fill and suggestions update as the draft happens.
// The public website can't do this (browsers can't read your client) — this local
// app can, because it runs on your machine. Node only; no installs.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';   // LCU uses a self-signed cert (local only)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 5500;
const ROOT = path.resolve(__dirname);
const COMPANION_BUILD = '2026-06-27.cowork';   // bumped on companion changes — shown by /api/status
const LOCKFILES = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  process.env.LOCALAPPDATA + '\\Riot Games\\League of Legends\\lockfile',
];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const POS2ROLE = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'support' };
const SCOUT_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };

// Parse a summoner's ranked champion pool (games/wins/WR per champ) off their op.gg
// page — used to SCOUT enemy summoners and target-ban their comfort champs.
function parsePool(html) {
  const u = html.replace(/\\"/g, '"');
  const out = [], seen = new Set();
  const re = /"match_up_stats":/g; let m;
  while ((m = re.exec(u))) {
    const head = u.slice(Math.max(0, m.index - 800), m.index);
    const hm = [...head.matchAll(/\{"id":(\d+),"play":(\d+),"win":(\d+),"lose":(\d+),"win_rate":([\d.]+)/g)];
    if (!hm.length) continue;
    const x = hm[hm.length - 1], id = +x[1];
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({ championId: id, games: +x[2], wins: +x[3], winRate: Math.round(+x[5]) });
  }
  return out.sort((a, b) => b.games - a.games);
}
// Aggregate a player's OP.GG champion pool into overall stats. Only fields OP.GG actually exposes
// for the player are computed (games, win rate, KDA, avg K/D/A) — CS/min, GPM, DMG%, vision etc.
// live in OP.GG's global meta data, NOT the player's pool, so they're intentionally omitted.
function parsePlayerStats(html) {
  const u = html.replace(/\\"/g, '"');
  const re = /"match_up_stats":/g; let m; const seen = new Set();
  let games = 0, wins = 0, K = 0, D = 0, A = 0;
  while ((m = re.exec(u))) {
    const head = u.slice(Math.max(0, m.index - 1400), m.index);
    const hm = [...head.matchAll(/\{"id":(\d+),"play":(\d+),"win":(\d+),"lose":(\d+),"win_rate":([\d.]+)/g)];
    if (!hm.length) continue;
    const x = hm[hm.length - 1], id = +x[1]; if (id <= 0 || seen.has(id)) continue; seen.add(id);
    const tail = head.slice(head.lastIndexOf('{"id":' + id));
    const km = tail.match(/"kda":\{"kda":[\d.]+,"kill":(\d+),"death":(\d+),"assist":(\d+)/);
    games += +x[2]; wins += +x[3];
    if (km) { K += +km[1]; D += +km[2]; A += +km[3]; }
  }
  if (!games) return null;
  return { games, wins, wr: Math.round(wins / games * 100), kda: +((K + A) / Math.max(1, D)).toFixed(2),
    avgK: +(K / games).toFixed(1), avgD: +(D / games).toFixed(1), avgA: +(A / games).toFixed(1) };
}
const _statsCache = {};   // "name#tag" -> { t, stats }
async function playerStats(name, tag) {
  const key = (name + '#' + tag).toLowerCase();
  const c = _statsCache[key];
  if (c && Date.now() - c.t < 30 * 60 * 1000) return c.stats;
  const url = `https://op.gg/summoners/na/${encodeURIComponent(name)}-${encodeURIComponent(tag || 'NA1')}/champions`;
  // op.gg occasionally returns a page without the embedded data — retry a couple times before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: SCOUT_UA });
      if (r.ok) {
        const stats = parsePlayerStats(await r.text());
        if (stats) { _statsCache[key] = { t: Date.now(), stats }; return stats; }   // only cache SUCCESS
      }
    } catch { /* network hiccup — retry */ }
    await new Promise(r => setTimeout(r, 1200));
  }
  return null;   // not cached, so it retries next time
}
const _scoutCache = {};   // "name#tag" -> { t, pool }
async function scoutSummoner(name, tag) {
  const key = (name + '#' + tag).toLowerCase();
  const c = _scoutCache[key];
  if (c && Date.now() - c.t < 30 * 60 * 1000) return c.pool;   // 30-min cache
  const url = `https://op.gg/summoners/na/${encodeURIComponent(name)}-${encodeURIComponent(tag || 'NA1')}/champions`;
  const r = await fetch(url, { headers: SCOUT_UA });
  if (!r.ok) return null;
  const pool = parsePool(await r.text());
  _scoutCache[key] = { t: Date.now(), pool };
  return pool;
}

function lcuAuth() {
  for (const f of LOCKFILES) {
    try {
      const parts = fs.readFileSync(f, 'utf8').split(':');   // name:pid:port:password:protocol
      if (parts.length >= 5) return { port: parts[2], auth: 'Basic ' + Buffer.from('riot:' + parts[3]).toString('base64') };
    } catch { /* try next */ }
  }
  return null;
}
async function lcuGet(a, p) {
  const r = await fetch(`https://127.0.0.1:${a.port}${p}`, { headers: { Authorization: a.auth } });
  return r.ok ? r.json() : (r.status === 404 ? '404' : null);
}
// Parse a champ-select session into the tool's draft shape.
// Which side are WE on? Prefer the player's team field (100/1 = blue, 200/2 = red), then our
// own cell id (blue 0-4, red 5-9), then the team's cell range. Robust across draft types.
function detectBlue(s) {
  const myTeam = s.myTeam || [];
  const me = myTeam.find(c => c.cellId === s.localPlayerCellId) || myTeam[0];
  const tm = me && me.team;
  if (tm === 1 || tm === 100) return true;
  if (tm === 2 || tm === 200) return false;
  if (s.localPlayerCellId != null) return s.localPlayerCellId < 5;
  const cells = myTeam.map(c => c.cellId);
  return cells.length ? cells.every(c => c < 5) : true;
}
// Bans read from the champ-select ACTION log — the reliable live source. session.bans.*
// is flaky (often empty during tournament-draft ban phases), so we key off the ban actions
// (championId set = hovered or locked) and split them by the actor's cell into our/their.
function bansFromActions(s, myCells) {
  const mine = new Set(myCells), our = [], their = [];
  for (const phase of (s.actions || [])) for (const act of (phase || [])) {
    if (act.type !== 'ban' || !act.championId) continue;
    (mine.has(act.actorCellId) ? our : their).push(act.championId);
  }
  return { our, their };
}
const mergeBans = (a, b) => [...new Set([...(a || []), ...(b || [])].filter(Boolean))];
function parseSession(s) {
  const myCells = (s.myTeam || []).map(c => c.cellId);
  const weAreBlue = detectBlue(s);
  const ourSide = weAreBlue ? 'blue' : 'red', theirSide = weAreBlue ? 'red' : 'blue';
  const teamPicks = (team) => (team || []).map(c => ({
    championId: c.championId || 0,
    role: POS2ROLE[c.assignedPosition] || null,
    name: c.gameName || c.summonerName || '',     // enemy names are usually hidden (empty) in ranked
    tag: c.tagLine || '',                          // tagline for op.gg scouting (when visible)
  })).filter(p => p.championId || p.role);
  const ab = bansFromActions(s, myCells);
  const teams = {};
  teams[ourSide] = { picks: teamPicks(s.myTeam), bans: mergeBans(s.bans && s.bans.myTeamBans, ab.our) };
  teams[theirSide] = { picks: teamPicks(s.theirTeam), bans: mergeBans(s.bans && s.bans.theirTeamBans, ab.their) };
  const me = (s.myTeam || []).find(c => c.cellId === s.localPlayerCellId);
  const queueId = s.queueId || null;
  return { active: true, ourSide, myRole: me ? (POS2ROLE[me.assignedPosition] || null) : null, teams,
    queueId, mode: resolveMode(queueId),   // 'flex' | 'ranked5' | null (null = a mode we don't track)
    phase: (s.timer && s.timer.phase) || '',
    // Diagnostics for verifying side/ban detection on a live draft (visible via /api/lcu).
    _debug: { ourSide, localCell: s.localPlayerCellId, myCells, theirCells: (s.theirTeam || []).map(c => c.cellId),
      teamField: me && me.team, banActions: (ab.our.length + ab.their.length), sessionBans: ((s.bans && s.bans.myTeamBans) || []).filter(Boolean).length } };
}
async function champSelect() {
  const a = lcuAuth();
  if (!a) return { active: false, reason: 'League client not running' };
  try {
    let gamePhase = '';
    try { const gf = await lcuGet(a, '/lol-gameflow/v1/phase'); if (gf && gf !== '404') gamePhase = String(gf); } catch {}
    const s = await lcuGet(a, '/lol-champ-select/v1/session');
    if (s === '404' || !s) return { active: false, reason: gamePhase ? ('phase: ' + gamePhase) : 'not in champ select', gamePhase };
    const parsed = parseSession(s); parsed.gamePhase = gamePhase || 'ChampSelect';
    return parsed;
  } catch (e) { return { active: false, reason: String(e.message || e) }; }
}

// ── Live draft auto-capture ─────────────────────────────────────────────────
// Watches the League client across champ select → game → result, and saves each
// completed draft (full pick/ban ORDER, both teams, mode, W/L) to live-drafts.json
// — which the tool merges into its learning history. Pick order is only available
// live (Riot's post-game API omits it), so this is the only way to capture it.
const DRAFTS_FILE = path.join(ROOT, 'live-drafts.json');
// We ONLY track two modes: Flex (queueId 440) and Ranked 5's / scrims (queueId 710, shown as
// "Featured" on op.gg — tournament draft). Every other queue is null and NOT captured/synced.
// NOTE: queueId 2400 is "ARAM: Mayhem" (an event mode), NOT Ranked 5's — do not track it.
const QUEUE_MODE = { 440: 'flex', 710: 'ranked5' };
function resolveMode(queueId) { return QUEUE_MODE[queueId] || null; }
// Roster account names (lowercased) — used to detect a FULL-roster game. Live drafting
// always runs off MonkeyDAdam's client; teammates' names are visible in champ select.
const ROSTER_NAMES = new Set(['thedrunkofrivia', 'teemoboy2011', 'styiebender', 'monkeydadam', 'yoitssam', 'lp fisherman']);
// Include any custom-added players (e.g. Kyle / "maul me maybe") so full-roster detection
// and per-player learning count them too.
try {
  const _ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'roster-custom.json'), 'utf8'));
  for (const p of (Array.isArray(_ex) ? _ex : [])) if (p && p.name) ROSTER_NAMES.add(String(p.name).toLowerCase());
} catch { /* no custom players */ }
const POS_ROLE = { top: 0, jungle: 1, mid: 2, adc: 3, support: 4 };
let CHAMP_NAME = {};       // championId -> name (from Data Dragon, loaded at startup)
let myPuuid = null;
const watch = { pending: null, savedIds: new Set(), tries: 0 };

function loadDrafts() { try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')) || []; } catch { return []; } }
function saveDraftEntry(entry) {
  const all = loadDrafts();
  if (all.some(d => d.gameId === entry.gameId)) return;
  all.unshift(entry);
  if (all.length > 200) all.length = 200;
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify(all, null, 2));
  console.log(`✓ captured draft (game ${entry.gameId}, ${entry.mode}${entry.result ? ', ' + entry.result : ''})`);
}
async function loadChampNames() {
  try {
    const ver = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
    const data = (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/champion.json`)).json()).data;
    for (const c of Object.values(data)) CHAMP_NAME[+c.key] = c.name;
  } catch { /* names fill best-effort; ids still saved */ }
}
const nm = id => CHAMP_NAME[id] || null;

// Build the saved-draft-shaped snapshot (names) from a champ-select session.
function snapshotDraft(s) {
  const myCells = (s.myTeam || []).map(c => c.cellId);
  const weBlue = detectBlue(s);
  const ourSide = weBlue ? 'blue' : 'red';
  const side = { blue: { picks: [null,null,null,null,null], bans: [null,null,null,null,null], names: ['','','','',''], roles: ['top','jungle','mid','adc','support'] },
                 red:  { picks: [null,null,null,null,null], bans: [null,null,null,null,null], names: ['','','','',''], roles: ['top','jungle','mid','adc','support'] } };
  const teamSideOf = cell => (cell < 5) === weBlue ? ourSide : (ourSide === 'blue' ? 'red' : 'blue');
  const fill = (cells, isOurTeam) => (cells || []).forEach(c => {
    const sd = isOurTeam ? ourSide : (ourSide === 'blue' ? 'red' : 'blue');
    const slot = POS_ROLE[POS2ROLE[c.assignedPosition]] ?? side[sd].picks.indexOf(null);
    if (slot >= 0 && c.championId) {
      side[sd].picks[slot] = nm(c.championId);
      side[sd].roles[slot] = POS2ROLE[c.assignedPosition] || side[sd].roles[slot];
      // Record WHO played it on our team (summoner gameName) so the tool can learn each
      // player's pool from real games and add picked champs to their pool.
      if (isOurTeam) side[sd].names[slot] = c.gameName || c.summonerName || '';
    }
  });
  fill(s.myTeam, true); fill(s.theirTeam, false);
  // FULL-ROSTER check: are all 5 of our team roster accounts? (LP Fisherman subbing in
  // still counts.) If 1+ random, we won't save it to the learning history.
  const allies = (s.myTeam || []).map(c => (c.gameName || c.summonerName || '').toLowerCase()).filter(Boolean);
  const fullRoster = (s.myTeam || []).length >= 5 && allies.filter(n => ROSTER_NAMES.has(n)).length >= 5;
  // Bans from the action log (reliable) merged with session.bans.* — mapped to champ names.
  const ab = bansFromActions(s, (s.myTeam || []).map(c => c.cellId));
  const banList = (arr) => mergeBans(arr, []).map(nm).filter(Boolean);
  side[ourSide].bans = banList(mergeBans(s.bans && s.bans.myTeamBans, ab.our));
  side[ourSide === 'blue' ? 'red' : 'blue'].bans = banList(mergeBans(s.bans && s.bans.theirTeamBans, ab.their));
  // Pick/ban order from the action log.
  const sequence = [];
  for (const phase of (s.actions || [])) for (const act of phase) {
    if (!act.completed || !act.championId) continue;
    sequence.push({ team: teamSideOf(act.actorCellId), type: act.type === 'ban' ? 'ban' : 'pick', champ: nm(act.championId) });
  }
  return { ourSide, sequence, blue: side.blue, red: side.red, fullRoster };
}
// Role for a post-game participant: teamPosition if present, else lane+role heuristic.
function lcuRoleOf(p) {
  const tp = (p.teamPosition || '').toLowerCase();
  if (POS2ROLE[tp]) return POS2ROLE[tp];
  const lane = ((p.timeline && p.timeline.lane) || p.lane || '').toUpperCase();
  const role = ((p.timeline && p.timeline.role) || p.role || '').toUpperCase();
  if (lane === 'TOP') return 'top';
  if (lane === 'JUNGLE') return 'jungle';
  if (lane === 'MIDDLE' || lane === 'MID') return 'mid';
  if (lane === 'BOTTOM' || lane === 'BOT') return role.includes('SUPPORT') ? 'support' : 'adc';
  return null;
}
// Pull a finished game from LCU match history (recent window). gameId optional → latest.
async function fetchGame(a, gameId) {
  const mh = await lcuGet(a, '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19');
  const games = (mh && mh.games && mh.games.games) || [];
  return gameId ? games.find(x => x.gameId === gameId) : games[0];
}
// Rebuild a saved-draft-shaped object from POST-GAME match data — has picks, result, AND bans
// reliably (the live champ-select doesn't always expose bans, e.g. Ranked 5's). No pick ORDER.
function parseGame(g) {
  if (!g) return null;
  const idents = {};
  for (const pi of (g.participantIdentities || [])) idents[pi.participantId] = pi.player || {};
  const parts = (g.participants || []).map(p => {
    const pl = idents[p.participantId] || {};
    return { championId: p.championId, teamId: p.teamId, role: lcuRoleOf(p),
      name: pl.gameName || pl.summonerName || '', puuid: pl.puuid || '', win: !!(p.stats && p.stats.win) };
  });
  const meP = parts.find(p => p.puuid === myPuuid) || parts[0];
  if (!meP) return null;
  const ourTeamId = meP.teamId, ourSide = ourTeamId === 100 ? 'blue' : 'red';
  const ourCount = parts.filter(p => p.teamId === ourTeamId && ROSTER_NAMES.has((p.name || '').toLowerCase())).length;
  const bansByTeam = {};
  for (const t of (g.teams || [])) bansByTeam[t.teamId] = (t.bans || []).slice()
    .sort((x, y) => (x.pickTurn || 0) - (y.pickTurn || 0)).map(b => b.championId).filter(c => c > 0);
  const buildSide = (teamId, withNames) => {
    const sd = { picks: [null,null,null,null,null], bans: [], names: ['','','','',''], roles: ['top','jungle','mid','adc','support'] };
    for (const p of parts.filter(x => x.teamId === teamId)) {
      let slot = POS_ROLE[p.role];
      if (slot == null || sd.picks[slot]) slot = sd.picks.indexOf(null);
      if (slot >= 0 && slot < 5) { sd.picks[slot] = nm(p.championId); if (p.role) sd.roles[slot] = p.role; if (withNames) sd.names[slot] = p.name; }
    }
    sd.bans = (bansByTeam[teamId] || []).map(nm).filter(Boolean);
    return sd;
  };
  return { ourSide, fullRoster: ourCount >= 5, result: meP.win ? 'win' : 'loss',
    queueId: g.queueId, date: new Date(g.gameCreation || Date.now()).toISOString(),
    blue: buildSide(100, ourSide === 'blue'), red: buildSide(200, ourSide === 'red') };
}
// Safety net: auto-save any completed full-roster game that the live watcher missed (e.g. the
// companion restarted mid-game) — reconstructed entirely from match history, bans included.
async function reconcileMatchHistory(a) {
  try {
    if (!myPuuid) { const me = await lcuGet(a, '/lol-summoner/v1/current-summoner'); if (me && me !== '404') myPuuid = me.puuid; }
    if (!myPuuid) return 0;
    const mh = await lcuGet(a, '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19');
    const games = (mh && mh.games && mh.games.games) || [];
    const drafts = loadDrafts();
    const byId = new Map(drafts.map(d => [d.gameId, d]));
    let changed = 0, dirty = false;
    for (const g of games) {
      const gid = g.gameId; if (!gid) continue;
      const existing = byId.get(gid);
      if (existing) {
        // Already saved — but backfill bans if the live capture missed them (e.g. Ranked 5's).
        const noBans = !((existing.blue && existing.blue.bans || []).length) && !((existing.red && existing.red.bans || []).length);
        if (noBans && existing.blue && existing.red) {
          const pg = parseGame(g);
          if (pg && ((pg.blue.bans || []).length || (pg.red.bans || []).length)) {
            existing.blue.bans = pg.blue.bans; existing.red.bans = pg.red.bans; dirty = true; changed++;
            console.log(`✓ backfilled bans for game ${gid} from match history`);
          }
        }
        watch.savedIds.add(gid); continue;
      }
      if (watch.savedIds.has(gid)) continue;
      if (watch.pending && watch.pending.gameId === gid) continue;   // let the live capture (with pick order) win
      const pg = parseGame(g);
      if (!pg) continue;
      const rMode = resolveMode(pg.queueId);
      // Ranked 5's is ALWAYS a full 5-stack, but Riot strips its match history to only our own
      // player (no teammates/bans) → parseGame can't see a full roster. Still record it (result +
      // our champ) so the record/history are accurate; full draft only comes from the live capture.
      const isR5 = rMode === 'ranked5';
      if (!rMode || (!pg.fullRoster && !isR5)) { watch.savedIds.add(gid); continue; }   // not Flex/Ranked5, or Flex w/ randoms
      const partial = isR5 && !pg.fullRoster;
      const entry = { gameId: gid, date: pg.date, queueId: pg.queueId, mode: rMode,
        ourSide: pg.ourSide, blue: pg.blue, red: pg.red, result: pg.result, partial,
        notes: partial ? 'Recovered from match history (Riot strips Ranked 5s draft — result only)' : 'Auto-saved from match history', live: false };
      drafts.unshift(entry); byId.set(gid, entry); watch.savedIds.add(gid); dirty = true; changed++;
      console.log(`✓ auto-saved completed game ${gid} (${entry.mode}, ${entry.result}) from match history`);
    }
    if (dirty) { if (drafts.length > 200) drafts.length = 200; fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2)); }
    return changed;
  } catch { return 0; }   // match history unavailable — try again next pass
}
async function watchTick() {
  const a = lcuAuth(); if (!a) return;
  try {
    if (!myPuuid) { const me = await lcuGet(a, '/lol-summoner/v1/current-summoner'); if (me && me !== '404') myPuuid = me.puuid; }
    const sess = await lcuGet(a, '/lol-gameflow/v1/session');
    const phase = (sess && sess !== '404' && sess.phase) || 'None';
    if (phase === 'ChampSelect') {
      const cs = await lcuGet(a, '/lol-champ-select/v1/session');
      if (cs && cs !== '404') {
        const queueId = (sess.gameData && sess.gameData.queue && sess.gameData.queue.id) || null;
        watch.pending = { gameId: null, queueId, date: new Date().toISOString(), ...snapshotDraft(cs) };
        // Diagnostic dump (local only, gitignored): the raw ban/action structure of the live
        // session, so we can pin where Ranked 5's stores bans. Keeps the latest tick per queue.
        try { fs.writeFileSync(path.join(ROOT, 'champ-select-dump.json'),
          JSON.stringify({ queueId, topKeys: Object.keys(cs), bans: cs.bans, actions: cs.actions, timer: cs.timer,
            myTeam: (cs.myTeam || []).map(c => ({ cellId: c.cellId, championId: c.championId, championPickIntentId: c.championPickIntentId, banIntentId: c.banIntentId, team: c.team, assignedPosition: c.assignedPosition })) }, null, 2)); } catch {}
      }
    } else if ((phase === 'GameStart' || phase === 'InProgress') && watch.pending) {
      if (!watch.pending.gameId && sess.gameData && sess.gameData.gameId) watch.pending.gameId = sess.gameData.gameId;
      watch.pending.inGame = true;
    } else if (watch.pending && watch.pending.inGame && !['GameStart', 'InProgress', 'ChampSelect'].includes(phase)) {
      // Game ended.
      const gid = watch.pending.gameId;
      if (gid && watch.savedIds.has(gid)) { watch.pending = null; watch.tries = 0; return; }
      // Only SAVE Flex/Ranked-5's full-roster games. Skip other modes (normals/bots/etc.) and
      // games with randoms — the live draft still ran, we just don't record this one.
      const wMode = resolveMode(watch.pending.queueId);
      if (!wMode || !watch.pending.fullRoster) {
        console.log(`skipped capture — ${!wMode ? 'queue ' + watch.pending.queueId + ' not tracked' : 'not a full-roster game'}`);
        if (gid) watch.savedIds.add(gid); watch.pending = null; watch.tries = 0; return;
      }
      // Pull the finished game from match history (retry a few ticks until it lands) — gives
      // W/L AND bans, which the live champ-select may not have exposed (e.g. Ranked 5's).
      const g = await fetchGame(a, gid);
      const pg = g ? parseGame(g) : null;
      const result = pg ? pg.result : undefined;
      watch.tries++;
      if (result !== undefined || watch.tries > 12) {
        const p = watch.pending;
        // Backfill bans from post-game data if the live snapshot didn't capture any.
        if (pg) {
          if (!(p.blue.bans || []).length) p.blue.bans = pg.blue.bans;
          if (!(p.red.bans || []).length) p.red.bans = pg.red.bans;
        }
        const entry = { gameId: gid || Date.now(), date: p.date, queueId: p.queueId, mode: wMode,
          ourSide: p.ourSide, sequence: p.sequence, blue: p.blue, red: p.red, result: result || null, notes: 'Auto-captured live', live: true };
        saveDraftEntry(entry); if (gid) watch.savedIds.add(gid);
        console.log(`   queueId=${p.queueId} → mode=${entry.mode}`);
        watch.pending = null; watch.tries = 0;
      }
    }
  } catch { /* transient LCU error — try next tick */ }
}

const J = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/api/lcu') {
    const data = await champSelect();
    return J(res, 200, data);
  }
  // Scout an enemy summoner's op.gg ranked pool (for target-ban suggestions).
  if (url === '/api/scout') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const name = (q.get('name') || '').trim(), tag = (q.get('tag') || 'NA1').trim();
    if (!name) return J(res, 400, { ok: false, error: 'name required' });
    try { const pool = await scoutSummoner(name, tag); return J(res, 200, { ok: !!pool, name, tag, pool: pool || [] }); }
    catch (e) { return J(res, 200, { ok: false, error: String(e.message || e), pool: [] }); }
  }
  // Per-player OP.GG stats (games, win rate, KDA, avg K/D/A) for the Stats tab.
  if (url === '/api/player-stats') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const name = (q.get('name') || '').trim(), tag = (q.get('tag') || 'NA1').trim();
    if (!name) return J(res, 400, { ok: false, error: 'name required' });
    try { const stats = await playerStats(name, tag); return J(res, 200, { ok: !!stats, name, tag, stats: stats || null }); }
    catch (e) { return J(res, 200, { ok: false, error: String(e.message || e), stats: null }); }
  }
  // Paste a fresh Riot key → run the roster re-pull live (key only as an env var to
  // the child process; never written to disk; roster-data.js output is pure stats).
  if (req.method === 'POST' && url === '/api/refresh-roster') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4000) req.destroy(); });
    req.on('end', () => {
      let key = ''; try { key = (JSON.parse(body).key || '').trim(); } catch {}
      if (!/^RGAPI-[0-9a-f-]+$/i.test(key)) return J(res, 400, { ok: false, error: 'That is not a valid RGAPI- key.' });
      // Only ONE refresh at a time — concurrent runs hammer Riot with the same dev key and
      // rate-limit each other into spurious failures.
      if (global._refreshRunning) return J(res, 409, { ok: false, error: 'A refresh is already running — give it a moment.' });
      global._refreshRunning = true;
      const done = (code, obj) => { global._refreshRunning = false; J(res, code, obj); };
      execFile(process.execPath, ['scripts/refresh-roster.js'],
        // Riot's API has valid certs → keep TLS verification ON for the child (only the
        // LCU needs it relaxed). Key passed as env only; never written to disk.
        { cwd: ROOT, env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', RIOT_KEY: key }, timeout: 180000, maxBuffer: 1 << 20 },
        (err, stdout, stderr) => {
          if (err) {
            const lines = ((stderr || err.message) || '').toString().trim().split('\n').filter(l => l.trim());
            return done(500, { ok: false, error: lines.pop() || 'refresh failed' });
          }
          done(200, { ok: true, log: stdout.toString().trim().split('\n').slice(-6) });
        });
    });
    return;
  }
  // Persist the user's custom roster players to a file the refresh scripts read,
  // so added players' op.gg pools + Riot games get pulled on the next refresh.
  if (req.method === 'POST' && url === '/api/save-roster') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      try {
        const arr = JSON.parse(body);
        if (!Array.isArray(arr)) throw 0;
        fs.writeFileSync(path.join(ROOT, 'roster-custom.json'), JSON.stringify(arr, null, 2));
        J(res, 200, { ok: true });
      } catch { J(res, 400, { ok: false, error: 'bad payload' }); }
    });
    return;
  }
  // ── COWORK bridge ──────────────────────────────────────────────────────────
  // A Claude-in-browser agent reads op.gg (which the API/scrape can't reliably give us) and
  // POSTs accurate data here; the tool reads it back. roster-stats.json holds per-player stats.
  const STATS_FILE = path.join(ROOT, 'roster-stats.json');
  const loadStats = () => { try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) || {}; } catch { return {}; } };
  if (url === '/api/roster-stats') return J(res, 200, loadStats());
  // Team handshake — Cowork hits this to confirm it's talking to the right (current) companion and
  // to see the same live state Claude Code sees. If this responds, the companion is up-to-date.
  if (url === '/api/status') {
    const drafts = loadDrafts(), st = loadStats();
    const byMode = drafts.reduce((a, d) => { const m = resolveMode(d.queueId) || d.mode || '?'; a[m] = (a[m] || 0) + 1; return a; }, {});
    return J(res, 200, { ok: true, companion: COMPANION_BUILD, contract: '/COWORK.md',
      recordedGames: drafts.length, gamesByMode: byMode,
      statsPlayers: { flex: Object.keys(st.flex || {}).length, ranked5: Object.keys(st.ranked5 || {}).length }, statsUpdated: st.updated || null,
      endpoints: ['GET /api/live-drafts', 'POST /api/add-game', 'GET /api/roster-stats', 'POST /api/set-roster-stats'] });
  }
  if (req.method === 'POST' && url === '/api/set-roster-stats') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        const mode = p.mode === 'ranked5' ? 'ranked5' : 'flex';
        if (!p.stats || typeof p.stats !== 'object') throw 0;
        const all = loadStats(); all[mode] = all[mode] || {};
        for (const k in p.stats) all[mode][k.toLowerCase()] = p.stats[k];   // merge per player
        all.updated = new Date().toISOString();
        fs.writeFileSync(STATS_FILE, JSON.stringify(all, null, 2));
        J(res, 200, { ok: true, mode, players: Object.keys(p.stats).length });
      } catch { J(res, 400, { ok: false, error: 'bad payload' }); }
    });
    return;
  }
  // Cowork backfills a full game (e.g. a Ranked 5's match Riot stripped locally) into the captures.
  if (req.method === 'POST' && url === '/api/add-game') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 100000) req.destroy(); });
    req.on('end', () => {
      try {
        const g = JSON.parse(body);
        if (!g.gameId || !g.blue || !g.red) throw 0;
        const entry = { gameId: g.gameId, date: g.date || new Date().toISOString(), queueId: g.queueId,
          mode: resolveMode(g.queueId) || (g.mode === 'ranked5' ? 'ranked5' : 'flex'),
          ourSide: g.ourSide || 'blue', blue: g.blue, red: g.red, result: g.result || null,
          notes: 'Backfilled via Cowork (op.gg)', live: false };
        const before = loadDrafts().length;
        saveDraftEntry(entry);   // dedupes by gameId
        J(res, 200, { ok: true, added: loadDrafts().length > before, mode: entry.mode });
      } catch { J(res, 400, { ok: false, error: 'bad payload' }); }
    });
    return;
  }
  // Auto-captured live drafts (full pick/ban order + result) for the tool to merge.
  if (url === '/api/live-drafts') return J(res, 200, loadDrafts());
  let file = path.join(ROOT, url === '/' ? '/draft-tool.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    // Never cache — always serve the latest file so the bookmarked page updates on refresh.
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store, must-revalidate' });
    res.end(buf);
  });
}).listen(PORT, async () => {
  console.log(`KQF Draft Tool (LIVE) → http://localhost:${PORT}`);
  console.log(lcuAuth() ? 'League client detected ✓' : 'League client not detected yet (start it & enter champ select).');
  for (const d of loadDrafts()) if (d.gameId) watch.savedIds.add(d.gameId);   // don't re-save known games
  await loadChampNames();
  setInterval(watchTick, 3000);   // capture champ select → game → result (LIVE only)
  // NOTE: client match-history reconcile is intentionally DISABLED — tracking is a running update
  // from live captures as games are played; op.gg is used to verify/fill stats. (reconcileMatchHistory
  // is kept in the file but not scheduled.)
  console.log('Live draft auto-capture armed.');
});
