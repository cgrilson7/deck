// USAGE: what the account has left, as Claude Code itself reports it. Every deck session's status
// line (the `statusLine` of our --settings file, main/hooks.ts) POSTs the CLI's status JSON to
// `/status`: `rate_limits.five_hour / seven_day` (claude.ai subscribers, after a session's first
// API response; `used_percentage` 0–100, `resets_at` epoch seconds) and that session's
// `context_window.used_percentage`. Ten sessions share one account, so the windows are ONE pair
// for the deck: each session only knows them as of its own last response, so the newest window
// wins (the later `resets_at`) and, within a window, the highest percentage (it only climbs).
// These are the CLI's own numbers, never an estimate of ours. The windows are kept in
// userData/usage.json so a restart does not blank the header; context is per session, in memory.

import { readFileSync, writeFileSync } from 'node:fs'
import type { DeckUsage, UsageWindow } from '@shared/types'

interface StatusPayload {
  session_id?: string
  context_window?: { used_percentage?: number | null }
  rate_limits?: Record<string, { used_percentage?: number; resets_at?: number } | undefined>
}

export class UsageTracker {
  private fiveHour: UsageWindow | null = null
  private sevenDay: UsageWindow | null = null
  private at = 0
  private readonly context = new Map<string, number>()
  private last = ''

  constructor(
    private readonly file: string,
    /** A Claude session id → the deck session's id (null = not one of ours). */
    private readonly deckId: (claudeSessionId: string) => string | null,
    private readonly push: (u: DeckUsage) => void
  ) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<DeckUsage>
      this.fiveHour = win(raw.fiveHour)
      this.sevenDay = win(raw.sevenDay)
      this.at = Number(raw.at) || 0
    } catch {
      /* nothing kept yet */
    }
  }

  /** `POST /status`: one session's status JSON. */
  onStatus(body: unknown): void {
    const p = (body ?? {}) as StatusPayload
    const id = p.session_id ? this.deckId(p.session_id) : null
    if (!id) return
    const ctx = p.context_window?.used_percentage
    if (typeof ctx === 'number' && isFinite(ctx)) this.context.set(id, Math.round(ctx))
    const five = newer(this.fiveHour, p.rate_limits?.five_hour)
    const seven = newer(this.sevenDay, p.rate_limits?.seven_day)
    if (five !== this.fiveHour || seven !== this.sevenDay) {
      this.fiveHour = five
      this.sevenDay = seven
      this.at = Date.now()
      try {
        writeFileSync(this.file, JSON.stringify({ fiveHour: five, sevenDay: seven, at: this.at }))
      } catch {
        /* the header still has it */
      }
    }
    const u = this.get()
    const key = JSON.stringify([u.fiveHour, u.sevenDay, u.context])
    if (key === this.last) return
    this.last = key
    this.push(u)
  }

  /** A session that is gone takes its context figure with it. */
  forget(id: string): void {
    this.context.delete(id)
  }

  get(): DeckUsage {
    // A window whose reset has passed says nothing about the one that followed.
    const live = (w: UsageWindow | null) => (w && w.resetsAt > Date.now() ? w : null)
    return { fiveHour: live(this.fiveHour), sevenDay: live(this.sevenDay), at: this.at, context: Object.fromEntries(this.context) }
  }
}

function win(w: unknown): UsageWindow | null {
  const x = w as UsageWindow | null | undefined
  return x && typeof x.pct === 'number' && typeof x.resetsAt === 'number' ? { pct: x.pct, resetsAt: x.resetsAt } : null
}

/** `cur`, or what a session just reported when that is a later window or further into the same one. */
function newer(cur: UsageWindow | null, got: { used_percentage?: number; resets_at?: number } | undefined): UsageWindow | null {
  if (!got || typeof got.used_percentage !== 'number' || typeof got.resets_at !== 'number') return cur
  const next = { pct: Math.round(got.used_percentage * 10) / 10, resetsAt: got.resets_at * 1000 }
  if (next.resetsAt <= Date.now()) return cur
  if (!cur || cur.resetsAt <= Date.now()) return next
  // The same window a minute apart in two sessions' clocks is still the same window.
  if (next.resetsAt > cur.resetsAt + 60_000) return next
  if (next.resetsAt < cur.resetsAt - 60_000) return cur
  return next.pct > cur.pct ? next : cur
}
