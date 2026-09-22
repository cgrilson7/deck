// The Game Boy, once, for the whole window: serverboy (pure JS, no DOM) stepped from a
// requestAnimationFrame loop, its screen copied into every canvas that asked to show it (the
// Pokemon tile, the Pokemon pane), its sound handed to WebAudio while the pane is open, its
// battery RAM written to userData/pokemon over IPC. The tile and the pane are both VIEWS of
// this one machine: opening the pane does not restart the game, closing it does not stop it,
// and with no view mounted at all (the tile turned off, the pane closed) the loop stops and
// the game waits, saved.
//
// serverboy's `doFrame()` is ONE ITERATION of the core, 8ms of Game Boy time (settings[6]),
// not a video frame: real time is 125 of them a second, and the audio comes out at 353 stereo
// pairs per iteration = 44150 Hz, which is what the AudioContext is opened at so nothing is
// resampled. Keys are pressed per iteration (the core releases them at the end of each), so a
// held key is re-pressed every step from `held`.

import { useEffect, useState } from 'react'
import { readSavedRom, writeSavedRom } from './pokemon'

export const GB_W = 160
export const GB_H = 144
/** Game Boy milliseconds one `doFrame()` advances (serverboy's settings[6]). */
const STEP_MS = 8
/** The most steps one rAF tick may run at 1× (a stalled tab catches up this far, no further). */
const MAX_STEPS = 6
const SRAM_EVERY_MS = 30_000
export const SPEEDS = [1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]
export const GB_KEYS = ['RIGHT', 'LEFT', 'UP', 'DOWN', 'A', 'B', 'SELECT', 'START'] as const
export type GbKey = (typeof GB_KEYS)[number]
export const STATE_SLOTS = [0, 1, 2] as const

export interface GbRom {
  /** The file name as listed (the pane shows it). */
  file: string
  path: string
  /** Main's sanitized stem: the save files' name. */
  name: string
}

export interface GbStatus {
  rom: GbRom | null
  loading: boolean
  error: string
  paused: boolean
  speed: Speed
  muted: boolean
  /** True while a rAF loop is stepping the core (a view is mounted and a ROM is in). */
  running: boolean
  /** A short line for the bar: "saved", "state 2 loaded", … cleared after a moment. */
  note: string
}

/** What serverboy's private core exposes that we touch. */
interface Core {
  canvasBuffer: { data: Uint8ClampedArray }
  /** The core's own read: Yellow runs in GBC mode and D000–DFFF is banked, so `memory[]` is not the truth there. */
  memoryRead(addr: number): number
  memoryWrite(addr: number, data: number): void
  /** The cartridge as loaded (the whole file); bank 0 is mirrored in `memory[]`. A save state carries a copy. */
  ROM: Uint8Array
  memory: Uint8Array
  audioBuffer: Float32Array
  audioDestinationPosition: number
  numSamplesTotal: number
  clocksPerSecond: number
  audioResamplerFirstPassFactor: number
  outputAudio(): void
  graphicsBlit(): void
  saveState(): unknown[]
  saving(state: unknown[]): void
}

interface Serverboy {
  loadRom(rom: string, sram?: number[]): boolean
  doFrame(): unknown
  pressKey(key: string): void
  getSaveData(): ArrayLike<number>
}

/**
 * The trainer's door, from the renderer's side: one request at a time, run INSIDE the same loop
 * that plays the game, so what the trainer does is what the tile shows. A `hold` presses keys
 * for up to N core steps and stops early on a memory condition; a `settle` runs keyless until
 * the screen holds still. With no view mounted (the tile off) the loop is not running, and a
 * job runs to completion at once instead. plugin/scripts/lib/door.mjs is the other end.
 */
interface Stop {
  addr: number
  len?: number
  when: 'changed' | 'eq' | 'ne'
  value?: number
}
interface Job {
  keys: GbKey[]
  budget: number
  n: number
  /** Called after every core step; true = the job is over. */
  after: () => boolean
  finish: () => Record<string, unknown>
  resolve: (v: Record<string, unknown>) => void
}

type SbCtor = new () => Serverboy

const MUTED_KEY = 'deck.pokemon.muted'
const SPEED_KEY = 'deck.pokemon.speed'

let ctor: Promise<SbCtor> | null = null

/**
 * serverboy names its private slot off `process.hrtime()` at module load, and the renderer
 * has no Node `process`: stand one up for the import, then take it away again so nothing else
 * mistakes this window for Node.
 */
function serverboy(): Promise<SbCtor> {
  if (!ctor) {
    const g = globalThis as { process?: { hrtime?: () => [number, number]; env?: Record<string, string> } }
    const mine = !g.process
    if (mine) {
      g.process = {
        env: {},
        hrtime: () => {
          const t = performance.now()
          return [Math.floor(t / 1000), Math.floor((t % 1000) * 1e6)]
        }
      }
    }
    ctor = import('serverboy')
      .then((m) => (m.default ?? m) as SbCtor)
      .finally(() => {
        if (mine) delete g.process
      })
  }
  return ctor
}

function bytesToString(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)))
  return s
}

/** WebAudio at the core's own rate: each tick's samples become one buffer, queued back to back a little ahead of now. */
class AudioOut {
  private ctx: AudioContext
  private gain: GainNode
  private next = 0
  constructor(rate: number) {
    this.ctx = new AudioContext({ sampleRate: Math.round(rate) })
    this.gain = this.ctx.createGain()
    this.gain.gain.value = 0.4
    this.gain.connect(this.ctx.destination)
  }
  push(samples: Float32Array, pairs: number): void {
    if (pairs <= 0) return
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const now = this.ctx.currentTime
    // Fallen behind (a stalled tab): start again a little ahead. Run away ahead (a burst): drop this one.
    if (this.next < now + 0.01) this.next = now + 0.04
    else if (this.next > now + 0.3) return
    const buf = this.ctx.createBuffer(2, pairs, this.ctx.sampleRate)
    const L = buf.getChannelData(0)
    const R = buf.getChannelData(1)
    for (let i = 0; i < pairs; i++) {
      L[i] = samples[2 * i]
      R[i] = samples[2 * i + 1]
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.gain)
    src.start(this.next)
    this.next += buf.duration
  }
  close(): void {
    void this.ctx.close()
  }
}

class GameBoy {
  private sb: Serverboy | null = null
  private core: Core | null = null
  private status: GbStatus = {
    rom: null,
    loading: false,
    error: '',
    paused: false,
    speed: 1,
    muted: false,
    running: false,
    note: ''
  }
  private listeners = new Set<(s: GbStatus) => void>()
  private views = new Set<CanvasRenderingContext2D>()
  private held = new Set<GbKey>()
  private raf = 0
  private last = 0
  private acc = 0
  private sramAt = 0
  private noteTimer = 0
  private image = new ImageData(GB_W, GB_H)
  private audio: AudioOut | null = null
  /** Whether sound is wanted at all (the pane is open); the mute button is on top of that. */
  private audible = false
  private samples = new Float32Array(1 << 16)
  private sampleCount = 0
  private autoloaded = false
  private loadSeq = 0
  private job: Job | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor() {
    try {
      this.status.muted = localStorage.getItem(MUTED_KEY) === '1'
      const sp = Number(localStorage.getItem(SPEED_KEY))
      if ((SPEEDS as readonly number[]).includes(sp)) this.status.speed = sp as Speed
    } catch {
      /* defaults */
    }
    // ⌘R reloads the renderer: the game restarts from its last battery save, so make that now.
    window.addEventListener('pagehide', () => this.saveSram())
    window.addEventListener('blur', () => this.releaseAll())
  }

  // ---- views ---------------------------------------------------------------------

  get state(): GbStatus {
    return this.status
  }

  subscribe(cb: (s: GbStatus) => void): () => void {
    this.listeners.add(cb)
    cb(this.status)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private set(patch: Partial<GbStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l(this.status)
  }

  /** Show the screen on this canvas until the returned function is called. The loop runs while any view is attached. */
  attach(canvas: HTMLCanvasElement): () => void {
    canvas.width = GB_W
    canvas.height = GB_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return () => {}
    this.views.add(ctx)
    this.blit()
    this.ensureLoop()
    return () => {
      this.views.delete(ctx)
      if (this.views.size === 0) this.stopLoop()
    }
  }

  /** The pane is open: sound may play. Closed: silence, and the keys let go. */
  setAudible(on: boolean): void {
    this.audible = on
    if (!on) {
      this.releaseAll()
      this.dropAudio()
    }
  }

  private blit(): void {
    if (!this.core || this.views.size === 0) return
    this.image.data.set(this.core.canvasBuffer.data)
    for (const ctx of this.views) ctx.putImageData(this.image, 0, 0)
  }

  // ---- the loop ------------------------------------------------------------------

  private ensureLoop(): void {
    if (this.raf || !this.core) return
    this.last = performance.now()
    this.acc = 0
    this.raf = requestAnimationFrame(this.tick)
    this.set({ running: true })
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.dropAudio()
    this.saveSram()
    if (this.status.running) this.set({ running: false })
  }

  private tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick)
    const sb = this.sb
    if (!sb || !this.core || this.status.paused) {
      this.last = now
      return
    }
    this.acc += Math.min(now - this.last, 250)
    this.last = now
    let steps = Math.floor(this.acc / STEP_MS)
    if (steps <= 0) return
    this.acc -= steps * STEP_MS
    steps = Math.min(steps, MAX_STEPS) * this.status.speed
    this.sampleCount = 0
    for (let i = 0; i < steps; i++) {
      if (this.job) {
        this.runJobStep()
        continue
      }
      for (const k of this.held) sb.pressKey(k)
      sb.doFrame()
    }
    this.blit()
    if (this.audible && !this.status.muted && this.status.speed === 1) {
      if (!this.audio) this.audio = new AudioOut(this.core.clocksPerSecond / this.core.audioResamplerFirstPassFactor)
      this.audio.push(this.samples, this.sampleCount >> 1)
    } else if (this.audio) this.dropAudio()
    if (now - this.sramAt > SRAM_EVERY_MS) this.saveSram()
  }

  private dropAudio(): void {
    this.audio?.close()
    this.audio = null
  }

  // ---- the cartridge -------------------------------------------------------------

  /** The ROM played last time, once, so the tile boots straight into the game. */
  autoload(): void {
    if (this.autoloaded) return
    this.autoloaded = true
    const path = readSavedRom()
    if (!path || this.status.rom) return
    void this.load({ name: path.slice(path.lastIndexOf('/') + 1), path })
  }

  async load(rom: { name: string; path: string }): Promise<void> {
    const seq = ++this.loadSeq
    this.saveSram()
    this.set({ loading: true, error: '' })
    try {
      const Sb = await serverboy()
      const { bytes, name } = await window.deck.pokemonLoadRom(rom.path)
      const sram = await window.deck.pokemonLoadSram(name)
      if (seq !== this.loadSeq) return
      const sb = new Sb()
      sb.loadRom(bytesToString(bytes), sram && sram.length ? Array.from(sram) : undefined)
      this.mount(sb)
      this.set({ rom: { file: rom.name, path: rom.path, name }, loading: false, paused: false, note: sram ? 'battery save loaded' : '' })
      writeSavedRom(rom.path)
      this.sramAt = performance.now()
      this.ensureLoop()
      this.blit()
      this.flashNote()
    } catch (e) {
      if (seq !== this.loadSeq) return
      this.set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Take the core out of a fresh serverboy and wire our taps: the screen read straight off its buffer, the sound off its output. */
  private mount(sb: Serverboy): void {
    const priv = Object.keys(sb).find((k) => k.startsWith('_'))
    const core = priv ? ((sb as unknown as Record<string, { gameboy: Core }>)[priv]?.gameboy ?? null) : null
    if (!core) throw new Error('serverboy has no core to tap')
    // graphicsBlit rebuilds a 92160-entry JS array every step for doFrame's return value; we read the typed buffer instead.
    core.graphicsBlit = () => {}
    const orig = core.outputAudio
    const self = this
    core.outputAudio = function (this: Core) {
      orig.call(this)
      const p = this.audioDestinationPosition === 0 ? this.numSamplesTotal : this.audioDestinationPosition
      if (self.sampleCount + 2 <= self.samples.length) {
        self.samples[self.sampleCount++] = this.audioBuffer[p - 2]
        self.samples[self.sampleCount++] = this.audioBuffer[p - 1]
      }
    }
    this.sb = sb
    this.core = core
    this.held.clear()
  }

  /** Power cycle: the battery save survives, the state does not. */
  async reset(): Promise<void> {
    const rom = this.status.rom
    if (!rom) return
    await this.load({ name: rom.file, path: rom.path })
  }

  // ---- saves ---------------------------------------------------------------------

  /** Battery RAM to disk, if the game has any. Fire and forget: called from the loop, unload, and the bar. */
  saveSram(): void {
    if (!this.sb || !this.status.rom) return
    this.sramAt = performance.now()
    let data: ArrayLike<number>
    try {
      data = this.sb.getSaveData()
    } catch {
      return
    }
    if (!data || data.length === 0) return
    void window.deck.pokemonSaveSram(this.status.rom.name, Uint8Array.from(data)).catch(() => {})
  }

  saveNow(): void {
    this.saveSram()
    this.note('saved')
  }

  async saveState(slot: number): Promise<void> {
    if (!this.core || !this.status.rom) return
    try {
      const json = JSON.stringify(this.core.saveState())
      await window.deck.pokemonSaveState(this.status.rom.name, slot, new TextEncoder().encode(json))
      this.note(`state ${slot + 1} saved`)
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  async loadState(slot: number): Promise<void> {
    if (!this.core || !this.status.rom) return
    try {
      const bytes = await window.deck.pokemonLoadState(this.status.rom.name, slot)
      if (!bytes || !this.core) {
        this.note(`no state in slot ${slot + 1}`)
        return
      }
      this.core.saving(JSON.parse(new TextDecoder().decode(bytes)) as unknown[])
      this.blit()
      this.note(`state ${slot + 1} loaded`)
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  private note(text: string): void {
    this.set({ note: text })
    this.flashNote()
  }

  private flashNote(): void {
    window.clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => this.set({ note: '' }), 2500)
  }

  // ---- the trainer's door --------------------------------------------------------

  private read(addr: number, len: number): Uint8Array {
    const out = new Uint8Array(len)
    const c = this.core
    if (c) for (let i = 0; i < len; i++) out[i] = c.memoryRead(addr + i)
    return out
  }

  private runJobStep(): void {
    const job = this.job
    const sb = this.sb
    if (!job || !sb) return
    for (const k of job.keys) sb.pressKey(k)
    sb.doFrame()
    job.n++
    if (job.after() || job.n >= job.budget) {
      this.job = null
      job.resolve(job.finish())
    }
  }

  /** Queue a job; it runs paced by the loop while a view shows the game, else at once. */
  private runJob(keys: GbKey[], budget: number, after: () => boolean, finish: () => Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      this.job = { keys, budget, n: 0, after, finish, resolve }
      if (!this.raf || this.status.paused) {
        while (this.job) this.runJobStep()
        this.blit()
      }
    })
  }

  private static same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  /** One request from plugin/scripts/lib/door.mjs; serialized, so two CLIs never interleave. */
  drive(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const run = () => this.driveNow(body)
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => {})
    return p
  }

  private async driveNow(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const op = String(body.op ?? '')
    if (op === 'info') return { rom: this.status.rom?.path ?? null, name: this.status.rom?.name ?? null, speed: this.status.speed, paused: this.status.paused, running: this.status.running }
    if (op === 'rom') {
      const path = String(body.path ?? '')
      await this.load({ name: path.slice(path.lastIndexOf('/') + 1), path })
      if (this.status.error) throw new Error(this.status.error)
      return {}
    }
    if (!this.core || !this.sb) throw new Error('no ROM loaded: open the Pokemon pane (⌘⇧G) and pick a cartridge')
    switch (op) {
      case 'ram': {
        const ranges = (body.ranges as [number, number][]) ?? []
        return { data: ranges.map(([a, n]) => btoa(String.fromCharCode(...this.read(a, n)))) }
      }
      case 'poke': {
        for (const [a, b64] of (body.writes as [number, string][]) ?? []) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          for (let i = 0; i < bytes.length; i++) this.core.memoryWrite(a + i, bytes[i])
        }
        this.blit()
        return {}
      }
      case 'patch': {
        // The trainer's ROM patch (the sprite gag's "A boring …" text): bytes into the LOADED image only —
        // the file is never written, and a state load brings the original back.
        let changed = 0
        for (const [o, b64] of (body.writes as [number, string][]) ?? []) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          for (let i = 0; i < bytes.length; i++) {
            const at = o + i
            if (at < 0 || at >= this.core.ROM.length) throw new Error(`patch: 0x${at.toString(16)} is outside the cartridge`)
            if (this.core.ROM[at] !== bytes[i]) changed++
            this.core.ROM[at] = bytes[i]
            if (at < 0x4000) this.core.memory[at] = bytes[i]
          }
        }
        return { changed }
      }
      case 'hold': {
        const keys = ((body.keys as string[]) ?? []).filter((k): k is GbKey => (GB_KEYS as readonly string[]).includes(k))
        const budget = Math.max(1, Math.min(20000, Number(body.iterations ?? 1)))
        const stops = (body.stop as Stop[]) ?? []
        const every = Math.max(1, Number(body.every ?? 2))
        const base = stops.map((s) => (s.when === 'changed' ? this.read(s.addr, s.len ?? 1) : null))
        let stopped: number | null = null
        let n = 0
        return this.runJob(
          keys,
          budget,
          () => {
            n++
            if (n % every !== 0 || !stops.length) return false
            for (let i = 0; i < stops.length; i++) {
              const s = stops[i]
              const cur = this.read(s.addr, s.len ?? 1)
              const hit = s.when === 'changed' ? !GameBoy.same(cur, base[i]!) : s.when === 'eq' ? cur[0] === s.value : cur[0] !== s.value
              if (hit) {
                stopped = i
                return true
              }
            }
            return false
          },
          () => ({ iterations: n, stopped, values: stops.map((s) => Array.from(this.read(s.addr, s.len ?? 1))) })
        )
      }
      case 'settle': {
        const max = Math.max(1, Math.min(20000, Number(body.max ?? 240)))
        const stable = Math.max(1, Number(body.stable ?? 24))
        let last = new Uint8Array(this.core.canvasBuffer.data)
        let quiet = 0
        let n = 0
        let settled = false
        return this.runJob(
          [],
          max,
          () => {
            n++
            const cur = this.core!.canvasBuffer.data
            if (GameBoy.same(cur, last)) quiet++
            else {
              quiet = 0
              last = new Uint8Array(cur)
            }
            settled = quiet >= stable
            return settled
          },
          () => ({ iterations: n, settled })
        )
      }
      case 'screen': {
        const scale = Math.max(1, Math.min(6, Number(body.scale ?? 3)))
        const src = document.createElement('canvas')
        src.width = GB_W
        src.height = GB_H
        this.image.data.set(this.core.canvasBuffer.data)
        src.getContext('2d')!.putImageData(this.image, 0, 0)
        const big = document.createElement('canvas')
        big.width = GB_W * scale
        big.height = GB_H * scale
        const ctx = big.getContext('2d')!
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(src, 0, 0, big.width, big.height)
        const blob = await new Promise<Blob | null>((r) => big.toBlob(r, 'image/png'))
        if (!blob) throw new Error('could not encode the screenshot')
        const path = await window.deck.pokemonShot(new Uint8Array(await blob.arrayBuffer()))
        return { path }
      }
      case 'save': {
        const name = String(body.name ?? 'checkpoint')
        const json = JSON.stringify(this.core.saveState())
        await window.deck.pokemonSaveState(this.status.rom!.name, `t-${name}`, new TextEncoder().encode(json))
        return { path: name }
      }
      case 'load': {
        const name = String(body.name ?? 'checkpoint')
        const bytes = await window.deck.pokemonLoadState(this.status.rom!.name, `t-${name}`)
        if (!bytes) throw new Error(`no save state named ${name}`)
        this.core.saving(JSON.parse(new TextDecoder().decode(bytes)) as unknown[])
        this.blit()
        this.note(`state “${name}” loaded`)
        return {}
      }
      case 'speed': {
        const sp = Number(body.speed)
        if ((SPEEDS as readonly number[]).includes(sp)) this.setSpeed(sp as Speed)
        return { speed: this.status.speed }
      }
      case 'pause':
        this.setPaused(!!body.on)
        return { paused: this.status.paused }
      default:
        throw new Error(`unknown op ${op}`)
    }
  }

  // ---- controls ------------------------------------------------------------------

  press(k: GbKey): void {
    this.held.add(k)
  }

  release(k: GbKey): void {
    this.held.delete(k)
  }

  releaseAll(): void {
    this.held.clear()
  }

  setPaused(on: boolean): void {
    if (on === this.status.paused) return
    this.set({ paused: on })
    if (on) {
      this.releaseAll()
      this.dropAudio()
      this.saveSram()
    } else this.last = performance.now()
  }

  setSpeed(s: Speed): void {
    this.set({ speed: s })
    try {
      localStorage.setItem(SPEED_KEY, String(s))
    } catch {
      /* not kept */
    }
  }

  setMuted(on: boolean): void {
    this.set({ muted: on })
    try {
      localStorage.setItem(MUTED_KEY, on ? '1' : '0')
    } catch {
      /* not kept */
    }
  }
}

let machine: GameBoy | null = null

/** The one Game Boy. Made on first use, so a deck without the tile never loads the emulator. */
export function gameboy(): GameBoy {
  if (!machine) {
    machine = new GameBoy()
    // The trainer's door: main relays POST /gameboy here. A ROM comes from the pane or from the
    // request's own `rom` op; with no view mounted, jobs run at once instead of paced.
    window.deck.onGameboy(({ id, body }) => {
      machine!.drive(body).then(
        (r) => window.deck.gameboyReply(id, { ok: true, ...r }),
        (e: unknown) => window.deck.gameboyReply(id, { ok: false, error: e instanceof Error ? e.message : String(e) })
      )
    })
  }
  return machine
}

/** Bring the machine up without a view (App calls this at boot when the tile is on), so the door answers even before a tile mounts. */
export function installGameboy(): void {
  gameboy().autoload()
}

/** The machine's status, live. */
export function useGameBoy(): GbStatus {
  const [s, setS] = useState<GbStatus>(() => gameboy().state)
  useEffect(() => gameboy().subscribe(setS), [])
  return s
}
