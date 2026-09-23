// The sprite gag (Village vs Notes), run by the deck itself. `plugin/scripts/trainer.mjs sprite
// watch` polls the renderer's Game Boy over POST /gameboy every 20ms and repaints the battle it
// finds — the pictures, the names, the moves, the text — all transient pokes, nothing written to
// the cartridge. It used to be a terminal the user kept open; the `spriteGag` setting makes it a
// child of main instead, so the toggle in the Pokemon pane (or View ▸ Pokemon) is the whole story.
//
// Electron's binary IS node with ELECTRON_RUN_AS_NODE=1, so there is no dependency on a `node` on
// the PATH. The watch runs until killed and prints its progress to stderr; we log those lines and
// restart it if it falls over, up to RESTART_MAX times a minute before giving up.
import { spawn, type ChildProcess } from 'node:child_process'
import type { DeckSettings } from '@shared/types'

/** How long to wait before standing a fallen watch back up. */
const RESTART_MS = 2000
/** Restarts allowed inside RESTART_WINDOW_MS before we stop trying (a watch that cannot run should not spin). */
const RESTART_MAX = 5
const RESTART_WINDOW_MS = 60_000

export class SpriteGag {
  private child: ChildProcess | null = null
  /** The moveset the running child was started with, so a change of it restarts the watch. */
  private moves = ''
  private wanted = false
  private timer: NodeJS.Timeout | null = null
  /** When each restart happened, inside the last window. */
  private restarts: number[] = []
  private gaveUp = false

  constructor(
    /** Absolute path of plugin/scripts/trainer.mjs. */
    private readonly trainerScript: string,
    /** The hooks server's port: the watch's door to the renderer's Game Boy. */
    private readonly port: number
  ) {}

  /** Called with the settings at boot and on every change: the child follows `spriteGag` / `spriteGagMoves`. */
  sync(settings: DeckSettings): void {
    const moves = settings.spriteGagMoves || 'download'
    this.wanted = settings.spriteGag
    if (!this.wanted) {
      this.stop()
      return
    }
    if (this.child && this.moves === moves) return
    // A new moveset means a new battle script: start the watch over with it.
    if (this.child) this.kill()
    this.moves = moves
    this.gaveUp = false
    this.restarts = []
    this.start()
  }

  /** Let the watch go: the setting is off, or the app is quitting. */
  stop(): void {
    this.wanted = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.kill()
  }

  private kill(): void {
    const c = this.child
    this.child = null
    if (!c) return
    c.removeAllListeners()
    c.stderr?.removeAllListeners()
    try {
      c.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }

  private start(): void {
    if (!this.wanted || this.child) return
    let child: ChildProcess
    try {
      child = spawn(process.execPath, [this.trainerScript, 'sprite', 'watch', '--moves', this.moves], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DECK_HOOK_PORT: String(this.port) },
        stdio: ['ignore', 'ignore', 'pipe']
      })
    } catch (err) {
      console.warn('[deck] sprite gag could not start:', (err as Error).message)
      return
    }
    this.child = child
    let tail = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      tail += chunk
      const lines = tail.split('\n')
      tail = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) console.log('[deck] sprite gag:', line.trim())
    })
    child.on('error', (err) => console.warn('[deck] sprite gag:', err.message))
    child.on('exit', (code, signal) => {
      if (this.child !== child) return
      this.child = null
      if (!this.wanted) return
      console.warn(`[deck] sprite gag stopped on its own (${signal ?? `code ${code}`})`)
      this.retry()
    })
  }

  private retry(): void {
    const now = Date.now()
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS)
    if (this.restarts.length >= RESTART_MAX) {
      if (!this.gaveUp) {
        this.gaveUp = true
        console.warn(`[deck] sprite gag kept falling over (${RESTART_MAX} restarts in a minute): giving up. Turn it off and on again to try once more`)
      }
      return
    }
    this.restarts.push(now)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.start()
    }, RESTART_MS)
  }
}
