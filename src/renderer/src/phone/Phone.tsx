import { useEffect, useRef, useState } from 'react'
import { BookOpen, GitBranch, Globe, Languages, Layers, Menu, Plus, X, type LucideIcon } from 'lucide-react'
import { agentKind, agentName, type AgentView, type DeckState, type SessionView } from '@shared/types'
import { MODELS, modelLabel } from '@shared/models'
import { ChatView } from '../components/ChatView'
import { DocPane } from '../components/DocPane'
import { Fox, type FoxAnim } from '../components/Fox'
import { FoxLog } from '../components/FoxLog'
import { FoxStatus } from '../components/FoxStatus'
import { GitTile } from '../components/GitTile'
import { QuixotePane } from '../components/QuixoteReader'
import { TilePrompt } from '../components/TilePrompt'
import { TranslateTile } from '../components/TranslateTile'
import { VocabTile } from '../components/VocabTile'
import { WikiTile } from '../components/WikiTile'
import { useFoxLog } from '../lib/foxlog'
import { shortPath } from '../lib/format'
import { onOpenDoc, type DocRef } from '../lib/paths'
import { useSettings } from '../lib/theme'
import { applyAnsiPalette } from './palette'
import { remote, type Link } from './api'
import { Keys, ScreenView } from './ScreenView'

/**
 * The deck on a phone: the open sessions as pages you swipe between (a chip row on top
 * names them, Foxtrot's pose showing each one's state), each page the same conversation view
 * the desktop's tiles show, a prompt bar along the bottom, and behind two buttons the
 * terminal's screen as tmux has it plus the keys a TUI needs, which is how a permission
 * prompt is answered from here. `+` starts or resumes a session; ⋯ focuses, parks or kills
 * the current one on the Mac. A tapped path opens the preview pane over everything. A
 * wolfpack's SUBAGENTS are pages too (a gold β chip after their parent): the conversation,
 * nothing to type into, and under ⋯ the leash — pause, resume, cancel with a reason.
 *
 * The header is the desktop's two columns folded away: ☰ on the LEFT is the session browser
 * (every open session, most recently active first, its betas and subagents under it, then the
 * parked ones), ☰ on the RIGHT the mini apps that work from here — the ones whose data main
 * fetches or stores (Wikipedia + weather, the reader, vocabulary, translator, changes, Foxtrot's
 * log); an app takes the pages' place until its ✕. Foxtrot stands between them, posed for the
 * whole deck like the desktop's FoxHead; a tap opens his log. Under the header, a strip names
 * the page under your thumb.
 */
type AppId = 'wiki' | 'reader' | 'vocab' | 'translate' | 'changes' | 'foxlog'
const APPS: { id: AppId; name: string; hint: string; icon: LucideIcon | null }[] = [
  { id: 'wiki', name: 'Wikipedia', hint: 'Picture of the day, search, the weather', icon: Globe },
  { id: 'reader', name: 'Reader', hint: 'La Odisea · Don Quijote; select a word to translate it', icon: BookOpen },
  { id: 'vocab', name: 'Vocabulary', hint: 'Dictionary, flash cards, the review list', icon: Layers },
  { id: 'translate', name: 'Translator', hint: 'English ⇄ Spanish', icon: Languages },
  { id: 'changes', name: 'Changes', hint: "The current session's working tree", icon: GitBranch },
  { id: 'foxlog', name: "Foxtrot's log", hint: "What he's seen and barked at", icon: null }
]

/** The session browser's order, the desktop's left column (`byRecency` in Grid.tsx, which the phone must not import: it pulls in xterm). */
const byRecency =
  (attentionFirst: boolean) =>
  (a: SessionView, b: SessionView): number =>
    (attentionFirst ? Number(b.attention) - Number(a.attention) : 0) || (b.activeAt ?? b.createdAt) - (a.activeAt ?? a.createdAt) || (a.slot ?? 0) - (b.slot ?? 0)

const agentPose = (a: AgentView): FoxAnim => (a.cancelled ? 'down' : a.endedAt !== null ? 'sleep' : a.paused ? 'look' : 'run')

type Page = { kind: 'session'; id: string; s: SessionView } | { kind: 'agent'; id: string; a: AgentView; parent: SessionView | null }

export function Phone() {
  const settings = useSettings()
  const [state, setState] = useState<DeckState | null>(null)
  const [link, setLink] = useState<Link>(remote.link)
  const [error, setError] = useState<string | null>(null)
  const [cur, setCur] = useState<string | null>(null)
  const [view, setView] = useState<'chat' | 'screen'>('chat')
  const [keys, setKeys] = useState(false)
  const [doc, setDoc] = useState<DocRef | null>(null)
  const [sheet, setSheet] = useState<'new' | 'more' | null>(null)
  const [agents, setAgents] = useState<AgentView[]>([])
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null)
  const [app, setApp] = useState<AppId | null>(null)
  const pages = useRef<HTMLDivElement>(null)

  useEffect(() => applyAnsiPalette(settings), [settings])

  useEffect(() => {
    const offLink = remote.on('link', setLink)
    setLink(remote.link) // the socket may have opened between the first render and this subscription
    const offState = window.deck.onState(setState)
    let t = 0
    const offErr = window.deckErrors.onError((m) => {
      setError(m)
      window.clearTimeout(t)
      t = window.setTimeout(() => setError(null), 5000)
    })
    const offDoc = onOpenDoc(setDoc)
    const offAgents = window.deck.onAgents(setAgents)
    return () => {
      offLink()
      offState()
      offErr()
      offDoc()
      offAgents()
      window.clearTimeout(t)
    }
  }, [])

  // Every (re)connection starts from a fresh state: the phone may have slept through a lot.
  useEffect(() => {
    if (link !== 'open') return
    void window.deck.getState().then(setState).catch(() => {})
    void window.deck.agents().then(setAgents).catch(() => {})
  }, [link])

  // The keyboard shrinks the visual viewport, not the layout: size the page to what is actually visible.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const apply = () => {
      document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
      window.scrollTo(0, 0)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
    }
  }, [])

  const sessions = state?.open ?? []
  // The pages: every open session, each followed by its subagents (gold β chips).
  const open: Page[] = []
  for (const s of sessions) {
    open.push({ kind: 'session', id: s.id, s })
    for (const a of agents.filter((a) => a.parent === s.id)) open.push({ kind: 'agent', id: `agent:${a.id}`, a, parent: s })
  }
  // Keep a page under the finger: the current one if still open, else whichever needs you, else the first.
  useEffect(() => {
    if (open.length === 0) {
      setCur(null)
      return
    }
    if (cur && open.some((p) => p.id === cur)) return
    setCur((open.find((p) => p.kind === 'session' && p.s.attention) ?? open[0]).id)
  }, [open, cur])

  const page = open.find((p) => p.id === cur) ?? null
  const current = page?.kind === 'session' ? page.s : null
  const index = page ? open.indexOf(page) : -1

  // A chip tap scrolls the pages; a swipe sets the chip. Both go through `cur`.
  const goTo = (id: string) => {
    setCur(id)
    const el = pages.current
    const i = open.findIndex((p) => p.id === id)
    if (el && i >= 0) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }
  const onScroll = () => {
    const el = pages.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    const p = open[i]
    if (p && p.id !== cur) setCur(p.id)
  }
  // Pages come and go with sessions; keep the scroller on the current one when they do.
  const indexRef = useRef(index)
  indexRef.current = index
  useEffect(() => {
    const el = pages.current
    if (el && indexRef.current >= 0) el.scrollTo({ left: indexRef.current * el.clientWidth })
  }, [open.length, app])

  if (link === 'unpaired' || link === 'unauthorized') return <Unpaired link={link} />

  const needs = !!current && (current.attention || current.status === 'blocked')
  const needCount = sessions.filter((s) => s.attention || s.status === 'blocked').length
  // Changes follows the page: a subagent's page reads its parent's tree.
  const changesOf = current ?? (page?.kind === 'agent' ? page.parent : null)
  const shownApp = APPS.find((a) => a.id === app) ?? null
  const pick = (id: string) => {
    setDrawer(null)
    setApp(null)
    goTo(id)
  }

  return (
    <div className="ph">
      {link !== 'open' && <div className="ph-link">{link === 'connecting' ? 'connecting…' : 'reconnecting…'}</div>}
      {error && <div className="ph-link is-error">{error}</div>}
      <header className="ph-top">
        <button type="button" className="ph-burger" onClick={() => setDrawer('left')} title="Sessions" aria-label="Sessions">
          <Menu size={22} />
          {needCount > 0 && <span className="ph-badge">{needCount}</span>}
        </button>
        <button type="button" className="ph-head-fox" onClick={() => setApp((a) => (a === 'foxlog' ? null : 'foxlog'))} title="Foxtrot's log">
          <Fox anim={deckPose(sessions)} scale={2} />
        </button>
        <button type="button" className="ph-burger" onClick={() => setDrawer('right')} title="Apps" aria-label="Apps">
          <Menu size={22} />
        </button>
      </header>

      {shownApp ? (
        <div className="ph-strip">
          <span className="ph-strip-name">
            {shownApp.icon ? <shownApp.icon size={15} /> : <Fox anim="idle" scale={1} />}
            {shownApp.name}
            {shownApp.id === 'changes' && changesOf ? <span className="ph-strip-sub"> · {changesOf.name}</span> : null}
          </span>
          <button type="button" className="ph-strip-close" onClick={() => setApp(null)} title="Back to the sessions">
            <X size={18} />
          </button>
        </div>
      ) : (
        page && (
          <button type="button" className="ph-strip" onClick={() => setDrawer('left')}>
            {page.kind === 'session' ? (
              <>
                <span className={`slot ${page.s.pack ? 'slot-beta' : ''}`}>{page.s.pack ? 'β' : page.s.slot}</span>
                <FoxStatus id={page.s.id} status={page.s.status} attention={page.s.attention} coat={page.s.pack ? 'gold' : undefined} />
                <span className="ph-strip-name">{page.s.name}</span>
              </>
            ) : (
              <>
                <span className="slot slot-beta">β</span>
                <Fox anim={agentPose(page.a)} scale={1} coat="gold" />
                <span className="ph-strip-name">{agentName(page.a)}</span>
              </>
            )}
            <span className="ph-strip-count">
              {index + 1} / {open.length}
            </span>
          </button>
        )
      )}

      {shownApp ? (
        <div className="ph-app">
          {app === 'wiki' && <WikiTile />}
          {app === 'reader' && <QuixotePane onClose={() => setApp(null)} />}
          {app === 'vocab' && <VocabTile />}
          {app === 'translate' && <TranslateTile />}
          {app === 'changes' && <GitTile session={changesOf} />}
          {app === 'foxlog' && state && <PhoneFoxLog state={state} onClose={() => setApp(null)} />}
        </div>
      ) : open.length === 0 ? (
        <div className="ph-empty">
          <Fox anim={state ? 'sleep' : 'look'} scale={4} />
          <p>{state ? 'No open sessions.' : 'Waiting for the deck…'}</p>
          {state && (
            <button type="button" className="ph-btn" onClick={() => setSheet('new')}>
              new session
            </button>
          )}
        </div>
      ) : (
        <div className="ph-pages" ref={pages} onScroll={onScroll}>
          {open.map((p) =>
            p.kind === 'session' ? (
              <div key={p.id} className={`ph-page status-${p.s.status} ${p.s.attention ? 'attention' : ''}`}>
                {view === 'screen' && p.id === cur ? (
                  <ScreenView id={p.s.id} active={p.id === cur} />
                ) : (
                  <ChatView id={p.s.id} cwd={p.s.cwd} status={p.s.status} attention={p.s.attention} onNeeds={() => setView('screen')} jump />
                )}
              </div>
            ) : (
              <div key={p.id} className={`ph-page ph-page-agent ${p.a.endedAt !== null ? 'status-idle' : 'status-busy'}`}>
                {p.a.cancelled && <div className="ph-agent-note is-cancel">cancelled: {p.a.cancelled.reason}</div>}
                {p.a.paused && !p.a.cancelled && <div className="ph-agent-note">{p.a.held ? 'paused: its tool call is waiting' : 'pausing: its next tool call will wait'}</div>}
                <ChatView id={p.id} cwd={p.parent?.cwd ?? ''} status={p.a.endedAt !== null ? 'idle' : 'busy'} attention={false} jump />
              </div>
            )
          )}
        </div>
      )}

      {!shownApp && page?.kind === 'agent' && (
        <div className="ph-bar ph-bar-agent">
          <span className="ph-agent-who">
            {agentKind(page.a)}
            {page.a.model ? ` · ${modelLabel(page.a.model)}` : ''} · {page.a.cancelled ? 'cancelled' : page.a.endedAt !== null ? 'done' : page.a.paused ? 'paused' : 'working'}
          </span>
          <span className="spacer" />
          <button type="button" className="ph-btn" onClick={() => setSheet('more')} title="This agent">
            ⋯
          </button>
        </div>
      )}
      {!shownApp && current && (
        <>
          {keys && <Keys id={current.id} />}
          <div className="ph-bar">
            <TilePrompt id={current.id} />
            <button type="button" className={`ph-btn ${keys ? 'on' : ''}`} onClick={() => setKeys((v) => !v)} title="Terminal keys">
              ⌨
            </button>
            <button type="button" className={`ph-btn ${view === 'screen' ? 'on' : ''} ${needs && view === 'chat' ? 'needs' : ''}`} onClick={() => setView((v) => (v === 'chat' ? 'screen' : 'chat'))} title={view === 'chat' ? 'Show the terminal screen' : 'Back to the conversation'}>
              {view === 'chat' ? '▤' : '💬'}
            </button>
            <button type="button" className="ph-btn" onClick={() => setSheet('more')} title="This session">
              ⋯
            </button>
          </div>
        </>
      )}

      {drawer === 'left' && state && (
        <Drawer side="left" title="Sessions" onClose={() => setDrawer(null)}>
          {sessions
            .filter((s) => !s.pack)
            .sort(byRecency(settings.attentionFirst))
            .map((s) => (
              <SessionGroup key={s.id} s={s} betas={sessions.filter((b) => b.pack?.alpha === s.id)} agents={agents.filter((a) => a.parent === s.id)} cur={app ? null : cur} focused={s.slot === state.focusSlot} pick={pick} />
            ))}
          {/* A beta whose alpha is not open any more still shows, at the foot. */}
          {sessions
            .filter((b) => b.pack && !sessions.some((s) => s.id === b.pack!.alpha))
            .map((b) => (
              <SessionRow key={b.id} s={b} on={!app && cur === b.id} focused={false} onClick={() => pick(b.id)} />
            ))}
          {sessions.length === 0 && <p className="ph-hint">No open sessions.</p>}
          {sessions.filter((s) => !s.pack).length < state.cap && (
            <button
              type="button"
              className="ph-drow ph-drow-new"
              onClick={() => {
                setDrawer(null)
                setSheet('new')
              }}
            >
              <Plus size={18} /> New session
            </button>
          )}
          {state.parked.length > 0 && <h3>Parked</h3>}
          {state.parked.slice(0, 12).map((s) => (
            <button
              key={s.id}
              type="button"
              className="ph-drow ph-drow-parked"
              onClick={() => {
                setDrawer(null)
                void window.deck.command({ type: 'resume', id: s.id })
              }}
            >
              <span className="ph-drow-text">
                <span className="name">{s.name}</span>
                <span className="sub">{shortPath(s.cwd)}</span>
              </span>
              <span className="ph-drow-tag">resume</span>
            </button>
          ))}
        </Drawer>
      )}
      {drawer === 'right' && (
        <Drawer side="right" title="Apps" onClose={() => setDrawer(null)}>
          {APPS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`ph-drow ph-drow-app ${app === a.id ? 'on' : ''}`}
              disabled={a.id === 'changes' && !changesOf}
              onClick={() => {
                setDrawer(null)
                setApp(a.id)
              }}
            >
              <span className="ph-app-icon">{a.icon ? <a.icon size={20} /> : <Fox anim="idle" scale={1} />}</span>
              <span className="ph-drow-text">
                <span className="name">{a.name}</span>
                <span className="sub">{a.id === 'changes' && changesOf ? `${changesOf.name}'s working tree` : a.hint}</span>
              </span>
            </button>
          ))}
          <p className="ph-hint ph-drawer-foot">The Game Boy, Molecule, Studio, Posture, music and the web apps stay on the Mac.</p>
        </Drawer>
      )}
      {doc && <DocPane target={doc} onClose={() => setDoc(null)} />}
      {sheet === 'new' && state && <NewSheet state={state} worktree={settings.worktreeByDefault} model={settings.defaultModel} onClose={() => setSheet(null)} />}
      {sheet === 'more' && current && <MoreSheet s={current} onClose={() => setSheet(null)} />}
      {sheet === 'more' && page?.kind === 'agent' && <AgentSheet a={page.a} parent={page.parent} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Foxtrot for the whole deck, the desktop's FoxHead rule: trots while any session works, sleeps when all rest, else looks around. (The posture alarm is the Mac's.) */
function deckPose(sessions: SessionView[]): FoxAnim {
  if (sessions.some((s) => s.status === 'busy')) return 'run'
  return sessions.every((s) => s.status === 'idle' && !s.attention) ? 'sleep' : 'look'
}

function PhoneFoxLog({ state, onClose }: { state: DeckState; onClose: () => void }) {
  const entries = useFoxLog()
  return <FoxLog state={state} entries={entries} onClose={onClose} />
}

function Drawer({ side, title, onClose, children }: { side: 'left' | 'right'; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="ph-drawer-scrim" onClick={onClose} />
      <nav className={`ph-drawer ph-drawer-${side}`}>
        <div className="ph-drawer-head">
          <h2>{title}</h2>
          <button type="button" className="ph-strip-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        <div className="ph-drawer-body">{children}</div>
      </nav>
    </>
  )
}

/** A session in the drawer, then its betas and subagents indented under it, the way its pack sits under it in the desktop's left column. */
function SessionGroup({ s, betas, agents, cur, focused, pick }: { s: SessionView; betas: SessionView[]; agents: AgentView[]; cur: string | null; focused: boolean; pick: (id: string) => void }) {
  return (
    <>
      <SessionRow s={s} on={cur === s.id} focused={focused} onClick={() => pick(s.id)} />
      {betas.map((b) => (
        <SessionRow key={b.id} s={b} on={cur === b.id} focused={false} member onClick={() => pick(b.id)} />
      ))}
      {agents.map((a) => (
        <button key={a.id} type="button" className={`ph-drow ph-drow-member ${cur === `agent:${a.id}` ? 'on' : ''}`} onClick={() => pick(`agent:${a.id}`)}>
          <span className="slot slot-beta">β</span>
          <Fox anim={agentPose(a)} scale={1} coat="gold" />
          <span className="ph-drow-text">
            <span className="name">{agentName(a)}</span>
            <span className="sub">
              {agentKind(a)} · {a.cancelled ? 'cancelled' : a.endedAt !== null ? 'done' : a.paused ? 'paused' : 'working'}
            </span>
          </span>
        </button>
      ))}
    </>
  )
}

function SessionRow({ s, on, focused, member, onClick }: { s: SessionView; on: boolean; focused: boolean; member?: boolean; onClick: () => void }) {
  const needs = s.attention || s.status === 'blocked'
  return (
    <button type="button" className={`ph-drow ${member ? 'ph-drow-member' : ''} ${on ? 'on' : ''} ${needs ? 'attention' : ''}`} onClick={onClick}>
      <span className={`slot ${s.pack ? 'slot-beta' : ''}`}>{s.pack ? 'β' : s.slot}</span>
      <FoxStatus id={s.id} status={s.status} attention={s.attention} coat={s.pack ? 'gold' : undefined} />
      <span className="ph-drow-text">
        <span className="name">{s.name}</span>
        <span className="sub">{shortPath(s.cwd)}</span>
      </span>
      {needs ? <span className="ph-drow-tag is-needs">needs you</span> : focused ? <span className="ph-drow-tag">on the Mac</span> : null}
    </button>
  )
}

function Unpaired({ link }: { link: Link }) {
  return (
    <div className="ph ph-empty">
      <Fox anim="look" scale={4} />
      <p>{link === 'unauthorized' ? 'This link no longer matches the deck.' : 'Not paired with a deck yet.'}</p>
      <p className="ph-hint">On the Mac, press the phone button in Deck's top bar and scan the code (or open the link) on this phone.</p>
      {link === 'unauthorized' && (
        <button type="button" className="ph-btn" onClick={() => remote.unpair()}>
          forget this pairing
        </button>
      )}
    </div>
  )
}

/** `+`: start a session in a recent folder, or resume a parked one. The Mac's folder picker is not reachable from here. */
function NewSheet({ state, worktree: dflt, model: dfltModel, onClose }: { state: DeckState; worktree: boolean; model: string; onClose: () => void }) {
  const [worktree, setWorktree] = useState(dflt)
  const [model, setModel] = useState(dfltModel)
  // A default set by hand that the catalog lacks still needs a row, or the select would show the wrong one.
  const models = MODELS.some((m) => m.id === dfltModel) ? MODELS : [...MODELS, { id: dfltModel, label: dfltModel, hint: '' }]
  const run = (cmd: Parameters<typeof window.deck.command>[0]) => {
    void window.deck.command(cmd)
    onClose()
  }
  return (
    <Sheet onClose={onClose}>
      <h3>Start in</h3>
      {state.recent.length === 0 && <p className="ph-hint">No recent folders yet; start one on the Mac first.</p>}
      {state.recent.map((cwd) => (
        <button key={cwd} type="button" className="ph-row" onClick={() => run({ type: 'new', cwd, worktree, model })}>
          {shortPath(cwd)}
        </button>
      ))}
      <label className="ph-row ph-check">
        <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
        in a git worktree
      </label>
      <label className="ph-row ph-select">
        <span>model</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {state.parked.length > 0 && <h3>Parked</h3>}
      {state.parked.slice(0, 12).map((s) => (
        <button key={s.id} type="button" className="ph-row" onClick={() => run({ type: 'resume', id: s.id })}>
          <span className="name">{s.name}</span>
          <span className="cwd">{shortPath(s.cwd)}</span>
        </button>
      ))}
    </Sheet>
  )
}

/** ⋯: what the desktop's keyboard does to a session, for the one under your thumb. */
function MoreSheet({ s, onClose }: { s: SessionView; onClose: () => void }) {
  const run = (cmd: Parameters<typeof window.deck.command>[0]) => {
    void window.deck.command(cmd)
    onClose()
  }
  return (
    <Sheet onClose={onClose}>
      <h3>
        {s.pack ? 'β' : s.slot} · {s.name}
      </h3>
      <p className="ph-hint">{shortPath(s.cwd)}</p>
      <button type="button" className="ph-row" onClick={() => run({ type: 'focus', slot: s.slot! })}>
        Focus on the Mac
      </button>
      {s.pack && <Leash id={s.id} name={s.pack.task} paused={s.paused} beta run={run} />}
      <button type="button" className="ph-row" onClick={() => run({ type: 'detach', slot: s.slot! })}>
        Park (the conversation keeps running)
      </button>
      <button
        type="button"
        className="ph-row danger"
        onClick={() => {
          if (window.confirm(`Kill session ${s.slot} (${s.name})? The tmux session and its Claude go away.`)) run({ type: 'kill', id: s.id })
        }}
      >
        Kill
      </button>
      <button type="button" className="ph-row" onClick={() => location.reload()}>
        Reload this page
      </button>
    </Sheet>
  )
}

/** ⋯ on a subagent's page: the leash (it has no terminal to park or kill), and its parent to focus. */
function AgentSheet({ a, parent, onClose }: { a: AgentView; parent: SessionView | null; onClose: () => void }) {
  const run = (cmd: Parameters<typeof window.deck.command>[0]) => {
    void window.deck.command(cmd)
    onClose()
  }
  const done = a.endedAt !== null
  return (
    <Sheet onClose={onClose}>
      <h3>β · {agentName(a)}</h3>
      <p className="ph-hint">
        {agentKind(a)}
        {a.model ? ` · ${modelLabel(a.model)}` : ''}
        {a.task && a.description ? ` · ${a.task}` : ''}
      </p>
      {!done && !a.cancelled && <Leash id={a.id} name={agentName(a)} paused={a.paused} run={run} />}
      {(done || a.cancelled) && (
        <button type="button" className="ph-row" onClick={() => run({ type: 'agentDismiss', id: a.id, force: !done })}>
          Dismiss (put the tile away)
        </button>
      )}
      {parent && (
        <button type="button" className="ph-row" onClick={() => run({ type: 'focus', slot: parent.slot! })}>
          Focus its parent on the Mac ({parent.slot} · {parent.name})
        </button>
      )}
    </Sheet>
  )
}

/** Pause / resume / kill rows: a pause's note is asked with a plain prompt; a kill asks nothing, the phone has no dialog of its own. */
function Leash({ id, name, paused, beta, run }: { id: string; name: string; paused: boolean; beta?: boolean; run: (cmd: Parameters<typeof window.deck.command>[0]) => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <>
      {paused ? (
        <button type="button" className="ph-row" onClick={() => run({ type: 'leashResume', id })}>
          Resume (let its next tool call through)
        </button>
      ) : (
        <button
          type="button"
          className="ph-row"
          onClick={() => {
            const note = window.prompt(`Pause “${name}”: its next tool call waits until you resume it.\nA note for the alpha (optional):`, '')
            if (note !== null) run({ type: 'leashPause', id, note: note.trim() || undefined })
          }}
        >
          Pause (its next tool call waits)
        </button>
      )}
      <button
        type="button"
        className="ph-row danger"
        onClick={() => {
          if (armed) run({ type: 'leashCancel', id })
          else setArmed(true)
        }}
      >
        {armed ? 'Tap again to kill it' : 'Kill (the alpha is told)'}
      </button>
    </>
  )
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="ph-sheet-scrim" onClick={onClose} />
      <div className="ph-sheet" role="dialog">
        {children}
      </div>
    </>
  )
}
