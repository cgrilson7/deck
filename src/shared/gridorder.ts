// Where every grid tile sits: two columns (sessions and their packs LEFT, mini apps RIGHT: `homeSide`), each an ordered list of tile keys — `slot:<n>` (a
// session), `beta:<id>`, `pack:<alpha id>`, or a plugin key (`mol:<n>` for a Molecule tile past the first, `web:<id>` for a web app). The saved order (`gridOrder`, a
// setting) is written whenever a tile is dragged; a tile it has never seen takes a default place
// that does not depend on what else is showing, so focusing a session (which takes its tile out
// of the grid) or a pack appearing never reshuffles the rest.

import { PLUGIN_KEYS, isPluginKey } from './types'

export type GridSide = 'left' | 'right'
export interface GridOrder {
  left: string[]
  right: string[]
}

/** A tile to place, by its key. */
export interface OrderItem {
  key: string
}

export const GRID_ORDER_MAX = 64

const KEY = new RegExp(`^(slot:\\d{1,3}|(pack|beta):[0-9a-z-]{1,40}|${PLUGIN_KEYS.join('|')}|mol:[1-9]\\d?|web:[a-z0-9][a-z0-9-]{0,23})$`)

export function isGridKey(k: unknown): k is string {
  return typeof k === 'string' && KEY.test(k)
}

const isPlugin = isPluginKey

/**
 * THE TWO COLUMNS HAVE JOBS. LEFT is where work gets done in the background: every session, beta
 * and pack, and nothing else. RIGHT is entertainment: the mini apps and the web apps. (The center
 * is whatever you are on now, either kind.) A key's column is therefore a fact about the key, not
 * a preference: no drag, picker or saved order can put a tile in the other one.
 */
export function homeSide(key: string): GridSide {
  return isPlugin(key) ? 'right' : 'left'
}

/**
 * The columns IN FULL: the saved order as it is (keys not showing right now keep their place:
 * the focused session's, a mini app that is off) with every key in its home column — one saved
 * on the wrong side (an order from before the columns had jobs) follows the keys that were
 * already there — plus every item the order does not know, at the foot of its column. What is
 * drawn is this, filtered to what is showing.
 */
export function arrange(items: OrderItem[], order: GridOrder): GridOrder {
  const saved = [...new Set([...order.left, ...order.right])]
  const cols: GridOrder = { left: [], right: [] }
  for (const side of ['left', 'right'] as const) {
    const here = new Set(order[side])
    cols[side] = [...saved.filter((k) => homeSide(k) === side && here.has(k)), ...saved.filter((k) => homeSide(k) === side && !here.has(k))]
  }
  for (const it of items) {
    const col = cols[homeSide(it.key)]
    if (!col.includes(it.key)) col.push(it.key)
  }
  return cols
}

/** `full` with `key` moved before / after `target` in ITS OWN column (null, or a target in the other one = the end). */
export function moved(full: GridOrder, key: string, target: string | null, after = false): GridOrder {
  const out = { left: full.left.filter((k) => k !== key), right: full.right.filter((k) => k !== key) }
  const col = out[homeSide(key)]
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
