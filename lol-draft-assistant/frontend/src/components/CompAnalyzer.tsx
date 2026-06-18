import type { DraftState, Champion } from '../types'

interface Props {
  draft: DraftState
  champions: Record<number, Champion>
  myTeam: 'blue' | 'red'
}

const ARCHETYPE_COLORS: Record<string, string> = {
  engage: 'bg-orange-500/80',
  poke: 'bg-yellow-500/80',
  assassin: 'bg-red-500/80',
  peel: 'bg-green-500/80',
  scaling: 'bg-blue-500/80',
  unknown: 'bg-gray-500/80',
}

const ARCHETYPE_LABELS: Record<string, string> = {
  engage: 'Engage',
  poke: 'Poke',
  assassin: 'Assassin',
  peel: 'Peel',
  scaling: 'Scaling',
}

function analyzeComp(picks: DraftState['picks'], team: 'blue' | 'red', champions: Record<number, Champion>) {
  const teamPicks = picks.filter(p => p.team === team)
  const tags: Record<string, number> = {}
  for (const pick of teamPicks) {
    const champ = champions[pick.championId]
    if (champ) {
      for (const tag of champ.tags) {
        tags[tag] = (tags[tag] || 0) + 1
      }
    }
  }
  const archetypes = {
    engage: (tags['Tank'] || 0) + (tags['Fighter'] || 0),
    poke: (tags['Mage'] || 0) + (tags['Marksman'] || 0),
    assassin: tags['Assassin'] || 0,
    peel: tags['Support'] || 0,
    scaling: (tags['Mage'] || 0) + (tags['Marksman'] || 0),
  }
  const dominant = Object.entries(archetypes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'
  return { tags, archetypes, dominant, hasTank: (tags['Tank'] || 0) > 0, hasADC: (tags['Marksman'] || 0) > 0 }
}

export function CompAnalyzer({ draft, champions, myTeam }: Props) {
  const myComp = analyzeComp(draft.picks, myTeam, champions)
  const enemyTeam = myTeam === 'blue' ? 'red' : 'blue'
  const enemyComp = analyzeComp(draft.picks, enemyTeam, champions)

  const warnings: string[] = []
  if (!myComp.hasTank && draft.picks.filter(p => p.team === myTeam).length >= 3) {
    warnings.push('No tank — vulnerable to dive and poke')
  }
  if (!myComp.hasADC && draft.picks.filter(p => p.team === myTeam).length >= 3) {
    warnings.push('No ADC — may lack sustained damage')
  }

  return (
    <div className="flex flex-col gap-3 w-64">
      <h2 className="text-lol-gold font-lol tracking-widest text-sm uppercase px-1">Comp Analysis</h2>

      {/* My team */}
      <div className="bg-lol-blue-dim/20 border border-lol-blue/20 rounded p-3">
        <div className="text-lol-blue text-xs font-semibold mb-2">YOUR TEAM</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {Object.entries(myComp.tags).map(([tag, count]) => (
            <span key={tag} className="bg-lol-blue/20 text-lol-blue-light text-xs px-2 py-0.5 rounded-full">
              {tag} ×{count}
            </span>
          ))}
        </div>
        <div className={`inline-block px-2 py-0.5 rounded text-white text-xs font-bold ${ARCHETYPE_COLORS[myComp.dominant]}`}>
          {ARCHETYPE_LABELS[myComp.dominant] || 'Mixed'}
        </div>
      </div>

      {/* Enemy team */}
      <div className="bg-lol-red-dim/20 border border-lol-red/20 rounded p-3">
        <div className="text-lol-red text-xs font-semibold mb-2">ENEMY TEAM</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {Object.entries(enemyComp.tags).map(([tag, count]) => (
            <span key={tag} className="bg-lol-red/20 text-red-300 text-xs px-2 py-0.5 rounded-full">
              {tag} ×{count}
            </span>
          ))}
        </div>
        <div className={`inline-block px-2 py-0.5 rounded text-white text-xs font-bold ${ARCHETYPE_COLORS[enemyComp.dominant]}`}>
          {ARCHETYPE_LABELS[enemyComp.dominant] || 'Mixed'}
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-600/30 rounded px-3 py-2">
              <span className="text-yellow-400 text-xs mt-0.5">⚠</span>
              <span className="text-yellow-200 text-xs">{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
