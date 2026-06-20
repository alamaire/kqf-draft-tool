const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
(async () => {
  const t = await (await fetch('https://op.gg/lol/summoners/na/MonkeyDAdam-NA1', { headers: UA })).text();
  const u = t.replace(/\\"/g, '"');
  const i = u.indexOf('"games":');
  console.log('GAMES STRUCT:', u.slice(i, i + 700));
  console.log('\n--- participant-ish keys ---');
  for (const k of ['"team_key"', '"participant', '"summoner":', '"teams"', 'riot_id', 'puuid', 'game_length', 'created_at']) {
    const j = u.indexOf(k); console.log(k, j >= 0 ? 'YES @' + j : 'no');
  }
})().catch(e => console.log('ERR', e.message));
