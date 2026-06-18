import { useEffect, useRef, useState } from 'react'
import type { Champion, DraftState, SummonerData, Suggestion, BanSuggestion, WsMessage } from '../types'

const WS_URL = `ws://${window.location.hostname}:8000/ws`

export function useDraft() {
  const [status, setStatus] = useState<'disconnected' | 'idle' | 'in_draft' | 'connecting'>('connecting')
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [summoners, setSummoners] = useState<Record<string, SummonerData>>({})
  const [suggestions, setSuggestions] = useState<{ picks: Suggestion[]; bans: BanSuggestion[] }>({ picks: [], bans: [] })
  const [champions, setChampions] = useState<Record<number, Champion>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/champions')
      .then(r => r.json())
      .then((list: Champion[]) => {
        const map: Record<number, Champion> = {}
        list.forEach(c => { map[c.id] = c })
        setChampions(map)
      })
      .catch(() => {})
  }, [])

  const connect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => setStatus('idle')

    ws.onmessage = (e) => {
      const msg: WsMessage = JSON.parse(e.data)
      if (msg.type === 'status') {
        setStatus(msg.payload as 'disconnected' | 'idle' | 'in_draft')
      } else if (msg.type === 'draft_update') {
        const p = msg.payload as { draft: DraftState; summoners: Record<string, SummonerData>; suggestions: { picks: Suggestion[]; bans: BanSuggestion[] } }
        setDraft(p.draft)
        setSummoners(p.summoners)
        setSuggestions(p.suggestions)
        setStatus(p.draft.status)
      }
    }

    ws.onclose = () => {
      setStatus('disconnected')
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [])

  return { status, draft, summoners, suggestions, champions }
}
