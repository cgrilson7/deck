// The session manager: CAP sticky slots, one tmux session + one pty per open session,
// parked sessions resumable by tmux (if alive) or by `claude --resume <id>`.
// State is authoritative here; the renderer is a view and sends commands.

import * as pty from 'node-pty'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { BETA_SLOT_BASE, type DeckState, type PackRef, type SessionRecord, type SessionStatus, type SessionView } from '@shared/types'
import { cleanModel, cleanPermissionMode } from '@shared/models'
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
  /** A beta paused from the deck (main/agents.ts holds its tool calls); shown on the view. */
  paused?: boolean
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
  /** The deck's Claude Code plugin (the wolfpack skill + its CLI), `--plugin-dir` on every session. */
  pluginDir: string
  profile: string
  /** Live settings: where a new session starts when nothing is focused, the --worktree default, and the --model default ('' = none). */
  defaults: () => { cwd: string; worktree: boolean; model: string }
  /** Live slot cap for top-level sessions (CAP today; betas sit above it, see BETA_SLOT_BASE). */
  cap: () => number
  events: SessionEvents
}

const SPAWN_COLS = 120
const SPAWN_ROWS = 40
/** Bracketed paste lands first; ⏎ follows a beat later (what TilePrompt does in the renderer). */
const PASTE_ENTER_MS = 40

export interface NewSessionOpts {
  cwd?: string
  worktree?: boolean
  /** What to hand `--model`; '' = nothing; undefined = the `defaultModel` setting. */
  model?: string
  /** A wolfpack beta: a cell of its own behind the sessions, slotted above the ⌘ range, focus left where it is. */
  pack?: PackRef
  /** The CLI's `--name` (the fleet listing's name): a beta's task. */
  name?: string
  /** The first prompt, handed to the CLI as its positional argument so nothing races the TUI. */
  prompt?: string
  /** `--permission-mode`, as the CLI takes it (acceptEdits, plan, …); anything not in PERMISSION_MODES is dropped. */
  permissionMode?: string
  /** A NEW PROJECT: make `cwd` (and its parents) when it does not exist yet, instead of refusing. */
  create?: boolean
  /** With `create`: `git init` the folder unless it is already inside a repository. */
  gitInit?: boolean
  /** False = the focus stays where it is (a beta never takes it either). Default true. */
  focus?: boolean
}

/** `~` and `~/x` as the shell would read them; anything else as given, resolved. */
export function expandHome(p: string): string {
  const t = p.trim()
  if (t === '~') return homedir()
  if (t.startsWith('~/')) return join(homedir(), t.slice(2))
  return resolve(t)
}
/** How many start folders we remember (sessions.json) and how many of those the UI offers. */
const RECENT_KEEP = 10
export const RECENT_SHOW = 6

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
      if (rec.slot !== null && !rec.pack && rec.slot > this.cap()) rec.slot = null // cap shrank since this was saved
      if (rec.slot !== null) {
        if (alive) this.attach(rec.id)
        else rec.slot = null // tmux server gone (reboot); parked, resumable via --resume
      }
    }
    // A beta only shows inside its alpha's tile: with the alpha parked, so is the beta.
    for (const rec of this.records) {
      if (rec.pack && rec.slot !== null && !this.isOpen(rec.pack.alpha)) this.detach(rec.slot)
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

  async newSession(opts: NewSessionOpts): Promise<SessionRecord> {
    if (opts.pack) {
      const alpha = this.records.find((r) => r.id === opts.pack!.alpha)
      if (!alpha || alpha.slot === null) throw new Error('The alpha is not open.')
      if (alpha.pack) throw new Error('A beta cannot run a pack of its own.')
    }
    const slot = opts.pack ? this.freeBetaSlot() : this.freeSlot()
    if (slot === null) throw new Error(`All ${this.cap()} slots are open. Close one first.`)
    const defaults = this.o.defaults()
    const cwd = expandHome(opts.cwd ?? this.focusedCwd() ?? defaults.cwd)
    if (opts.create) {
      // A fresh project folder (the launcher's "new project"): made here, so the CLI starts inside it.
      if (existsSync(cwd) && !statSync(cwd).isDirectory()) throw new Error(`Not a folder: ${cwd}`)
      mkdirSync(cwd, { recursive: true })
      if (opts.gitInit) await this.gitInit(cwd)
    }
    if (!existsSync(cwd)) throw new Error(`Folder does not exist: ${cwd}`)
    const worktree = opts.worktree ?? defaults.worktree
    const model = cleanModel(opts.model ?? defaults.model)
    const permissionMode = cleanPermissionMode(opts.permissionMode)
    const id = randomBytes(3).toString('hex')
    const rec: SessionRecord = {
      id,
      tmuxName: `deck-${id}`,
      claudeSessionId: randomUUID(),
      cwd,
      worktree,
      model,
      ...(permissionMode ? { permissionMode } : {}),
      createdAt: Date.now(),
      slot,
      name: opts.name || opts.pack?.task || (worktree ? 'new worktree' : 'new session'),
      ...(opts.pack ? { pack: opts.pack } : {})
    }
    const args = ['--session-id', rec.claudeSessionId]
    if (worktree) args.push('--worktree')
    if (model) args.push('--model', model)
    if (opts.name) args.push('--name', opts.name)
    if (permissionMode) args.push('--permission-mode', permissionMode)
    if (opts.prompt) args.push(opts.prompt)
    await this.o.tmux.newSession({ name: rec.tmuxName, cwd, command: this.claudeCommand(args), cols: SPAWN_COLS, rows: SPAWN_ROWS })
    this.records.push(rec)
    if (!opts.pack) this.touchRecent(cwd)
    this.rt.set(id, { status: 'starting', attention: false, tmuxAlive: true, title: '', userDetached: false })
    this.attach(id)
    // A beta joins quietly: the alpha (usually the one you are talking to) keeps the focus. So does
    // a session asked for without it (the Studio's chat, which shows inside the Studio pane).
    if (!opts.pack && opts.focus !== false) this.focusSlot = slot
    this.save()
    this.broadcast()
    return rec
  }

  /** `git init` a fresh project folder, unless it already sits inside a repository. The login shell's env finds git. */
  private gitInit(cwd: string): Promise<void> {
    return new Promise((done, fail) => {
      execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd, env: this.o.env }, (err) => {
        if (!err) return done()
        execFile('git', ['init', '-q'], { cwd, env: this.o.env }, (e2, _out, stderr) => (e2 ? fail(new Error(`git init failed: ${String(stderr || e2.message).trim()}`)) : done()))
      })
    })
  }

  async resume(id: string): Promise<void> {
    const rec = this.get(id)
    const r = this.rt.get(id)!
    if (rec.slot !== null) {
      this.focusSlot = rec.slot
      this.broadcast()
      return
    }
    // A beta whose alpha is gone comes back as a session of its own.
    if (rec.pack && !this.isOpen(rec.pack.alpha)) delete rec.pack
    const slot = rec.pack ? this.freeBetaSlot() : this.freeSlot()
    if (slot === null) throw new Error(`All ${this.cap()} slots are open. Close one first.`)
    r.tmuxAlive = await this.o.tmux.hasSession(rec.tmuxName)
    if (!r.tmuxAlive) {
      if (!existsSync(rec.cwd)) throw new Error(`Folder no longer exists: ${rec.cwd}`)
      // Claude re-enters the session's worktree on --resume by itself; no -w here. The model is
      // ours to repeat: --resume alone would fall back to the CLI's default.
      const args = ['--resume', rec.claudeSessionId]
      if (rec.model) args.push('--model', rec.model)
      if (rec.permissionMode) args.push('--permission-mode', rec.permissionMode)
      await this.o.tmux.newSession({
        name: rec.tmuxName,
        cwd: rec.cwd,
        command: this.claudeCommand(args),
        cols: SPAWN_COLS,
        rows: SPAWN_ROWS
      })
      r.tmuxAlive = true
      r.status = 'starting'
    }
    if (!rec.pack) this.touchRecent(rec.cwd)
    rec.slot = slot
    this.attach(id)
    if (!rec.pack) this.focusSlot = slot
    this.save()
    this.broadcast()
    // An alpha brings back the betas that are still running in tmux (a dead beta is left parked).
    for (const beta of this.betasOf(id, false)) {
      if (await this.o.tmux.hasSession(beta.tmuxName)) await this.resume(beta.id).catch((err) => console.warn('[deck] beta did not resume:', err))
    }
  }

  /** Close the tile; the tmux session and the Claude conversation stay resumable. An alpha parks its betas too. */
  detach(slot: number): void {
    const rec = this.bySlot(slot)
    if (!rec) return
    for (const beta of this.betasOf(rec.id)) this.detach(beta.slot!)
    const r = this.rt.get(rec.id)!
    r.userDetached = true
    if (r.pty) r.pty.kill() // handlePtyExit parks it
    else this.park(rec)
  }

  /** Kill the tmux session and forget the record entirely. An alpha takes its betas with it. */
  async kill(id: string): Promise<void> {
    const rec = this.get(id)
    for (const beta of this.betasOf(id, false)) await this.kill(beta.id)
    const r = this.rt.get(id)
    if (r) {
      r.userDetached = true
      r.pty?.kill()
    }
    await this.o.tmux.killSession(rec.tmuxName)
    this.remove(id)
  }

  /** End a wolfpack: kill its betas, or park them so their conversations can be picked up. */
  async dismissPack(alpha: string, park: boolean, only?: string[]): Promise<void> {
    const betas = this.betasOf(alpha).filter((b) => !only || only.includes(b.id))
    for (const beta of betas) {
      if (park) this.detach(beta.slot!)
      else await this.kill(beta.id)
    }
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

  /** The leash's paused flag on a session's view (the tracker holds the tool calls; this only shows it). */
  setPaused(id: string, on: boolean): void {
    const r = this.rt.get(id)
    if (!r || !!r.paused === on) return
    r.paused = on
    this.broadcast()
  }

  /** Paste a prompt into a session and submit it (bracketed paste, then ⏎ a beat later). */
  paste(id: string, text: string): void {
    this.input(id, `\x1b[200~${text}\x1b[201~`)
    setTimeout(() => this.input(id, '\r'), PASTE_ENTER_MS)
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

  /** The tmux session behind a deck id (the phone's screen view reads it), null when unknown. */
  tmuxNameOf(id: string): string | null {
    return this.records.find((r) => r.id === id)?.tmuxName ?? null
  }

  /** The folder a session was started in, null for an unknown id. */
  cwdOf(id: string): string | null {
    return this.records.find((r) => r.id === id)?.cwd ?? null
  }

  /** The record behind a deck id, or the one that was handed this Claude session id; null when unknown. */
  find(ref: { id?: string; claudeSessionId?: string; tmuxName?: string }): SessionRecord | null {
    return this.records.find((r) => (ref.id && r.id === ref.id) || (ref.claudeSessionId && r.claudeSessionId === ref.claudeSessionId) || (ref.tmuxName && r.tmuxName === ref.tmuxName)) ?? null
  }

  /** The live view of one session, null when unknown. */
  view(id: string): SessionView | null {
    return this.getState().open.find((s) => s.id === id) ?? this.getState().parked.find((s) => s.id === id) ?? null
  }

  /** An alpha's betas: the open ones (default), or every one it ever had, parked included. */
  betasOf(alpha: string, openOnly = true): SessionRecord[] {
    return this.records.filter((r) => r.pack?.alpha === alpha && (!openOnly || r.slot !== null))
  }

  isOpen(id: string): boolean {
    const rec = this.records.find((r) => r.id === id)
    return !!rec && rec.slot !== null
  }

  private cap(): number {
    return this.o.cap()
  }

  getState(): DeckState {
    const views: SessionView[] = this.records.map((rec) => {
      const r = this.rt.get(rec.id)
      return {
        ...rec,
        name: r?.title || rec.name,
        status: r?.status ?? 'unknown',
        attention: r?.attention ?? false,
        attached: !!r?.pty,
        tmuxAlive: r?.tmuxAlive ?? false,
        paused: r?.paused ?? false
      }
    })
    return {
      cap: this.cap(),
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
    // --settings merges with the user's own; --plugin-dir adds ours beside their installed plugins.
    const parts = ['claude', '--settings', this.o.hooksSettingsPath, '--plugin-dir', this.o.pluginDir, ...args]
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
    // However the alpha went (⌘W, or its Claude exiting), the betas have no tile to live in.
    for (const beta of this.betasOf(rec.id)) this.detach(beta.slot!)
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
    // A top-level session before a beta, one needing you before the rest.
    const open = this.openSorted().sort((a, b) => Number(!!a.pack) - Number(!!b.pack))
    const needy = open.find((s) => this.rt.get(s.id)?.attention)
    this.focusSlot = (needy ?? open[0])?.slot ?? null
  }

  private freeSlot(): number | null {
    const used = new Set(this.records.map((r) => r.slot))
    for (let n = 1; n <= this.cap(); n++) if (!used.has(n)) return n
    return null
  }

  /** Betas are slotted from BETA_SLOT_BASE up: sticky like the rest, outside the cap and the ⌘ keys. */
  private freeBetaSlot(): number {
    const used = new Set(this.records.map((r) => r.slot))
    let n = BETA_SLOT_BASE + 1
    while (used.has(n)) n++
    return n
  }

  private focusedCwd(): string | null {
    const rec = this.focusSlot !== null ? this.bySlot(this.focusSlot) : null
    return rec && existsSync(rec.cwd) ? rec.cwd : null
  }

  /** The folder a session's pane is in now (a --worktree session's worktree), else the folder it was started in. */
  async liveCwd(id: string): Promise<string | null> {
    const rec = this.records.find((r) => r.id === id)
    if (!rec) return null
    return (await this.o.tmux.paneCwd(rec.tmuxName)) ?? rec.cwd
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
