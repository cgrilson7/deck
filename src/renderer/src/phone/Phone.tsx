import { useEffect, useRef, useState } from 'react'
import type { DeckState, SessionView } from '@shared/types'
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
 * the current one on the Mac. A tapped path opens the preview pane over everything.
 */
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
    return () => {
      offLink()
      offState()
      offErr()
      offDoc()
      window.clearTimeout(t)
    }
  }, [])

  // Every (re)connection starts from a fresh state: the phone may have slept through a lot.
  useEffect(() => {
    if (link !== 'open') return
    void window.deck.getState().then(setState).catch(() => {})
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

  const open = state?.open ?? []
  // Keep a page under the finger: the current one if still open, else whichever needs you, else the first.
  useEffect(() => {
    if (open.length === 0) {
      setCur(null)
      return
    }
    if (cur && open.some((s) => s.id === cur)) return
    setCur((open.find((s) => s.attention) ?? open[0]).id)
  }, [open, cur])

  const current = open.find((s) => s.id === cur) ?? null
  const index = current ? open.indexOf(current) : -1

  // A chip tap scrolls the pages; a swipe sets the chip. Both go through `cur`.
  const goTo = (id: string) => {
    setCur(id)
    const el = pages.current
    const i = open.findIndex((s) => s.id === id)
    if (el && i >= 0) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }
  const onScroll = () => {
    const el = pages.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    const s = open[i]
    if (s && s.id !== cur) setCur(s.id)
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
        {open.map((s) => (
          <button key={s.id} type="button" className={`ph-chip ${s.id === cur ? 'on' : ''} ${s.attention ? 'attention' : ''} status-${s.status}`} onClick={() => goTo(s.id)}>
            <span className="slot">{s.slot}</span>
            <FoxStatus id={s.id} status={s.status} attention={s.attention} />
            <span className="name">{s.name}</span>
          </button>
        ))}
        {state && open.length < state.cap && (
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
          {open.map((s) => (
            <div key={s.id} className={`ph-page status-${s.status} ${s.attention ? 'attention' : ''}`}>
              {view === 'screen' && s.id === cur ? (
                <ScreenView id={s.id} active={s.id === cur} />
              ) : (
                <ChatView id={s.id} cwd={s.cwd} status={s.status} attention={s.attention} onNeeds={() => setView('screen')} />
              )}
            </div>
          ))}
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
      {sheet === 'new' && state && <NewSheet state={state} worktree={settings.worktreeByDefault} onClose={() => setSheet(null)} />}
      {sheet === 'more' && current && <MoreSheet s={current} onClose={() => setSheet(null)} />}
    </div>
  )
}

function Unpaired({ link }: { link: Link }) {
  return (
    <div className="ph ph-empty">
      <Fox anim="alert" scale={4} />
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
function NewSheet({ state, worktree: dflt, onClose }: { state: DeckState; worktree: boolean; onClose: () => void }) {
  const [worktree, setWorktree] = useState(dflt)
  const run = (cmd: Parameters<typeof window.deck.command>[0]) => {
    void window.deck.command(cmd)
    onClose()
  }
  return (
    <Sheet onClose={onClose}>
      <h3>Start in</h3>
      {state.recent.length === 0 && <p className="ph-hint">No recent folders yet; start one on the Mac first.</p>}
      {state.recent.map((cwd) => (
        <button key={cwd} type="button" className="ph-row" onClick={() => run({ type: 'new', cwd, worktree })}>
          {shortPath(cwd)}
        </button>
      ))}
      <label className="ph-row ph-check">
        <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
        in a git worktree
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
        {s.slot} · {s.name}
      </h3>
      <p className="ph-hint">{shortPath(s.cwd)}</p>
      <button type="button" className="ph-row" onClick={() => run({ type: 'focus', slot: s.slot! })}>
        Focus on the Mac
      </button>
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
