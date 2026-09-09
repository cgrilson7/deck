import { useEffect, useState } from 'react'
import type { DeckState } from '@shared/types'
import { FocusPane } from './components/FocusPane'
import { Grid } from './components/Grid'
import { dispose, liveIds } from './lib/terminals'

export default function App() {
  const [state, setState] = useState<DeckState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.deck.getState().then(setState)
    const offState = window.deck.onState(setState)
    let t: number | undefined
    const offErr = window.deckErrors.onError((msg) => {
      setError(msg)
      window.clearTimeout(t)
      t = window.setTimeout(() => setError(null), 5000)
    })
    return () => {
      offState()
      offErr()
      window.clearTimeout(t)
    }
  }, [])

  // A session that left the open set (parked / killed) drops its terminal.
  useEffect(() => {
    if (!state) return
    const open = new Set(state.open.map((s) => s.id))
    for (const id of liveIds()) if (!open.has(id)) dispose(id)
  }, [state])

  if (!state) return <div className="boot">deck</div>

  const focused = state.open.find((s) => s.slot === state.focusSlot) ?? null
  const others = state.open
    .filter((s) => s.slot !== state.focusSlot)
    .sort((a, b) => Number(b.attention) - Number(a.attention) || a.slot! - b.slot!)
  const needy = state.open.filter((s) => s.attention && s.slot !== state.focusSlot).length

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">deck</span>
        <span className="count">
          {state.open.length} / {state.cap}
        </span>
        {needy > 0 && (
          <button className="needy" onClick={() => window.deck.command({ type: 'jumpAttention' })} title="Jump to the next session that needs you (⌘↩)">
            {needy} need{needy === 1 ? 's' : ''} you
          </button>
        )}
        {state.profile !== 'deck' && <span className="badge">{state.profile}</span>}
        <span className="spacer" />
        {error && <span className="error">{error}</span>}
      </header>
      <main className="main">
        <FocusPane session={focused} />
        <Grid sessions={others} state={state} />
      </main>
    </div>
  )
}
