import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AgentView, DeckState } from '@shared/types'
import { DocPane } from './components/DocPane'
import { FocusPane } from './components/FocusPane'
import { FoxHead } from './components/FoxHead'
import { HeaderStatus } from './components/HeaderStatus'
import { UsageMeter } from './components/UsageMeter'
import { FoxLog } from './components/FoxLog'
import { Grid, byRecency, type Member } from './components/Grid'
import { AgentPane } from './components/AgentPane'
import { LeashDialog } from './components/LeashDialog'
import { PhonePair } from './components/PhonePair'
import { ThemeControls } from './components/ThemeControls'
import { dispose, liveIds } from './lib/terminals'
import { docMayClose, onOpenDoc, openDoc, type DocRef } from './lib/paths'
import { onLeash, type LeashAsk } from './lib/leash'
import { onAgentPane, useAutoDismiss } from './lib/agents'
import { useFoxLog } from './lib/foxlog'
import { onStudio, readStudioChat, writeStudioChat } from './lib/studio'
import { StudioPane } from './components/StudioPane'
import { onPokemon } from './lib/pokemon'
import { PokemonPane } from './components/PokemonPane'
import { installGameboy } from './lib/gameboy'
import { installMol, onMolPane, rethemeMol, syncMolTiles } from './lib/mol'
import { MolPane } from './components/MolPane'
import { installLesson, onLessonPane, syncLessonTiles } from './lib/lesson'
import { LessonPane } from './components/LessonPane'
import { onQuixote } from './lib/quixote'
import { QuixotePane } from './components/QuixoteReader'
import { onPosturePane, posture } from './lib/posture'
import { PosturePane } from './components/Posture'
import { onWebApp } from './lib/webapps'
import { WebLayer } from './components/WebLayer'
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
  // A subagent opened from its pack tile: its id. The agent pane takes the CENTER, like the Studio (they take turns).
  const [agentOpen, setAgentOpen] = useState<string | null>(null)
  // The leash dialog: a cancel asking for its reason, a pause for a note.
  const [leash, setLeash] = useState<LeashAsk | null>(null)
  // The Studio open in the CENTER: the focus pane steps aside (the focused session shows in the grid meanwhile).
  const [studioOpen, setStudioOpen] = useState(false)
  // The Game Boy in the center, the same way; it and the Studio take turns.
  const [pokemonOpen, setPokemonOpen] = useState(false)
  // A molecule viewer, the same way (the Molecule tile it belongs to): the three of them and an open agent take turns.
  const [molOpen, setMolOpen] = useState<number | null>(null)
  // A Lesson tile at reading size, the same way (which tile's).
  const [lessonOpen, setLessonOpen] = useState<number | null>(null)
  // The reader (La Odisea, Don Quijote) at reading size, the same way.
  const [bookOpen, setBookOpen] = useState(false)
  // The Posture tile full size (the feed, the streak, the last two hours), the same way.
  const [postureOpen, setPostureOpen] = useState(false)
  // A web app (Village, …), the same way — its id. Its webview outlives this: see WebLayer.
  const [webOpen, setWebOpen] = useState<string | null>(null)
  // The session the Studio is talking to ("Ask Claude for help" starts one): shown INSIDE the Studio
  // pane while it is open, so it leaves the grid then, the way the focused session does.
  const [studioChat, setStudioChatState] = useState<string | null>(readStudioChat)
  const setStudioChat = (id: string | null) => {
    writeStudioChat(id)
    setStudioChatState(id)
  }
  const fox = useFoxLog()
  const settings = useSettings()
  const molTiles = useRef<number[]>([1])
  molTiles.current = settings.molTiles
  const lessonTiles = useRef<number[]>([1])
  lessonTiles.current = settings.lessonTiles
  const webApps = useRef(settings.webApps)
  webApps.current = settings.webApps
  // Subagents of every open session (SubagentStart / SubagentStop hooks), each a tile of its own.
  const [agents, setAgents] = useState<AgentView[]>([])
  // Finished agents put themselves away after 15s unless held (lib/agents.ts).
  useAutoDismiss(agents)

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
        if (docMayClose()) setDoc(null)
        setFoxOpen(false)
        setAgentOpen(null)
        setLessonOpen(null)
        setBookOpen(false)
        setPostureOpen(false)
        setWebOpen(null)
        setLeash(null)
      }
      if (ev.type === 'toggleFoxLog') {
        if (!docMayClose()) return
        setDoc(null)
        setFoxOpen((v) => !v)
      }
      if (ev.type === 'toggleMol') {
        setWebOpen(null)
        setStudioOpen(false)
        setPokemonOpen(false)
        setAgentOpen(null)
        setLessonOpen(null)
        setBookOpen(false)
        setPostureOpen(false)
        setMolOpen((v) => (v === null ? (molTiles.current[0] ?? 1) : null))
      }
      if (ev.type === 'toggleLesson') {
        setWebOpen(null)
        setMolOpen(null)
        setStudioOpen(false)
        setPokemonOpen(false)
        setAgentOpen(null)
        setBookOpen(false)
        setPostureOpen(false)
        setLessonOpen((v) => (v === null ? (lessonTiles.current[0] ?? 1) : null))
      }
      if (ev.type === 'toggleQuixote') {
        setWebOpen(null)
        setMolOpen(null)
        setStudioOpen(false)
        setPokemonOpen(false)
        setAgentOpen(null)
        setLessonOpen(null)
        setPostureOpen(false)
        setBookOpen((v) => !v)
      }
      if (ev.type === 'togglePosture') {
        setWebOpen(null)
        setMolOpen(null)
        setStudioOpen(false)
        setPokemonOpen(false)
        setAgentOpen(null)
        setLessonOpen(null)
        setBookOpen(false)
        setPostureOpen((v) => !v)
      }
      if (ev.type === 'toggleStudio') {
        setWebOpen(null)
        setMolOpen(null)
        setPokemonOpen(false)
        setAgentOpen(null)
        setLessonOpen(null)
        setBookOpen(false)
        setPostureOpen(false)
        setStudioOpen((v) => !v)
      }
      if (ev.type === 'toggleWeb') {
        const id = ev.id ?? webApps.current[0]?.id ?? null
        setMolOpen(null)
        setStudioOpen(false)
        setPokemonOpen(false)
        setAgentOpen(null)
        setLessonOpen(null)
        setBookOpen(false)
        setPostureOpen(false)
        setWebOpen((v) => (v === id ? null : id))
      }
      if (ev.type === 'togglePokemon') {
        setWebOpen(null)
        setMolOpen(null)
        setStudioOpen(false)
        setAgentOpen(null)
        setLessonOpen(null)
        setBookOpen(false)
        setPostureOpen(false)
        setPokemonOpen((v) => !v)
      }
    })
    const offMol = onMolPane((want) => {
      setWebOpen(null)
      setStudioOpen(false)
      setPokemonOpen(false)
      setAgentOpen(null)
      setLessonOpen(null)
      setBookOpen(false)
      setPostureOpen(false)
      setMolOpen((v) => (want.want === false || (want.want === 'toggle' && v !== null) ? null : (want.tile ?? v ?? molTiles.current[0] ?? 1)))
    })
    const offLesson = onLessonPane((want) => {
      setWebOpen(null)
      setMolOpen(null)
      setStudioOpen(false)
      setPokemonOpen(false)
      setAgentOpen(null)
      setBookOpen(false)
      setPostureOpen(false)
      setLessonOpen((v) => (want.want === false || (want.want === 'toggle' && v !== null) ? null : (want.tile ?? v ?? lessonTiles.current[0] ?? 1)))
    })
    const offBook = onQuixote((want) => {
      setWebOpen(null)
      setMolOpen(null)
      setStudioOpen(false)
      setPokemonOpen(false)
      setAgentOpen(null)
      setLessonOpen(null)
      setPostureOpen(false)
      setBookOpen((v) => (want === 'toggle' ? !v : want))
    })
    const offPosture = onPosturePane((want) => {
      setWebOpen(null)
      setMolOpen(null)
      setStudioOpen(false)
      setPokemonOpen(false)
      setAgentOpen(null)
      setLessonOpen(null)
      setBookOpen(false)
      setPostureOpen((v) => (want === 'toggle' ? !v : want))
    })
    const offStudio = onStudio((want) => {
      setWebOpen(null)
      setMolOpen(null)
      setPokemonOpen(false)
      setAgentOpen(null)
      setLessonOpen(null)
      setBookOpen(false)
      setPostureOpen(false)
      setStudioOpen((v) => (want === 'toggle' ? !v : want))
    })
    const offPokemon = onPokemon((want) => {
      setWebOpen(null)
      setMolOpen(null)
      setStudioOpen(false)
      setAgentOpen(null)
      setLessonOpen(null)
      setBookOpen(false)
      setPostureOpen(false)
      setPokemonOpen((v) => (want === 'toggle' ? !v : want))
    })
    const offWeb = onWebApp((want) => {
      const id = want.id ?? webApps.current[0]?.id ?? null
      if (want.want !== false) {
        setMolOpen(null)
        setStudioOpen(false)
        setPokemonOpen(false)
        setAgentOpen(null)
        setLessonOpen(null)
        setBookOpen(false)
        setPostureOpen(false)
      }
      setWebOpen((v) => (want.want === false || (want.want === 'toggle' && v === id) ? null : id))
    })
    void window.deck.agents().then(setAgents).catch(() => {})
    const offAgents = window.deck.onAgents(setAgents)
    const offDoc = onOpenDoc((r) => {
      setFoxOpen(false)
      setDoc(r)
    })
    // A session asked for a file (`$DECK_DOC open`, POST /doc): the same pane a click opens.
    const offDocDoor = window.deck.onDocOpen((r) => openDoc(r.path, undefined, r.line))
    const offAgentPane = onAgentPane((id) => {
      if (id) {
        setStudioOpen(false)
        setPokemonOpen(false)
        setMolOpen(null)
        setWebOpen(null)
        setLessonOpen(null)
        setBookOpen(false)
        setPostureOpen(false)
      }
      setAgentOpen(id)
    })
    const offLeash = onLeash(setLeash)
    return () => {
      offState()
      offErr()
      offUi()
      offDoc()
      offDocDoor()
      offAgents()
      offAgentPane()
      offLeash()
      offStudio()
      offPokemon()
      offMol()
      offLesson()
      offBook()
      offPosture()
      offWeb()
      window.clearTimeout(t)
    }
  }, [])

  // A focus change from anywhere (⌘1–9, the menu, the phone) takes the center back from the Studio, the Game Boy or an agent.
  const focusSlot = state?.focusSlot ?? null
  useEffect(() => {
    setStudioOpen(false)
    setPokemonOpen(false)
    setMolOpen(null)
    setLessonOpen(null)
    setBookOpen(false)
    setPostureOpen(false)
    setAgentOpen(null)
    setWebOpen(null)
  }, [focusSlot])

  // The Game Boy answers the trainer's door from boot when its tile is on, whichever cell it is in.
  useEffect(() => {
    if (settings.showPokemon) installGameboy()
  }, [settings.showPokemon])

  // The posture tracker watches from boot while its tile is on (the camera off with it), whichever cell it is in.
  useEffect(() => {
    posture().enable(settings.showPosture)
    if (!settings.showPosture) setPostureOpen(false)
  }, [settings.showPosture])

  // So does the molecule viewer its own (`POST /mol`): a session can `show` before the tile has ever been scrolled to.
  useEffect(() => {
    if (settings.showMol) installMol()
  }, [settings.showMol])
  // The viewer's background and labels are the theme's.
  useEffect(() => {
    if (settings.showMol) rethemeMol()
  }, [settings.theme, settings.appearance, settings.showMol])
  // A Molecule tile that was closed gives its viewer (and its WebGL context) up; the pane goes with it.
  useEffect(() => {
    syncMolTiles(settings.molTiles)
    setMolOpen((v) => (v !== null && !settings.molTiles.includes(v) ? null : v))
  }, [settings.molTiles])

  // The Lesson tile answers its door (`POST /lesson`) from boot, and every tile has its deck (its lesson restored) before it is scrolled to.
  useEffect(() => {
    if (!settings.showLesson) return
    installLesson()
    syncLessonTiles(settings.lessonTiles)
    setLessonOpen((v) => (v !== null && !settings.lessonTiles.includes(v) ? null : v))
  }, [settings.showLesson, settings.lessonTiles])

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
  // A dismissed agent is gone from the list: the center goes back to the session.
  const openAgent = agentOpen ? (agents.find((a) => a.id === agentOpen) ?? null) : null
  // A web app that was removed while showing gives the center back.
  const openWeb = webOpen !== null && settings.webApps.some((a) => a.id === webOpen) ? webOpen : null
  const others = top
    .filter((s) => (studioOpen ? s.id !== studioChat : pokemonOpen || molOpen !== null || lessonOpen !== null || bookOpen || postureOpen || openAgent || openWeb !== null ? true : s.slot !== state.focusSlot))
    .sort(byRecency(settings.attentionFirst))
  // Members grouped by alpha (in slot order): its betas needing you first, then its subagents as they started (the grid draws those as ONE pack tile per alpha).
  const members: Member[] = []
  for (const alpha of [...top].sort((a, b) => a.slot! - b.slot!)) {
    for (const b of betas.filter((b) => b.pack!.alpha === alpha.id && b.slot !== state.focusSlot).sort((a, b) => Number(b.attention) - Number(a.attention) || a.slot! - b.slot!))
      members.push({ kind: 'beta', session: b })
    for (const a of agents.filter((a) => a.parent === alpha.id)) members.push({ kind: 'agent', agent: a, parent: alpha })
  }
  const alphaOf = focused?.pack ? (top.find((a) => a.id === focused.pack!.alpha) ?? null) : null

  return (
    <div className={`app ${settings.compact ? 'compact' : ''}`}>
      {/* Tall on purpose: Foxtrot on the left, a roomy tools area on the right. */}
      <header className="topbar">
        <FoxHead
          state={state}
          open={foxOpen}
          onToggle={() => {
            if (!docMayClose()) return
            setDoc(null)
            setFoxOpen((v) => !v)
          }}
        />
        <div className="topbar-tools">
          <span className="wordmark">deck</span>
          <HeaderStatus state={state} agents={agents} />
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
          <UsageMeter focusId={focused?.id ?? null} />
          <ThemeControls open={themeOpen} onOpenChange={setThemeOpen} />
        </div>
      </header>
      <main className="main" style={{ '--focus-cols': FOCUS_COLS[settings.focusWidth] ?? FOCUS_COLS.third } as CSSProperties}>
        {openAgent ? (
          <AgentPane agent={openAgent} parent={top.find((s) => s.id === openAgent.parent) ?? null} pack={agents.filter((a) => a.parent === openAgent.parent)} onClose={() => setAgentOpen(null)} />
        ) : openWeb !== null ? null : pokemonOpen ? (
          <PokemonPane onClose={() => setPokemonOpen(false)} />
        ) : molOpen !== null ? (
          <MolPane tile={molOpen} onClose={() => setMolOpen(null)} />
        ) : lessonOpen !== null ? (
          <LessonPane tile={lessonOpen} session={focused} onClose={() => setLessonOpen(null)} />
        ) : bookOpen ? (
          <QuixotePane onClose={() => setBookOpen(false)} />
        ) : postureOpen ? (
          <PosturePane onClose={() => setPostureOpen(false)} />
        ) : studioOpen ? (
          <StudioPane session={focused} chat={state.open.find((s) => s.id === studioChat) ?? null} onChat={setStudioChat} onClose={() => setStudioOpen(false)} />
        ) : (
          <FocusPane session={focused} state={state} settings={settings} alpha={alphaOf} />
        )}
        <Grid
          sessions={others}
          members={members}
          state={state}
          settings={settings}
          openAgent={openAgent?.id ?? null}
        />
        {/* Always mounted: a web app's page lives on while something else has the center. */}
        <WebLayer apps={settings.webApps} open={openAgent ? null : openWeb} onClose={() => setWebOpen(null)} />
        {/* Over the right column, never over the terminal: read the file while the session keeps going. */}
        {doc && <DocPane target={doc} onClose={() => setDoc(null)} />}
        {foxOpen && <FoxLog state={state} entries={fox} onClose={() => setFoxOpen(false)} />}
      </main>
      {leash && <LeashDialog ask={leash} onClose={() => setLeash(null)} />}
    </div>
  )
}
