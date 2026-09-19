// Where every grid tile sits: two columns, each an ordered list of tile keys — `slot:<n>` (a
// session), `beta:<id>`, `pack:<alpha id>`, or a plugin key (`mol:<n>` for a Molecule tile past the first). The saved order (`gridOrder`, a
// setting) is written whenever a tile is dragged; a tile it has never seen takes a default place
// that does not depend on what else is showing, so focusing a session (which takes its tile out
// of the grid) or a pack appearing never reshuffles the rest.

import { PLUGIN_KEYS, isPluginKey } from './types'

export type GridSide = 'left' | 'right'
export interface GridOrder {
  left: string[]
  right: string[]
}

/** A tile to place: its key and the column it goes to when the saved order does not know it. */
export interface OrderItem {
  key: string
  prefer: GridSide
}

export const GRID_ORDER_MAX = 64

const KEY = new RegExp(`^(slot:\\d{1,3}|(pack|beta):[0-9a-z-]{1,40}|${PLUGIN_KEYS.join('|')}|mol:[1-9]\\d?)$`)

export function isGridKey(k: unknown): k is string {
  return typeof k === 'string' && KEY.test(k)
}

const isPlugin = isPluginKey

/**
 * The columns IN FULL: the saved order as it is (keys not showing right now keep their place:
 * the focused session's, a mini app that is off), plus every item it does not know — a session,
 * beta or pack right after the last of those in its preferred column (so they stay ahead of the
 * mini apps), a mini app at the end of its. What is drawn is this, filtered to what is showing.
 */
export function arrange(items: OrderItem[], order: GridOrder): GridOrder {
  const left = [...new Set(order.left)]
  const right = [...new Set(order.right)].filter((k) => !left.includes(k))
  const cols = { left, right }
  for (const it of items) {
    if (left.includes(it.key) || right.includes(it.key)) continue
    const col = cols[it.prefer]
    if (isPlugin(it.key)) col.push(it.key)
    else {
      let at = 0
      col.forEach((k, i) => {
        if (!isPlugin(k)) at = i + 1
      })
      col.splice(at, 0, it.key)
    }
  }
  return cols
}

/** `full` with `key` moved to `side`, before / after `target` (null = the end of the column). */
export function moved(full: GridOrder, key: string, side: GridSide, target: string | null, after = false): GridOrder {
  const out = { left: full.left.filter((k) => k !== key), right: full.right.filter((k) => k !== key) }
  const col = out[side]
  const i = target === null || target === key ? -1 : col.indexOf(target)
  if (i < 0) col.push(key)
  else col.splice(i + (after ? 1 : 0), 0, key)
  return out
}

/** What is worth writing down: keys not showing are kept only when they can come back (a slot, a mini app). */
export function pruned(full: GridOrder, showing: Set<string>): GridOrder {
  const keep = (k: string) => showing.has(k) || isPlugin(k) || k.startsWith('slot:')
  return { left: full.left.filter(keep).slice(0, GRID_ORDER_MAX), right: full.right.filter(keep).slice(0, GRID_ORDER_MAX) }
}
