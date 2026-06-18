// Pulls counter + synergy + role-stat data for EVERY LoL champion from op.gg and
// writes champ-data.js (window.OPGG_DATA) that draft-tool.html consumes. This is
// the script the daily refresh routine runs to keep the site accurate.
//
//   node scripts/refresh-opgg.js [limit]
//
// Data shapes:
//   counters[champName][oppName] = opp's win rate (%) vs champName  (opp counters it if >50)
//   synergy[champName][partnerName] = duo win rate (%)
//   stats[champName] = { wr, games, roles: { role: [wr, pickRate] } }   (per-role from tier pages)

const fs = require('fs');
const path = require('path');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const OUT = path.resolve(__dirname, '..', 'champ-data.js');
const LIMIT = parseInt(process.argv[2] || '0', 10);

const COUNTER_RE = /\{"play":(\d+),"win":(\d+),"win_rate":([\d.]+),"champion":\{"image_url":"[^"]*","name":"([^"]*)","key":"([^"]*)"\}\}/g;
const SYN_RE = /"play":(\d+),"synergy_position":"([^"]*)","win_rate":([\d.]+),"pick_rate":[\d.]+,"synergy_champion_name":"([^"]*)"/g;

const slugFor = (id) => ({ MonkeyKing: 'monkeyking', Nunu: 'nunu' }[id] || id.toLowerCase());

async function getText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await new Promise(res => setTimeout(res, 400));
  }
  return null;
}

function parseCounters(html) {
  const u = html.replace(/\\"/g, '"');
  const out = {}; let m; COUNTER_RE.lastIndex = 0;
  while ((m = COUNTER_RE.exec(u))) out[m[4]] = +m[3];   // opp name -> opp wr vs this champ (%)
  return out;
}
function parseSynergy(html) {
  const u = html.replace(/\\"/g, '"');
  const out = {}; let m; SYN_RE.lastIndex = 0;
  while ((m = SYN_RE.exec(u))) {
    let wr = +m[3]; if (wr <= 1) wr = +(wr * 100).toFixed(2);   // fractions -> %
    out[m[4]] = wr;
  }
  return out;
}

async function mapLimit(items, n, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const ver = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
  const champRaw = (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/champion.json`)).json()).data;
  let champs = Object.values(champRaw).map(c => ({ id: c.id, name: c.name, slug: slugFor(c.id) }));
  if (LIMIT) champs = champs.slice(0, LIMIT);
  console.log(`Pulling ${champs.length} champions from op.gg ...`);

  const counters = {}, synergy = {};
  let okC = 0, okS = 0, fail = [];
  await mapLimit(champs, 6, async (c) => {
    const [hc, hs] = await Promise.all([
      getText(`https://op.gg/lol/champions/${c.slug}/counters`),
      getText(`https://op.gg/lol/champions/${c.slug}/synergies`),
    ]);
    if (hc) { const d = parseCounters(hc); if (Object.keys(d).length) { counters[c.name] = d; okC++; } }
    if (hs) { const d = parseSynergy(hs); if (Object.keys(d).length) { synergy[c.name] = d; okS++; } }
    if (!hc && !hs) fail.push(c.slug);
  });

  // Per-role stats (WR + pick rate) from the tier pages.
  const stats = {};
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
  const STAT_RE = /"champion_id":(\d+),"win_rate":([\d.]+),"pick_rate":([\d.]+)/g;
  for (const role of ROLES) {
    const h = await getText(`https://op.gg/lol/champions?position=${role}`);
    // tier pages key by champion_id; map id->name via champRaw
    const idToName = {}; for (const c of Object.values(champRaw)) idToName[+c.key] = c.name;
    if (h) {
      const u = h.replace(/\\"/g, '"'); let m; STAT_RE.lastIndex = 0;
      while ((m = STAT_RE.exec(u))) {
        const nm = idToName[+m[1]]; if (!nm) continue;
        let wr = +m[2], pr = +m[3]; if (wr <= 1) wr = +(wr * 100).toFixed(2); if (pr <= 1) pr = +(pr * 100).toFixed(2);
        (stats[nm] = stats[nm] || { roles: {} }).roles[role] = [wr, pr];
      }
    }
  }

  const payload = { v: ver, generated: new Date().toISOString(), counters, synergy, stats };
  fs.writeFileSync(OUT, 'window.OPGG_DATA = ' + JSON.stringify(payload) + ';\n');
  console.log(`Done. counters:${okC} synergy:${okS} stats:${Object.keys(stats).length} champs. Failed slugs: ${fail.join(', ') || 'none'}`);
  console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
