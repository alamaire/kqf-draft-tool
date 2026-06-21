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
const FULL_ROSTER = 5;          // a team must have this many roster members to count
const FLEX_QUEUE = 440;         // Ranked Flex
const RANKED5_QUEUE = null;     // TODO: set to the Ranked 5's queueId once it launches (Jun 26)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GAP = 800;

async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, H);
    if (r.status === 200) return r.json();
    if (r.status === 429) { await sleep(2000); continue; }
    return null;
  }
  return null;
}
function modeFor(q) { return q === FLEX_QUEUE ? 'flex' : q === RANKED5_QUEUE ? 'ranked5' : 'other'; }

async function main() {
  const puuidToKey = {};
  for (const p of ROSTER) {
    const a = await getJSON(`https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(p.name)}/${encodeURIComponent(p.tag)}`);
    if (a && a.puuid) puuidToKey[a.puuid] = p.key;
    await sleep(GAP);
  }
  console.log('resolved', Object.keys(puuidToKey).length, '/', ROSTER.length, 'puuids');

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
    const md = await getJSON(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/${id}`);
    await sleep(GAP);
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
    // per-game record (for the match-history list + per-game analysis)
    (b.games = b.games || []).push({ id, win: won, date: md.info.gameEndTimestamp || md.info.gameCreation || 0, picks });
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
  const payload = {
    generated: new Date().toISOString(),
    flex: shape(bucket('flex')),
    ranked5: shape(bucket('ranked5')),
    other: shape(bucket('other')),
    all: shape(all),
  };
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
