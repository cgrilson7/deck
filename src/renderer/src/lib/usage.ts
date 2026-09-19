// Usage as the renderer sees it (main/usage.ts): the account's two rate-limit windows and each
// session's context %, fetched once and then pushed on every change. One subscription for the
// whole window, so the header's meters and every tile's context badge read the same state.

import { useSyncExternalStore } from 'react'
import type { DeckUsage } from '@shared/types'

let usage: DeckUsage = { fiveHour: null, sevenDay: null, at: 0, context: {} }
const subs = new Set<() => void>()
let started = false

function start(): void {
  if (started) return
  started = true
  const set = (u: DeckUsage) => {
    usage = u
    for (const f of subs) f()
  }
  void window.deck.usage().then(set)
  window.deck.onUsage(set)
}

export function useUsage(): DeckUsage {
  return useSyncExternalStore(
    (f) => {
      start()
      subs.add(f)
      return () => subs.delete(f)
    },
    () => usage
  )
}

/** Amber from here, red from there: for a rate-limit window and for a context window alike. */
export const USAGE_WARN = 70
export const USAGE_HOT = 90

export function usageLevel(pct: number): 'ok' | 'warn' | 'hot' {
  return pct >= USAGE_HOT ? 'hot' : pct >= USAGE_WARN ? 'warn' : 'ok'
}

/** Time LEFT until a window starts over, short: "2h 14m", "47m", "3d 4h". */
export function left(resetsAt: number, now: number): string {
  const m = Math.max(0, Math.round((resetsAt - now) / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
