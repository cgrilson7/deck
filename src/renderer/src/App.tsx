import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { DeckState } from '@shared/types'
import { FocusPane } from './components/FocusPane'
import { Grid } from './components/Grid'
import { ThemeControls } from './components/ThemeControls'
import { dispose, liveIds } from './lib/terminals'
import { useSettings } from './lib/theme'

const FOCUS_COLS: Record<string, string> = {
  third: 'minmax(0, 1fr) minmax(0, 2fr)',
  twoFifths: 'minmax(0, 2fr) minmax(0, 3fr)',
  half: 'minmax(0, 1fr) minmax(0, 1fr)'
}

export default function App() {
  const [state, setState] = useState<DeckState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [themeOpen, setThemeOpen] = useState(false)
  const settings = useSettings()

  useEffect(() => {
    void window.deck.getState().then(setState)
    const offState = window.deck.onState(setState)
    let t: number | undefined
    const offErr = window.deckErrors.onError((msg) => {
      setError(msg)
      window.clearTimeout(t)
      t = window.setTimeout(() => setError(null), 5000)
    })
    const offUi = window.deck.onUi((ev) => {
      if (ev.type === 'openSettings') setThemeOpen((v) => !v)
      if (ev.type === 'closeOverlays') setThemeOpen(false)
    })
    return () => {
      offState()
      offErr()
      offUi()
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
    .sort((a, b) => (settings.attentionFirst ? Number(b.attention) - Number(a.attention) : 0) || a.slot! - b.slot!)
  const needy = state.open.filter((s) => s.attention && s.slot !== state.focusSlot).length

  return (
    <div className={`app ${settings.compact ? 'compact' : ''}`}>
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
        <button
          className="bar-btn"
          onClick={() => window.deck.command({ type: 'refreshUi' })}
          title="Reload the interface and redraw every terminal (⌘R). Sessions and conversations keep running; nothing is closed."
        >
          <RefreshCw size={13} />
          <span>refresh UI</span>
        </button>
        <span className="spacer" />
        {error && <span className="error">{error}</span>}
        <ThemeControls open={themeOpen} onOpenChange={setThemeOpen} />
      </header>
      <main className="main" style={{ gridTemplateColumns: FOCUS_COLS[settings.focusWidth] ?? FOCUS_COLS.third }}>
        <FocusPane session={focused} />
        <Grid sessions={others} state={state} settings={settings} />
      </main>
    </div>
  )
}
