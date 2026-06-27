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
  return { active: true, ourSide, myRole: me ? (POS2ROLE[me.assignedPosition] || null) : null, teams,
    phase: (s.timer && s.timer.phase) || '',
    // Diagnostics for verifying side/ban detection on a live draft (visible via /api/lcu).
    _debug: { ourSide, localCell: s.localPlayerCellId, myCells, theirCells: (s.theirTeam || []).map(c => c.cellId),
      teamField: me && me.team, banActions: (ab.our.length + ab.their.length), sessionBans: ((s.bans && s.bans.myTeamBans) || []).filter(Boolean).length } };
}
async function champSelect() {
  const a = lcuAuth();
  if (!a) return { active: false, reason: 'League client not running' };
  try {
    const s = await lcuGet(a, '/lol-champ-select/v1/session');
    if (s === '404' || !s) return { active: false, reason: 'not in champ select' };
    return parseSession(s);
  } catch (e) { return { active: false, reason: String(e.message || e) }; }
}

// ── Live draft auto-capture ─────────────────────────────────────────────────
// Watches the League client across champ select → game → result, and saves each
// completed draft (full pick/ban ORDER, both teams, mode, W/L) to live-drafts.json
// — which the tool merges into its learning history. Pick order is only available
// live (Riot's post-game API omits it), so this is the only way to capture it.
const DRAFTS_FILE = path.join(ROOT, 'live-drafts.json');
const QUEUE_MODE = { 420: 'solo', 440: 'flex' /* , <ranked5 id>: 'ranked5' once known */ };
// Resolve a captured game's mode. Ranked 5's is a 5-stack tournament/custom draft whose
// queueId may be custom/unknown — so ANY full-roster drafted game that isn't Flex/Solo is
// treated as Ranked 5's. (Captures are full-roster-only, so this reliably tags them tonight
// even before the exact queueId is known; the queueId is logged so it can be pinned later.)
function resolveMode(queueId, fullRoster) {
  if (queueId === 420) return 'solo';
  if (queueId === 440) return 'flex';
  return fullRoster ? 'ranked5' : 'other';
}
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
async function resolveResult(a, gameId) {
  const mh = await lcuGet(a, '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=4');
  const games = (mh && mh.games && mh.games.games) || [];
  const g = gameId ? games.find(x => x.gameId === gameId) : games[0];
  if (!g) return undefined;                       // not in history yet → retry later
  let pid = (g.participantIdentities || []).find(pi => pi.player && pi.player.puuid === myPuuid);
  pid = pid ? pid.participantId : (g.participants && g.participants[0] && g.participants[0].participantId);
  const part = (g.participants || []).find(p => p.participantId === pid);
  return part ? (part.stats && part.stats.win ? 'win' : 'loss') : undefined;
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
      }
    } else if ((phase === 'GameStart' || phase === 'InProgress') && watch.pending) {
      if (!watch.pending.gameId && sess.gameData && sess.gameData.gameId) watch.pending.gameId = sess.gameData.gameId;
      watch.pending.inGame = true;
    } else if (watch.pending && watch.pending.inGame && !['GameStart', 'InProgress', 'ChampSelect'].includes(phase)) {
      // Game ended.
      const gid = watch.pending.gameId;
      if (gid && watch.savedIds.has(gid)) { watch.pending = null; watch.tries = 0; return; }
      // Only SAVE full-roster games to the learning history (skip games with randoms) —
      // the live draft/suggestions still ran, we just don't record this one.
      if (!watch.pending.fullRoster) { console.log('skipped capture — not a full-roster game'); if (gid) watch.savedIds.add(gid); watch.pending = null; watch.tries = 0; return; }
      // resolve W/L from match history (retry a few ticks until it lands).
      const result = await resolveResult(a, gid);
      watch.tries++;
      if (result !== undefined || watch.tries > 12) {
        const p = watch.pending;
        const entry = { gameId: gid || Date.now(), date: p.date, queueId: p.queueId, mode: resolveMode(p.queueId, p.fullRoster),
          ourSide: p.ourSide, sequence: p.sequence, blue: p.blue, red: p.red, result: result || null, notes: 'Auto-captured live', live: true };
        saveDraftEntry(entry); if (gid) watch.savedIds.add(gid);
        console.log(`   queueId=${p.queueId} → mode=${entry.mode}`);   // so the Ranked 5's queueId can be identified on first play
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
  setInterval(watchTick, 3000);   // capture champ select → game → result
  console.log('Live draft auto-capture armed.');
});
