import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AgentView, DeckState } from '@shared/types'
import { DocPane } from './components/DocPane'
import { FocusPane } from './components/FocusPane'
import { FoxHead } from './components/FoxHead'
import { FoxLog } from './components/FoxLog'
import { Grid, type Member } from './components/Grid'
import { AgentPane } from './components/AgentPane'
import { LeashDialog } from './components/LeashDialog'
import { PhonePair } from './components/PhonePair'
import { ThemeControls } from './components/ThemeControls'
import { dispose, liveIds } from './lib/terminals'
import { onOpenDoc, type DocRef } from './lib/paths'
import { onLeash, type LeashAsk } from './lib/leash'
import { useFoxLog } from './lib/foxlog'
import { onStudio, readStudioChat, writeStudioChat } from './lib/studio'
import { StudioPane } from './components/StudioPane'
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
  // A subagent tapped into: its id, and the agent pane shows its conversation full size with the leash.
  const [agentOpen, setAgentOpen] = useState<string | null>(null)
  // The leash dialog: a cancel asking for its reason, a pause for a note.
  const [leash, setLeash] = useState<LeashAsk | null>(null)
  // The Studio open in the CENTER: the focus pane steps aside (the focused session shows in the grid meanwhile).
  const [studioOpen, setStudioOpen] = useState(false)
  // The session the Studio is talking to ("Ask Claude for help" starts one): shown INSIDE the Studio
  // pane while it is open, so it leaves the grid then, the way the focused session does.
  const [studioChat, setStudioChatState] = useState<string | null>(readStudioChat)
  const setStudioChat = (id: string | null) => {
    writeStudioChat(id)
    setStudioChatState(id)
  }
  const fox = useFoxLog()
  const settings = useSettings()
  // Subagents of every open session (SubagentStart / SubagentStop hooks), each a tile of its own.
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
        setAgentOpen(null)
        setLeash(null)
      }
      if (ev.type === 'toggleFoxLog') {
        setDoc(null)
        setAgentOpen(null)
        setFoxOpen((v) => !v)
      }
      if (ev.type === 'toggleStudio') setStudioOpen((v) => !v)
    })
    const offStudio = onStudio((want) => setStudioOpen((v) => (want === 'toggle' ? !v : want)))
    void window.deck.agents().then(setAgents).catch(() => {})
    const offAgents = window.deck.onAgents(setAgents)
    const offDoc = onOpenDoc((r) => {
      setFoxOpen(false)
      setAgentOpen(null)
      setDoc(r)
    })
    const offLeash = onLeash(setLeash)
    return () => {
      offState()
      offErr()
      offUi()
      offDoc()
      offAgents()
      offLeash()
      offStudio()
      window.clearTimeout(t)
    }
  }, [])

  // A focus change from anywhere (⌘1–9, the menu, the phone) takes the center back from the Studio.
  const focusSlot = state?.focusSlot ?? null
  useEffect(() => {
    setStudioOpen(false)
  }, [focusSlot])

  // A session that left the open set (parked / killed) drops its terminal.
  useEffect(() => {
    if (!state) return
    const open = new Set(state.open.map((s) => s.id))
    for (const id of liveIds()) if (!open.has(id)) dispose(id)
  }, [state])

  if (!state) return <div className="boot">deck</div>

  const focused = state.open.find((s) => s.slot === state.focusSlot) ?? null
  // Top-level sessions hold the ⌘ slots; a wolfpack's members (betas, subagents) are cells of their own behind them.
  const top = state.open.filter((s) => !s.pack)
  const betas = state.open.filter((s) => s.pack)
  const others = top
    .filter((s) => (studioOpen ? s.id !== studioChat : s.slot !== state.focusSlot))
    .sort((a, b) => (settings.attentionFirst ? Number(b.attention) - Number(a.attention) : 0) || a.slot! - b.slot!)
  // Members grouped by alpha (in slot order), each group's betas needing you first, then subagents as they started.
  const members: Member[] = []
  for (const alpha of [...top].sort((a, b) => a.slot! - b.slot!)) {
    for (const b of betas.filter((b) => b.pack!.alpha === alpha.id && b.slot !== state.focusSlot).sort((a, b) => Number(b.attention) - Number(a.attention) || a.slot! - b.slot!))
      members.push({ kind: 'beta', session: b })
    for (const a of agents.filter((a) => a.parent === alpha.id)) members.push({ kind: 'agent', agent: a, parent: alpha })
  }
  const alphaOf = focused?.pack ? (top.find((a) => a.id === focused.pack!.alpha) ?? null) : null
  const openAgent = agentOpen ? (agents.find((a) => a.id === agentOpen) ?? null) : null
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
        {studioOpen ? (
          <StudioPane session={focused} chat={state.open.find((s) => s.id === studioChat) ?? null} onChat={setStudioChat} onClose={() => setStudioOpen(false)} />
        ) : (
          <FocusPane session={focused} state={state} settings={settings} alpha={alphaOf} />
        )}
        <Grid
          sessions={others}
          members={members}
          state={state}
          settings={settings}
          onOpenAgent={(id) => {
            setDoc(null)
            setFoxOpen(false)
            setAgentOpen(id)
          }}
        />
        {/* Over the right column, never over the terminal: read the file while the session keeps going. */}
        {doc && <DocPane target={doc} onClose={() => setDoc(null)} />}
        {foxOpen && <FoxLog state={state} entries={fox.entries} onClose={() => setFoxOpen(false)} />}
        {openAgent && <AgentPane agent={openAgent} parent={top.find((s) => s.id === openAgent.parent) ?? null} onClose={() => setAgentOpen(null)} />}
      </main>
      {leash && <LeashDialog ask={leash} onClose={() => setLeash(null)} />}
    </div>
  )
}
