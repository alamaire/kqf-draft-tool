import type { Suggestion, BanSuggestion, Champion } from '../types'
import { ChampionPortrait } from './ChampionPortrait'

interface Props {
  picks: Suggestion[]
  bans: BanSuggestion[]
  champions: Record<number, Champion>
  showBans: boolean
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1 w-full">
      <span className="text-gray-500 text-xs w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value * 100}%` }} />
      </div>
      <span className="text-gray-400 text-xs w-8 text-right">{Math.round(value * 100)}%</span>
    </div>
  )
}

export function SuggestionPanel({ picks, bans, champions, showBans }: Props) {
  const items = showBans ? bans : picks

  return (
    <div className="flex flex-col gap-2 w-72">
      <h2 className="text-lol-gold font-lol tracking-widest text-sm uppercase px-1">
        {showBans ? 'Ban Suggestions' : 'Pick Suggestions'}
      </h2>

      {items.length === 0 && (
        <div className="text-gray-500 text-sm px-1">Waiting for draft data...</div>
      )}

      {showBans
        ? (bans as BanSuggestion[]).map((s, i) => {
            const champ = champions[s.championId]
            return (
              <div key={s.championId} className="flex items-center gap-3 bg-lol-red-dim/20 border border-lol-red/20 rounded px-3 py-2">
                <span className="text-lol-gold/60 text-sm w-5 text-center">{i + 1}</span>
                <ChampionPortrait champion={champ} size="sm" />
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-lol-gold-light text-sm font-semibold truncate">{champ?.name || '...'}</span>
                  <span className="text-red-400 text-xs">Threat {Math.round(s.threatScore * 100)}%</span>
                </div>
              </div>
            )
          })
        : (picks as Suggestion[]).map((s, i) => {
            const champ = champions[s.championId]
            return (
              <div key={s.championId} className="flex flex-col bg-lol-blue-dim/20 border border-lol-blue/20 rounded px-3 py-2 gap-1">
                <div className="flex items-center gap-3">
                  <span className="text-lol-gold/60 text-sm w-5 text-center">{i + 1}</span>
                  <ChampionPortrait champion={champ} size="sm" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-lol-gold-light text-sm font-semibold truncate">{champ?.name || '...'}</span>
                    <span className="text-lol-blue text-xs capitalize">{s.role}</span>
                  </div>
                  <span className="text-lol-gold font-bold text-sm">{Math.round(s.totalScore * 100)}</span>
                </div>
                <div className="flex flex-col gap-0.5 pl-8">
                  <ScoreBar label="Meta" value={s.scores.tier} color="bg-yellow-500" />
                  <ScoreBar label="Counter" value={s.scores.counter} color="bg-red-500" />
                  <ScoreBar label="Synergy" value={s.scores.synergy} color="bg-green-500" />
                  <ScoreBar label="Mastery" value={s.scores.familiarity} color="bg-blue-400" />
                </div>
              </div>
            )
          })
      }
    </div>
  )
}
