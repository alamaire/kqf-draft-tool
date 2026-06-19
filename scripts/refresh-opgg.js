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

// Unescape RSC chunk JSON: decode \uXXXX (e.g. & -> &) AND \" -> ", so champ
// names like "Nunu & Willump" come through correctly.
const unescapeJson = (s) => s
  .replace(/\\+u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\"/g, '"');

function parseCounters(html) {
  const u = unescapeJson(html);
  const out = {}; let m; COUNTER_RE.lastIndex = 0;
  while ((m = COUNTER_RE.exec(u))) out[m[4]] = +m[3];   // opp name -> opp wr vs this champ (%)
  return out;
}
function parseSynergy(html) {
  const u = unescapeJson(html);
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

  // Per-role stats from the tier pages. Each main record carries the champ's real
  // win rate, pick rate, ROLE rate (share of its games in that role → tells us its
  // true roles), tier and RANK in the role. stats[name][role] = {wr,pr,roleRate,tier,rank}.
  const stats = {};
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
  const STAT_RE = /"name":"([^"]+)","image_url":"[^"]*","positionName":"[^"]+","positionWinRate":([\d.]+),"positionPickRate":([\d.]+),"positionBanRate":[\d.]+,"positionRoleRate":([\d.]+),"positionTierData":\{[^}]*\},"positionTier":(\d+),"positionRank":(\d+)/g;
  for (const role of ROLES) {
    const h = await getText(`https://op.gg/lol/champions?position=${role}`);
    if (!h) continue;
    const u = unescapeJson(h); let m; STAT_RE.lastIndex = 0;
    while ((m = STAT_RE.exec(u))) {
      const name = m[1];
      (stats[name] = stats[name] || {})[role] = {
        wr: +m[2], pr: +m[3], roleRate: +(+m[4]).toFixed(3), tier: +m[5], rank: +m[6],
      };
    }
  }

  // ── itero.gg champ_table (DIAMOND+): phase strength, damage profile, tankiness,
  // gold@14. itero[champName][role] = {gold14, early, mid, late, ad, ap, dmg, tank}.
  const itero = {};
  const LANE_MAP = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', BOTTOM: 'adc', UTILITY: 'support', SUPPORT: 'support' };
  const ICOLS = {
    gold14: 'pre14_lane_gold_diff',
    early: 'all_early_wr_adj', mid: 'all_mid_wr_adj', late: 'all_late_wr_adj',
    ad: 'all_physicalDamageDoneToChampions', ap: 'all_magicDamageDoneToChampions',
    dmg: 'all_totalDamageDoneToChampions', tank: 'all_totalDamageTaken',
  };
  try {
    const ir = await fetch('https://api.itero.gg/champ_table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA['User-Agent'], Origin: 'https://www.itero.gg' },
      body: JSON.stringify({ rank_class: 'DIAMOND', req_cols: Object.values(ICOLS) }),
    });
    const ij = await ir.json();
    const val = (cell) => (cell && typeof cell === 'object' ? cell.stats : cell);
    if (ij && ij.status_code === 200 && Array.isArray(ij.data)) {
      for (const row of ij.data) {
        const role = LANE_MAP[row.lane]; if (!role) continue;
        const rec = {};
        for (const k in ICOLS) { const v = val(row[ICOLS[k]]); if (v != null) rec[k] = +(+v).toFixed(2); }
        if (Object.keys(rec).length) (itero[row.champion] = itero[row.champion] || {})[role] = rec;
      }
    }
    console.log(`itero (DIAMOND): ${Object.keys(itero).length} champs`);
  } catch (e) { console.log('itero pull failed:', e.message); }

  const payload = { v: ver, generated: new Date().toISOString(), counters, synergy, stats, itero };
  fs.writeFileSync(OUT, 'window.OPGG_DATA = ' + JSON.stringify(payload) + ';\n');
  console.log(`Done. counters:${okC} synergy:${okS} stats:${Object.keys(stats).length} champs. Failed slugs: ${fail.join(', ') || 'none'}`);
  console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
