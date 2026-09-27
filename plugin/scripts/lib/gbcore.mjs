// gbcore: THE ONE RUNTIME MODULE both Game Boy ends share — the headless door (door.mjs, serverboy in the
// CLI's process) and the renderer's emulator (src/renderer/src/lib/gameboy.ts). Pure JS: Uint8Array in and
// out, no Buffer, no node:*, no DOM, so a headless preview runs the very bytes the deck runs. Its types are
// gbcore.d.mts beside it (the renderer's only view of this file): keep the two in step by hand.
//
// What it is for: the door ops `vram`, `oam`, `palette` and `patchset` (listed in OPS, reported by `info`
// so the CLI can feature-detect them), built on serverboy's private core the way the research proved:
//  - a VRAM write with STAT forced to mode 0 lands every time (200/200 headless; a plain memoryWrite
//    is dropped whenever a step ended in mode 3), and going through the core's own writer keeps its
//    tile cache right;
//  - a palette written through updateGBC*Palette changes the colours without touching BCPS / OCPS,
//    so the game's own palette pointer is never disturbed;
//  - a state carries the whole ROM image, so patches are NAMED SETS over a PRISTINE copy of the
//    file, re-applied by `reconcile` after every state load, or an old state brings stale bytes back.

export const OPS = Object.freeze(['vram', 'oam', 'palette', 'patchset'])

// ---- base64, by hand -----------------------------------------------------------------------

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const INDEX = new Int16Array(128).fill(-1)
for (let i = 0; i < 64; i++) INDEX[ALPHA.charCodeAt(i)] = i
INDEX[45] = 62 // '-' (url-safe)
INDEX[95] = 63 // '_'

export function b64enc(bytes) {
  let out = ''
  const n = bytes.length
  let i = 0
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += ALPHA[v >> 18] + ALPHA[(v >> 12) & 63] + ALPHA[(v >> 6) & 63] + ALPHA[v & 63]
  }
  if (i < n) {
    const v = (bytes[i] << 16) | (i + 1 < n ? bytes[i + 1] << 8 : 0)
    out += ALPHA[v >> 18] + ALPHA[(v >> 12) & 63] + (i + 1 < n ? ALPHA[(v >> 6) & 63] : '=') + '='
  }
  return out
}

export function b64dec(text) {
  const s = String(text).replace(/[\s=]/g, '')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const v = c < 128 ? INDEX[c] : -1
    if (v < 0) throw new Error(`base64: bad character ${JSON.stringify(s[i])}`)
    acc = ((acc << 6) | v) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return o === out.length ? out : out.subarray(0, o)
}

// ---- VRAM, OAM, palettes ---------------------------------------------------------------------

function vramRange(core, addr, len, bank) {
  if (!Number.isInteger(addr) || !Number.isInteger(len) || len < 0 || addr < 0x8000 || addr + len > 0xa000)
    throw new Error(`vram: $${Number(addr).toString(16)}+${len} is outside $8000–$9FFF`)
  if (bank !== 0 && bank !== 1) throw new Error(`vram: bank ${bank} is not 0 or 1`)
  if (bank === 1 && !core.VRAM) throw new Error('vram: bank 1 exists only in GBC mode')
}

export function vramWrite(core, addr, bytes, bank = 0) {
  vramRange(core, addr, bytes.length, bank)
  const mode = core.modeSTAT
  const was = core.currVRAMBank
  core.modeSTAT = 0
  try {
    if (was !== bank) core.memoryWriter[0xff4f](core, 0xff4f, bank)
    for (let k = 0; k < bytes.length; k++) core.memoryWrite(addr + k, bytes[k])
  } finally {
    if (core.currVRAMBank !== was) core.memoryWriter[0xff4f](core, 0xff4f, was)
    core.modeSTAT = mode
  }
}

// Tile data ($8000–$97FF) is memory[] for bank 0 and VRAM[] for bank 1, but the two TILE MAPS
// ($9800–$9FFF) live in neither: the core keeps them in BGCHRBank1 (the map) and BGCHRBank2 (the GBC
// attributes), $800 bytes each, and memory[$9800..] is never written.
export function vramRead(core, addr, len, bank = 0) {
  vramRange(core, addr, len, bank)
  const out = new Uint8Array(len)
  const map = bank === 0 ? core.BGCHRBank1 : core.BGCHRBank2
  for (let k = 0; k < len; k++) {
    const a = addr + k
    if (a >= 0x9800 && map) out[k] = map[a & 0x7ff]
    else out[k] = bank === 0 ? core.memory[a] : core.VRAM[a & 0x1fff]
  }
  return out
}

export function oamRead(core) {
  return Uint8Array.from(core.memory.subarray(0xfe00, 0xfea0))
}

export function bgr555(colour) {
  if (typeof colour === 'number') {
    if (!Number.isInteger(colour) || colour < 0 || colour > 0x7fff) throw new Error(`palette: ${colour} is not a BGR555 number`)
    return colour
  }
  const m = /^#([0-9a-f]{6})$/i.exec(String(colour))
  if (!m) throw new Error(`palette: ${JSON.stringify(colour)} is not '#rrggbb' or a BGR555 number`)
  const v = parseInt(m[1], 16)
  const r = v >> 16
  const g = (v >> 8) & 0xff
  const b = v & 0xff
  return ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3)
}

/** [[index, 4 colours], …] → [[byte index 0–63, byte], …], validated. */
function paletteBytes(list, what) {
  const out = []
  for (const [index, colours] of list ?? []) {
    if (!Number.isInteger(index) || index < 0 || index > 7) throw new Error(`palette: ${what} index ${index} is not 0–7`)
    if (!Array.isArray(colours) || colours.length !== 4) throw new Error(`palette: ${what} ${index} needs 4 colours`)
    colours.map(bgr555).forEach((v, c) => out.push([index * 8 + c * 2, v & 0xff], [index * 8 + c * 2 + 1, v >> 8]))
  }
  return out
}

export function paletteSet(core, want) {
  // Both lists are checked before either is written, so a bad entry changes nothing.
  const bg = paletteBytes(want?.bg, 'bg')
  const obj = paletteBytes(want?.obj, 'obj')
  for (const [i, d] of bg) core.updateGBCBGPalette(i, d)
  for (const [i, d] of obj) core.updateGBCOBJPalette(i, d)
}

export function paletteRead(core) {
  return { bg: Uint8Array.from(core.gbcBGRawPalette.subarray(0, 64)), obj: Uint8Array.from(core.gbcOBJRawPalette.subarray(0, 64)) }
}

// ---- patch sets ------------------------------------------------------------------------------

const NAME = /^[a-z0-9:_-]{1,40}$/
const MAX_SETS = 64
const MAX_BYTES = 65536

/** Does this ROM offset show in memory[] too? Bank 0 is mirrored there — except the boot ROM's windows while it runs. */
function mirrored(core, i) {
  if (i >= 0x4000) return false
  if (core.inBootstrap && (i < 0x100 || (i >= 0x200 && i < 0x900))) return false
  return true
}

export class PatchSets {
  constructor(pristine) {
    if (!(pristine instanceof Uint8Array)) throw new Error('PatchSets: pristine must be a Uint8Array')
    this.pristine = pristine
    /** name → [[offset, Uint8Array], …]; a Map keeps install order. */
    this.sets = new Map()
  }

  _check(name, writes) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`patchset: bad name ${JSON.stringify(name)} (a–z 0–9 : _ -, 1–40 long)`)
    if (!Array.isArray(writes)) throw new Error('patchset: writes must be a list of [offset, bytes]')
    let total = 0
    const out = []
    for (const w of writes) {
      const [o, b] = w ?? []
      const bytes = b instanceof Uint8Array ? b.slice() : Uint8Array.from(b ?? [])
      if (!Number.isInteger(o) || o < 0 || o + bytes.length > this.pristine.length)
        throw new Error(`patchset ${name}: 0x${Number(o).toString(16)}+${bytes.length} is outside the cartridge`)
      total += bytes.length
      out.push([o, bytes])
    }
    if (total > MAX_BYTES) throw new Error(`patchset ${name}: ${total} bytes is over ${MAX_BYTES}`)
    if (!this.sets.has(name) && this.sets.size >= MAX_SETS) throw new Error(`patchset: ${MAX_SETS} sets at most`)
    return out
  }

  /** Rewrite [offset, len] ranges of the image as pristine + every set that is on, in install order. */
  _restore(core, ranges) {
    const rom = core.ROM
    const end = Math.min(rom.length, this.pristine.length)
    let changed = 0
    for (const [o, n] of ranges) {
      const lo = Math.max(0, o)
      const hi = Math.min(end, o + n)
      if (hi <= lo) continue
      const want = this.pristine.slice(lo, hi)
      for (const writes of this.sets.values())
        for (const [wo, wb] of writes) {
          const a = Math.max(lo, wo)
          const b = Math.min(hi, wo + wb.length)
          for (let i = a; i < b; i++) want[i - lo] = wb[i - wo]
        }
      for (let i = lo; i < hi; i++) {
        const v = want[i - lo]
        let diff = false
        if (rom[i] !== v) {
          rom[i] = v
          diff = true
        }
        if (mirrored(core, i) && core.memory[i] !== v) {
          core.memory[i] = v
          diff = true
        }
        if (diff) changed++
      }
    }
    return changed
  }

  set(core, name, writes) {
    const clean = this._check(name, writes)
    const old = this.sets.get(name) ?? []
    this.sets.delete(name) // a replaced set goes to the end: the newest install wins an overlap
    this.sets.set(name, clean)
    return this._restore(core, [...old, ...clean].map(([o, b]) => [o, b.length]))
  }

  off(core, name) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`patchset: bad name ${JSON.stringify(name)}`)
    const old = this.sets.get(name)
    if (!old) return 0
    this.sets.delete(name)
    return this._restore(core, old.map(([o, b]) => [o, b.length]))
  }

  has(name) {
    return this.sets.has(name)
  }

  list() {
    return [...this.sets].map(([name, writes]) => ({ name, bytes: writes.reduce((n, [, b]) => n + b.length, 0) }))
  }

  reconcile(core) {
    return this._restore(core, [[0, this.pristine.length]])
  }

  toJSON() {
    return { sets: [...this.sets].map(([name, writes]) => ({ name, writes: writes.map(([o, b]) => [o, b64enc(b)]) })) }
  }

  static fromJSON(pristine, data) {
    const ps = new PatchSets(pristine)
    for (const s of data?.sets ?? []) ps.sets.set(s.name, ps._check(s.name, (s.writes ?? []).map(([o, b]) => [o, b64dec(b)])))
    return ps
  }
}
