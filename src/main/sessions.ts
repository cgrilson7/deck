// The session manager: CAP sticky slots, one tmux session + one pty per open session,
// parked sessions resumable by tmux (if alive) or by `claude --resume <id>`.
// State is authoritative here; the renderer is a view and sends commands.

import * as pty from 'node-pty'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type DeckState, type SessionRecord, type SessionStatus, type SessionView } from '@shared/types'
import type { FleetEntry } from './fleet'
import type { HookEvent, HookPayload } from './hooks'
import { Tmux, shq } from './tmux'

interface Runtime {
  status: SessionStatus
  attention: boolean
  tmuxAlive: boolean
  title: string
  pty?: pty.IPty
  userDetached: boolean
  /** Last size the renderer asked for, so a reattach starts at the right size. */
  cols?: number
  rows?: number
}

export interface SessionEvents {
  state(state: DeckState): void
  data(id: string, data: string): void
  exit(id: string): void
}

export interface SessionManagerOptions {
  tmux: Tmux
  env: NodeJS.ProcessEnv
  userDataDir: string
  hooksSettingsPath: string
  profile: string
  /** Live settings: where a new session starts when nothing is focused, and the --worktree default. */
  defaults: () => { cwd: string; worktree: boolean }
  /** Live slot cap: CAP, minus one per plugin tile (vocabulary, translator) occupying a grid cell. */
  cap: () => number
  events: SessionEvents
}

const SPAWN_COLS = 120
const SPAWN_ROWS = 40
/** How many start folders we remember (sessions.json) and how many of those the UI offers. */
const RECENT_KEEP = 10
export const RECENT_SHOW = 3

export class SessionManager {
  private records: SessionRecord[] = []
  private rt = new Map<string, Runtime>()
  private focusSlot: number | null = null
  /** Folders sessions were started in, most recent first. Outlives the sessions themselves. */
  private recentCwds: string[] = []
  private quitting = false
  private readonly storePath: string
  private broadcastTimer: NodeJS.Timeout | null = null

  constructor(private readonly o: SessionManagerOptions) {
    mkdirSync(o.userDataDir, { recursive: true })
    this.storePath = join(o.userDataDir, 'sessions.json')
  }

  // ---- lifecycle ---------------------------------------------------------

  async init(): Promise<void> {
    this.load()
    for (const rec of this.records) {
      const alive = await this.o.tmux.hasSession(rec.tmuxName)
      this.rt.set(rec.id, { status: alive ? 'unknown' : 'idle', attention: false, tmuxAlive: alive, title: '', userDetached: false })
      if (rec.slot !== null && rec.slot > this.o.cap()) rec.slot = null // cap shrank since this was saved
      if (rec.slot !== null) {
        if (alive) this.attach(rec.id)
        else rec.slot = null // tmux server gone (reboot); parked, resumable via --resume
      }
    }
    this.ensureFocus()
    this.save()
    this.broadcast()
  }

  /**
   * Refresh: kill every pty client; handlePtyExit sees the tmux session alive and not
   * user-detached, and attaches a fresh one, which makes tmux repaint the whole screen.
   * Nothing inside tmux notices.
   */
  reattachAll(): void {
    for (const rec of this.records) {
      const r = this.rt.get(rec.id)
      if (rec.slot !== null && r?.pty) r.pty.kill()
    }
  }

  /** App is quitting: drop the pty clients but keep slots, so relaunch reattaches in place. */
  detachAll(): void {
    this.quitting = true
    for (const r of this.rt.values()) r.pty?.kill()
    this.save()
  }

  // ---- commands ----------------------------------------------------------

  async newSession(opts: { cwd?: string; worktree?: boolean }): Promise<SessionRecord> {
    const slot = this.freeSlot()
    if (slot === null) throw new Error(`All ${this.o.cap()} slots are open. Close one first.`)
    const defaults = this.o.defaults()
    const cwd = opts.cwd ?? this.focusedCwd() ?? defaults.cwd
    if (!existsSync(cwd)) throw new Error(`Folder does not exist: ${cwd}`)
    const worktree = opts.worktree ?? defaults.worktree
    const id = randomBytes(3).toString('hex')
    const rec: SessionRecord = {
      id,
      tmuxName: `deck-${id}`,
      claudeSessionId: randomUUID(),
      cwd,
      worktree,
      createdAt: Date.now(),
      slot,
      name: worktree ? 'new worktree' : 'new session'
    }
    const args = ['--session-id', rec.claudeSessionId]
    if (worktree) args.push('--worktree')
    await this.o.tmux.newSession({ name: rec.tmuxName, cwd, command: this.claudeCommand(args), cols: SPAWN_COLS, rows: SPAWN_ROWS })
    this.records.push(rec)
    this.touchRecent(cwd)
    this.rt.set(id, { status: 'starting', attention: false, tmuxAlive: true, title: '', userDetached: false })
    this.attach(id)
    this.focusSlot = slot
    this.save()
    this.broadcast()
    return rec
  }

  async resume(id: string): Promise<void> {
    const rec = this.get(id)
    const r = this.rt.get(id)!
    if (rec.slot !== null) {
      this.focusSlot = rec.slot
      this.broadcast()
      return
    }
    const slot = this.freeSlot()
    if (slot === null) throw new Error(`All ${this.o.cap()} slots are open. Close one first.`)
    r.tmuxAlive = await this.o.tmux.hasSession(rec.tmuxName)
    if (!r.tmuxAlive) {
      if (!existsSync(rec.cwd)) throw new Error(`Folder no longer exists: ${rec.cwd}`)
      // Claude re-enters the session's worktree on --resume by itself; no -w here.
      await this.o.tmux.newSession({
        name: rec.tmuxName,
        cwd: rec.cwd,
        command: this.claudeCommand(['--resume', rec.claudeSessionId]),
        cols: SPAWN_COLS,
        rows: SPAWN_ROWS
      })
      r.tmuxAlive = true
      r.status = 'starting'
    }
    this.touchRecent(rec.cwd)
    rec.slot = slot
    this.attach(id)
    this.focusSlot = slot
    this.save()
    this.broadcast()
  }

  /** Close the tile; the tmux session and the Claude conversation stay resumable. */
  detach(slot: number): void {
    const rec = this.bySlot(slot)
    if (!rec) return
    const r = this.rt.get(rec.id)!
    r.userDetached = true
    if (r.pty) r.pty.kill() // handlePtyExit parks it
    else this.park(rec)
  }

  /** Kill the tmux session and forget the record entirely. */
  async kill(id: string): Promise<void> {
    const rec = this.get(id)
    const r = this.rt.get(id)
    if (r) {
      r.userDetached = true
      r.pty?.kill()
    }
    await this.o.tmux.killSession(rec.tmuxName)
    this.remove(id)
  }

  /** Drop a parked record (does not touch tmux; use kill for that). */
  forget(id: string): void {
    const rec = this.get(id)
    if (rec.slot !== null) throw new Error('Session is open; detach or kill it instead.')
    this.remove(id)
  }

  focus(slot: number): void {
    if (!this.bySlot(slot)) return
    this.focusSlot = slot
    this.broadcast()
  }

  cycle(dir: 1 | -1): void {
    const open = this.openSorted()
    if (open.length === 0) return
    const i = open.findIndex((s) => s.slot === this.focusSlot)
    const next = open[(i + dir + open.length) % open.length]
    this.focusSlot = next.slot
    this.broadcast()
  }

  jumpAttention(): void {
    const target = this.openSorted().find((s) => this.rt.get(s.id)?.attention && s.slot !== this.focusSlot)
    if (target) {
      this.focusSlot = target.slot
      this.broadcast()
    }
  }

  // ---- pty i/o -----------------------------------------------------------

  input(id: string, data: string): void {
    const r = this.rt.get(id)
    if (!r?.pty) return
    r.pty.write(data)
    if (r.attention) {
      r.attention = false
      this.broadcast()
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const r = this.rt.get(id)
    if (!r?.pty || cols < 2 || rows < 2) return
    r.cols = cols
    r.rows = rows
    try {
      r.pty.resize(cols, rows)
    } catch {
      /* pty already gone */
    }
  }

  setTitle(id: string, title: string): void {
    const r = this.rt.get(id)
    if (!r || r.title === title) return
    r.title = title
    this.broadcast()
  }

  bell(id: string): void {
    const r = this.rt.get(id)
    if (!r || r.attention) return
    r.attention = true
    this.broadcast()
  }

  // ---- external signals --------------------------------------------------

  onFleet(entries: FleetEntry[]): void {
    const byId = new Map(entries.filter((e) => e.sessionId).map((e) => [e.sessionId, e]))
    let changed = false
    for (const rec of this.records) {
      const r = this.rt.get(rec.id)
      if (!r) continue
      const e = byId.get(rec.claudeSessionId)
      if (e) {
        const status = normalizeStatus(e.status ?? e.state)
        if (status !== r.status) {
          r.status = status
          changed = true
        }
        if (e.name && e.name !== rec.name) {
          rec.name = e.name
          changed = true
        }
        if (status === 'blocked' && !r.attention) {
          r.attention = true
          changed = true
        }
      } else if (rec.slot !== null && r.pty && r.status !== 'starting') {
        // Open, attached, but Claude isn't listed: probably a dead pane (crash) or exited.
        void this.o.tmux.paneDead(rec.tmuxName).then((dead) => {
          if (dead && r.status !== 'dead') {
            r.status = 'dead'
            r.attention = true
            this.broadcast()
          }
        })
      }
    }
    if (changed) {
      this.save()
      this.broadcast()
    }
  }

  onHook(event: HookEvent, payload: HookPayload): void {
    const rec = this.records.find((x) => x.claudeSessionId === payload.session_id)
    if (!rec) return
    const r = this.rt.get(rec.id)
    if (!r) return
    switch (event) {
      case 'Notification':
        r.attention = true
        if (payload.notification_type === 'permission_prompt' || payload.notification_type === 'elicitation_dialog') r.status = 'blocked'
        break
      case 'Stop':
        r.attention = true
        r.status = 'idle'
        break
      case 'UserPromptSubmit':
        r.attention = false
        r.status = 'busy'
        break
    }
    this.broadcast()
  }

  // ---- state -------------------------------------------------------------

  getState(): DeckState {
    const views: SessionView[] = this.records.map((rec) => {
      const r = this.rt.get(rec.id)
      return {
        ...rec,
        name: r?.title || rec.name,
        status: r?.status ?? 'unknown',
        attention: r?.attention ?? false,
        attached: !!r?.pty,
        tmuxAlive: r?.tmuxAlive ?? false
      }
    })
    return {
      cap: this.o.cap(),
      focusSlot: this.focusSlot,
      open: views.filter((v) => v.slot !== null).sort((a, b) => a.slot! - b.slot!),
      parked: views.filter((v) => v.slot === null).sort((a, b) => b.createdAt - a.createdAt),
      recent: this.recent(),
      profile: this.o.profile
    }
  }

  /** The most recent start folders that still exist, for the "new session in…" menus. */
  recent(): string[] {
    return this.recentCwds.filter((d) => existsSync(d)).slice(0, RECENT_SHOW)
  }

  // ---- internals ---------------------------------------------------------

  private touchRecent(cwd: string): void {
    this.recentCwds = [cwd, ...this.recentCwds.filter((d) => d !== cwd)].slice(0, RECENT_KEEP)
  }

  private claudeCommand(args: string[]): string {
    // exec so the pane's process IS claude (clean exit → session ends → slot frees).
    const parts = ['claude', '--settings', this.o.hooksSettingsPath, ...args]
    return 'exec ' + parts.map(shq).join(' ')
  }

  private attach(id: string): void {
    const rec = this.get(id)
    const r = this.rt.get(id)!
    r.userDetached = false
    const p = pty.spawn('tmux', [...this.o.tmux.cliPrefix, 'attach-session', '-t', rec.tmuxName], {
      name: 'xterm-256color',
      cols: r.cols ?? SPAWN_COLS,
      rows: r.rows ?? SPAWN_ROWS,
      cwd: this.o.env.HOME ?? '/',
      env: this.o.env as Record<string, string>
    })
    r.pty = p
    p.onData((d) => this.o.events.data(id, d))
    p.onExit(() => void this.handlePtyExit(id))
  }

  private async handlePtyExit(id: string): Promise<void> {
    const r = this.rt.get(id)
    const rec = this.records.find((x) => x.id === id)
    if (!r || !rec) return
    r.pty = undefined
    this.o.events.exit(id)
    if (this.quitting) return
    const alive = await this.o.tmux.hasSession(rec.tmuxName)
    r.tmuxAlive = alive
    if (alive && !r.userDetached) {
      // The tmux client died but the session is fine (rare): reattach in place.
      this.attach(id)
      return
    }
    this.park(rec)
  }

  private park(rec: SessionRecord): void {
    const r = this.rt.get(rec.id)
    if (r) {
      r.attention = false
      r.status = 'idle'
      r.userDetached = false
    }
    if (rec.slot !== null) {
      if (this.focusSlot === rec.slot) this.focusSlot = null
      rec.slot = null
    }
    this.ensureFocus()
    this.save()
    this.broadcast()
  }

  private remove(id: string): void {
    const rec = this.records.find((x) => x.id === id)
    this.records = this.records.filter((x) => x.id !== id)
    this.rt.delete(id)
    if (rec && rec.slot !== null && this.focusSlot === rec.slot) this.focusSlot = null
    this.ensureFocus()
    this.save()
    this.broadcast()
  }

  private ensureFocus(): void {
    if (this.focusSlot !== null && this.bySlot(this.focusSlot)) return
    const open = this.openSorted()
    const needy = open.find((s) => this.rt.get(s.id)?.attention)
    this.focusSlot = (needy ?? open[0])?.slot ?? null
  }

  private freeSlot(): number | null {
    const used = new Set(this.records.map((r) => r.slot))
    for (let n = 1; n <= this.o.cap(); n++) if (!used.has(n)) return n
    return null
  }

  private focusedCwd(): string | null {
    const rec = this.focusSlot !== null ? this.bySlot(this.focusSlot) : null
    return rec && existsSync(rec.cwd) ? rec.cwd : null
  }

  private openSorted(): SessionRecord[] {
    return this.records.filter((r) => r.slot !== null).sort((a, b) => a.slot! - b.slot!)
  }

  private bySlot(slot: number): SessionRecord | undefined {
    return this.records.find((r) => r.slot === slot)
  }

  private get(id: string): SessionRecord {
    const rec = this.records.find((r) => r.id === id)
    if (!rec) throw new Error(`No such session: ${id}`)
    return rec
  }

  private load(): void {
    try {
      if (!existsSync(this.storePath)) return
      const raw = JSON.parse(readFileSync(this.storePath, 'utf8')) as { records?: SessionRecord[]; focusSlot?: number | null; recentCwds?: string[] }
      this.records = (raw.records ?? []).filter((r) => r && r.id && r.tmuxName && r.claudeSessionId)
      this.focusSlot = raw.focusSlot ?? null
      if (Array.isArray(raw.recentCwds)) {
        this.recentCwds = raw.recentCwds.filter((d): d is string => typeof d === 'string' && d.length > 0).slice(0, RECENT_KEEP)
      } else {
        // First run with this field: seed it from the sessions we already know about, newest first.
        for (const rec of [...this.records].sort((a, b) => a.createdAt - b.createdAt)) this.touchRecent(rec.cwd)
      }
    } catch (err) {
      console.warn('[deck] could not read sessions.json:', err)
      this.records = []
    }
  }

  private save(): void {
    try {
      writeFileSync(this.storePath, JSON.stringify({ records: this.records, focusSlot: this.focusSlot, recentCwds: this.recentCwds }, null, 2))
    } catch (err) {
      console.warn('[deck] could not write sessions.json:', err)
    }
  }

  private broadcast(): void {
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      this.o.events.state(this.getState())
    }, 30)
  }
}

function normalizeStatus(raw: string | undefined): SessionStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'busy':
    case 'working':
    case 'running':
      return 'busy'
    case 'idle':
    case 'completed':
    case 'stopped':
      return 'idle'
    case 'blocked':
    case 'waiting':
    case 'needs_input':
    case 'needs-input':
      return 'blocked'
    case 'failed':
    case 'error':
      return 'dead'
    default:
      return 'unknown'
  }
}
