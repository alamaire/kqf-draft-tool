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
function parseSession(s) {
  const myCells = (s.myTeam || []).map(c => c.cellId);
  const weAreBlue = myCells.length ? myCells.every(c => c < 5) : true;
  const ourSide = weAreBlue ? 'blue' : 'red', theirSide = weAreBlue ? 'red' : 'blue';
  const teamPicks = (team) => (team || []).map(c => ({
    championId: c.championId || 0,
    role: POS2ROLE[c.assignedPosition] || null,
    name: c.gameName || c.summonerName || '',     // enemy names are usually hidden (empty) in ranked
  })).filter(p => p.championId || p.role);
  const teams = {};
  teams[ourSide] = { picks: teamPicks(s.myTeam), bans: (s.bans && s.bans.myTeamBans || []).filter(Boolean) };
  teams[theirSide] = { picks: teamPicks(s.theirTeam), bans: (s.bans && s.bans.theirTeamBans || []).filter(Boolean) };
  const me = (s.myTeam || []).find(c => c.cellId === s.localPlayerCellId);
  return { active: true, ourSide, myRole: me ? (POS2ROLE[me.assignedPosition] || null) : null, teams,
    phase: (s.timer && s.timer.phase) || '' };
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

const J = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/api/lcu') {
    const data = await champSelect();
    return J(res, 200, data);
  }
  // Paste a fresh Riot key → run the roster re-pull live (key only as an env var to
  // the child process; never written to disk; roster-data.js output is pure stats).
  if (req.method === 'POST' && url === '/api/refresh-roster') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4000) req.destroy(); });
    req.on('end', () => {
      let key = ''; try { key = (JSON.parse(body).key || '').trim(); } catch {}
      if (!/^RGAPI-[0-9a-f-]+$/i.test(key)) return J(res, 400, { ok: false, error: 'That is not a valid RGAPI- key.' });
      execFile(process.execPath, ['scripts/refresh-roster.js'],
        // Riot's API has valid certs → keep TLS verification ON for the child (only the
        // LCU needs it relaxed). Key passed as env only; never written to disk.
        { cwd: ROOT, env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', RIOT_KEY: key }, timeout: 180000, maxBuffer: 1 << 20 },
        (err, stdout, stderr) => {
          if (err) {
            const lines = ((stderr || err.message) || '').toString().trim().split('\n').filter(l => l.trim());
            return J(res, 500, { ok: false, error: lines.pop() || 'refresh failed' });
          }
          J(res, 200, { ok: true, log: stdout.toString().trim().split('\n').slice(-6) });
        });
    });
    return;
  }
  let file = path.join(ROOT, url === '/' ? '/draft-tool.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`KQF Draft Tool (LIVE) → http://localhost:${PORT}`);
  console.log(lcuAuth() ? 'League client detected ✓' : 'League client not detected yet (start it & enter champ select).');
});
