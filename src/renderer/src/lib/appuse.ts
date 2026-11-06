import { useSyncExternalStore } from 'react'
import { lessonTileOf, molTileOf } from '@shared/types'

// When each mini app / web app was first put in the grid and last used, for the right +'s list.
// Keyed by the APP, not the tile: `mol:3` and `lesson:2` count as `mol` / `lesson`, a web app is
// `web:<id>`. "Used" = a pointer down anywhere in its cell, or placing it from the picker. Kept in
// localStorage (a convenience: losing it costs only the dates).

const KEY = 'deck.apps.use'

export interface AppUse {
  /** Epoch ms it was first seen in the grid (or placed). */
  created: number
  /** Epoch ms of the last click in its tile; 0 = never. */
  used: number
}

let table: Record<string, AppUse> | null = null
const subs = new Set<() => void>()

function load(): Record<string, AppUse> {
  if (table) return table
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    table = raw && typeof raw === 'object' ? raw : {}
  } catch {
    table = {}
  }
  return table!
}

function write(next: Record<string, AppUse>): void {
  table = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
  for (const s of subs) s()
}

/** A grid key → the app it belongs to. */
export function appOf(key: string): string {
  return molTileOf(key) !== null ? 'mol' : lessonTileOf(key) !== null ? 'lesson' : key
}

/** Showing in the grid: given a creation date if it has none. */
export function seenApps(keys: string[]): void {
  const t = load()
  const now = Date.now()
  const missing = [...new Set(keys.map(appOf))].filter((k) => !t[k])
  if (!missing.length) return
  write({ ...t, ...Object.fromEntries(missing.map((k) => [k, { created: now, used: 0 }])) })
}

/** Used now (created too, if it never was). Writes at most once a second per app. */
export function touchApp(key: string): void {
  const app = appOf(key)
  const t = load()
  const now = Date.now()
  if (t[app] && now - t[app].used < 1000) return
  write({ ...t, [app]: { created: t[app]?.created ?? now, used: now } })
}

/** A web app removed: its dates go with it. */
export function forgetApp(key: string): void {
  const t = load()
  if (!t[key]) return
  const { [key]: _, ...rest } = t
  write(rest)
}

const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function useAppUse(): Record<string, AppUse> {
  return useSyncExternalStore(subscribe, load)
}

/** Scroll a grid tile into view and flash it (the picker's "go to"). False when it is not in the DOM. */
export function goToTile(key: string): boolean {
  const n = document.querySelector<HTMLElement>(`.cell[data-key="${CSS.escape(key)}"]`)
  if (!n) return false
  n.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  n.classList.remove('cell-flash')
  void n.offsetWidth
  n.classList.add('cell-flash')
  window.setTimeout(() => n.classList.remove('cell-flash'), 1600)
  return true
}
