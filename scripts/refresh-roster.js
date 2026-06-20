// Pulls the KQF roster's REAL games-together from the Riot API and writes
// roster-data.js (window.ROSTER_DATA) — per-player champ pools + W/L from games
// where 2+ roster members were on the same team. The API key is read from the
// RIOT_KEY env var and is NEVER written to disk/output.
//
//   RIOT_KEY=RGAPI-xxxx node scripts/refresh-roster.js
//
// Riot dev keys expire ~24h, so re-run with a fresh key to update. (Can't run in
// the daily GitHub Action — no persistent key — so this is a manual/local refresh.)

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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GAP = 800;   // stay under dev-key 100 req / 2 min

async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, H);
    if (r.status === 200) return r.json();
    if (r.status === 429) { await sleep(2000); continue; }
    return null;
  }
  return null;
}

async function main() {
  // 1) resolve puuids
  const puuidToKey = {};
  for (const p of ROSTER) {
    const a = await getJSON(`https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(p.name)}/${encodeURIComponent(p.tag)}`);
    if (a && a.puuid) puuidToKey[a.puuid] = p.key;
    await sleep(GAP);
  }
  console.log('resolved', Object.keys(puuidToKey).length, '/', ROSTER.length, 'puuids');

  // 2) each player's recent match ids → count how many roster members share each
  const matchCount = {};
  for (const puuid of Object.keys(puuidToKey)) {
    const ids = await getJSON(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?count=30&type=ranked`);
    for (const id of (ids || [])) matchCount[id] = (matchCount[id] || 0) + 1;
    await sleep(GAP);
  }
  // a match in >=2 roster members' lists = a roster-together game
  const rosterMatchIds = Object.keys(matchCount).filter(id => matchCount[id] >= 2);
  console.log('candidate roster games:', rosterMatchIds.length);

  // 3) fetch each roster game; record each roster member's champ + win
  const pools = {};       // key -> { championId: {games,wins} }
  let recGames = 0, recWins = 0;
  for (const id of rosterMatchIds) {
    const md = await getJSON(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/${id}`);
    await sleep(GAP);
    if (!md || !md.info) continue;
    const ps = md.info.participants;
    // group roster members by team
    const byTeam = {};
    for (const p of ps) { const k = puuidToKey[p.puuid]; if (k) (byTeam[p.teamId] = byTeam[p.teamId] || []).push(p); }
    // the team with 2+ roster members is "our" team this game
    const team = Object.values(byTeam).find(arr => arr.length >= 2);
    if (!team) continue;
    const won = team[0].win;
    recGames++; if (won) recWins++;
    for (const p of team) {
      const k = puuidToKey[p.puuid];
      const pool = pools[k] = pools[k] || {};
      const c = pool[p.championId] = pool[p.championId] || { championId: p.championId, games: 0, wins: 0 };
      c.games++; if (p.win) c.wins++;
    }
  }

  // shape pools as sorted arrays with win rate
  const outPools = {};
  for (const k in pools) {
    outPools[k] = Object.values(pools[k])
      .map(c => ({ ...c, winRate: c.games ? Math.round(c.wins / c.games * 100) : 0 }))
      .sort((a, b) => b.games - a.games);
  }
  const payload = { generated: new Date().toISOString(), record: { games: recGames, wins: recWins }, pools: outPools };
  fs.writeFileSync(OUT, 'window.ROSTER_DATA = ' + JSON.stringify(payload) + ';\n');
  console.log(`roster games: ${recGames} (${recWins}W). players with pools: ${Object.keys(outPools).length}`);
  console.log('wrote', OUT);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
