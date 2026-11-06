import { useEffect, useRef, useState } from 'react'
import { Disc3, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import type { SessionView } from '@shared/types'
import { ps1, STATE_SLOTS, usePs1, usePs1Discs, type Ps1Button } from '../lib/ps1'
import { Fox } from './Fox'

/**
 * Keyboard → PlayStation while the pane is open: arrows the d-pad, Z X A S the face buttons (cross,
 * circle, square, triangle — RetroArch's own layout), Q W shoulders, E R the second shoulders.
 */
const KEYMAP: Record<string, Ps1Button> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  z: 'cross',
  x: 'circle',
  a: 'square',
  s: 'triangle',
  q: 'l1',
  w: 'r1',
  e: 'l2',
  r: 'r2',
  Enter: 'start',
  Shift: 'select',
  Backspace: 'select'
}
const KEY_OF: Partial<Record<Ps1Button, string>> = { cross: 'Z', circle: 'X', square: 'A', triangle: 'S', l1: 'Q', r1: 'W', l2: 'E', r2: 'R', start: '⏎', select: '⇧' }

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || !!el.closest('.xterm'))
}

/**
 * The PS1 full size in the CENTER column, in the focus pane's place (the Pokemon pane's rules: any
 * session click, ⌘1–9 or a focus change closes it). The keyboard is the pad while it is open, not
 * while typing into a field; sound plays only here.
 *
 * Dressed as the console: the game in a TV, the grey top of a PS1 under it — the disc lid, POWER (its
 * lamp green while a disc runs; it boots the last disc or ejects), RESET, OPEN (eject: the disc tray) —
 * and a controller below with the four coloured symbols.
 *
 * FULL SCREEN (⤢, F, or a double-click on the game): the pane takes the whole screen (the Fullscreen
 * API over the deck window), the game as large as it fits, and a DOCK along the bottom with every open
 * session — its status, its name, what it is doing — so a session that needs you is one click away:
 * clicking one leaves full screen and focuses it. Esc leaves full screen first, the pane second.
 */
export function Ps1Pane({ onClose, sessions, focusSlot }: { onClose: () => void; sessions: SessionView[]; focusSlot: number | null }) {
  const st = usePs1()
  const discs = usePs1Discs()
  const host = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLElement>(null)
  const [theater, setTheater] = useState(false)
  const theaterRef = useRef(false)
  theaterRef.current = theater

  useEffect(() => {
    const m = ps1()
    m.autoload()
    m.setAudible(true)
    const off = host.current ? m.attach(host.current, 'pane') : undefined
    pane.current?.focus()
    return () => {
      off?.()
      m.setAudible(false)
    }
  }, [])

  // Full screen follows the pane's class; leaving it from outside (macOS's own controls, Esc) clears the class.
  useEffect(() => {
    const el = pane.current
    if (!el) return
    if (theater && document.fullscreenElement !== el) void el.requestFullscreen().catch(() => {})
    if (!theater && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
  }, [theater])
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && theaterRef.current) setTheater(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const m = ps1()
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (typing(e.target)) return
        if (theaterRef.current) setTheater(false)
        else onClose()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setTheater((v) => !v)
        return
      }
      const b = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()]
      if (!b) return
      e.preventDefault()
      m.press(b)
    }
    const up = (e: KeyboardEvent) => {
      const b = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()]
      if (b) m.release(b)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      m.releaseAll()
    }
  }, [onClose])

  const m = ps1()
  const pad = (b: Ps1Button) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      m.press(b)
    },
    onPointerUp: () => m.release(b),
    onPointerLeave: () => m.release(b),
    onPointerCancel: () => m.release(b),
    title: `Hold ${b}${KEY_OF[b] ? ` (${KEY_OF[b]})` : ''}`
  })
  const on = st.running
  const lastDisc = () => {
    let last: string | null = null
    try {
      last = localStorage.getItem('deck.ps1.disc')
    } catch {}
    return discs.find((d) => d.path === last) ?? discs[0] ?? null
  }
  const power = () => {
    if (on) void m.eject()
    else {
      const d = lastDisc()
      if (d) void m.load(d).catch(() => {})
    }
  }
  const goTo = (s: SessionView) => {
    setTheater(false)
    onClose()
    if (s.slot != null) void window.deck.command({ type: 'focus', slot: s.slot })
  }

  return (
    <section ref={pane} className={`focus pokemon-pane ps1-pane ${theater ? 'ps1-theater' : ''}`} tabIndex={-1}>
      <header className="pane-head">
        <Disc3 size={14} className="pokemon-glyph" />
        <span className="name">PS1</span>
        {st.disc && (
          <span className="badge" title={st.disc.path}>
            {st.disc.name}
          </span>
        )}
        {st.info?.serial && <span className="badge">{st.info.serial}</span>}
        {st.note && <span className="badge pokemon-note">{st.note}</span>}
        {st.error && <span className="badge pokemon-err">{st.error}</span>}
        <span className="spacer" />
        <button className="ghost" title={theater ? 'Leave full screen (Esc, F)' : 'Full screen, with your sessions along the bottom (F)'} onClick={() => setTheater((v) => !v)}>
          {theater ? <Minimize size={13} /> : <Maximize size={13} />}
        </button>
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      <div className="pokemon-stage ps1-stage" onDoubleClick={() => on && setTheater((v) => !v)}>
        <div className="ps1-tv">
          <div ref={host} className="ps1-host" style={{ display: on ? undefined : 'none' }} />
          {!on && (
            <div className="pokemon-pick">
              <Fox anim={st.loading ? 'run' : 'idle'} scale={3} />
              {st.loading ? (
                <span>{st.loading}</span>
              ) : discs.length ? (
                <>
                  <span>Pick a disc</span>
                  <div className="pokemon-roms">
                    {discs.map((d) => (
                      <button key={d.path} className="pill" onClick={() => void m.load(d).catch(() => {})} title={d.path}>
                        {d.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <span className="pokemon-hint">No discs (.cue, .chd, .pbp, .iso) in the disc folder (Keys &amp; services on the launcher)</span>
              )}
            </div>
          )}
        </div>
      </div>

      {theater ? (
        <SessionDock sessions={sessions} focusSlot={focusSlot} onPick={goTo} onExit={() => setTheater(false)} />
      ) : (
        <div className="pokemon-bar ps1-console">
          {/* The top of the console: the disc lid, and the three buttons that do what they did. */}
          <div className="ps1-top">
            <span className={`ps1-lid ${on && !st.paused ? 'spin' : ''}`} title={st.disc ? st.disc.name : 'No disc'} />
            <div className="ps1-tray">
              {STATE_SLOTS.map((s) => (
                <span key={s} className="ps1-slot" title={`Save state slot ${s + 1}`}>
                  <span className="ps1-slot-n">{s + 1}</span>
                  <button className="ps1-chip" disabled={!on} onClick={() => void m.saveState(s).catch(() => {})} title={`Save the whole console to slot ${s + 1}`}>
                    save
                  </button>
                  <button className="ps1-chip" disabled={!on} onClick={() => void m.loadState(s).catch(() => {})} title={`Load slot ${s + 1}`}>
                    load
                  </button>
                </span>
              ))}
              <span className="ps1-tray-row">
                <button className={`ps1-chip ${st.paused ? 'on' : ''}`} disabled={!on} onClick={() => m.setPaused(!st.paused)} title={st.paused ? 'Resume' : 'Pause'}>
                  {st.paused ? <Play size={11} /> : <Pause size={11} />}
                </button>
                <button className={`ps1-chip ${st.muted ? '' : 'on'}`} onClick={() => m.setMuted(!st.muted)} title={st.muted ? 'Sound on' : 'Mute'}>
                  {st.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                </button>
                {discs.length > 0 && (
                  <select
                    className="ps1-select"
                    value={st.disc?.path ?? ''}
                    title="Swap the disc (the memory card is written first)"
                    onChange={(e) => {
                      const d = discs.find((x) => x.path === e.target.value)
                      if (d) void m.load(d).catch(() => {})
                    }}
                  >
                    {!st.disc && <option value="">no disc</option>}
                    {st.disc && !discs.some((d) => d.path === st.disc!.path) && <option value={st.disc.path}>{st.disc.name}</option>}
                    {discs.map((d) => (
                      <option key={d.path} value={d.path}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </div>
            <div className="ps1-keys">
              <span className="ps1-key-wrap">
                <button className="ps1-key" onClick={() => m.reset()} disabled={!on} title="RESET: restart the game (the memory card stays)" />
                <small>RESET</small>
              </span>
              <span className="ps1-key-wrap">
                <button className="ps1-key" onClick={power} title={on ? 'POWER: off (the memory card is written first)' : 'POWER: on, with the last disc'}>
                  <i className={`ps1-led ${on ? 'on' : ''}`} />
                </button>
                <small>POWER</small>
              </span>
              <span className="ps1-key-wrap">
                <button className="ps1-open" onClick={() => void m.eject()} disabled={!on} title="OPEN: eject the disc and pick another" />
                <small>OPEN</small>
              </span>
            </div>
          </div>

          {/* The controller: shoulders, the d-pad, SELECT / START, and the four symbols in their colours. */}
          <div className="ps1-pad">
            <div className="ps1-shoulders">
              <button className="ps1-sh" {...pad('l2')}>L2</button>
              <button className="ps1-sh" {...pad('l1')}>L1</button>
            </div>
            <div className="ps1-dpad">
              <button className="ps1-dir up" {...pad('up')} />
              <button className="ps1-dir left" {...pad('left')} />
              <button className="ps1-dir right" {...pad('right')} />
              <button className="ps1-dir down" {...pad('down')} />
            </div>
            <div className="ps1-mid">
              <button className="ps1-small" {...pad('select')} />
              <button className="ps1-small" {...pad('start')} />
              <small>SELECT&nbsp;&nbsp;START</small>
            </div>
            <div className="ps1-face-btns">
              <button className="ps1-fb triangle" {...pad('triangle')}>
                △
              </button>
              <button className="ps1-fb square" {...pad('square')}>
                □
              </button>
              <button className="ps1-fb circle" {...pad('circle')}>
                ○
              </button>
              <button className="ps1-fb cross" {...pad('cross')}>
                ✕
              </button>
            </div>
            <div className="ps1-shoulders">
              <button className="ps1-sh" {...pad('r2')}>R2</button>
              <button className="ps1-sh" {...pad('r1')}>R1</button>
            </div>
          </div>
          <div className="pokemon-row pokemon-keys">
            <span className="pokemon-hint">arrows pad · Z ✕ · X ○ · A □ · S △ · Q W L1 R1 · E R L2 R2 · ⏎ start · ⇧ select · F full screen · Esc closes</span>
          </div>
        </div>
      )}
    </section>
  )
}

const STATUS_WORD: Record<string, string> = { busy: 'working', idle: 'idle', blocked: 'needs you', starting: 'starting', dead: 'stopped', unknown: '' }

/** Full screen's bottom strip: every open session as a chip (status lamp, name, its title), the ones that need you first. */
function SessionDock({ sessions, focusSlot, onPick, onExit }: { sessions: SessionView[]; focusSlot: number | null; onPick: (s: SessionView) => void; onExit: () => void }) {
  const sorted = [...sessions].sort((a, b) => Number(b.attention || b.status === 'blocked') - Number(a.attention || a.status === 'blocked') || (a.slot ?? 99) - (b.slot ?? 99))
  return (
    <nav className="ps1-dock" aria-label="Sessions">
      <div className="ps1-dock-list">
        {sorted.length === 0 && <span className="ps1-dock-empty">no sessions open</span>}
        {sorted.map((s) => {
          const needs = s.attention || s.status === 'blocked'
          return (
            <button key={s.id} className={`ps1-dock-chip ${needs ? 'needs' : ''} ${s.slot === focusSlot ? 'focused' : ''}`} onClick={() => onPick(s)} title={`${s.name}${s.title ? ` — ${s.title}` : ''}\n${STATUS_WORD[s.status] ?? s.status}${s.cwd ? `\n${s.cwd}` : ''}\nClick: leave full screen and go to it`}>
              <i className={`ps1-dock-dot ${s.status} ${needs ? 'needs' : ''}`} />
              {s.slot != null && <span className="ps1-dock-slot">{s.slot === 10 ? 0 : s.slot}</span>}
              <span className="ps1-dock-name">{s.name}</span>
              {s.title && <span className="ps1-dock-title">{s.title}</span>}
            </button>
          )
        })}
      </div>
      <button className="ps1-dock-exit" onClick={onExit} title="Leave full screen (Esc)">
        <Minimize size={13} /> exit
      </button>
    </nav>
  )
}
