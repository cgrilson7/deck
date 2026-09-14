import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AgentView, DeckState } from '@shared/types'
import { DocPane } from './components/DocPane'
import { FocusPane } from './components/FocusPane'
import { FoxHead } from './components/FoxHead'
import { FoxLog } from './components/FoxLog'
import { Grid } from './components/Grid'
import { PackPane } from './components/PackPane'
import type { Pack } from './components/PackTile'
import { PhonePair } from './components/PhonePair'
import { ThemeControls } from './components/ThemeControls'
import { dispose, liveIds } from './lib/terminals'
import { onOpenDoc, type DocRef } from './lib/paths'
import { useFoxLog } from './lib/foxlog'
import { useSettings } from './lib/theme'

/** Three columns: tiles, the focus pane, tiles. The setting is how much of the width the center takes. */
const FOCUS_COLS: Record<string, string> = {
  third: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
  twoFifths: 'minmax(0, 3fr) minmax(0, 4fr) minmax(0, 3fr)',
  half: 'minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)'
}

export default function App() {
  const [state, setState] = useState<DeckState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [themeOpen, setThemeOpen] = useState(false)
  // The file the preview pane is showing over the grid (null = no pane). Set from anywhere a
  // path is clicked: a tile's conversation, or the terminal's own link provider.
  const [doc, setDoc] = useState<DocRef | null>(null)
  // Foxtrot's whole log, over the grid like the file preview. One pane at a time: opening either closes the other.
  const [foxOpen, setFoxOpen] = useState(false)
  // A wolfpack tapped into: its alpha's id, and the pane shows every beta full size.
  const [packOpen, setPackOpen] = useState<string | null>(null)
  const fox = useFoxLog()
  const settings = useSettings()
  // Subagents of every open session (SubagentStart / SubagentStop hooks), for the pack tiles.
  const [agents, setAgents] = useState<AgentView[]>([])

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
      if (ev.type === 'closeOverlays') {
        setThemeOpen(false)
        setDoc(null)
        setFoxOpen(false)
        setPackOpen(null)
      }
      if (ev.type === 'toggleFoxLog') {
        setDoc(null)
        setPackOpen(null)
        setFoxOpen((v) => !v)
      }
    })
    void window.deck.agents().then(setAgents).catch(() => {})
    const offAgents = window.deck.onAgents(setAgents)
    const offDoc = onOpenDoc((r) => {
      setFoxOpen(false)
      setPackOpen(null)
      setDoc(r)
    })
    return () => {
      offState()
      offErr()
      offUi()
      offDoc()
      offAgents()
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
  // Betas live inside their alpha's pack tile, never in a cell of their own.
  const top = state.open.filter((s) => !s.pack)
  const betas = state.open.filter((s) => s.pack)
  const others = top
    .filter((s) => s.slot !== state.focusSlot)
    .sort((a, b) => (settings.attentionFirst ? Number(b.attention) - Number(a.attention) : 0) || a.slot! - b.slot!)
  const packs: Pack[] = top
    .map((alpha) => ({ alpha, betas: betas.filter((b) => b.pack!.alpha === alpha.id), agents: agents.filter((a) => a.parent === alpha.id) }))
    .filter((p) => p.betas.length + p.agents.length > 0)
  const alphaOf = focused?.pack ? (top.find((a) => a.id === focused.pack!.alpha) ?? null) : null
  const openPack = packOpen ? (packs.find((p) => p.alpha.id === packOpen) ?? null) : null
  const needy = state.open.filter((s) => s.attention && s.slot !== state.focusSlot).length

  return (
    <div className={`app ${settings.compact ? 'compact' : ''}`}>
      {/* Tall on purpose: Foxtrot and his last barks on the left, a roomy tools area on the right. */}
      <header className="topbar">
        <FoxHead
          state={state}
          entries={fox.entries}
          live={fox.live}
          open={foxOpen}
          onToggle={() => {
            setDoc(null)
            setFoxOpen((v) => !v)
          }}
        />
        <div className="topbar-tools">
          <span className="wordmark">deck</span>
          <span className="count">
            {top.length} / {state.cap}
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
          <PhonePair />
          <span className="spacer" />
          {error && <span className="error">{error}</span>}
          <ThemeControls open={themeOpen} onOpenChange={setThemeOpen} />
        </div>
      </header>
      <main className="main" style={{ gridTemplateColumns: FOCUS_COLS[settings.focusWidth] ?? FOCUS_COLS.third }}>
        <FocusPane session={focused} recent={state.recent} alpha={alphaOf} />
        <Grid
          sessions={others}
          packs={packs}
          state={state}
          settings={settings}
          onOpenPack={(id) => {
            setDoc(null)
            setFoxOpen(false)
            setPackOpen(id)
          }}
        />
        {/* Over the right column, never over the terminal: read the file while the session keeps going. */}
        {doc && <DocPane target={doc} onClose={() => setDoc(null)} />}
        {foxOpen && <FoxLog state={state} entries={fox.entries} onClose={() => setFoxOpen(false)} />}
        {openPack && <PackPane pack={openPack} onClose={() => setPackOpen(null)} />}
      </main>
    </div>
  )
}
