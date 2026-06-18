// Audit champ-data.js against Data Dragon: coverage, name consistency, value sanity,
// and that every counter/synergy reference resolves to a real champion.
const fs = require('fs');
const UA = { 'User-Agent': 'Mozilla/5.0' };

const main = async () => {
  eval(fs.readFileSync('champ-data.js', 'utf8').replace('window.', 'global.'));
  const D = global.OPGG_DATA;
  const ver = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
  const raw = (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/champion.json`)).json()).data;
  const ddNames = new Set(Object.values(raw).map(c => c.name));
  const N = ddNames.size;
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];

  const issues = [];
  const note = (s) => issues.push(s);

  // 1) Coverage
  const missStats = [...ddNames].filter(n => !D.stats[n]);
  const missCount = [...ddNames].filter(n => !D.counters[n] || !Object.keys(D.counters[n]).length);
  const missSyn = [...ddNames].filter(n => !D.synergy[n] || !Object.keys(D.synergy[n]).length);
  console.log(`DDragon champs: ${N} (patch ${ver}) | data patch ${D.v}`);
  console.log(`stats: ${Object.keys(D.stats).length}, counters: ${Object.keys(D.counters).length}, synergy: ${Object.keys(D.synergy).length}`);
  if (missStats.length) note(`No stats: ${missStats.join(', ')}`);
  if (missCount.length) note(`No counters: ${missCount.join(', ')}`);
  if (missSyn.length) note(`No synergy: ${missSyn.join(', ')}`);

  // 2) Names present in data that aren't valid DDragon names (engine lookups would fail)
  const badKeys = [...new Set([...Object.keys(D.stats), ...Object.keys(D.counters), ...Object.keys(D.synergy)])].filter(n => !ddNames.has(n));
  if (badKeys.length) note(`Unknown champ keys in data: ${badKeys.join(', ')}`);

  // 3) Counter/synergy REFERENCES that don't resolve
  const badRefs = new Set();
  for (const c in D.counters) for (const opp in D.counters[c]) if (!ddNames.has(opp)) badRefs.add(opp);
  for (const c in D.synergy) for (const p in D.synergy[c]) if (!ddNames.has(p)) badRefs.add(p);
  if (badRefs.size) note(`Unresolved matchup/synergy refs (${badRefs.size}): ${[...badRefs].slice(0, 20).join(', ')}`);

  // 4) Value sanity
  let wrBad = 0, prBad = 0, rrBad = 0, rankBad = 0, rrSumBad = [];
  for (const n in D.stats) {
    let sum = 0;
    for (const r in D.stats[n]) {
      const d = D.stats[n][r];
      if (!ROLES.includes(r)) note(`bad role "${r}" for ${n}`);
      if (d.wr < 35 || d.wr > 65) wrBad++;
      if (d.pr < 0 || d.pr > 60) prBad++;
      if (d.roleRate < 0 || d.roleRate > 1) rrBad++;
      if (!(d.rank >= 1)) rankBad++;
      sum += d.roleRate;
    }
    if (sum < 0.6 || sum > 1.25) rrSumBad.push(`${n}=${sum.toFixed(2)}`);
  }
  if (wrBad) note(`WR out of [35,65]: ${wrBad} entries`);
  if (prBad) note(`pickRate out of [0,60]: ${prBad}`);
  if (rrBad) note(`roleRate out of [0,1]: ${rrBad}`);
  if (rankBad) note(`bad rank: ${rankBad}`);
  if (rrSumBad.length) note(`roleRate sum off (first 15): ${rrSumBad.slice(0, 15).join(', ')}`);

  // 5) Counter entry counts (too few = parse problem)
  const thinCounters = Object.entries(D.counters).filter(([, v]) => Object.keys(v).length < 10).map(([k, v]) => `${k}(${Object.keys(v).length})`);
  if (thinCounters.length) note(`Thin counter lists (<10): ${thinCounters.join(', ')}`);

  // 6) Spot checks
  const spot = [
    ["Rek'Sai", 'jungle'], ['Gragas', 'top'], ['Miss Fortune', 'adc'],
    ['Thresh', 'support'], ['Ahri', 'mid'], ['Garen', 'top'],
  ];
  console.log('\nSpot checks (primary role by roleRate):');
  for (const [n] of spot) {
    const st = D.stats[n]; if (!st) { console.log(`  ${n}: NO STATS`); continue; }
    const top = Object.keys(st).sort((a, b) => st[b].roleRate - st[a].roleRate)[0];
    console.log(`  ${n}: primary=${top} (rr ${st[top].roleRate}, wr ${st[top].wr.toFixed(1)}, rank ${st[top].rank})`);
  }

  console.log(`\n=== ${issues.length ? issues.length + ' ISSUE GROUP(S) ===' : 'ALL CHECKS PASSED ==='}`);
  issues.forEach(i => console.log('•', i));
};
main().catch(e => console.log('ERR', e));
