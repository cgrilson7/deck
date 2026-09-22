// The door: how the trainer's CLI reaches a Game Boy. Two implementations of one small protocol —
// the DECK (POST /gameboy on the hooks server: main relays it to the renderer's emulator, so
// the game you drive is the one on the Pokemon tile) and HEADLESS (serverboy in this process,
// for tests and for running without the app). Every op is a plain object in, a plain object out:
//   info                                      → { rom, name, speed, paused }
//   ram   { ranges: [[addr, len], …] }        → { data: [base64, …] }
//   poke  { writes: [[addr, base64], …] }      → write bytes (the party forge, the warp table)
//   patch { writes: [[offset, base64], …] }    → { changed }   bytes into the LOADED ROM image, by file offset
//         (the sprite gag's text); the file is never written, and a state load brings the original back
//   hold  { keys, iterations, stop, every }   → { iterations, stopped, values }
//         keys are held for up to `iterations` (8ms core steps); every `every` steps each
//         `stop` — { addr, len, when: 'changed' | 'eq' | 'ne', value } — is tested, and the
//         first that fires ends the hold ('changed' compares with the bytes read at the start).
//   settle { max, stable }                    → { iterations, settled }   run keyless until the
//         screen has not changed for `stable` steps, or `max` steps have gone by
//   screen { scale }                          → { path }   a PNG on disk, upscaled, pixelated
//   save { name } / load { name }             → { path } / { ok }   named save states
//   speed { speed } / pause { on }            → deck only
//   rom { path }                              → load a cartridge

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const KEYS = ['RIGHT', 'LEFT', 'UP', 'DOWN', 'A', 'B', 'SELECT', 'START']

// ---- PNG, the few lines of it we need --------------------------------------------------

let crcTable
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** RGBA pixels → PNG bytes, each source pixel `scale`× wide and tall. */
export function encodePng(rgba, w, h, scale = 1) {
  const W = w * scale
  const H = h * scale
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / scale)
    let o = y * (W * 3 + 1)
    raw[o++] = 0
    for (let x = 0; x < W; x++) {
      const si = (sy * w + Math.floor(x / scale)) * 4
      raw[o++] = rgba[si]
      raw[o++] = rgba[si + 1]
      raw[o++] = rgba[si + 2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- the deck --------------------------------------------------------------------------

export class DeckDoor {
  constructor(port) {
    this.port = port
  }
  async call(body) {
    let res
    try {
      res = await fetch(`http://127.0.0.1:${this.port}/gameboy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    } catch (err) {
      throw new Error(`no deck answering on port ${this.port} (${err.message}). Is this session running inside the deck, with the Pokemon tile on?`)
    }
    const out = await res.json().catch(() => ({ ok: false, error: `bad reply (${res.status})` }))
    if (!out.ok) throw new Error(out.error ?? 'the deck refused')
    return out
  }
}

// ---- headless --------------------------------------------------------------------------

function toRomString(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
  return s
}

/**
 * serverboy in this process. `dir` is where screenshots and save states go. The core's
 * `doFrame()` is one 8ms iteration; a video frame is two. serverboy releases every key at the
 * end of each iteration, so a held key is pressed again before every step.
 */
export class HeadlessDoor {
  constructor(dir, opts = {}) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    this.sb = null
    this.core = null
    this.rom = null
    this.shots = 0
    // serverboy is a dependency of the deck, not of the plugin: find it from the repo root, or where told.
    const require = createRequire(opts.modulesFrom ?? new URL('../../../package.json', import.meta.url))
    if (!globalThis.process.hrtime) globalThis.process.hrtime = () => [0, 0]
    this.Serverboy = require('serverboy')
  }

  loadRom(path, sram) {
    const bytes = readFileSync(path)
    const sb = new this.Serverboy()
    sb.loadRom(toRomString(bytes), sram ? Array.from(sram) : undefined)
    const priv = Object.keys(sb).find((k) => k.startsWith('_'))
    this.core = sb[priv].gameboy
    this.core.graphicsBlit = () => {}
    this.sb = sb
    this.rom = path
  }

  step(keys) {
    for (const k of keys) this.sb.pressKey(k)
    this.sb.doFrame()
  }

  /** Through the core's own reader: Yellow runs in GBC mode and D000–DFFF is a banked region, not the flat `memory` array. */
  read(addr, len) {
    const c = this.core
    const out = new Uint8Array(len)
    for (let i = 0; i < len; i++) out[i] = c.memoryRead(addr + i)
    return out
  }

  async call(body) {
    const op = body.op
    if (op === 'info') return { ok: true, rom: this.rom, name: this.rom ? this.rom.slice(this.rom.lastIndexOf('/') + 1) : null, speed: 0, paused: false }
    if (!this.core && op !== 'rom') throw new Error('no ROM loaded')
    switch (op) {
      case 'rom':
        this.loadRom(body.path)
        return { ok: true }
      case 'ram':
        return { ok: true, data: body.ranges.map(([a, n]) => Buffer.from(this.read(a, n)).toString('base64')) }
      case 'poke':
        for (const [a, b64] of body.writes) {
          const bytes = Buffer.from(b64, 'base64')
          for (let i = 0; i < bytes.length; i++) this.core.memoryWrite(a + i, bytes[i])
        }
        return { ok: true }
      case 'patch': {
        let changed = 0
        for (const [o, b64] of body.writes) {
          const bytes = Buffer.from(b64, 'base64')
          for (let i = 0; i < bytes.length; i++) {
            if (o + i < 0 || o + i >= this.core.ROM.length) throw new Error(`patch: 0x${(o + i).toString(16)} is outside the cartridge`)
            if (this.core.ROM[o + i] !== bytes[i]) changed++
            this.core.ROM[o + i] = bytes[i]
            if (o + i < 0x4000) this.core.memory[o + i] = bytes[i]
          }
        }
        return { ok: true, changed }
      }
      case 'hold':
        return { ok: true, ...this.hold(body) }
      case 'settle':
        return { ok: true, ...this.settle(body) }
      case 'screen': {
        const png = encodePng(this.core.canvasBuffer.data, 160, 144, body.scale ?? 3)
        const path = join(this.dir, `screen-${(this.shots++ % 4) + 1}.png`)
        writeFileSync(path, png)
        return { ok: true, path }
      }
      case 'save': {
        const path = join(this.dir, `${sanitize(body.name)}.state`)
        writeFileSync(path, JSON.stringify(this.core.saveState()))
        return { ok: true, path }
      }
      case 'load': {
        const path = join(this.dir, `${sanitize(body.name)}.state`)
        if (!existsSync(path)) throw new Error(`no save state named ${body.name}`)
        this.core.saving(JSON.parse(readFileSync(path, 'utf8')))
        return { ok: true }
      }
      case 'speed':
      case 'pause':
        return { ok: true }
      default:
        throw new Error(`unknown op ${op}`)
    }
  }

  hold({ keys = [], iterations = 1, stop = [], every = 2 }) {
    keys = keys.filter((k) => KEYS.includes(k))
    const base = stop.map((s) => (s.when === 'changed' ? Buffer.from(this.read(s.addr, s.len ?? 1)) : null))
    let n = 0
    let stopped = null
    while (n < iterations) {
      this.step(keys)
      n++
      if (n % every === 0 && stop.length) {
        for (let i = 0; i < stop.length; i++) {
          const s = stop[i]
          const cur = Buffer.from(this.read(s.addr, s.len ?? 1))
          const hit = s.when === 'changed' ? !cur.equals(base[i]) : s.when === 'eq' ? cur[0] === s.value : cur[0] !== s.value
          if (hit) {
            stopped = i
            break
          }
        }
        if (stopped != null) break
      }
    }
    return { iterations: n, stopped, values: stop.map((s) => Array.from(this.read(s.addr, s.len ?? 1))) }
  }

  settle({ max = 240, stable = 24 }) {
    let last = Buffer.from(this.core.canvasBuffer.data)
    let quiet = 0
    let n = 0
    while (n < max) {
      this.step([])
      n++
      const cur = Buffer.from(this.core.canvasBuffer.data.buffer, this.core.canvasBuffer.data.byteOffset, this.core.canvasBuffer.data.byteLength)
      if (Buffer.compare(last, cur) === 0) quiet++
      else {
        quiet = 0
        last = Buffer.from(cur)
      }
      if (quiet >= stable) return { iterations: n, settled: true }
    }
    return { iterations: n, settled: false }
  }
}

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)
