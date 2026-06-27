// Pulls the KQF roster's FULL-STACK games (5 roster members on one team) from the
// Riot API and writes roster-data.js (window.ROSTER_DATA), bucketed BY GAME MODE
// (Flex vs Ranked 5's vs other), so each mode's history is separate. Only counts
// games where the roster is present and FULL (any 5 of the 6 members — LP Fisherman
// may sub in for a main). The API key (RIOT_KEY env var) is NEVER written to disk.
//
//   RIOT_KEY=RGAPI-xxxx node scripts/refresh-roster.js
//
// Dev keys expire ~24h → manual re-run to update (the static site/daily Action can't
// hold a key). Re-run after games to keep suggestions learning.

const fs = require('fs');
const path = require('path');
const KEY = process.env.RIOT_KEY;
if (!KEY) { console.error('Set RIOT_KEY env var'); process.exit(1); }
const H = { headers: { 'X-Riot-Token': KEY } };
const REGION = 'americas';
const OUT = path.resolve(__dirname, '..', 'roster-data.js');
const ROSTER = [
  { key: 'thedrunkofrivia', name: 'TheDrunkOfRivia', tag: 'NA1' },
  { key: 'teemoboy2011', name: 'Teemoboy2011', tag: 'Smile' },
  { key: 'styiebender', name: 'StyIebender', tag: 'NA1' },
  { key: 'monkeydadam', name: 'MonkeyDAdam', tag: 'NA1' },
  { key: 'yoitssam', name: 'YoitsSam', tag: 'NA1' },
  { key: 'lp fisherman', name: 'LP Fisherman', tag: 'NA1' },
];
// Merge any user-added players (written by the companion's /api/save-roster).
try {
  const extra = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'roster-custom.json'), 'utf8'));
  for (const p of (Array.isArray(extra) ? extra : [])) if (p && p.name && !ROSTER.some(r => r.key === p.name)) ROSTER.push({ key: p.name, name: p.display || p.name, tag: p.opggTag || 'NA1' });
} catch { /* no custom roster file */ }
const FULL_ROSTER = 5;          // a team must have this many roster members to count
const FLEX_QUEUE = 440;         // Ranked Flex
const RANKED5_QUEUE = 710;      // Ranked 5's / scrims (op.gg "Featured", tournament draft). NOTE: 2400 = ARAM Mayhem, not this.
const SOLO_QUEUE = 420;         // Ranked Solo/Duo — for the solo-queue matchup history
const SOLO_KEY = 'monkeydadam'; // the player Solo Queue mode optimizes for (SOLO_PLAYER in the tool)
const POS = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'support' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GAP = 800;

let _lastStatus = 0;   // HTTP status of the most recent getJSON call (for diagnostics)
async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, H);
    _lastStatus = r.status;
    if (r.status === 200) return r.json();
    if (r.status === 429) { await sleep(2000); continue; }
    return null;
  }
  return null;
}
// Cached match fetch (so solo + roster passes never double-pull the same match).
const _matchCache = {};
async function getMatch(id) {
  if (_matchCache[id] !== undefined) return _matchCache[id];
  const md = await getJSON(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/${id}`);
  await sleep(GAP);
  return (_matchCache[id] = md);
}
function modeFor(q) { return q === FLEX_QUEUE ? 'flex' : q === RANKED5_QUEUE ? 'ranked5' : 'other'; }

async function main() {
  let puuidToKey = {}, fails = [];
  // A freshly generated dev key can return 401 for a few seconds while it activates on Riot's
  // side. So retry the whole account resolution a few times before declaring the key bad —
  // this self-heals the "paste a fresh key → 401 → works a minute later" case.
  for (let attempt = 1; attempt <= 3; attempt++) {
    puuidToKey = {}; fails = [];
    for (const p of ROSTER) {
      const a = await getJSON(`https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(p.name)}/${encodeURIComponent(p.tag)}`);
      if (a && a.puuid) { puuidToKey[a.puuid] = p.key; console.log('  ✓', `${p.name}#${p.tag}`); }
      else { fails.push({ name: `${p.name}#${p.tag}`, status: _lastStatus }); console.log('  ✗', `${p.name}#${p.tag}`, '→ HTTP', _lastStatus); }
      await sleep(GAP);
    }
    if (Object.keys(puuidToKey).length > 0) break;                 // got at least one → proceed
    const s = (fails[0] && fails[0].status) || 0;
    if ((s === 401 || s === 403 || s === 429) && attempt < 3) {    // transient / key still activating
      console.log(`0 puuids (HTTP ${s}) — key may still be activating; retrying in 7s (attempt ${attempt}/3)…`);
      await sleep(7000);
      continue;
    }
    break;
  }
  console.log('resolved', Object.keys(puuidToKey).length, '/', ROSTER.length, 'puuids');
  // A bad/expired key resolves 0 puuids — fail loudly with the ACTUAL reason instead of
  // overwriting good data. Distinguish bad key (401/403) from name change (404) / limit (429).
  if (Object.keys(puuidToKey).length === 0) {
    const s = (fails[0] && fails[0].status) || 0;
    const why = (s === 401 || s === 403)
      ? `HTTP ${s} — your Riot API key is INVALID or EXPIRED. Dev keys expire every 24h: go to https://developer.riotgames.com/, copy the fresh "Development API Key" (whole RGAPI-… string), and paste it again.`
      : s === 404
      ? `HTTP 404 — the Riot IDs weren't found (a name/tag may have changed). Check the names/tags in scripts/refresh-roster.js.`
      : s === 429
      ? `HTTP 429 — rate limited. Wait ~1 minute, then try again.`
      : `No response from Riot (HTTP ${s || 'n/a'}) — check your internet connection.`;
    console.error('No puuids resolved. ' + why + ' Keeping existing roster-data.js.');
    process.exit(1);
  }

  const matchCount = {};
  for (const puuid of Object.keys(puuidToKey)) {
    const ids = await getJSON(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?count=40`);
    for (const id of (ids || [])) matchCount[id] = (matchCount[id] || 0) + 1;
    await sleep(GAP);
  }
  // a match shared by >=FULL_ROSTER players' lists is a strong full-stack candidate
  const candidates = Object.keys(matchCount).filter(id => matchCount[id] >= FULL_ROSTER);
  console.log('full-stack candidates:', candidates.length);

  // bucket builder: mode -> { record:{games,wins}, pools:{key:{champId:{games,wins}}} }
  const buckets = {};
  const bucket = m => (buckets[m] = buckets[m] || { record: { games: 0, wins: 0 }, pools: {} });
  const queueTally = {};   // queueId -> # of full-roster games (so a new mode self-identifies)
  for (const id of candidates) {
    const md = await getMatch(id);
    if (!md || !md.info) continue;
    const ps = md.info.participants;
    const byTeam = {};
    for (const p of ps) { const k = puuidToKey[p.puuid]; if (k) (byTeam[p.teamId] = byTeam[p.teamId] || []).push(p); }
    const team = Object.values(byTeam).find(arr => arr.length >= FULL_ROSTER);   // FULL roster on one team
    if (!team) continue;
    queueTally[md.info.queueId] = (queueTally[md.info.queueId] || 0) + 1;
    const mode = modeFor(md.info.queueId);
    const b = bucket(mode);
    const won = team[0].win;
    b.record.games++; if (won) b.record.wins++;
    const picks = {};   // nameKey -> championId for THIS game
    for (const p of team) {
      const k = puuidToKey[p.puuid];
      picks[k] = p.championId;
      const pool = b.pools[k] = b.pools[k] || {};
      const c = pool[p.championId] = pool[p.championId] || { championId: p.championId, games: 0, wins: 0 };
      c.games++; if (p.win) c.wins++;
    }
    // Bans, ordered by pickTurn (match-v5 has ban order but NOT pick order).
    const ourTeamId = team[0].teamId, theirTeamId = ourTeamId === 100 ? 200 : 100;
    const banOf = tid => { const t = (md.info.teams || []).find(t => t.teamId === tid); return t ? (t.bans || []).slice().sort((a, b) => a.pickTurn - b.pickTurn).map(b => b.championId).filter(x => x > 0) : []; };
    // per-game record (for the match-history list + per-game analysis)
    (b.games = b.games || []).push({ id, win: won, date: md.info.gameEndTimestamp || md.info.gameCreation || 0, picks, bans: { our: banOf(ourTeamId), their: banOf(theirTeamId) } });
  }

  // shape: each mode + an "all" combined bucket
  const shape = b => ({
    record: b.record,
    pools: Object.fromEntries(Object.entries(b.pools).map(([k, m]) =>
      [k, Object.values(m).map(c => ({ ...c, winRate: c.games ? Math.round(c.wins / c.games * 100) : 0 })).sort((a, z) => z.games - a.games)])),
    games: (b.games || []).sort((a, z) => z.date - a.date),
  });
  const all = bucket('_all_'); // build combined
  for (const m of Object.keys(buckets)) {
    if (m === '_all_') continue;
    const b = buckets[m]; all.record.games += b.record.games; all.record.wins += b.record.wins;
    (all.games = all.games || []).push(...(b.games || []));
    for (const k in b.pools) for (const cid in b.pools[k]) {
      const src = b.pools[k][cid];
      const pool = all.pools[k] = all.pools[k] || {};
      const c = pool[cid] = pool[cid] || { championId: src.championId, games: 0, wins: 0 };
      c.games += src.games; c.wins += src.wins;
    }
  }
  // ── SOLO-QUEUE matchup history for SOLO_KEY — "how I do vs specific champs" ──
  // matchups[myChampId][vsChampId] = [games, wins] (lane opponent = same teamPosition,
  // other team); byRole[role][myChampId] = [games, wins].
  let solo = null;
  const soloPuuid = Object.keys(puuidToKey).find(pu => puuidToKey[pu] === SOLO_KEY);
  if (soloPuuid) {
    const ids = await getJSON(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${soloPuuid}/ids?queue=${SOLO_QUEUE}&count=50`);
    const matchups = {}, byRole = {};
    let games = 0;
    for (const id of (ids || [])) {
      const md = await getMatch(id);
      if (!md || !md.info) continue;
      const me = md.info.participants.find(p => p.puuid === soloPuuid);
      if (!me || !me.teamPosition) continue;
      games++;
      const myC = me.championId, role = POS[me.teamPosition] || null, won = !!me.win;
      if (role) { const r = byRole[role] = byRole[role] || {}; const t = r[myC] = r[myC] || [0, 0]; t[0]++; if (won) t[1]++; }
      const opp = md.info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);
      if (opp) { const mm = matchups[myC] = matchups[myC] || {}; const rec = mm[opp.championId] = mm[opp.championId] || [0, 0]; rec[0]++; if (won) rec[1]++; }
    }
    if (games) solo = { player: SOLO_KEY, games, matchups, byRole };
    console.log(`solo (${SOLO_KEY}): ${games} ranked-solo games, ${Object.keys(matchups).length} champs with matchups`);
  }

  const payload = {
    generated: new Date().toISOString(),
    flex: shape(bucket('flex')),
    ranked5: shape(bucket('ranked5')),
    other: shape(bucket('other')),
    all: shape(all),
    solo,
  };
  // Don't clobber good data with an empty pull (transient API issue / key trouble).
  if (all.record.games === 0 && !solo && fs.existsSync(OUT)) { console.error('0 full-roster games and no solo data — keeping existing roster-data.js.'); process.exit(1); }
  fs.writeFileSync(OUT, 'window.ROSTER_DATA = ' + JSON.stringify(payload) + ';\n');
  for (const m of ['flex', 'ranked5', 'other', 'all'])
    console.log(`${m}: ${payload[m].record.wins}W-${payload[m].record.games - payload[m].record.wins}L of ${payload[m].record.games}`);
  // Full-roster games by queueId. 440=Flex. A NEW id here = the Ranked 5's mode →
  // set RANKED5_QUEUE to it (top of this file) and re-run to split it from Flex.
  const QNAMES = { 420: 'Solo/Duo', 440: 'Flex', 400: 'Normal Draft', 430: 'Normal Blind', 490: 'Quickplay', 700: 'Clash', 0: 'Custom' };
  console.log('full-roster games by queueId:',
    Object.entries(queueTally).map(([q, n]) => `${q}${QNAMES[q] ? '(' + QNAMES[q] + ')' : ' ⟵ NEW?'}=${n}`).join('  '));
  console.log('wrote', OUT);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
