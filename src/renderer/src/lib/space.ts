// THE SPACE TILE's state: ~/space's status (pushed by main whenever status.json changes) and its
// items (fetched when the status moves), one store for the tile and the pane. openSpace() asks
// App for the center column, the Posture way (a window event).

import { useEffect, useState } from 'react'
import type { SpaceAct, SpaceItem, SpaceStatus, TrashGame } from '@shared/types'
import { foxtrotAct } from './foxact'

interface SpaceView {
  status: SpaceStatus | null
  items: SpaceItem[]
  /** A request in flight (its label), so buttons can say so. */
  busy: string | null
  error: string | null
  /** The Trash game's last reading. */
  trash: TrashGame | null
  /** When the Trash was last seen emptied (ms), for the tile's victory lap. */
  lapAt: number
}

let view: SpaceView = { status: null, items: [], busy: null, error: null, trash: null, lapAt: 0 }
const subs = new Set<(v: SpaceView) => void>()
let installed = false

function set(p: Partial<SpaceView>): void {
  view = { ...view, ...p }
  for (const s of subs) s(view)
}

async function loadItems(): Promise<void> {
  try {
    set({ items: await window.deck.spaceItems() })
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) })
  }
}

function install(): void {
  if (installed) return
  installed = true
  void window.deck.spaceStatus().then((status) => {
    set({ status })
    if (status) void loadItems()
  })
  void window.deck.spaceTrash().then((trash) => trash && set({ trash }))
  window.deck.onSpaceTrash((trash) => {
    set({ trash, ...(trash.emptied ? { lapAt: Date.now() } : {}) })
    // The victory lap, in the Foxtrot tile too if it is up.
    if (trash.emptied) foxtrotAct({ anim: 'leap', ms: 2600, words: ['TRASH!', 'GONE!', `${fmtBytes(trash.emptied.bytes)}!`, 'ARF!'] })
  })
  window.deck.onSpaceStatus((status) => {
    set({ status })
    if (status) void loadItems()
  })
}

export function useSpace(): SpaceView {
  const [v, setV] = useState(view)
  useEffect(() => {
    install()
    subs.add(setV)
    setV(view)
    return () => void subs.delete(setV)
  }, [])
  return v
}

/** Send one request through main to the space CLI. Status and items refresh by themselves after. */
export async function spaceAct(req: SpaceAct, label: string): Promise<boolean> {
  set({ busy: label, error: null })
  try {
    const r = (await window.deck.spaceAct(req)) as { error?: string } | null
    if (r && typeof r === 'object' && 'error' in r && r.error) {
      set({ error: r.error })
      return false
    }
    await loadItems()
    return true
  } finally {
    set({ busy: null })
  }
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never'
  const m = Math.round((now - ts) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const EVENT = 'deck:space-pane'
export type SpaceWant = boolean | 'toggle'
export function openSpace(): void {
  window.dispatchEvent(new CustomEvent<SpaceWant>(EVENT, { detail: true }))
}
export function onSpacePane(cb: (want: SpaceWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<SpaceWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
