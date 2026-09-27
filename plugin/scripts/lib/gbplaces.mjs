// gbplaces: THE OVERWORLD RUNTIME — named overlay PACKS painted into fixed PLACES of the game after
// EVERY core step, by both Game Boy ends: the headless door (door.mjs's `step()`) and the renderer
// (gameboy.ts's one `stepCore`). Pure JS like gbcore.mjs beside it (Uint8Array, no Buffer / fs / DOM),
// so a headless preview is what the tile does. Its types are gbplaces.d.mts: keep the two in step.
//
// A PACK is DATA (docs/sprites/reports/skill-design.md §3): the CLI compiles the art (packs.mjs), the
// runtime is a fixed vocabulary of places written here. This step builds two of them (§6: the old
// `overworld` of sprites.mjs, taken apart):
//   player    Red's walking sprite: OBJ tiles $8000 (standing: down, up, left = 12 tiles) and $8800
//             (walking, the same 12), both kept equal to the CURRENT frame of the pack's animation —
//             `run` while wWalkCounter ≠ 0, `idle` otherwise, frame = floor(now / ms) % n — so every
//             direction shows the same side view and the step alternation the game does changes nothing.
//   follower  Pikachu's: $80C0 / $88C0, the same rule, or { blank: true } (zeros: he follows, unseen).
//             While Pikachu walks to Nurse Joy the game loads his walking frames $40 tiles higher
//             ($8CC0) and adds hPikachuSpriteVRAMOffset ($FFFC = $40) to every OAM tile ≥ $80
//             (engine/pikachu/pikachu_emotions.asm PikachuWalksToNurseJoy, pikachu_movement.asm
//             LoadPikachuSpriteIntoVRAM, engine/gfx/sprite_oam.asm), so while that byte is $40 the
//             frames go there too. It is 0 at every other moment, and $8CC0 then belongs to the NPCs.
// A place is KEPT, not painted once: every step compares VRAM with the frame it wants (reading
// memory[] directly, no copy) and writes through gbcore's vramWrite only when they differ — the game
// reloads these tiles on every map load and after every text box, and the next step puts ours back.
// The OBJ palette (the pack's `palette`) is compared with palette RAM every step and set through
// paletteSet when it differs, mapped through the game's own fade register (keepPalette).
// OBJ palette 0 is Red's AND every NPC's and Pikachu's (formats.md §3: all attrs $00).
//
// WHEN A PLACE STANDS BACK (its status says why):
//   'battle'  wIsInBattle ≠ 0: $8000 is the battle's sprites then.
//   'idle'    a text box or a menu is up: wFontLoaded bit 0 (BIT_FONT_LOADED) is set. The font is
//             loaded over $8800 (vFont) for every text box — walking frames painted there garble the
//             letters A–L — and the party menu puts its icons at $8000; the game reloads both when the
//             box closes (ReloadWalkingTilePatterns / ReloadMapSpriteTilePatterns clear the bit) and the
//             next step repaints. So the fox holds still through a dialogue. Also: no step has run yet.
//   'kept'    everything was already ours.   'painted'  something was written this step.
//
// YELLOW ONLY: the addresses below are pokeyellow's (plugin/data/yellow.json `addr`, and pret's
// pokeyellow.sym for this cartridge for the two it lacks), hardcoded so this file stays pure.

import { b64dec, b64enc, bgr555, paletteSet, vramWrite } from './gbcore.mjs'

const W_FONT_LOADED = 0xcfc3 // bit 0 = BIT_FONT_LOADED (constants/ram_constants.asm)
const W_WALK_COUNTER = 0xcfc4
const W_IS_IN_BATTLE = 0xd056 // banked WRAM: read through the core's memoryRead, never memory[]
const H_PIKACHU_VRAM_OFFSET = 0xfffc

const RED_STAND = 0x8000
const RED_WALK = 0x8800
const PIKA_STAND = 0x80c0
const PIKA_WALK = 0x88c0
const PIKA_WALK_CENTER = 0x8cc0 // + $40 tiles, only while hPikachuSpriteVRAMOffset is $40
export const FRAME_BYTES = 192 // 3 frames (stand down / up / left) × 4 tiles × 16 bytes

/** The runtime's registry, in the order `step` keeps them. */
export const PLACES = Object.freeze(['player', 'follower'])
const NAME = /^[a-z0-9:_-]{1,40}$/
const MAX_PACKS = 16
const MAX_FRAMES = 32

function frames(list, what) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_FRAMES) throw new Error(`${what}: 1–${MAX_FRAMES} frames`)
  return list.map((f, i) => {
    const bytes = b64dec(f)
    if (bytes.length !== FRAME_BYTES) throw new Error(`${what}[${i}]: ${bytes.length} bytes, a frame is ${FRAME_BYTES} (3 × 4 tiles)`)
    return bytes
  })
}

function objPlace(p, place, blankOk) {
  if (!p || typeof p !== 'object') throw new Error(`${place}: not an object`)
  if (p.blank === true) {
    if (!blankOk) throw new Error(`${place}: only the follower can be blank`)
    const zero = new Uint8Array(FRAME_BYTES)
    return { blank: true, idle: [zero], run: [zero], ms: { idle: 1000, run: 1000 }, palette: null }
  }
  const idle = frames(p.frames?.idle, `${place}.frames.idle`)
  const run = frames(p.frames?.run, `${place}.frames.run`)
  const ms = { idle: Number(p.ms?.idle), run: Number(p.ms?.run) }
  for (const k of ['idle', 'run']) if (!(ms[k] >= 16 && ms[k] <= 10000)) throw new Error(`${place}.ms.${k}: 16–10000`)
  let palette = null
  if (p.palette != null) {
    const obj = p.palette.obj
    if (!Number.isInteger(obj) || obj < 0 || obj > 7) throw new Error(`${place}.palette.obj: 0–7`)
    const colours = p.palette.colours
    if (!Array.isArray(colours) || colours.length !== 4) throw new Error(`${place}.palette.colours: 4 colours`)
    const values = colours.map(bgr555)
    const rest = obj < 4 ? 0xd0 : 0xe0 // rOBP0 / rOBP1 at rest (home/fade.asm FadePal4)
    palette = { obj, values, rest, base: fadeBase(values, rest), byReg: new Map() }
  }
  return { blank: false, idle, run, ms, palette }
}

/** Is VRAM bank 0 at `at` already `want`? memory[] is bank 0's tile data (gbcore's vramRead reads it there). */
function same(core, at, want) {
  const m = core.memory
  for (let i = 0; i < want.length; i++) if (m[at + i] !== want[i]) return false
  return true
}

/**
 * A pack's four colours as they sit at rest (register `rest`) → the four BASE shades the game's fades
 * index: base[s] = the colour of the first index the resting register maps to shade s; a shade the rest
 * value never selects (shade 2 under $D0) is the blend of its neighbours.
 */
function fadeBase(values, rest) {
  const base = [null, null, null, null]
  for (let i = 0; i < 4; i++) {
    const s = (rest >> (2 * i)) & 3
    if (base[s] == null) base[s] = values[i]
  }
  const mix = (a, b) => (((a & 31) + (b & 31)) >> 1) | (((((a >> 5) & 31) + ((b >> 5) & 31)) >> 1) << 5) | (((((a >> 10) & 31) + ((b >> 10) & 31)) >> 1) << 10)
  for (let s = 0; s < 4; s++)
    if (base[s] == null) {
      let lo = s - 1
      while (lo >= 0 && base[lo] == null) lo--
      let hi = s + 1
      while (hi < 4 && base[hi] == null) hi++
      base[s] = lo >= 0 && hi < 4 ? mix(base[lo], base[hi]) : lo >= 0 ? base[lo] : base[hi]
    }
  return base
}


export class Overlays {
  constructor() {
    /** name → { pack (as given), places (compiled) }; a Map keeps install order. */
    this.packs = new Map()
    /** place → { pack, state } from the last step. */
    this.last = {}
    this._active = null
  }

  /** Install or replace a pack by name; the newest pack filling a place is the one painted there. Throws on a bad pack. */
  set(pack) {
    if (!pack || typeof pack !== 'object') throw new Error('overlay: a pack is an object')
    const name = pack.name
    if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`overlay: bad pack name ${JSON.stringify(name)} (a–z 0–9 : _ -, 1–40 long)`)
    if (pack.v !== 1) throw new Error(`overlay ${name}: v must be 1`)
    const places = pack.places ?? {}
    const keys = Object.keys(places)
    if (!keys.length) throw new Error(`overlay ${name}: no places`)
    const compiled = {}
    for (const k of keys) {
      if (!PLACES.includes(k)) throw new Error(`overlay ${name}: unknown place ${JSON.stringify(k)} (${PLACES.join(', ')})`)
      compiled[k] = objPlace(places[k], `${name}.${k}`, k === 'follower')
    }
    if (!this.packs.has(name) && this.packs.size >= MAX_PACKS) throw new Error(`overlay: ${MAX_PACKS} packs at most`)
    this.packs.delete(name) // a replaced pack goes to the end: the newest install wins a place
    this.packs.set(name, { pack: { name, v: 1, places }, places: compiled })
    this._active = null
  }

  clear(name) {
    const had = this.packs.delete(name)
    if (had) this._active = null
    return had
  }

  list() {
    return [...this.packs].map(([name, p]) => ({ name, places: Object.keys(p.places) }))
  }

  /** What `step` last did in each place that has a pack ('idle' until a step has run with it). */
  status() {
    const out = {}
    for (const [place, { pack }] of this.active()) out[place] = { pack, state: this.last[place]?.pack === pack ? this.last[place].state : 'idle' }
    return out
  }

  /** [place, { pack, place }] for the newest pack per place, in PLACES order. */
  active() {
    if (this._active) return this._active
    const out = []
    for (const place of PLACES) {
      let found = null
      for (const [name, p] of this.packs) if (p.places[place]) found = { pack: name, place: p.places[place] }
      if (found) out.push([place, found])
    }
    this._active = out
    return out
  }

  /** After EVERY core step. `now` is milliseconds (the renderer: performance.now(); headless: game time). */
  step(core, now) {
    const active = this.active()
    if (!active.length) return
    let hold = null
    if (core.memoryRead(W_IS_IN_BATTLE) !== 0) hold = 'battle'
    else if (core.memoryRead(W_FONT_LOADED) & 1) hold = 'idle'
    if (hold) {
      for (const [place, { pack }] of active) this.last[place] = { pack, state: hold }
      return
    }
    const cycle = core.memoryRead(W_WALK_COUNTER) !== 0 ? 'run' : 'idle'
    let palette = null
    for (const [place, { pack, place: p }] of active) {
      const list = p[cycle]
      const want = list[Math.floor(now / p.ms[cycle]) % list.length]
      const targets =
        place === 'player' ? [RED_STAND, RED_WALK] : core.memoryRead(H_PIKACHU_VRAM_OFFSET) === 0x40 ? [PIKA_STAND, PIKA_WALK, PIKA_WALK_CENTER] : [PIKA_STAND, PIKA_WALK]
      let wrote = false
      for (const at of targets)
        if (!same(core, at, want)) {
          vramWrite(core, at, want, 0)
          wrote = true
        }
      if (p.palette) palette = p.palette // the later place's wins, like its tiles would
      this.last[place] = { pack, state: wrote ? 'painted' : 'kept' }
    }
    if (palette && core.gbcOBJRawPalette) this.keepPalette(core, palette)
  }

  /**
   * The coat FOLLOWS THE GAME'S FADES. Yellow on a CGB still fades the DMG way: it writes rOBP0 / rOBP1
   * ($FF48 / $FF49; home/fade.asm FadePal1–8) and rebuilds each CGB palette as base[(OBPx >> 2i) & 3]
   * (engine/gfx/palettes.asm DMGPalToCGBPal) — palettes 0–3 through OBP0, 4–7 through OBP1. At rest the
   * registers hold $D0 / $E0 (FadePal4), and a pack's colours are what palette RAM holds THEN (the old gag
   * wrote them so): with the register at rest they go in verbatim; mid-fade each colour is the pack's
   * base shade the register selects (`fadeBase`), so the fox darkens and whitens with the screen instead
   * of staying lit on a black one (seen headless at the Pokémon Center door before this). Compared every
   * step, written only when palette RAM differs — which also takes back a map load's own palette.
   */
  keepPalette(core, palette) {
    const reg = core.memory[palette.obj < 4 ? 0xff48 : 0xff49]
    let want = palette.byReg.get(reg)
    if (!want) {
      const cols = reg === palette.rest ? palette.values : [0, 1, 2, 3].map((i) => palette.base[(reg >> (2 * i)) & 3])
      want = new Uint8Array(8)
      cols.forEach((v, c) => {
        want[c * 2] = v & 0xff
        want[c * 2 + 1] = v >> 8
      })
      palette.byReg.set(reg, want)
    }
    const raw = core.gbcOBJRawPalette
    const o = palette.obj * 8
    for (let i = 0; i < 8; i++)
      if (raw[o + i] !== want[i]) {
        paletteSet(core, { obj: [[palette.obj, [0, 1, 2, 3].map((c) => want[c * 2] | (want[c * 2 + 1] << 8))]] })
        return
      }
  }

  toJSON() {
    return { v: 1, packs: [...this.packs.values()].map((p) => p.pack), last: this.last }
  }

  static fromJSON(data) {
    const o = new Overlays()
    for (const pack of data?.packs ?? []) o.set(pack)
    if (data?.last && typeof data.last === 'object') o.last = { ...data.last }
    return o
  }
}

/** A 64-byte 16×16 frame (four tiles row-major) → a place frame (the same view thrice: down, up, left), base64. */
export function placeFrame(frame64) {
  if (frame64.length !== 64) throw new Error(`a 16×16 frame is 64 bytes, not ${frame64.length}`)
  const out = new Uint8Array(FRAME_BYTES)
  for (let k = 0; k < 3; k++) out.set(frame64, k * 64)
  return b64enc(out)
}
