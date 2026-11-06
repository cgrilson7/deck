// INSTALL UPDATE: the packaged deck knows which source it was built from (out/build-info.json,
// written by scripts/stamp.mjs during `npm run dist`) and compares it with the repo it came from,
// every minute and whenever the window comes forward. Different = the top bar's "install update".
// Installing runs `npm run dist` in the repo, swaps the new bundle in over the running one and
// relaunches it; every session lives in tmux, so nothing is lost but a few seconds of the window.
// Under `npm run dev` there is no build-info.json, so this stays quiet.

import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DeckUpdate } from '@shared/types'
import { fingerprint } from '../../scripts/lib/fingerprint.mjs'

const CHECK_MS = 60_000

interface BuildInfo {
  repo: string
  fingerprint: string | null
  builtAt: number
}

export class Updater {
  private info: BuildInfo | null = null
  private state: DeckUpdate = { state: 'none' }
  private timer: NodeJS.Timeout | null = null
  private checking = false

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly logPath: string,
    private readonly onChange: (u: DeckUpdate) => void
  ) {
    try {
      const raw = JSON.parse(readFileSync(join(__dirname, '../build-info.json'), 'utf8')) as BuildInfo
      if (app.isPackaged && raw.repo && raw.fingerprint && existsSync(raw.repo)) this.info = raw
    } catch {
      /* dev, or an app built before this: no updates offered */
    }
  }

  start(): void {
    if (!this.info || this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_MS)
  }

  get(): DeckUpdate {
    return this.state
  }

  private set(u: DeckUpdate): void {
    this.state = u
    this.onChange(u)
  }

  /** Compare the repo with what this app was built from. Never while a build runs. */
  async check(): Promise<void> {
    const info = this.info
    if (!info || this.checking || this.state.state === 'building' || this.state.state === 'installing') return
    this.checking = true
    try {
      const now = await fingerprint(info.repo, this.env)
      // (the state may have moved while git ran)
      const st = this.state.state as DeckUpdate['state']
      if (now === null || st === 'building' || st === 'installing') return
      const available = now !== info.fingerprint
      // A failed build stays reported until the source changes again (or a retry succeeds).
      if (this.state.state === 'error' && this.state.fingerprint === now) return
      const next: DeckUpdate = available ? { state: 'available', fingerprint: now, builtAt: info.builtAt, repo: info.repo } : { state: 'none' }
      if (next.state !== this.state.state || next.fingerprint !== this.state.fingerprint) this.set(next)
    } finally {
      this.checking = false
    }
  }

  /** Build the repo and swap the result in over this app, then relaunch. Resolves once the build is under way. */
  async install(): Promise<void> {
    const info = this.info
    if (!info) throw new Error('no update source: this deck was not built by `npm run dist`')
    if (this.state.state === 'building' || this.state.state === 'installing') return
    const fp = (await fingerprint(info.repo, this.env)) ?? ''
    this.set({ state: 'building', fingerprint: fp, repo: info.repo, startedAt: Date.now() })
    const log = createWriteStream(this.logPath, { flags: 'w' })
    log.write(`[deck] npm run dist in ${info.repo} (${new Date().toISOString()})\n`)
    const child = spawn('npm', ['run', 'dist'], { cwd: info.repo, env: { ...this.env, DECK_FINGERPRINT: fp }, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const keep = (b: Buffer): void => {
      log.write(b)
      tail = (tail + b.toString('utf8')).slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', (err) => {
      log.end()
      this.set({ state: 'error', fingerprint: fp, repo: info.repo, error: String(err.message) })
    })
    child.on('close', (code) => {
      log.end()
      if (code !== 0) {
        const last = tail.trim().split('\n').slice(-6).join('\n')
        this.set({ state: 'error', fingerprint: fp, repo: info.repo, error: `npm run dist exited ${code}\n${last}\n(full log: ${this.logPath})` })
        return
      }
      try {
        this.swap(info.repo)
      } catch (err) {
        this.set({ state: 'error', fingerprint: fp, repo: info.repo, error: (err as Error).message })
      }
    })
  }

  /** The new bundle replaces the running one once this process has exited, then opens. */
  private swap(repo: string): void {
    const name = `${app.getName()}.app`
    const built = newestBundle(join(repo, 'dist'), name)
    if (!built) throw new Error(`the build finished but no ${name} was found under ${join(repo, 'dist')}`)
    // …/Foo.app/Contents/MacOS/Foo → …/Foo.app
    const current = dirname(dirname(dirname(app.getPath('exe'))))
    if (!current.endsWith('.app')) throw new Error(`cannot tell which bundle is running (${current})`)
    this.set({ ...this.state, state: 'installing' })
    // A detached shell outlives us: wait for this pid to go, copy the new bundle beside the old,
    // swap the two (the old is only removed once the new one is whole), open it.
    const script = [
      'while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done',
      'rm -rf "$DEST.new" && ditto "$SRC" "$DEST.new" || { open "$DEST"; exit 1; }',
      'rm -rf "$DEST.old" && mv "$DEST" "$DEST.old" && mv "$DEST.new" "$DEST" && rm -rf "$DEST.old"',
      'open "$DEST"'
    ].join('\n')
    const child = spawn('/bin/sh', ['-c', script], {
      detached: true,
      stdio: 'ignore',
      env: { ...this.env, PID: String(process.pid), SRC: built, DEST: current }
    })
    child.unref()
    setTimeout(() => app.quit(), 300)
  }
}

/** The most recently built `name` one folder down in `dist` (mac-arm64/, mac/, mac-universal/…). */
function newestBundle(dist: string, name: string): string | null {
  let best: { path: string; at: number } | null = null
  try {
    for (const d of readdirSync(dist)) {
      const p = join(dist, d, name)
      try {
        const at = statSync(p).mtimeMs
        if (!best || at > best.at) best = { path: p, at }
      } catch {
        /* not here */
      }
    }
  } catch {
    return null
  }
  return best?.path ?? null
}
