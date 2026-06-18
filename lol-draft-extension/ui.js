// ── State ──────────────────────────────────────────────────────────────────
const S = {
  lockfile: null,       // { port, password }
  certAccepted: false,
  champions: {},        // id -> { id, key, name, tags, img }
  uggStats: {},         // champId -> { role -> { winRate, tier, games } }
  draft: null,          // parsed draft
  summoners: {},        // summonerId -> summoner data
  suggestions: { picks: [], bans: [] },
  status: 'loading',    // loading | setup | disconnected | idle | in_draft
  pollTimer: null,
  activeTab: 'picks',
  uggPatch: '14_24',
}

const TIER_SCORES = { 1: 1.0, 2: 0.85, 3: 0.7, 4: 0.55, 5: 0.4 }
const ROLE_MAP = { 1: 'jungle', 2: 'support', 3: 'adc', 4: 'top', 5: 'mid' }
const ARCHETYPE_COLORS = {
  engage: '#E67E22', poke: '#F1C40F', assassin: '#E74C3C',
  peel: '#27AE60', scaling: '#3498DB', mixed: '#7F8C8D',
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function init() {
  document.getElementById('reset-btn').addEventListener('click', resetSetup)
  window.onLockfilePaste = onLockfilePaste
  document.getElementById('accept-cert-btn').addEventListener('click', onAcceptCert)
  document.getElementById('finish-btn').addEventListener('click', onFinishSetup)

  // Load stored lockfile data
  const stored = await chromeGet(['lockfile', 'certAccepted'])
  if (stored.lockfile) S.lockfile = stored.lockfile
  if (stored.certAccepted) S.certAccepted = stored.certAccepted

  // Load champion data
  await loadChampions()

  // Load U.GG tier data (non-blocking)
  loadUGGData().catch(() => {})

  // Decide what screen to show
  if (!S.lockfile || !S.certAccepted) {
    showSetup()
  } else {
    startPolling()
  }
}

// ── Chrome storage helpers ─────────────────────────────────────────────────
function chromeGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve))
}
function chromeSet(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve))
}

// ── Setup flow ─────────────────────────────────────────────────────────────
function showSetup() {
  setStatus('setup', 'gray', 'Setup required')
  show('setup-screen')
  hide('idle-screen')
  hide('draft-screen')
  updateSetupUI()
}

function updateSetupUI() {
  const step2 = document.getElementById('step2')
  const step3 = document.getElementById('step3')
  const step4 = document.getElementById('step4')
  const certBtn = document.getElementById('accept-cert-btn')
  const finishBtn = document.getElementById('finish-btn')
  const certStatus = document.getElementById('cert-status')

  if (S.lockfile) {
    step2.classList.add('done')
    certBtn.disabled = false
  }
  if (S.certAccepted) {
    step3.classList.add('done')
    certStatus.textContent = '✓ Certificate accepted'
    certStatus.style.color = 'var(--green)'
    finishBtn.disabled = false
  }
}

async function onLockfilePaste(value) {
  const content = value.trim()
  if (!content) return
  const parts = content.split(':')
  if (parts.length < 5) {
    document.getElementById('lockfile-status').textContent = '✗ Needs 5 parts — make sure you copied the whole line'
    document.getElementById('lockfile-status').style.color = 'var(--red)'
    return
  }
  S.lockfile = { port: parts[2], password: parts[3] }
  await chromeSet({ lockfile: S.lockfile })
  document.getElementById('lockfile-status').textContent = `✓ Port ${S.lockfile.port} — looks good`
  document.getElementById('lockfile-status').style.color = 'var(--green)'
  updateSetupUI()
}

function onAcceptCert() {
  if (!S.lockfile) return
  // Open the LCU URL — user clicks Advanced → Proceed
  const url = `https://127.0.0.1:${S.lockfile.port}/`
  chrome.tabs.create({ url }, () => {
    document.getElementById('cert-status').textContent = 'Opened — accept the cert, then come back and click below'
    document.getElementById('cert-status').style.color = 'var(--yellow)'
    // Mark cert as accepted when user clicks finish
    S.certAccepted = true
    chromeSet({ certAccepted: true })
    updateSetupUI()
  })
}

async function onFinishSetup() {
  hide('setup-screen')
  startPolling()
}

async function resetSetup() {
  S.lockfile = null
  S.certAccepted = false
  S.summoners = {}
  clearInterval(S.pollTimer)
  await chromeSet({ lockfile: null, certAccepted: false })
  showSetup()
}

// ── LCU polling ────────────────────────────────────────────────────────────
function startPolling() {
  setStatus('idle', 'yellow', 'Connecting...')
  poll()
  S.pollTimer = setInterval(poll, 600)
}

async function poll() {
  if (!S.lockfile) return

  let session
  try {
    session = await lcuGet('/lol-champ-select/v1/session')
  } catch (err) {
    if (S.status !== 'disconnected') {
      setStatus('disconnected', 'red', 'League client not detected — is it running?')
      show('idle-screen')
      hide('draft-screen')
      S.draft = null
    }
    return
  }

  if (!session || session.httpStatus === 404) {
    if (S.status !== 'idle') {
      setStatus('idle', 'gray', 'Waiting for champion select...')
      show('idle-screen')
      hide('draft-screen')
      S.draft = null
      S.summoners = {}
    }
    return
  }

  const parsed = parseDraftState(session)

  // Resolve summoners for any new members
  await resolveSummoners(session)

  // Rebuild suggestions on every state change
  S.suggestions = buildSuggestions(parsed)
  S.draft = parsed

  if (S.status !== 'in_draft') {
    setStatus('in_draft', 'green', 'Draft in progress')
    hide('idle-screen')
    show('draft-screen')
  }

  renderDraft()
}

// ── LCU helpers ────────────────────────────────────────────────────────────
async function lcuGet(path) {
  const { port, password } = S.lockfile
  const r = await fetch(`https://127.0.0.1:${port}${path}`, {
    headers: { 'Authorization': 'Basic ' + btoa(`riot:${password}`) },
  })
  if (!r.ok) return null
  return r.json()
}

async function resolveSummoners(session) {
  const allMembers = [...(session.myTeam || []), ...(session.theirTeam || [])]
  await Promise.all(allMembers.map(async (member) => {
    const sid = member.summonerId
    if (!sid || S.summoners[sid]) return
    try {
      const summoner = await lcuGet(`/lol-summoner/v1/summoners/${sid}`)
      if (!summoner) return
      const puuid = summoner.puuid || ''
      const [mastery, ranked] = await Promise.all([
        lcuGet(`/lol-collections/v1/inventories/by-puuid/${puuid}/champion-mastery`).catch(() => []),
        lcuGet(`/lol-ranked/v1/ranked-stats/${puuid}`).catch(() => null),
      ])
      const sortedMastery = Array.isArray(mastery)
        ? mastery.sort((a, b) => (b.championPoints || 0) - (a.championPoints || 0)).slice(0, 20)
        : []
      const soloQueue = ranked?.queues?.find(q => q.queueType === 'RANKED_SOLO_5x5') || null
      S.summoners[sid] = {
        sid,
        gameName: summoner.gameName || summoner.displayName || 'Player',
        tagLine: summoner.tagLine || '',
        level: summoner.summonerLevel || 0,
        mastery: sortedMastery,
        ranked: soloQueue,
      }
    } catch (_) {}
  }))
}

// ── Draft state parsing ────────────────────────────────────────────────────
function parseDraftState(session) {
  const picks = [], bans = []
  for (const group of session.actions || []) {
    for (const action of group) {
      const cid = action.championId
      const cell = action.actorCellId
      const team = cell < 5 ? 'blue' : 'red'
      if (action.type === 'ban' && action.completed && cid)
        bans.push({ championId: cid, team, cellId: cell })
      if (action.type === 'pick' && action.completed && cid)
        picks.push({ championId: cid, team, cellId: cell })
    }
  }

  let currentAction = null
  for (const group of session.actions || []) {
    for (const action of group) {
      if (action.isInProgress) { currentAction = action; break }
    }
    if (currentAction) break
  }

  const localCell = session.localPlayerCellId ?? 0
  const myTeam = localCell < 5 ? 'blue' : 'red'
  const all = [...(session.myTeam || []), ...(session.theirTeam || [])]
  const blueTeam = all.filter(m => (m.cellId ?? 0) < 5).sort((a, b) => a.cellId - b.cellId)
  const redTeam = all.filter(m => (m.cellId ?? 0) >= 5).sort((a, b) => a.cellId - b.cellId)

  return { picks, bans, blueTeam, redTeam, myTeam, localCell, currentAction, timer: session.timer }
}

// ── Suggestion engine ──────────────────────────────────────────────────────
function buildSuggestions(draft) {
  const allyPicks = draft.picks.filter(p => p.team === draft.myTeam).map(p => p.championId)
  const enemyPicks = draft.picks.filter(p => p.team !== draft.myTeam).map(p => p.championId)
  const banned = new Set(draft.bans.map(b => b.championId))
  const allChampIds = Object.keys(S.champions).map(Number)

  // Whose turn is it? Use their mastery
  let curMastery = []
  if (draft.currentAction) {
    const cell = draft.currentAction.actorCellId
    const team = cell < 5 ? draft.blueTeam : draft.redTeam
    const member = team.find(m => m.cellId === cell)
    if (member) curMastery = S.summoners[member.summonerId]?.mastery || []
  }

  // Enemy masteries for ban suggestions
  const enemyTeam = draft.myTeam === 'blue' ? draft.redTeam : draft.blueTeam
  const enemyMasteries = enemyTeam.map(m => S.summoners[m.summonerId]?.mastery || [])

  const picks = scorePicks(allyPicks, enemyPicks, banned, allChampIds, curMastery, draft)
  const bans = scoreBans(enemyMasteries, banned, allyPicks)
  return { picks: picks.slice(0, 10), bans: bans.slice(0, 6) }
}

function scorePicks(allyPicks, enemyPicks, banned, allIds, masteries, draft) {
  const results = []
  for (const cid of allIds) {
    if (banned.has(cid) || allyPicks.includes(cid) || enemyPicks.includes(cid)) continue
    const ugg = S.uggStats[cid] || {}
    const roleStats = bestRoleStats(ugg)

    // Tier + winrate score
    const wr = roleStats?.winRate ?? 50
    const tier = roleStats?.tier ?? 5
    const tierScore = (TIER_SCORES[tier] ?? 0.3) * 0.5 + Math.max(0, (wr - 45) / 15) * 0.5

    // Mastery score
    const m = masteries.find(x => x.championId === cid)
    const masteryScore = m ? Math.min(1, (m.championPoints || 0) / 150000) * 0.7 + Math.min(1, (m.championLevel || 0) / 7) * 0.3 : 0

    // Comp need score
    const champ = S.champions[cid]
    const compScore = compNeedScore(champ, allyPicks, draft.picks.length)

    const total = tierScore * 0.38 + masteryScore * 0.32 + compScore * 0.15 + 0.5 * 0.15
    results.push({
      championId: cid,
      total: Math.min(99, Math.round(total * 100)),
      tierScore: Math.round(tierScore * 100),
      masteryScore: Math.round(masteryScore * 100),
      compScore: Math.round(compScore * 100),
      role: roleStats?.role ?? '',
    })
  }
  return results.sort((a, b) => b.total - a.total)
}

function scoreBans(enemyMasteries, banned, allyPicks) {
  const threat = {}
  for (let i = 0; i < enemyMasteries.length; i++) {
    const mastery = enemyMasteries[i]
    for (let j = 0; j < Math.min(mastery.length, 5); j++) {
      const cid = mastery[j].championId
      if (!cid || banned.has(cid) || allyPicks.includes(cid)) continue
      const weight = 1 / (j + 1)
      const ugg = S.uggStats[cid] || {}
      const stats = bestRoleStats(ugg)
      const tierW = TIER_SCORES[stats?.tier ?? 5] ?? 0.4
      threat[cid] = (threat[cid] || 0) + weight * tierW
    }
  }
  return Object.entries(threat)
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ championId: Number(id), threatScore: Math.min(99, Math.round(score * 60)) }))
}

function bestRoleStats(ugg) {
  if (!ugg || !Object.keys(ugg).length) return null
  return Object.values(ugg).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0]
}

function compNeedScore(champ, allyPicks, totalPicks) {
  if (!champ || totalPicks < 2) return 0.5
  const tags = champ.tags || []
  const allyChamps = allyPicks.map(id => S.champions[id]).filter(Boolean)
  const allyTags = allyChamps.flatMap(c => c.tags || [])
  const hasTank = allyTags.includes('Tank')
  const hasADC = allyTags.includes('Marksman')
  if (!hasTank && tags.includes('Tank')) return 0.9
  if (!hasADC && tags.includes('Marksman')) return 0.85
  return 0.5
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadChampions() {
  // Try cache first
  const cached = await chromeGet(['champions', 'champVersion'])
  const r = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
  const versions = await r.json()
  const latest = versions[0]

  if (cached.champions && cached.champVersion === latest) {
    S.champions = cached.champions
    return
  }

  const cr = await fetch(`https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`)
  const raw = await cr.json()
  S.champions = {}
  for (const [key, champ] of Object.entries(raw.data)) {
    const id = parseInt(champ.key)
    S.champions[id] = {
      id, key, name: champ.name, tags: champ.tags,
      img: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`,
    }
  }
  await chromeSet({ champions: S.champions, champVersion: latest })
}

async function loadUGGData() {
  const cacheKey = `ugg_${S.uggPatch}`
  const cached = await chromeGet([cacheKey])
  if (cached[cacheKey]) {
    S.uggStats = cached[cacheKey]
    return
  }

  // Try to fetch current patch from U.GG
  const url = `https://stats2.u.gg/lol/1.5/table/champions/${S.uggPatch}/ranked_solo_5x5/4/na1/1.json`
  try {
    const r = await fetch(url)
    if (!r.ok) return
    const raw = await r.json()
    S.uggStats = parseUGGStats(raw)
    await chromeSet({ [cacheKey]: S.uggStats })
  } catch (_) {}
}

function parseUGGStats(raw) {
  const result = {}
  for (const [champIdStr, roleData] of Object.entries(raw)) {
    const champId = parseInt(champIdStr)
    result[champId] = {}
    for (const [roleIdStr, stats] of Object.entries(roleData)) {
      const roleId = parseInt(roleIdStr)
      if (!stats?.[0] || !Array.isArray(stats[0])) continue
      const d = stats[0]
      const wins = d[0] || 0, games = d[1] || 0
      result[champId][ROLE_MAP[roleId] || 'none'] = {
        wins, games,
        winRate: games > 0 ? parseFloat((wins / games * 100).toFixed(1)) : 50,
        tier: d[4] || 5,
        role: ROLE_MAP[roleId] || 'none',
      }
    }
  }
  return result
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderDraft() {
  const { draft, summoners, suggestions } = S
  if (!draft) return

  // Phase banner
  const isBan = draft.currentAction?.type === 'ban'
  document.getElementById('phase-label').textContent = isBan ? 'BAN PHASE' : 'PICK PHASE'
  const timerMs = draft.timer?.adjustedTimeLeftInPhase ?? 0
  const secs = Math.ceil(timerMs / 1000)
  const timerEl = document.getElementById('phase-timer')
  timerEl.textContent = secs > 0 ? `${secs}s` : '--'
  timerEl.className = 'timer' + (secs > 0 && secs <= 7 ? ' urgent' : '')

  // Ban phase indicator on tab
  const banInd = document.getElementById('ban-phase-indicator')
  if (isBan) banInd.classList.remove('hidden'); else banInd.classList.add('hidden')

  // Teams
  renderTeam('blue-team', draft.blueTeam, draft, summoners)
  renderTeam('red-team', draft.redTeam, draft, summoners)

  // Suggestions
  renderSuggestions()

  // Comp
  renderComp(draft)
}

function renderTeam(elId, members, draft, summoners) {
  const side = elId.startsWith('blue') ? 'blue' : 'red'
  const bans = draft.bans.filter(b => b.team === side)
  let html = '<div class="ban-row">'
  for (let i = 0; i < 5; i++) {
    const ban = bans[i]
    if (ban) {
      const champ = S.champions[ban.championId]
      html += `<div class="ban-portrait"><img src="${champ?.img || ''}" alt="${champ?.name || ''}"/></div>`
    } else {
      html += `<div class="ban-portrait empty">✕</div>`
    }
  }
  html += '</div>'

  for (const member of members) {
    const pick = draft.picks.find(p => p.team === side && p.cellId === member.cellId)
    const champ = pick ? S.champions[pick.championId] : null
    const sid = member.summonerId
    const s = summoners[sid]
    const name = s?.gameName || `Player ${member.cellId % 5 + 1}`
    const rankStr = s?.ranked ? formatRank(s.ranked) : ''
    const isMe = member.cellId === draft.localCell
    const champImg = champ ? `<img src="${champ.img}" alt="${champ.name}"/>` : '?'
    const champName = champ ? `<div class="player-champ-name">${champ.name}</div>` : ''
    const rankClass = side === 'blue' ? 'blue-text' : 'red-text'
    const meStyle = isMe ? 'box-shadow:0 0 0 2px var(--gold);' : ''
    html += `
      <div class="player-row ${side}" style="${meStyle}">
        <div class="player-champ-portrait">${champImg}</div>
        <div class="player-info">
          <div class="player-name">${escHtml(name)}${isMe ? ' <span style="color:var(--gold);font-size:10px">(you)</span>' : ''}</div>
          ${rankStr ? `<div class="player-rank ${rankClass}">${rankStr}</div>` : ''}
          ${champName}
        </div>
      </div>`
  }
  document.getElementById(elId).innerHTML = html
}

function renderSuggestions() {
  const { picks, bans } = S.suggestions
  const showBans = S.activeTab === 'bans' || S.draft?.currentAction?.type === 'ban'
  const items = showBans ? bans : picks
  let html = ''

  if (!items.length) {
    html = '<div class="empty-msg">Loading data...</div>'
  } else if (showBans) {
    for (let i = 0; i < items.length; i++) {
      const s = items[i]
      const champ = S.champions[s.championId]
      html += `
        <div class="suggestion-item ban">
          <div class="suggestion-top">
            <span class="rank-num">${i + 1}</span>
            <div class="champ-portrait">${champ ? `<img src="${champ.img}" alt="${champ.name}"/>` : ''}</div>
            <div class="suggestion-info">
              <div class="suggestion-name">${champ?.name || '...'}</div>
              <div class="suggestion-sub red">Threat score</div>
            </div>
            <span class="suggestion-score" style="color:var(--red)">${s.threatScore}</span>
          </div>
        </div>`
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      const s = items[i]
      const champ = S.champions[s.championId]
      const scoreColor = s.total >= 70 ? 'var(--green)' : s.total >= 50 ? 'var(--gold)' : 'var(--gray)'
      html += `
        <div class="suggestion-item pick">
          <div class="suggestion-top">
            <span class="rank-num">${i + 1}</span>
            <div class="champ-portrait">${champ ? `<img src="${champ.img}" alt="${champ.name}"/>` : ''}</div>
            <div class="suggestion-info">
              <div class="suggestion-name">${champ?.name || '...'}</div>
              <div class="suggestion-sub">${s.role || ''}</div>
            </div>
            <span class="suggestion-score" style="color:${scoreColor}">${s.total}</span>
          </div>
          <div class="score-bars">
            ${scoreBar('Meta', s.tierScore, '#C89B3C')}
            ${scoreBar('Mastery', s.masteryScore, '#3498DB')}
            ${scoreBar('Comp', s.compScore, '#27AE60')}
          </div>
        </div>`
    }
  }
  document.getElementById('suggestions-list').innerHTML = html
}

function scoreBar(label, val, color) {
  return `
    <div class="score-row">
      <span class="score-label">${label}</span>
      <div class="score-bar-bg"><div class="score-bar-fill" style="width:${val}%;background:${color}"></div></div>
      <span class="score-val">${val}</span>
    </div>`
}

function renderComp(draft) {
  document.getElementById('comp-my-team').innerHTML = compBlock(draft, draft.myTeam, 'blue')
  const enemy = draft.myTeam === 'blue' ? 'red' : 'blue'
  document.getElementById('comp-enemy-team').innerHTML = compBlock(draft, enemy, 'red')

  // Warnings
  const myPicks = draft.picks.filter(p => p.team === draft.myTeam).map(p => S.champions[p.championId]).filter(Boolean)
  const myTags = myPicks.flatMap(c => c.tags)
  const warnings = []
  if (myPicks.length >= 3 && !myTags.includes('Tank')) warnings.push('No tank — vulnerable to dive')
  if (myPicks.length >= 3 && !myTags.includes('Marksman')) warnings.push('No ADC — may lack sustained damage')
  if (myPicks.length >= 4 && myTags.filter(t => t === 'Assassin').length >= 2) warnings.push('Heavy assassin comp — no engage')
  document.getElementById('comp-warnings').innerHTML = warnings.map(w =>
    `<div class="warning-item"><span class="warning-icon">⚠</span><span class="warning-text">${w}</span></div>`
  ).join('')
}

function compBlock(draft, team, colorClass) {
  const picks = draft.picks.filter(p => p.team === team).map(p => S.champions[p.championId]).filter(Boolean)
  const tagCounts = {}
  for (const c of picks) for (const t of c.tags) tagCounts[t] = (tagCounts[t] || 0) + 1
  const label = team === draft.myTeam ? 'YOUR TEAM' : 'ENEMY TEAM'
  const labelClass = colorClass === 'blue' ? 'blue-text' : 'red-text'
  const dominant = calcDominantArchetype(tagCounts)
  const archColor = ARCHETYPE_COLORS[dominant] || '#7F8C8D'
  const tags = Object.entries(tagCounts).map(([t, n]) =>
    `<span class="tag-chip ${colorClass}">${t} ×${n}</span>`
  ).join('')
  const archLabel = dominant.charAt(0).toUpperCase() + dominant.slice(1)
  return `
    <div class="comp-team-block ${colorClass}">
      <div class="comp-team-label ${labelClass}">${label}</div>
      <div class="tags-row">${tags || '<span style="color:var(--gray);font-size:11px">No picks yet</span>'}</div>
      <span class="archetype-badge" style="background:${archColor}">${archLabel}</span>
    </div>`
}

function calcDominantArchetype(tagCounts) {
  const scores = {
    engage: (tagCounts['Tank'] || 0) * 2 + (tagCounts['Fighter'] || 0),
    poke: (tagCounts['Mage'] || 0) + (tagCounts['Marksman'] || 0),
    assassin: (tagCounts['Assassin'] || 0) * 2,
    peel: (tagCounts['Support'] || 0) * 2,
    scaling: (tagCounts['Mage'] || 0) * 0.5 + (tagCounts['Marksman'] || 0) * 0.5,
  }
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return top && top[1] > 0 ? top[0] : 'mixed'
}

// ── Tab switch ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  S.activeTab = tab
  document.getElementById('tab-picks').classList.toggle('active', tab === 'picks')
  document.getElementById('tab-bans').classList.toggle('active', tab === 'bans')
  renderSuggestions()
}
window.switchTab = switchTab

// ── UI helpers ─────────────────────────────────────────────────────────────
function setStatus(status, dotClass, text) {
  S.status = status
  const dot = document.getElementById('status-dot')
  dot.className = `status-dot ${dotClass}`
  document.getElementById('status-text').textContent = text
}

function show(id) { document.getElementById(id).classList.remove('hidden') }
function hide(id) { document.getElementById(id).classList.add('hidden') }

function formatRank(ranked) {
  if (!ranked) return ''
  const { tier, rank, leaguePoints } = ranked
  if (!tier || tier === 'NONE') return 'Unranked'
  const t = tier.charAt(0) + tier.slice(1).toLowerCase()
  if (['Challenger', 'Grandmaster', 'Master'].includes(t))
    return `${t} ${leaguePoints}LP`
  return `${t} ${rank} ${leaguePoints}LP`
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── Go ─────────────────────────────────────────────────────────────────────
init()
