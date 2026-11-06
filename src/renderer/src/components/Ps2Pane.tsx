import { useEffect, useRef, useState } from 'react'
import { Maximize, Minimize, Tv } from 'lucide-react'
import type { Ps2Button, SessionView } from '@shared/types'
import { ps2, usePs2 } from '../lib/ps2'
import { Fox } from './Fox'
import { SessionDock } from './Ps1Pane'

/** Keyboard → PS2 pad while the pane is open: the PS1 pane's layout, so one set of fingers plays both. */
const KEYMAP: Record<string, Ps2Button> = {
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
const KEY_OF: Partial<Record<Ps2Button, string>> = { cross: 'Z', circle: 'X', square: 'A', triangle: 'S', l1: 'Q', r1: 'W', l2: 'E', r2: 'R', start: '⏎', select: '⇧' }

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || !!el.closest('.xterm'))
}

/**
 * PCSX2 full size in the CENTER column (the PS1 pane's rules: Esc closes, a session click or focus change
 * closes it). The picture is PCSX2's own window, mirrored; the keyboard and the pad below play it while the
 * deck stays in front. Dressed as the black PS2: its ribbed front with the two lamps, and a DualShock 2.
 * FULL SCREEN (⤢, F, a double-click): the game over everything, the session dock along the bottom.
 */
export function Ps2Pane({ onClose, sessions, focusSlot }: { onClose: () => void; sessions: SessionView[]; focusSlot: number | null }) {
  const v = usePs2()
  const canvas = useRef<HTMLCanvasElement>(null)
  const pane = useRef<HTMLElement>(null)
  const [theater, setTheater] = useState(false)
  const theaterRef = useRef(false)
  theaterRef.current = theater

  useEffect(() => {
    const off = canvas.current ? ps2().attach(canvas.current) : undefined
    pane.current?.focus()
    return () => off?.()
  }, [])

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
    const m = ps2()
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
        setTheater((t) => !t)
        return
      }
      const b = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()]
      if (!b) return
      e.preventDefault()
      if (!e.repeat) m.press(b)
    }
    const up = (e: KeyboardEvent) => {
      const b = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()]
      if (b) m.release(b)
    }
    const blur = () => m.releaseAll()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      m.releaseAll()
    }
  }, [onClose])

  const m = ps2()
  const pad = (b: Ps2Button) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      m.press(b)
    },
    onPointerUp: () => m.release(b),
    onPointerLeave: () => m.release(b),
    onPointerCancel: () => m.release(b),
    title: `Hold ${b}${KEY_OF[b] ? ` (${KEY_OF[b]})` : ''}`
  })
  const st = v.status
  const goTo = (s: SessionView) => {
    setTheater(false)
    onClose()
    if (s.slot != null) void window.deck.command({ type: 'focus', slot: s.slot })
  }

  return (
    <section ref={pane} className={`focus pokemon-pane ps2-pane ${theater ? 'ps1-theater' : ''}`} tabIndex={-1}>
      <header className="pane-head">
        <Tv size={14} className="pokemon-glyph" />
        <span className="name">PS2</span>
        {st?.window?.title && <span className="badge">{st.window.title}</span>}
        {st && st.running && !st.trusted && <span className="badge pokemon-err">keys need Accessibility for Foxtrot&apos;s Workshop</span>}
        {v.error && <span className="badge pokemon-err">{v.error}</span>}
        <span className="spacer" />
        <button className="ghost" title={theater ? 'Leave full screen (Esc, F)' : 'Full screen, with your sessions along the bottom (F)'} onClick={() => setTheater((t) => !t)}>
          {theater ? <Minimize size={13} /> : <Maximize size={13} />}
        </button>
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      <div className="pokemon-stage ps1-stage" onDoubleClick={() => v.live && setTheater((t) => !t)}>
        <div className="ps1-tv">
          <canvas ref={canvas} className="ps2-canvas" style={{ display: v.live ? undefined : 'none' }} />
          {!v.live && (
            <div className="pokemon-pick">
              <Fox anim={st?.running ? 'run' : 'idle'} scale={3} />
              {!st ? (
                <span>looking for PCSX2…</span>
              ) : !st.installed ? (
                <span className="pokemon-hint">PCSX2 is not in /Applications</span>
              ) : st.running ? (
                <span className="pokemon-hint">{st.window ? 'connecting to PCSX2’s window…' : 'PCSX2 is running but has no game window open'}</span>
              ) : st.discs.length ? (
                <>
                  <span>Start PCSX2 with</span>
                  <div className="pokemon-roms">
                    {st.discs.map((d) => (
                      <button key={d.path} className="pill" onClick={() => void m.launch(d.path)} title={d.path}>
                        {d.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <span className="pokemon-hint">No PS2 discs (.iso, .chd, .cso) in the PS2 disc folder (Keys &amp; services on the launcher)</span>
              )}
            </div>
          )}
        </div>
      </div>

      {theater ? (
        <SessionDock sessions={sessions} focusSlot={focusSlot} onPick={goTo} onExit={() => setTheater(false)} />
      ) : (
        <div className="pokemon-bar ps2-console">
          <div className="ps2-front">
            <span className="ps2-lamps">
              <span className="ps2-lamp-wrap">
                <i className={`ps2-lamp green ${st?.running ? 'on' : ''}`} />
                <small>{st?.running ? 'PCSX2 running' : 'PCSX2 off'}</small>
              </span>
              <span className="ps2-lamp-wrap">
                <i className={`ps2-lamp blue ${v.live ? 'on' : ''}`} />
                <small>{v.live ? 'picture live' : 'no picture'}</small>
              </span>
            </span>
          </div>
          <div className="ps1-pad ps2-pad">
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
              <span className="ps2-sticks">
                <i className="ps2-stick" />
                <i className="ps2-stick" />
              </span>
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
            <span className="pokemon-hint">arrows pad · Z ✕ · X ○ · A □ · S △ · Q W L1 R1 · E R L2 R2 · ⏎ start · ⇧ select · F full screen · Esc closes · a gamepad plays PCSX2 directly</span>
          </div>
        </div>
      )}
    </section>
  )
}
