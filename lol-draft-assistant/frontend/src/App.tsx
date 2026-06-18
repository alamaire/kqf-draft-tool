import { useState } from 'react'
import { useDraft } from './hooks/useDraft'
import { DraftBoard } from './components/DraftBoard'
import { SuggestionPanel } from './components/SuggestionPanel'
import { CompAnalyzer } from './components/CompAnalyzer'

const STATUS_LABELS = {
  connecting: { label: 'Connecting...', color: 'text-yellow-400' },
  disconnected: { label: 'League client not detected', color: 'text-red-400' },
  idle: { label: 'Waiting for champion select...', color: 'text-gray-400' },
  in_draft: { label: 'Draft in progress', color: 'text-green-400' },
}

export default function App() {
  const { status, draft, summoners, suggestions, champions } = useDraft()
  const [showBans, setShowBans] = useState(false)

  const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS.connecting
  const inDraft = status === 'in_draft' && draft

  const isBanPhase = draft?.currentAction?.type === 'ban'

  return (
    <div className="min-h-screen bg-lol-dark flex flex-col">
      {/* Header */}
      <header className="border-b border-lol-gold/20 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lol-gold font-lol text-xl tracking-widest">DRAFT ASSIST</span>
          <span className="text-lol-gold/40 text-xs">by KQF</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${statusInfo.color}`}>● {statusInfo.label}</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-start justify-center gap-6 p-6 overflow-auto">
        {!inDraft ? (
          <div className="flex flex-col items-center justify-center gap-4 mt-20">
            <div className="text-lol-gold/30 text-6xl">⚔</div>
            <p className={`text-lg ${statusInfo.color}`}>{statusInfo.label}</p>
            {status === 'disconnected' && (
              <p className="text-gray-500 text-sm text-center max-w-sm">
                Make sure League of Legends is running and you're logged in.
              </p>
            )}
            {status === 'idle' && (
              <p className="text-gray-500 text-sm text-center max-w-sm">
                Queue up for a ranked game. The draft board will appear automatically.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Left: Suggestions */}
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setShowBans(false)}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    !showBans ? 'bg-lol-blue text-white' : 'bg-lol-blue/10 text-lol-blue hover:bg-lol-blue/20'
                  }`}
                >
                  Picks
                </button>
                <button
                  onClick={() => setShowBans(true)}
                  className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                    showBans ? 'bg-lol-red text-white' : 'bg-lol-red/10 text-lol-red hover:bg-lol-red/20'
                  }`}
                >
                  Bans
                </button>
                {isBanPhase && (
                  <span className="text-yellow-400 text-xs self-center animate-pulse">● Ban phase</span>
                )}
              </div>
              <SuggestionPanel
                picks={suggestions.picks}
                bans={suggestions.bans}
                champions={champions}
                showBans={showBans || isBanPhase}
              />
            </div>

            {/* Center: Draft board */}
            <DraftBoard draft={draft} champions={champions} summoners={summoners} />

            {/* Right: Comp analysis */}
            <CompAnalyzer draft={draft} champions={champions} myTeam={draft.myTeam} />
          </>
        )}
      </main>
    </div>
  )
}
