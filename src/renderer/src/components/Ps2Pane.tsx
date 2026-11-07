import { useEffect, useRef, useState } from 'react'
import { Circle, Maximize, Minimize, Tv } from 'lucide-react'
import type { Ps2Button, SessionView } from '@shared/types'
import { ps2, usePs2 } from '../lib/ps2'
import { Fox } from './Fox'
import { SessionDock } from './Ps1Pane'
import { FoxtrotPlays, stageRect } from './FoxtrotPlays'

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

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || !!el.closest('.xterm'))
}

/**
 * PCSX2 full size in the CENTER column (the PS1 pane's rules: Esc closes, a session click or focus change
 * closes it). The picture is PCSX2's own window, mirrored; the keyboard and the pad below play it while the
 * deck stays in front. Dressed as "FOXTROT PLAYS …" (FoxtrotPlays: the 9:16 stage for Reels / Stories, its
 * DualShock 2 lit orange as buttons go down, and playable by pointer); record lays the recorder over it.
 * FULL SCREEN (⤢, F, a double-click): the game over everything, the session dock along the bottom.
 */
export function Ps2Pane({ onClose, sessions, focusSlot }: { onClose: () => void; sessions: SessionView[]; focusSlot: number | null }) {
  const v = usePs2()
  const canvas = useRef<HTMLCanvasElement>(null)
  const pane = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
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
  const record = () => {
    setTheater(false)
    // Out of full screen first, so the rectangle is the one the recorder will see.
    window.setTimeout(() => {
      const r = stageRect(stage.current)
      if (r) window.deck.ps2Record(r)
    }, theaterRef.current ? 700 : 0)
  }
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
        {st?.game && <span className="badge">{st.game}</span>}
        {st && st.running && !st.trusted && <span className="badge pokemon-err">keys need Accessibility for Foxtrot&apos;s Workshop</span>}
        {v.error && <span className="badge pokemon-err">{v.error}</span>}
        <span className="spacer" />
        <button className="ghost" title="Record the 9:16 frame: the screen recorder laid exactly over it" onClick={record}>
          <Circle size={11} className="fp-rec-dot" /> record
        </button>
        <button className="ghost" title={theater ? 'Leave full screen (Esc, F)' : 'Full screen, with your sessions along the bottom (F)'} onClick={() => setTheater((t) => !t)}>
          {theater ? <Minimize size={13} /> : <Maximize size={13} />}
        </button>
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      <div className="pokemon-stage fp-host" onDoubleClick={() => v.live && setTheater((t) => !t)}>
        <FoxtrotPlays
          game={st?.game ?? null}
          canvasRef={canvas}
          live={v.live}
          stageRef={stage}
          onPress={(b, down) => (down ? m.press(b) : m.release(b))}
          empty={
            <div className="pokemon-pick fp-pick">
              <Fox anim={st?.running ? 'run' : 'idle'} scale={8} />
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
          }
        />
      </div>

      {theater ? (
        <SessionDock sessions={sessions} focusSlot={focusSlot} onPick={goTo} onExit={() => setTheater(false)} />
      ) : (
        <div className="pokemon-row pokemon-keys fp-keys">
          <span className="pokemon-hint">arrows pad · Z ✕ · X ○ · A □ · S △ · Q W L1 R1 · E R L2 R2 · ⏎ start · ⇧ select · F full screen · Esc closes · the controller plays PCSX2 directly and lights the pad</span>
        </div>
      )}
    </section>
  )
}
