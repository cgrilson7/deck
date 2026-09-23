import { useEffect, useRef } from 'react'
import { Gamepad2, Pause, Play, RotateCcw, Save, Swords, Volume2, VolumeX } from 'lucide-react'
import { gameboy, GB_KEYS, SPEEDS, STATE_SLOTS, useGameBoy, type GbKey, type Speed } from '../lib/gameboy'
import { usePokemonRoms } from '../lib/pokemon'
import { patchSettings, useSettings } from '../lib/theme'
import { Fox } from './Fox'

/** Keyboard → Game Boy while the pane is open. Arrows are the pad; Z/X the way every emulator has it. */
const KEYMAP: Record<string, GbKey> = {
  ArrowRight: 'RIGHT',
  ArrowLeft: 'LEFT',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  z: 'A',
  Z: 'A',
  x: 'B',
  X: 'B',
  Enter: 'START',
  Shift: 'SELECT',
  Backspace: 'SELECT'
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || !!el.closest('.xterm'))
}

/**
 * The Game Boy full size in the CENTER column, in the focus pane's place (the focused session
 * shows as a grid tile meanwhile; any session click, ⌘1–9 or a focus change closes it, as with
 * the Studio). The keyboard is the pad while it is open — not while typing into a field — and
 * the bar under the screen holds what a cartridge cannot: the battery save now, three save-state
 * slots, speed, pause, reset, sound. Sound plays only here: the tile is silent.
 */
export function PokemonPane({ onClose }: { onClose: () => void }) {
  const st = useGameBoy()
  const roms = usePokemonRoms()
  // The sprite gag is main's: the setting runs `trainer.mjs sprite watch` as a child of its own.
  const { spriteGag } = useSettings()
  const canvas = useRef<HTMLCanvasElement>(null)
  const pane = useRef<HTMLElement>(null)

  useEffect(() => {
    const gb = gameboy()
    gb.autoload()
    gb.setAudible(true)
    const off = canvas.current ? gb.attach(canvas.current) : undefined
    pane.current?.focus()
    return () => {
      off?.()
      gb.setAudible(false)
    }
  }, [])

  useEffect(() => {
    const gb = gameboy()
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!typing(e.target)) onClose()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const k = KEYMAP[e.key]
      if (!k) return
      e.preventDefault()
      gb.press(k)
    }
    const up = (e: KeyboardEvent) => {
      const k = KEYMAP[e.key]
      if (k) gb.release(k)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      gb.releaseAll()
    }
  }, [onClose])

  const gb = gameboy()
  const pad = (k: GbKey) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      gb.press(k)
    },
    onPointerUp: () => gb.release(k),
    onPointerLeave: () => gb.release(k),
    onPointerCancel: () => gb.release(k)
  })

  return (
    <section ref={pane} className="focus pokemon-pane" tabIndex={-1}>
      <header className="pane-head">
        <Gamepad2 size={14} className="pokemon-glyph" />
        <span className="name">Pokemon</span>
        {st.rom && (
          <span className="badge" title={st.rom.path}>
            {st.rom.file.replace(/\.gbc?$/i, '')}
          </span>
        )}
        {st.note && <span className="badge pokemon-note">{st.note}</span>}
        {st.error && <span className="badge pokemon-err">{st.error}</span>}
        <span className="spacer" />
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      <div className="pokemon-stage">
        <canvas ref={canvas} className="pokemon-canvas" style={{ display: st.rom ? undefined : 'none' }} />
        {!st.rom && (
          <div className="pokemon-pick">
            <Fox anim={st.loading ? 'run' : 'idle'} scale={3} />
            {st.loading ? (
              <span>loading the cartridge…</span>
            ) : roms.length ? (
              <>
                <span>Pick a cartridge</span>
                <div className="pokemon-roms">
                  {roms.map((r) => (
                    <button key={r.path} className="pill" onClick={() => void gb.load(r)} title={r.path}>
                      {r.name.replace(/\.gbc?$/i, '')}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="pokemon-hint">No .gb / .gbc files in the ROM folder (Keys &amp; services on the launcher)</span>
            )}
          </div>
        )}
      </div>

      <div className="pokemon-bar">
        <div className="pokemon-row">
          <button className="pill" disabled={!st.rom} title="Write the battery save now (it is also written every 30s and on close)" onClick={() => gb.saveNow()}>
            <Save size={12} /> save
          </button>
          <span className="pokemon-sep" />
          {STATE_SLOTS.map((s) => (
            <span key={s} className="pokemon-slot" title={`Save state slot ${s + 1}`}>
              <span className="pokemon-slot-n">{s + 1}</span>
              <button className="pill" disabled={!st.rom} onClick={() => void gb.saveState(s)} title={`Save the whole machine to slot ${s + 1}`}>
                save
              </button>
              <button className="pill" disabled={!st.rom} onClick={() => void gb.loadState(s)} title={`Load slot ${s + 1}`}>
                load
              </button>
            </span>
          ))}
          <span className="pokemon-sep" />
          {SPEEDS.map((s) => (
            <button key={s} className={`pill ${st.speed === s ? 'on' : ''}`} onClick={() => gb.setSpeed(s as Speed)} title={s === 1 ? 'Real time' : `${s}× (silent)`}>
              {s}×
            </button>
          ))}
          <span className="pokemon-sep" />
          <button className={`pill ${st.paused ? 'on' : ''}`} disabled={!st.rom} onClick={() => gb.setPaused(!st.paused)} title={st.paused ? 'Resume' : 'Pause'}>
            {st.paused ? <Play size={12} /> : <Pause size={12} />} {st.paused ? 'resume' : 'pause'}
          </button>
          <button className="pill" disabled={!st.rom} onClick={() => void gb.reset()} title="Power cycle (the battery save stays)">
            <RotateCcw size={12} /> reset
          </button>
          <button className={`pill ${st.muted ? '' : 'on'}`} onClick={() => gb.setMuted(!st.muted)} title={st.muted ? 'Sound on' : 'Mute'}>
            {st.muted ? <VolumeX size={12} /> : <Volume2 size={12} />} {st.muted ? 'muted' : 'sound'}
          </button>
          <button
            className={`pill ${spriteGag ? 'on' : ''}`}
            onClick={() => patchSettings({ spriteGag: !spriteGag })}
            title="Village vs Notes: repaint every battle (the sprite gag)"
          >
            <Swords size={12} /> gag
          </button>
          <span className="spacer" />
          {roms.length > 0 && st.rom && (
            <select
              className="pokemon-select"
              value={st.rom.path}
              title="Swap the cartridge (the battery save is written first)"
              onChange={(e) => {
                const r = roms.find((x) => x.path === e.target.value)
                if (r) void gb.load(r)
              }}
            >
              {!roms.some((r) => r.path === st.rom!.path) && <option value={st.rom.path}>{st.rom.file}</option>}
              {roms.map((r) => (
                <option key={r.path} value={r.path}>
                  {r.name.replace(/\.gbc?$/i, '')}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="pokemon-row pokemon-keys">
          <span className="pokemon-hint">← ↑ ↓ → pad · Z = A · X = B · ⏎ = Start · ⇧ = Select · Esc closes</span>
          <span className="spacer" />
          <span className="pokemon-pad">
            {GB_KEYS.map((k) => (
              <button key={k} className="pill" {...pad(k)} title={`Hold ${k}`}>
                {k === 'RIGHT' ? '→' : k === 'LEFT' ? '←' : k === 'UP' ? '↑' : k === 'DOWN' ? '↓' : k.toLowerCase()}
              </button>
            ))}
          </span>
        </div>
      </div>
    </section>
  )
}
