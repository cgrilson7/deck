import { useEffect, useRef, useState } from 'react'
import { Gamepad2, Pause, Play, RotateCcw, Save, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { gameboy, GB_KEYS, SPEEDS, STATE_SLOTS, useGameBoy, type GbKey, type Speed } from '../lib/gameboy'
import { usePokemonRoms } from '../lib/pokemon'
import { patchSettings, useSettings } from '../lib/theme'
import { Fox } from './Fox'
import { GB_ARTS, GB_LOOKS, GB_PLACES, GB_SETS, gbLookOn, type GbPlace } from '@shared/types'

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
          <SpritesMenu />
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

const PLACE_LABEL: Record<GbPlace, string> = { player: 'You', follower: 'Follower' }

/**
 * THE SPRITES POPOVER (docs/sprites.md step 5): the looks as buttons, a row per overlay place (the game's own
 * or an art), the patch sets as checkboxes, and the battle gag. Every control is a setting (`gbPlaces`,
 * `gbPatches`, `spriteGag`); the Game Boy follows the settings, so a ⌘R keeps all of it.
 */
function SpritesMenu() {
  const s = useSettings()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const any = Object.keys(s.gbPlaces).length > 0 || s.gbPatches.length > 0 || s.spriteGag

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const setPlace = (place: GbPlace, art: string) => {
    const next = { ...s.gbPlaces }
    if (art) next[place] = art
    else delete next[place]
    patchSettings({ gbPlaces: next })
  }
  const toggleSet = (name: string, on: boolean) => patchSettings({ gbPatches: on ? [...s.gbPatches.filter((n) => n !== name), name] : s.gbPatches.filter((n) => n !== name) })
  // Every set that is on, the ones main can build first; a set the CLI kept under another name shows too.
  const sets = [...GB_SETS.map((x) => ({ name: x.name, label: x.label, hint: x.hint as string })), ...s.gbPatches.filter((n) => !GB_SETS.some((x) => x.name === n)).map((n) => ({ name: n, label: n, hint: 'kept by the CLI' }))]

  return (
    <div className="pokemon-sprites" ref={box}>
      <button className={`pill ${any ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Sprites: Foxtrot, the battle gag, the game's own">
        <Sparkles size={12} /> sprites
      </button>
      {open && (
        <div className="popover pokemon-sprites-pop">
          <div className="menu-title">Looks</div>
          <div className="pokemon-row">
            {GB_LOOKS.map((l) => (
              <button key={l.id} className={`pill ${gbLookOn(s, l) ? 'on' : ''}`} title={l.hint} onClick={() => patchSettings(l.patch)}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="menu-title">Places</div>
          {GB_PLACES.map((place) => {
            const cur = s.gbPlaces[place] ?? ''
            const arts = GB_ARTS[place].includes(cur) || !cur ? GB_ARTS[place] : [...GB_ARTS[place], cur]
            return (
              <label key={place} className="pokemon-sprites-line">
                <span>{PLACE_LABEL[place]}</span>
                <select className="pokemon-select" value={cur} onChange={(e) => setPlace(place, e.target.value)}>
                  <option value="">{place === 'player' ? 'Red' : 'Pikachu'}</option>
                  {arts.map((a) => (
                    <option key={a} value={a}>
                      {a === 'blank' ? 'nobody (unseen)' : a[0].toUpperCase() + a.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
          <div className="menu-title">Patches</div>
          {sets.map((x) => (
            <label key={x.name} className="pokemon-sprites-line" title={x.hint}>
              <input type="checkbox" checked={s.gbPatches.includes(x.name)} onChange={(e) => toggleSet(x.name, e.target.checked)} />
              <span>{x.label}</span>
            </label>
          ))}
          <label className="pokemon-sprites-line" title="Every battle repainted: NOTES APP against VILLAGE (the sprite gag's watch)">
            <input type="checkbox" checked={s.spriteGag} onChange={(e) => patchSettings({ spriteGag: e.target.checked })} />
            <span>Village vs Notes (battles)</span>
          </label>
        </div>
      )}
    </div>
  )
}
