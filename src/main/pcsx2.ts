// The PS2 tile's main side: PCSX2 MIRRORED. PCSX2 is a native app of its own (no wasm PS2 runs a game
// like Madden), so the deck does not emulate anything here — it SHOWS PCSX2's game window (Electron's
// desktop capture of that one window, `window:<CGWindowID>:0`, in the renderer: lib/ps2.ts) and PLAYS it
// from the tile: keys pressed in the deck become key events posted straight into PCSX2's process, so
// PCSX2 hears them while the deck stays in front.
//
// Both go through plugin/native/pcsx2-bridge.swift, compiled with the Xcode tools' swiftc the first time
// it is needed into userData/pcsx2 (recompiled when the source changes). macOS asks for two permissions,
// once each, for Foxtrot's Workshop: Screen Recording (to see the window) and Accessibility (to post keys).
//
// The keys are PCSX2's OWN default keyboard bindings for pad 1 (its PCSX2.ini [Pad1]); a rebinding there
// would need the same change in PAD_KEYS.

import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Ps2Button, Ps2Status } from '../shared/types'

const APP = '/Applications/PCSX2.app'
const BIN = join(APP, 'Contents', 'MacOS', 'PCSX2')
const DISC_EXTS = new Set(['.iso', '.chd', '.cso', '.gz'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'Library', 'Applications'])

/** PCSX2's default pad-1 keyboard bindings, as macOS virtual key codes. */
const PAD_KEYS: Record<Ps2Button, number> = {
  up: 126, // Up
  down: 125, // Down
  left: 123, // Left
  right: 124, // Right
  cross: 40, // K
  circle: 37, // L
  square: 38, // J
  triangle: 34, // I
  start: 36, // Return
  select: 51, // Backspace
  l1: 12, // Q
  r1: 14, // E
  l2: 18, // 1
  r2: 20, // 3
  l3: 19, // 2
  r3: 21, // 4
  // The left stick (Madden runs with it as well as the d-pad): W A S D.
  lup: 13,
  lleft: 0,
  ldown: 1,
  lright: 2
}

function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

export class Pcsx2 {
  private readonly dir: string
  private bridge: ChildProcessWithoutNullStreams | null = null
  private bridgeJob: Promise<string> | null = null
  private pending: ((line: string) => void)[] = []
  private buffer = ''
  private held = new Set<Ps2Button>()
  /** The game window's capture source as last seen (the display-media handler's answer). */
  lastSource: string | null = null

  constructor(
    userData: string,
    private readonly source: string,
    private readonly settings: () => { ps2DiscDir: string }
  ) {
    this.dir = join(userData, 'pcsx2')
  }

  // ---- the bridge ------------------------------------------------------------------

  /** The compiled bridge's path, built from the shipped source the first time (or when the source changed). */
  private compile(): Promise<string> {
    if (this.bridgeJob) return this.bridgeJob
    this.bridgeJob = (async () => {
      const src = readFileSync(this.source, 'utf8')
      const hash = createHash('sha1').update(src).digest('hex').slice(0, 12)
      const bin = join(this.dir, `pcsx2-bridge-${hash}`)
      if (existsSync(bin)) return bin
      mkdirSync(this.dir, { recursive: true })
      const srcCopy = join(this.dir, 'pcsx2-bridge.swift')
      writeFileSync(srcCopy, src)
      try {
        await promisify(execFile)('/usr/bin/swiftc', ['-O', srcCopy, '-o', bin], { timeout: 180_000 })
      } catch (err) {
        throw new Error(`the PCSX2 bridge did not compile (Xcode command-line tools: xcode-select --install): ${(err as Error).message}`)
      }
      return bin
    })().catch((err) => {
      this.bridgeJob = null
      throw err
    })
    return this.bridgeJob
  }

  /** One command to the long-running bridge, its one-line JSON answer back. */
  private async ask(cmd: string): Promise<Record<string, unknown>> {
    if (!this.bridge) {
      const bin = await this.compile()
      if (!this.bridge) {
        const p = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
        p.stdout.setEncoding('utf8')
        p.stdout.on('data', (chunk: string) => {
          this.buffer += chunk
          let nl: number
          while ((nl = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, nl)
            this.buffer = this.buffer.slice(nl + 1)
            this.pending.shift()?.(line)
          }
        })
        p.on('exit', () => {
          if (this.bridge === p) this.bridge = null
          for (const r of this.pending.splice(0)) r('{"error":"bridge exited"}')
        })
        this.bridge = p
      }
    }
    const bridge = this.bridge
    return new Promise((resolve) => {
      this.pending.push((line) => {
        try {
          resolve(JSON.parse(line) as Record<string, unknown>)
        } catch {
          resolve({ error: line })
        }
      })
      bridge.stdin.write(cmd + '\n')
    })
  }

  dispose(): void {
    this.bridge?.kill()
    this.bridge = null
  }

  // ---- PCSX2 -----------------------------------------------------------------------

  private pidCache: { pid: number | null; at: number } = { pid: null, at: 0 }

  /** PCSX2's pid, looked up at most every 2 s (keys come many to the second). */
  private async pid(): Promise<number | null> {
    if (Date.now() - this.pidCache.at < 2000) return this.pidCache.pid
    const pid = await this.findPid()
    this.pidCache = { pid, at: Date.now() }
    return pid
  }

  private async findPid(): Promise<number | null> {
    try {
      const { stdout } = await promisify(execFile)('/usr/bin/pgrep', ['-f', BIN])
      const pid = Number(stdout.trim().split('\n')[0])
      return Number.isFinite(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  /** Is PCSX2 there and running, its game window (the largest window on screen), and the two permissions. */
  async status(): Promise<Ps2Status> {
    const installed = existsSync(BIN)
    const pid = installed ? await this.pid() : null
    let window: Ps2Status['window'] = null
    let trusted = false
    let error: string | null = null
    try {
      trusted = (await this.ask('trusted')).trusted === true
      if (pid) {
        const r = await this.ask(`windows ${pid}`)
        const wins = ((r.windows as { id: number; title: string; w: number; h: number; onscreen: boolean }[]) ?? []).filter((w) => w.onscreen && w.w >= 320 && w.h >= 240)
        wins.sort((a, b) => b.w * b.h - a.w * a.h)
        const w = wins[0]
        if (w) window = { id: w.id, title: w.title, width: w.w, height: w.h, source: `window:${w.id}:0` }
        this.lastSource = window?.source ?? null
      }
    } catch (err) {
      error = (err as Error).message
    }
    return { installed, running: pid !== null, window, trusted, error, discs: this.listDiscs(), game: pid ? await this.game(pid, window?.title ?? '') : null }
  }

  private gameCache: { pid: number; disc: string | null } | null = null

  /**
   * The game that is up, for "Foxtrot Plays …": PCSX2 titles its game window with the GameDB name
   * ("Madden NFL 2005"); a window still titled PCSX2 (the game list, a BIOS boot) falls back to the disc
   * named on its command line, read once per pid.
   */
  private async game(pid: number, title: string): Promise<string | null> {
    const t = title.replace(/\s*\[[A-Z]{4}-\d{5}\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
    if (t && !/^pcsx2\b/i.test(t)) return t
    if (this.gameCache?.pid !== pid) {
      let disc: string | null = null
      try {
        const { stdout } = await promisify(execFile)('/bin/ps', ['-o', 'args=', '-p', String(pid)])
        const m = /\s--\s+(.+?)\s*$/.exec(stdout) ?? /\s(\/\S.*\.(?:iso|chd|cso|gz))\s*$/i.exec(stdout)
        if (m) disc = basename(m[1], extname(m[1]))
      } catch {
        /* gone */
      }
      this.gameCache = { pid, disc }
    }
    return this.gameCache.disc
  }

  /** The PS2 discs under the disc folder (four folders deep). */
  listDiscs(): { name: string; path: string }[] {
    const out: { name: string; path: string }[] = []
    const walk = (dir: string, depth: number) => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (depth < 4 && !SKIP_DIRS.has(e.name)) walk(p, depth + 1)
        } else if (DISC_EXTS.has(extname(e.name).toLowerCase())) out.push({ name: basename(e.name, extname(e.name)), path: p })
      }
    }
    walk(expandHome(this.settings().ps2DiscDir), 0)
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Start PCSX2 on a disc (fast boot, straight into the game). Refused while it already runs: one console. */
  async launch(path: string): Promise<void> {
    if (!existsSync(BIN)) throw new Error('PCSX2 is not installed in /Applications')
    if (await this.findPid()) throw new Error('PCSX2 is already running')
    if (!this.listDiscs().some((d) => d.path === path)) throw new Error('that disc is not in the PS2 disc folder')
    await promisify(execFile)('/usr/bin/open', ['-a', APP, '--args', '-fastboot', '--', path])
    this.pidCache.at = 0
  }

  /** A pad button down or up in PCSX2 (its keyboard binding, posted to its process). */
  async key(button: Ps2Button, down: boolean): Promise<void> {
    const code = PAD_KEYS[button]
    if (code === undefined) return
    if (down === this.held.has(button)) return
    const pid = await this.pid()
    if (!pid) return
    if (down) this.held.add(button)
    else this.held.delete(button)
    await this.ask(`${down ? 'down' : 'up'} ${code} ${pid}`)
  }

  /** Let go of everything held (the pane closed, the window lost focus). */
  async releaseAll(): Promise<void> {
    for (const b of [...this.held]) await this.key(b, false)
  }
}
