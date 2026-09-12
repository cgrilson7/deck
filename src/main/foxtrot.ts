// Foxtrot, the head: one watcher over every session, keeping a running log of what he sees.
//
// Phase one is senses only — rules over signals deck already has, no model: the session state
// SessionManager broadcasts (status, attention, focus, open / parked) and the transcripts main
// tails (your prompts, tool calls with the paths they touched, their results). Most of what he
// sees is a `note` for the log. A few things are `bark`s, because they want you, and those are
// what the top bar shows and what makes him bark: a permission prompt nobody has answered, a
// finished turn nobody has looked at, two sessions editing the same file, a run of tool errors,
// a Claude that exited. Barks are rare on purpose — each fires once per episode, and waits that
// cross their threshold together are told together.
//
// Everything is appended to userData/foxtrot.jsonl, so the log outlives a restart.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { DeckState, FoxEntry, FoxKind, SessionView, Transcript } from '@shared/types'

/** Entries kept in memory (and handed to the renderer at most). */
const KEEP = 1000
/** Past this many lines on disk, the file is rewritten with the last COMPACT_TO. */
const COMPACT_AT = 5000
const COMPACT_TO = 2000
/** Session state settles for this long after boot (records load, tmux answers) before diffs mean anything. */
const BOOT_GRACE_MS = 6000
const TICK_MS = 30_000
/** Turns shorter than this are not worth a line. */
const TURN_MIN_MS = 20_000
/** A permission prompt unanswered this long (in a session you are not looking at) is a bark. */
const BLOCKED_MS = 4 * 60_000
/** A session waiting on you (a finished turn, a notification) that you have not focused since, this long, is a bark. */
const UNREAD_MS = 15 * 60_000
/** Tool errors in a row that make a bark. */
const ERROR_RUN = 3
/** Two sessions editing one file within this window collide. */
const COLLIDE_MS = 45 * 60_000

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** An episode being timed: when it began, and whether he has said so yet. */
interface Watch {
  since: number
  told: boolean
}

/** What he has already taken in from one session's transcript. */
interface Seen {
  tools: Set<string>
  done: Set<string>
  errors: number
  told: boolean
  lastPrompt: number
}

export class Foxtrot {
  private readonly file: string
  private readonly emit: (e: FoxEntry) => void
  private readonly born = Date.now()
  private entries: FoxEntry[] = []
  private lines = 0
  private seq = 0
  private awake = false
  private timer: NodeJS.Timeout
  private bootTimer: NodeJS.Timeout
  /** Every session seen this run (open or parked), for naming ones that have since closed. */
  private views = new Map<string, SessionView>()
  private open = new Map<string, SessionView>()
  private focusSlot: number | null = null
  private turnSince = new Map<string, number>()
  private blocked = new Map<string, Watch>()
  private unread = new Map<string, Watch>()
  private seen = new Map<string, Seen>()
  /** path → session id → last edit. */
  private edits = new Map<string, Map<string, number>>()
  /** collision key → when it was told. */
  private told = new Map<string, number>()

  constructor(userData: string, emit: (e: FoxEntry) => void) {
    this.file = join(userData, 'foxtrot.jsonl')
    this.emit = emit
    this.load()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref()
    this.bootTimer = setTimeout(() => this.wake(), BOOT_GRACE_MS)
    this.bootTimer.unref()
  }

  /** The log, newest last. */
  log(limit = 500): FoxEntry[] {
    const n = Math.max(1, Math.min(Number(limit) || 500, KEEP))
    return this.entries.slice(-n)
  }

  stop(): void {
    clearInterval(this.timer)
    clearTimeout(this.bootTimer)
  }

  // ---- senses: session state ---------------------------------------------

  onState(state: DeckState): void {
    const now = Date.now()
    for (const s of [...state.parked, ...state.open]) this.views.set(s.id, s)
    const open = new Map(state.open.map((s) => [s.id, s]))
    const parked = new Set(state.parked.map((s) => s.id))

    if (this.awake) {
      for (const s of state.open) {
        if (!this.open.has(s.id)) this.add('note', 'opened', `${cap(who(s))} opened in ${tilde(s.cwd)}${s.worktree ? ', in a worktree' : ''}.`, [s.id])
      }
      for (const [id, was] of this.open) {
        if (open.has(id)) continue
        this.add('note', 'closed', `${cap(who(was))} ${parked.has(id) ? 'was parked' : 'closed'}.`, [id])
        this.forget(id)
      }
    }

    for (const s of state.open) {
      const p = this.open.get(s.id)
      const looking = s.slot === state.focusSlot
      if (s.status === 'busy' && p?.status !== 'busy' && p?.status !== 'blocked') this.turnSince.set(s.id, now)
      if (p?.status === 'busy' && s.status === 'idle') {
        const took = now - (this.turnSince.get(s.id) ?? now)
        if (this.awake && took >= TURN_MIN_MS) this.add('note', 'finished', `${cap(who(s))} finished a turn after ${duration(took)}.`, [s.id])
      }
      // Waiting on you starts when attention does (Stop or a Notification hook, whichever beat
      // the fleet poll), in a session you are not looking at. Ones already waiting at boot are old news.
      if (this.awake && p && s.attention && !p.attention && !looking && s.status !== 'blocked' && s.status !== 'dead') {
        this.unread.set(s.id, { since: now, told: false })
      }
      if (s.status === 'blocked') {
        if (!this.blocked.has(s.id)) this.blocked.set(s.id, { since: now, told: false })
      } else this.blocked.delete(s.id)
      if (this.awake && s.status === 'dead' && p && p.status !== 'dead') this.add('bark', 'died', `${cap(who(s))}: Claude exited.`, [s.id])
      // Looking at it, or talking to it, is what "unread" was waiting for.
      if (looking || s.status === 'busy' || s.status === 'blocked' || !s.attention) this.unread.delete(s.id)
    }
    this.open = open
    this.focusSlot = state.focusSlot
  }

  // ---- senses: transcripts ------------------------------------------------

  onTranscript(t: Transcript): void {
    const s = this.open.get(t.id)
    if (!s) return
    let seen = this.seen.get(t.id)
    if (!seen) {
      seen = { tools: new Set(), done: new Set(), errors: 0, told: false, lastPrompt: 0 }
      this.seen.set(t.id, seen)
    }
    for (const b of t.blocks) {
      // History from before he woke up is taken in silently; only what happens now is news.
      const fresh = b.ts >= this.born
      if (b.kind === 'user') {
        if (fresh && b.ts > seen.lastPrompt) {
          seen.lastPrompt = b.ts
          this.add('note', 'prompt', `You to ${who(s)}: “${clip(b.text.replace(/\s+/g, ' '), 110)}”`, [t.id])
        }
        continue
      }
      if (b.kind !== 'tool') continue
      if (!seen.tools.has(b.id)) {
        seen.tools.add(b.id)
        if (fresh && b.path && EDIT_TOOLS.has(b.name)) this.edited(t.id, b.path, b.ts)
      }
      if (b.done && !seen.done.has(b.id)) {
        seen.done.add(b.id)
        if (!fresh) continue
        if (!b.error) {
          seen.errors = 0
          seen.told = false
          continue
        }
        seen.errors += 1
        if (seen.errors >= ERROR_RUN && !seen.told) {
          seen.told = true
          this.add('bark', 'errors', `${cap(who(s))} has hit ${seen.errors} tool errors in a row (the last one in ${b.name}).`, [t.id])
        }
      }
    }
  }

  /** One session edited `path`: if another open one did too, lately, that is a collision. */
  private edited(id: string, path: string, ts: number): void {
    let bySession = this.edits.get(path)
    if (!bySession) {
      bySession = new Map()
      this.edits.set(path, bySession)
    }
    bySession.set(id, ts)
    for (const [other, when] of bySession) {
      if (other === id || ts - when > COLLIDE_MS) continue
      const a = this.open.get(id)
      const b = this.open.get(other)
      if (!a || !b) continue
      const key = [path, ...[id, other].sort()].join('\0')
      if (Date.now() - (this.told.get(key) ?? 0) < COLLIDE_MS) continue
      this.told.set(key, Date.now())
      const [first, second] = (a.slot ?? 0) < (b.slot ?? 0) ? [a, b] : [b, a]
      this.add('bark', 'collision', `${cap(who(first))} and ${who(second)} are both editing ${basename(path)}.`, [first.id, second.id], [path])
    }
  }

  // ---- the clock: episodes that have gone on too long -----------------------

  private wake(): void {
    this.awake = true
    const n = this.open.size
    this.add('note', 'boot', n ? `Up, and watching ${n} session${n === 1 ? '' : 's'}.` : 'Up. No sessions open yet.', [...this.open.keys()])
  }

  private tick(): void {
    if (!this.awake) return
    const now = Date.now()
    const due = (m: Map<string, Watch>, ms: number) => {
      const ids: string[] = []
      for (const [id, w] of m) {
        const s = this.open.get(id)
        if (!s || w.told || now - w.since < ms || s.slot === this.focusSlot) continue
        w.told = true
        ids.push(id)
      }
      return ids.sort((x, y) => (this.open.get(x)?.slot ?? 0) - (this.open.get(y)?.slot ?? 0))
    }
    const blocked = due(this.blocked, BLOCKED_MS)
    if (blocked.length === 1) {
      const w = this.blocked.get(blocked[0])!
      this.add('bark', 'blocked', `${cap(who(this.open.get(blocked[0])!))} has been waiting on a permission prompt for ${duration(now - w.since)}.`, blocked)
    } else if (blocked.length > 1) {
      this.add('bark', 'blocked', `${cap(list(blocked.map((id) => who(this.open.get(id)!))))} are all waiting on permission prompts.`, blocked)
    }
    const unread = due(this.unread, UNREAD_MS)
    if (unread.length === 1) {
      const w = this.unread.get(unread[0])!
      this.add('bark', 'unread', `${cap(who(this.open.get(unread[0])!))} has been waiting on you for ${duration(now - w.since)} and you haven't looked.`, unread)
    } else if (unread.length > 1) {
      this.add('bark', 'unread', `${cap(list(unread.map((id) => who(this.open.get(id)!))))} are all waiting on you, and you haven't looked.`, unread)
    }
    // Old edits can no longer collide.
    for (const [path, bySession] of this.edits) {
      for (const [id, when] of bySession) if (now - when > COLLIDE_MS) bySession.delete(id)
      if (bySession.size === 0) this.edits.delete(path)
    }
  }

  private forget(id: string): void {
    this.turnSince.delete(id)
    this.blocked.delete(id)
    this.unread.delete(id)
    this.seen.delete(id)
    for (const bySession of this.edits.values()) bySession.delete(id)
  }

  // ---- the log ----------------------------------------------------------------

  private add(level: FoxEntry['level'], kind: FoxKind, text: string, sessions: string[], paths?: string[]): void {
    const ts = Date.now()
    const e: FoxEntry = { id: `${ts.toString(36)}-${(this.seq++).toString(36)}`, ts, level, kind, text, sessions, ...(paths ? { paths } : {}) }
    this.entries.push(e)
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP)
    try {
      appendFileSync(this.file, JSON.stringify(e) + '\n')
      if (++this.lines > COMPACT_AT) this.compact()
    } catch (err) {
      console.warn('[deck] foxtrot could not write his log:', err)
    }
    this.emit(e)
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const rows = readFileSync(this.file, 'utf8').split('\n').filter(Boolean)
      this.lines = rows.length
      for (const row of rows.slice(-KEEP)) {
        try {
          const e = JSON.parse(row) as FoxEntry
          if (e && typeof e.text === 'string' && typeof e.ts === 'number') this.entries.push(e)
        } catch {
          /* a torn line: skip it */
        }
      }
      if (this.lines > COMPACT_AT) this.compact()
    } catch (err) {
      console.warn('[deck] foxtrot could not read his log:', err)
    }
  }

  private compact(): void {
    const keep = this.entries.slice(-COMPACT_TO)
    writeFileSync(this.file, keep.map((e) => JSON.stringify(e)).join('\n') + '\n')
    this.lines = keep.length
  }
}

// ---- words ------------------------------------------------------------------

/** How a session is named in a sentence: `slot 4 “fix the hooks”`. */
function who(s: SessionView): string {
  const name = clip(s.name.replace(/^[^\p{L}\p{N}]+/u, '').trim(), 32)
  const slot = s.slot !== null ? `slot ${s.slot}` : 'a parked session'
  return name ? `${slot} “${name}”` : slot
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function list(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

function tilde(p: string): string {
  const home = homedir()
  return p === home ? '~' : p.startsWith(home + '/') ? `~${p.slice(home.length)}` : p
}

function duration(ms: number): string {
  if (ms < 90_000) return `${Math.max(1, Math.round(ms / 1000))} seconds`
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h}h ${rest}m` : `${h} hour${h === 1 ? '' : 's'}`
}
