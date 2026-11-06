// THE PS1: a PlayStation in the deck — RetroArch's pcsx_rearmed core compiled to wasm, driven through
// Nostalgist (MIT), as a module singleton the way lib/gameboy.ts is the Game Boy.
//
// - ONE CANVAS, moved between views: the core draws into a single WebGL canvas, so the tile and the pane
//   do not each get a copy (the Game Boy blits to every canvas; a PS1 frame is too big to). `attach(host)`
//   puts the canvas in the newest view; the one before gets it back when that view goes. With no view it
//   waits in a parked box off-screen (Nostalgist appends an unconnected canvas to <body> otherwise).
// - Everything comes over `psx:` (main/ps1.ts): the core, the BIOS, the disc's .cue and .bin. The disc
//   sits in the core's in-memory file system (a JS buffer, ~500 MB for a full CD), not in its wasm heap.
// - KEYS are pressed with Nostalgist's pressDown/pressUp (synthetic events straight to the core); the
//   canvas is never focused, so the real keyboard never reaches RetroArch's own hotkeys (Esc would quit it).
// - SOUND: the tile is silent, the pane plays (the Game Boy's rule). Not with RetroArch's MUTE command: it
//   mutes, but a second MUTE never brings the sound back. The core runs unmuted into a GAIN NODE of the
//   deck's own instead — its WebAudio driver makes its AudioContext during launch, and for that moment
//   `window.AudioContext` is a subclass whose `destination` is the gain (see `withGain`).
// - SAVES: the memory card (RetroArch's .srm) every 30 s, on a disc swap and on pagehide; three state
//   slots and named checkpoints, all in userData/ps1/saves/<disc>.
// - THE DOOR (`POST /ps1`, plugin/scripts/ps1.mjs): read / write / find in the PS1's 2 MB of RAM, a value
//   scanner, freezes, buttons, states, screenshots. The core exports no pointer to its RAM, so it is FOUND:
//   main reads a few 64-byte runs of the boot executable's code off the disc (`ps1Info`), and where they sit
//   in the wasm heap, less their RAM address, is RAM's base.

import { useEffect, useState } from 'react'
import type { Nostalgist } from 'nostalgist'
import type { Ps1Disc, Ps1DiscInfo } from '@shared/types'

export type Ps1Button = 'up' | 'down' | 'left' | 'right' | 'cross' | 'circle' | 'square' | 'triangle' | 'l1' | 'r1' | 'l2' | 'r2' | 'start' | 'select'
export const PS1_BUTTONS: Ps1Button[] = ['up', 'down', 'left', 'right', 'cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'l2', 'r2', 'start', 'select']
/** PlayStation button → the RetroPad button pcsx_rearmed maps it to (B = cross, A = circle, Y = square, X = triangle). */
const RETROPAD: Record<Ps1Button, string> = { up: 'up', down: 'down', left: 'left', right: 'right', cross: 'b', circle: 'a', square: 'y', triangle: 'x', l1: 'l', r1: 'r', l2: 'l2', r2: 'r2', start: 'start', select: 'select' }
/** The keyboard RetroArch is told each RetroPad button is on — only so pressDown can name a key; real keys never reach it. */
const RA_KEYS: Record<string, string> = { up: 'up', down: 'down', left: 'left', right: 'right', b: 'z', a: 'x', y: 'a', x: 's', l: 'q', r: 'w', l2: 'e', r2: 'r', start: 'enter', select: 'rshift' }

export const STATE_SLOTS = [0, 1, 2] as const
const RAM_SIZE = 0x200000
const LAST_DISC = 'deck.ps1.disc'
const CARD_EVERY_MS = 30_000

export interface Ps1Status {
  disc: Ps1Disc | null
  info: Ps1DiscInfo | null
  loading: string | null
  error: string | null
  note: string | null
  running: boolean
  paused: boolean
  muted: boolean
  /** The pane is open (sound plays only there). */
  audible: boolean
  /** Where the canvas is: 'tile', 'pane' or null (parked). */
  view: string | null
}

interface Freeze {
  size: 1 | 2 | 4
  value: number
}

interface Scan {
  size: 1 | 2 | 4
  addrs: Uint32Array
  prev: Uint32Array
}

const hex = (n: number, w = 8) => '0x' + (n >>> 0).toString(16).padStart(w, '0')
/** A PS1 address in any of its spellings (0x800A1234, 800a1234, a KSEG1 0xA0…, a physical 0x0A1234) → its physical offset. */
function phys(a: unknown): number {
  const n = typeof a === 'number' ? a : typeof a === 'string' && /^(0x)?[0-9a-f]{1,8}$/i.test(a.trim()) ? parseInt(a.trim().replace(/^0x/i, ''), 16) : NaN
  if (!Number.isFinite(n)) throw new Error(`not an address: ${String(a)}`)
  return n & 0x1fffff
}
const kseg0 = (p: number) => hex(0x80000000 + p)
function bytesOf(h: unknown): Uint8Array {
  const s = String(h ?? '').replace(/\s+/g, '').replace(/^0x/i, '')
  if (!s || s.length % 2 || !/^[0-9a-f]+$/i.test(s)) throw new Error('hex wants an even number of hex digits, e.g. "1f00a0ff"')
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)))
}
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class Ps1Machine {
  private status: Ps1Status = { disc: null, info: null, loading: null, error: null, note: null, running: false, paused: false, muted: false, audible: false, view: null }
  private readonly listeners = new Set<(s: Ps1Status) => void>()
  readonly canvas: HTMLCanvasElement
  private readonly park: HTMLDivElement
  private hosts: { el: HTMLElement; name: string }[] = []
  private resizer: ResizeObserver | null = null
  private nost: Nostalgist | null = null
  /** The volume between the core and the speakers (0 or 1), made with the core's AudioContext. */
  private gain: GainNode | null = null
  private ramBase: number | null = null
  private scan: Scan | null = null
  private readonly freezes = new Map<number, Freeze>()
  private readonly held = new Set<Ps1Button>()
  private noteTimer: number | undefined
  private loadJob: Promise<void> | null = null
  private autoloaded = false

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'ps1-canvas'
    this.canvas.tabIndex = -1
    this.park = document.createElement('div')
    this.park.className = 'ps1-park'
    this.park.appendChild(this.canvas)
    document.body.appendChild(this.park)
    window.setInterval(() => void this.saveCard(), CARD_EVERY_MS)
    // ⌘R reloads the renderer: the game restarts from its memory card, so write it now.
    window.addEventListener('pagehide', () => void this.saveCard())
    window.addEventListener('blur', () => this.releaseAll())
    const tick = () => {
      this.applyFreezes()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // ---- views ---------------------------------------------------------------------

  get state(): Ps1Status {
    return this.status
  }

  subscribe(cb: (s: Ps1Status) => void): () => void {
    this.listeners.add(cb)
    cb(this.status)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private set(patch: Partial<Ps1Status>): void {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l(this.status)
  }

  private flash(note: string): void {
    this.set({ note })
    window.clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => this.set({ note: null }), 2500)
  }

  /** Show the screen in `host` until the returned function is called (the newest view wins; the one before gets it back). */
  attach(host: HTMLElement, name: string): () => void {
    const entry = { el: host, name }
    this.hosts.push(entry)
    this.mount()
    return () => {
      this.hosts = this.hosts.filter((h) => h !== entry)
      this.mount()
    }
  }

  private mount(): void {
    const top = this.hosts[this.hosts.length - 1] ?? null
    const into = top?.el ?? this.park
    if (this.canvas.parentElement !== into) into.appendChild(this.canvas)
    this.resizer?.disconnect()
    this.resizer = new ResizeObserver(() => this.fit())
    this.resizer.observe(into)
    this.fit()
    this.set({ view: top?.name ?? null })
  }

  private size(): { width: number; height: number } {
    const box = this.canvas.parentElement
    const w = box?.clientWidth || 640
    const h = box?.clientHeight || 480
    const dpr = window.devicePixelRatio || 1
    return { width: Math.max(64, Math.round(w * dpr)), height: Math.max(48, Math.round(h * dpr)) }
  }

  private fit(): void {
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    if (this.nost && this.status.running) {
      try {
        this.nost.resize(this.size())
      } catch {
        /* the core is between frames of a swap */
      }
    }
  }

  // ---- the disc --------------------------------------------------------------------

  /** Bring back the last disc (once per renderer), if it is still in the disc folder. */
  autoload(): void {
    if (this.autoloaded || this.status.disc || this.loadJob) return
    this.autoloaded = true
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_DISC)
    } catch {}
    if (!last) return
    void window.deck.ps1ListDiscs().then((discs) => {
      const d = discs.find((x) => x.path === last)
      if (d && !this.status.disc && !this.loadJob) void this.load(d)
    })
  }

  load(disc: Ps1Disc): Promise<void> {
    const job = (async () => {
      await this.eject()
      this.set({ loading: `loading ${disc.name}…`, error: null })
      try {
        const bios = await window.deck.ps1Bios()
        if (!bios) throw new Error('no PS1 BIOS: put a 512 KB scph*.bin in the BIOS folder (Keys & services on the launcher)')
        const [{ Nostalgist }, card, info] = await Promise.all([import('nostalgist'), window.deck.ps1LoadCard(disc.name), window.deck.ps1Info(disc.path)])
        this.set({ loading: `booting ${disc.name}…` })
        const { result: nost, gain } = await withGain(() => Nostalgist.launch({
          element: this.canvas,
          size: this.size(),
          core: { name: 'pcsx_rearmed', js: 'psx://core/pcsx_rearmed_libretro.js', wasm: 'psx://core/pcsx_rearmed_libretro.wasm' },
          rom: disc.files.map((f) => ({ fileName: f.name, fileContent: f.url })),
          bios: [{ fileName: bios.as, fileContent: bios.url }],
          ...(card ? { sram: new Blob([card as BlobPart]) } : {}),
          respondToGlobalEvents: false,
          retroarchConfig: {
            ...Object.fromEntries(Object.entries(RA_KEYS).map(([b, k]) => [`input_player1_${b}`, k])),
            input_exit_emulator: 'nul',
            input_menu_toggle: 'nul',
            audio_mute_enable: false,
            savestate_auto_load: false,
            savestate_thumbnail_enable: false,
            video_smooth: true
          } as never,
          retroarchCoreConfig: { pcsx_rearmed_bios: 'auto' }
        }), this.wantGain())
        this.nost = nost
        this.gain = gain
        this.ramBase = null
        this.scan = null
        this.freezes.clear()
        // Nostalgist focuses the canvas so the core hears the keyboard; the deck presses buttons itself.
        this.canvas.blur()
        try {
          localStorage.setItem(LAST_DISC, disc.path)
        } catch {}
        this.set({ disc, info, loading: null, running: true, paused: false })
        this.fit()
        this.syncSound()
      } catch (err) {
        this.nost = null
        this.set({ loading: null, running: false, error: err instanceof Error ? err.message : String(err) })
        throw err
      }
    })().finally(() => {
      this.loadJob = null
    })
    this.loadJob = job
    return job
  }

  /** Stop the machine (the memory card written first). The canvas stays, empty. */
  async eject(): Promise<void> {
    if (!this.nost) return
    await this.saveCard()
    try {
      this.nost.exit({ removeCanvas: false })
    } catch {
      /* already gone */
    }
    this.nost = null
    this.gain = null
    this.ramBase = null
    this.scan = null
    this.freezes.clear()
    this.set({ running: false, paused: false, disc: null, info: null })
  }

  // ---- play ------------------------------------------------------------------------

  press(b: Ps1Button): void {
    if (!this.nost || this.held.has(b)) return
    this.held.add(b)
    this.nost.pressDown(RETROPAD[b])
  }
  release(b: Ps1Button): void {
    if (!this.nost || !this.held.delete(b)) return
    this.nost.pressUp(RETROPAD[b])
  }
  releaseAll(): void {
    for (const b of [...this.held]) this.release(b)
  }

  setPaused(paused: boolean): void {
    if (!this.nost || paused === this.status.paused) return
    if (paused) this.nost.pause()
    else this.nost.resume()
    this.set({ paused })
  }

  reset(): void {
    if (!this.nost) return
    this.nost.restart()
    this.ramBase = null
    this.flash('reset')
  }

  setAudible(audible: boolean): void {
    this.set({ audible })
    this.syncSound()
  }
  setMuted(muted: boolean): void {
    this.set({ muted })
    this.syncSound()
  }
  private wantGain(): number {
    return this.status.muted || !this.status.audible ? 0 : 1
  }
  private syncSound(): void {
    const g = this.gain
    if (!g) return
    // A short ramp, so muting does not click.
    g.gain.setTargetAtTime(this.wantGain(), g.context.currentTime, 0.02)
    // A context made before any click may start suspended; the pane opening is a click.
    if (this.wantGain() > 0 && g.context.state === 'suspended') void (g.context as AudioContext).resume().catch(() => {})
  }

  // ---- saves -----------------------------------------------------------------------

  async saveCard(): Promise<void> {
    const nost = this.nost
    const disc = this.status.disc
    if (!nost || !disc) return
    try {
      const blob = await nost.saveSRAM()
      await window.deck.ps1SaveCard(disc.name, new Uint8Array(await blob.arrayBuffer()))
    } catch {
      /* no card yet (the game has not formatted one) */
    }
  }

  async saveState(slot: number | string): Promise<void> {
    if (!this.nost || !this.status.disc) throw new Error('no disc running')
    const { state } = await this.nost.saveState()
    await window.deck.ps1SaveState(this.status.disc.name, slot, new Uint8Array(await state.arrayBuffer()))
    this.flash(typeof slot === 'number' ? `saved to slot ${slot + 1}` : `saved “${slot}”`)
  }

  async loadState(slot: number | string): Promise<void> {
    if (!this.nost || !this.status.disc) throw new Error('no disc running')
    const data = await window.deck.ps1LoadState(this.status.disc.name, slot)
    if (!data) {
      this.flash(typeof slot === 'number' ? `slot ${slot + 1} is empty` : `no state “${slot}”`)
      throw new Error(typeof slot === 'number' ? `slot ${slot + 1} is empty` : `no state named “${slot}”`)
    }
    await this.nost.loadState(new Blob([data as BlobPart]))
    this.flash(typeof slot === 'number' ? `loaded slot ${slot + 1}` : `loaded “${slot}”`)
  }

  // ---- RAM -------------------------------------------------------------------------

  private heap(): Uint8Array {
    if (!this.nost) throw new Error('no disc running: open the PS1 pane and pick one (or `disc <name>`)')
    return this.nost.getEmscripten().Module.HEAPU8 as Uint8Array
  }

  /** The PS1's 2 MB of RAM as a live view of the core's heap (found once, re-found if it stops matching). */
  ram(): Uint8Array {
    const heap = this.heap()
    const info = this.status.info
    if (!info?.samples.length) throw new Error('this disc image cannot be read for its boot code (only .cue/.bin and .iso can): no RAM access')
    const matches = (base: number) =>
      info.samples.some((s) => {
        const pat = bytesOf(s.hex)
        const at = base + s.addr
        if (at < 0 || at + pat.length > heap.length) return false
        for (let j = 0; j < pat.length; j++) if (heap[at + j] !== pat[j]) return false
        return true
      })
    if (this.ramBase === null || !matches(this.ramBase)) this.ramBase = this.findRam(heap, info)
    if (this.ramBase === null) throw new Error('the PS1 RAM was not found yet: let the game get past the BIOS logo, then ask again')
    return heap.subarray(this.ramBase, this.ramBase + RAM_SIZE)
  }

  private findRam(heap: Uint8Array, info: Ps1DiscInfo): number | null {
    const words = new Uint32Array(heap.buffer, heap.byteOffset, heap.byteLength >>> 2)
    for (const s of info.samples) {
      const pat = bytesOf(s.hex)
      const pw = new Uint32Array(pat.buffer, 0, pat.length >>> 2)
      for (let i = 0; i + pw.length <= words.length; i++) {
        if (words[i] !== pw[0]) continue
        let k = 1
        while (k < pw.length && words[i + k] === pw[k]) k++
        if (k < pw.length) continue
        const base = i * 4 - s.addr
        if (base >= 0 && base + RAM_SIZE <= heap.length) return base
      }
    }
    return null
  }

  private peek(ram: Uint8Array, p: number, size: 1 | 2 | 4): number {
    return size === 1 ? ram[p] : size === 2 ? ram[p] | (ram[p + 1] << 8) : (ram[p] | (ram[p + 1] << 8) | (ram[p + 2] << 16) | (ram[p + 3] << 24)) >>> 0
  }
  private poke(ram: Uint8Array, p: number, size: 1 | 2 | 4, v: number): void {
    for (let i = 0; i < size; i++) ram[p + i] = (v >>> (8 * i)) & 0xff
  }

  private applyFreezes(): void {
    if (!this.freezes.size || !this.nost) return
    try {
      const ram = this.ram()
      for (const [p, f] of this.freezes) this.poke(ram, p, f.size, f.value)
    } catch {
      /* not found yet: the next frame tries again */
    }
  }

  // ---- the door --------------------------------------------------------------------

  async drive(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const op = String(body.op ?? 'status')
    const size = (v: unknown): 1 | 2 | 4 => {
      const n = Number(v ?? 1)
      if (n !== 1 && n !== 2 && n !== 4) throw new Error('size is 1, 2 or 4 bytes')
      return n
    }
    switch (op) {
      case 'status': {
        const s = this.status
        let ram: string | null = null
        try {
          if (this.nost) {
            this.ram()
            ram = hex(this.ramBase!)
          }
        } catch {}
        return {
          disc: s.disc?.name ?? null,
          serial: s.info?.serial ?? null,
          running: s.running,
          paused: s.paused,
          loading: s.loading,
          error: s.error,
          view: s.view,
          ramFound: ram !== null,
          freezes: [...this.freezes].map(([p, f]) => ({ addr: kseg0(p), size: f.size, value: f.value })),
          scan: this.scan ? { size: this.scan.size, count: this.scan.addrs.length } : null
        }
      }
      case 'discs':
        return { discs: (await window.deck.ps1ListDiscs()).map((d) => ({ name: d.name, path: d.path })) }
      case 'disc': {
        const want = String(body.name ?? body.path ?? '').toLowerCase()
        const discs = await window.deck.ps1ListDiscs()
        const d = discs.find((x) => x.path.toLowerCase() === want) ?? discs.find((x) => x.name.toLowerCase() === want) ?? discs.find((x) => x.name.toLowerCase().includes(want))
        if (!want || !d) throw new Error(`no disc “${want}”; there are: ${discs.map((x) => x.name).join(', ') || 'none (check the disc folder)'}`)
        await this.load(d)
        return { disc: d.name }
      }
      case 'read': {
        const ram = this.ram()
        const p = phys(body.addr)
        const len = Math.max(1, Math.min(0x10000, Number(body.len ?? 64) | 0))
        if (p + len > RAM_SIZE) throw new Error('that runs past the end of RAM (2 MB)')
        return { addr: kseg0(p), hex: toHex(ram.slice(p, p + len)) }
      }
      case 'write': {
        const ram = this.ram()
        const p = phys(body.addr)
        const b = body.hex !== undefined ? bytesOf(body.hex) : null
        if (b) {
          if (p + b.length > RAM_SIZE) throw new Error('that runs past the end of RAM (2 MB)')
          ram.set(b, p)
          return { addr: kseg0(p), wrote: b.length }
        }
        const sz = size(body.size)
        const v = Number(body.value)
        if (!Number.isFinite(v)) throw new Error('write wants hex, or a value (with size 1, 2 or 4)')
        this.poke(ram, p, sz, v >>> 0)
        return { addr: kseg0(p), size: sz, value: this.peek(ram, p, sz) }
      }
      case 'find': {
        const ram = this.ram()
        const pat = bytesOf(body.hex)
        const out: string[] = []
        for (let i = 0; i + pat.length <= RAM_SIZE && out.length < 200; i++) {
          let k = 0
          while (k < pat.length && ram[i + k] === pat[k]) k++
          if (k === pat.length) out.push(kseg0(i))
        }
        return { count: out.length, addrs: out, capped: out.length === 200 }
      }
      case 'scan':
        return this.scanOp(String(body.mode ?? 'list'), body)
      case 'freeze': {
        const p = phys(body.addr)
        const sz = size(body.size)
        const v = body.value !== undefined ? Number(body.value) >>> 0 : this.peek(this.ram(), p, sz)
        this.freezes.set(p, { size: sz, value: v })
        return { addr: kseg0(p), size: sz, value: v, freezes: this.freezes.size }
      }
      case 'unfreeze': {
        if (body.addr === undefined || body.addr === 'all') this.freezes.clear()
        else this.freezes.delete(phys(body.addr))
        return { freezes: this.freezes.size }
      }
      case 'press':
      case 'hold': {
        if (!this.nost) throw new Error('no disc running')
        const buttons = (Array.isArray(body.buttons) ? body.buttons : [body.button]).map((b) => String(b).toLowerCase()) as Ps1Button[]
        for (const b of buttons) if (!PS1_BUTTONS.includes(b)) throw new Error(`no button “${b}”: ${PS1_BUTTONS.join(', ')}`)
        const ms = Math.max(30, Math.min(600_000, Number(body.ms ?? 120)))
        for (const b of buttons) this.press(b)
        await sleep(ms)
        for (const b of buttons) this.release(b)
        return { pressed: buttons, ms }
      }
      case 'wait': {
        const ms = Math.max(0, Math.min(600_000, Number(body.ms ?? 1000)))
        await sleep(ms)
        return { waited: ms }
      }
      case 'state': {
        const slot = body.name !== undefined ? String(body.name) : Number(body.slot ?? 0)
        if (body.action === 'load') await this.loadState(slot)
        else if (body.action === 'save') await this.saveState(slot)
        else return { states: this.status.disc ? await window.deck.ps1States(this.status.disc.name) : [] }
        return { [String(body.action)]: slot }
      }
      case 'shot': {
        if (!this.nost) throw new Error('no disc running')
        const blob = await this.nost.screenshot()
        return { path: await window.deck.ps1Shot(new Uint8Array(await blob.arrayBuffer())) }
      }
      case 'pause':
        this.setPaused(true)
        return { paused: true }
      case 'resume':
        this.setPaused(false)
        return { paused: false }
      case 'reset':
        this.reset()
        return { reset: true }
      default:
        throw new Error(`unknown op “${op}”`)
    }
  }

  /**
   * THE SCANNER, DuckStation's memory scanner over the door: `start` takes every aligned value of a size
   * (or only those equal to `value`); each next mode keeps the candidates that pass, against the value or
   * against what they were at the previous step; `list` shows them.
   */
  private scanOp(mode: string, body: Record<string, unknown>): Record<string, unknown> {
    const ram = this.ram()
    const value = body.value !== undefined ? Number(body.value) >>> 0 : null
    if (mode === 'start') {
      const sz = Number(body.size ?? 1)
      if (sz !== 1 && sz !== 2 && sz !== 4) throw new Error('size is 1, 2 or 4 bytes')
      const n = RAM_SIZE / sz
      const addrs: number[] = []
      for (let i = 0; i < n; i++) if (value === null || this.peek(ram, i * sz, sz as 1 | 2 | 4) === value) addrs.push(i * sz)
      const a = Uint32Array.from(addrs)
      this.scan = { size: sz as 1 | 2 | 4, addrs: a, prev: a.map((p) => this.peek(ram, p, sz as 1 | 2 | 4)) }
      return this.scanReport()
    }
    if (!this.scan) throw new Error('no scan yet: `scan start` first')
    if (mode === 'list') return this.scanReport(Number(body.limit ?? 40))
    const { size, addrs, prev } = this.scan
    const test: Record<string, (now: number, was: number) => boolean> = {
      eq: (now) => now === value,
      ne: (now) => now !== value,
      gt: (now) => now > value!,
      lt: (now) => now < value!,
      inc: (now, was) => now > was,
      dec: (now, was) => now < was,
      changed: (now, was) => now !== was,
      unchanged: (now, was) => now === was
    }
    const t = test[mode]
    if (!t) throw new Error(`no scan mode “${mode}”: start, eq, ne, gt, lt, inc, dec, changed, unchanged, list`)
    if (['eq', 'ne', 'gt', 'lt'].includes(mode) && value === null) throw new Error(`scan ${mode} wants a value`)
    const keepA: number[] = []
    const keepV: number[] = []
    for (let i = 0; i < addrs.length; i++) {
      const now = this.peek(ram, addrs[i], size)
      if (t(now, prev[i])) {
        keepA.push(addrs[i])
        keepV.push(now)
      }
    }
    this.scan = { size, addrs: Uint32Array.from(keepA), prev: Uint32Array.from(keepV) }
    return this.scanReport()
  }

  private scanReport(limit = 40): Record<string, unknown> {
    const s = this.scan!
    const n = Math.min(s.addrs.length, Math.max(1, Math.min(500, limit)))
    const ram = this.ram()
    return {
      size: s.size,
      count: s.addrs.length,
      shown: Array.from({ length: n }, (_, i) => ({ addr: kseg0(s.addrs[i]), value: this.peek(ram, s.addrs[i], s.size) }))
    }
  }
}

/**
 * Run `launch` with `window.AudioContext` swapped for a subclass whose `destination` is a gain node in
 * front of the real one, and hand back that gain: whatever the core connects to "the speakers" goes
 * through it. Swapped only for the launch, so no other AudioContext in the deck (the barks, the Game Boy)
 * is touched.
 */
async function withGain<T>(launch: () => Promise<T>, level: number): Promise<{ result: T; gain: GainNode | null }> {
  const Real = window.AudioContext
  let gain: GainNode | null = null
  class Routed extends Real {
    private readonly out: GainNode
    constructor(options?: AudioContextOptions) {
      super(options)
      this.out = super.createGain()
      this.out.gain.value = level
      this.out.connect(super.destination)
      gain = this.out
    }
    override get destination(): AudioDestinationNode {
      return this.out as unknown as AudioDestinationNode
    }
  }
  window.AudioContext = Routed
  try {
    return { result: await launch(), gain }
  } finally {
    window.AudioContext = Real
  }
}

let machine: Ps1Machine | null = null

/** The one PS1. Made on first use, so a deck without the tile never loads the emulator. */
export function ps1(): Ps1Machine {
  if (!machine) {
    machine = new Ps1Machine()
    window.deck.onPs1(({ id, body }) => {
      machine!.drive(body).then(
        (r) => window.deck.ps1Reply(id, { ok: true, ...r }),
        (e: unknown) => window.deck.ps1Reply(id, { ok: false, error: e instanceof Error ? e.message : String(e) })
      )
    })
  }
  return machine
}

/** App calls this at boot when the tile is on, so the door answers before a tile mounts. */
export function installPs1(): void {
  ps1().autoload()
}

/** The tile was turned off: stop the machine (the card written first). */
export function shutdownPs1(): void {
  if (machine) void machine.eject()
}

export function usePs1(): Ps1Status {
  const [s, setS] = useState<Ps1Status>(() => ps1().state)
  useEffect(() => ps1().subscribe(setS), [])
  return s
}

export function usePs1Discs(): Ps1Disc[] {
  const [discs, setDiscs] = useState<Ps1Disc[]>([])
  useEffect(() => {
    let alive = true
    void window.deck
      .ps1ListDiscs()
      .then((d) => alive && setDiscs(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return discs
}
