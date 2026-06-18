import type { DraftState, Champion, SummonerData } from '../types'
import { ChampionPortrait } from './ChampionPortrait'

interface Props {
  draft: DraftState
  champions: Record<number, Champion>
  summoners: Record<string, SummonerData>
}

function TeamColumn({ members, picks, bans, champions, summoners, side }: {
  members: DraftState['blueTeam']
  picks: DraftState['picks']
  bans: DraftState['bans']
  champions: Record<number, Champion>
  summoners: Record<string, SummonerData>
  side: 'blue' | 'red'
}) {
  const color = side === 'blue' ? 'border-lol-blue/40' : 'border-lol-red/40'
  const bg = side === 'blue' ? 'bg-lol-blue-dim/30' : 'bg-lol-red-dim/30'
  const accent = side === 'blue' ? 'text-lol-blue' : 'text-lol-red'

  const teamBans = bans.filter(b => b.team === side)

  return (
    <div className={`flex flex-col gap-1 w-64 ${side === 'red' ? 'items-end' : 'items-start'}`}>
      {/* Bans row */}
      <div className="flex gap-1 mb-2 px-1">
        {Array.from({ length: 5 }).map((_, i) => {
          const ban = teamBans[i]
          const champ = ban ? champions[ban.championId] : undefined
          return (
            <ChampionPortrait
              key={i}
              champion={champ}
              size="sm"
              dimmed
              className="opacity-70"
            />
          )
        })}
      </div>

      {/* Players */}
      {members.map((member, i) => {
        const pick = picks.find(p => p.team === side && p.cellId === member.cellId)
        const champ = pick ? champions[pick.championId] : undefined
        const sid = member.summonerId
        const summoner = summoners[sid]
        const ranked = summoner?.ranked?.find(r => r.queueType === 'RANKED_SOLO_5x5')

        return (
          <div
            key={member.cellId}
            className={`flex ${side === 'red' ? 'flex-row-reverse' : 'flex-row'} items-center gap-2 w-full px-1 py-1 rounded ${bg} border ${color}`}
          >
            <ChampionPortrait champion={champ} size="md" />
            <div className={`flex flex-col ${side === 'red' ? 'items-end' : 'items-start'} min-w-0`}>
              <span className="text-lol-gold-light text-sm font-semibold truncate max-w-full">
                {summoner?.gameName || `Player ${i + 1}`}
              </span>
              {ranked && (
                <span className={`text-xs ${accent}`}>
                  {ranked.tier} {ranked.rank} {ranked.leaguePoints}LP
                </span>
              )}
              {champ && (
                <span className="text-xs text-gray-400">{champ.name}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function DraftBoard({ draft, champions, summoners }: Props) {
  const currentAction = draft.currentAction
  const phase = currentAction?.type === 'ban' ? 'BAN PHASE' : 'PICK PHASE'
  const timer = draft.timer?.adjustedTimeLeftInPhase
    ? Math.ceil(draft.timer.adjustedTimeLeftInPhase / 1000)
    : null

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Phase banner */}
      <div className="flex items-center gap-4 py-2">
        <span className="text-lol-gold text-lg font-lol tracking-widest">{phase}</span>
        {timer !== null && (
          <span className={`text-2xl font-bold tabular-nums ${timer <= 5 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
            {timer}s
          </span>
        )}
      </div>

      {/* Teams */}
      <div className="flex gap-8 items-start">
        <TeamColumn
          members={draft.blueTeam}
          picks={draft.picks}
          bans={draft.bans}
          champions={champions}
          summoners={summoners}
          side="blue"
        />

        {/* Center divider */}
        <div className="flex flex-col items-center justify-center self-stretch gap-2">
          <div className="w-px flex-1 bg-gradient-to-b from-transparent via-lol-gold/40 to-transparent" />
          <span className="text-lol-gold/60 text-xs font-lol">VS</span>
          <div className="w-px flex-1 bg-gradient-to-b from-transparent via-lol-gold/40 to-transparent" />
        </div>

        <TeamColumn
          members={draft.redTeam}
          picks={draft.picks}
          bans={draft.bans}
          champions={champions}
          summoners={summoners}
          side="red"
        />
      </div>
    </div>
  )
}
