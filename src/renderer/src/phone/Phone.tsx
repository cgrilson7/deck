import { useEffect, useRef, useState } from 'react'
import { agentKind, agentName, type AgentView, type DeckState, type SessionView } from '@shared/types'
import { MODELS, modelLabel } from '@shared/models'
import { ChatView } from '../components/ChatView'
import { DocPane } from '../components/DocPane'
import { Fox } from '../components/Fox'
import { FoxStatus } from '../components/FoxStatus'
import { TilePrompt } from '../components/TilePrompt'
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
 */
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
  }, [open.length])

  if (link === 'unpaired' || link === 'unauthorized') return <Unpaired link={link} />

  const needs = !!current && (current.attention || current.status === 'blocked')

  return (
    <div className="ph">
      {link !== 'open' && <div className="ph-link">{link === 'connecting' ? 'connecting…' : 'reconnecting…'}</div>}
      {error && <div className="ph-link is-error">{error}</div>}
      <div className="ph-top">
        {open.map((p) =>
          p.kind === 'session' ? (
            <button key={p.id} type="button" className={`ph-chip ${p.id === cur ? 'on' : ''} ${p.s.attention ? 'attention' : ''} status-${p.s.status}`} onClick={() => goTo(p.id)}>
              <span className={`slot ${p.s.pack ? 'slot-beta' : ''}`}>{p.s.pack ? 'β' : p.s.slot}</span>
              <FoxStatus id={p.s.id} status={p.s.status} attention={p.s.attention} coat={p.s.pack ? 'gold' : undefined} />
              <span className="name">{p.s.name}</span>
            </button>
          ) : (
            <button key={p.id} type="button" className={`ph-chip ph-chip-agent ${p.id === cur ? 'on' : ''}`} onClick={() => goTo(p.id)}>
              <span className="slot slot-beta">β</span>
              <Fox anim={p.a.cancelled ? 'down' : p.a.endedAt !== null ? 'sleep' : p.a.paused ? 'look' : 'run'} scale={1} coat="gold" />
              <span className="name">{agentName(p.a)}</span>
            </button>
          )
        )}
        {state && sessions.filter((s) => !s.pack).length < state.cap && (
          <button type="button" className="ph-chip ph-plus" onClick={() => setSheet('new')} title="New session">
            +
          </button>
        )}
      </div>

      {open.length === 0 ? (
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
                  <ChatView id={p.s.id} cwd={p.s.cwd} status={p.s.status} attention={p.s.attention} onNeeds={() => setView('screen')} />
                )}
              </div>
            ) : (
              <div key={p.id} className={`ph-page ph-page-agent ${p.a.endedAt !== null ? 'status-idle' : 'status-busy'}`}>
                {p.a.cancelled && <div className="ph-agent-note is-cancel">cancelled: {p.a.cancelled.reason}</div>}
                {p.a.paused && !p.a.cancelled && <div className="ph-agent-note">{p.a.held ? 'paused: its tool call is waiting' : 'pausing: its next tool call will wait'}</div>}
                <ChatView id={p.id} cwd={p.parent?.cwd ?? ''} status={p.a.endedAt !== null ? 'idle' : 'busy'} attention={false} />
              </div>
            )
          )}
        </div>
      )}

      {page?.kind === 'agent' && (
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
      {current && (
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

      {doc && <DocPane target={doc} onClose={() => setDoc(null)} />}
      {sheet === 'new' && state && <NewSheet state={state} worktree={settings.worktreeByDefault} model={settings.defaultModel} onClose={() => setSheet(null)} />}
      {sheet === 'more' && current && <MoreSheet s={current} onClose={() => setSheet(null)} />}
      {sheet === 'more' && page?.kind === 'agent' && <AgentSheet a={page.a} parent={page.parent} onClose={() => setSheet(null)} />}
    </div>
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

/** Pause / resume / cancel rows: the reason (or note) is asked with a plain prompt, the phone has no dialog of its own. */
function Leash({ id, name, paused, beta, run }: { id: string; name: string; paused: boolean; beta?: boolean; run: (cmd: Parameters<typeof window.deck.command>[0]) => void }) {
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
          const reason = window.prompt(`Cancel “${name}” — why? The alpha is told and adjusts${beta ? ' (the beta is killed)' : ''}.`, '')
          if (reason?.trim()) run({ type: 'leashCancel', id, reason: reason.trim() })
        }}
      >
        Cancel with a reason
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
