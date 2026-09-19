import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { PLUGIN_KEYS, molKey, molTileOf, nextMolTile, pluginCells, type AgentView, type DeckSettings, type DeckState, type PluginKey, type SessionView } from '@shared/types'
import { arrange, moved, pruned, type GridOrder, type GridSide } from '@shared/gridorder'
import { GitTile } from './GitTile'
import { PLUGINS, PlusTile } from './PlusTile'
import { Tile } from './Tile'
import { TranslateTile } from './TranslateTile'
import { VocabTile } from './VocabTile'
import { WikiTile } from './WikiTile'
import { MusicTile } from './MusicTile'
import { StudioTile } from './StudioTile'
import { PokemonTile } from './PokemonTile'
import { MolTile } from './MolTile'
import { PackTile } from './PackTile'
import { patchSettings, useSettings } from '../lib/theme'

/** A wolfpack's members: a beta session (a real tile of its own) or a subagent (a row of its alpha's pack tile; the agent pane in the center on click). */
export type Member = { kind: 'agent'; agent: AgentView; parent: SessionView | null } | { kind: 'beta'; session: SessionView }

/**
 * The grid: two columns of tiles either side of the focus pane, EACH ITS OWN ENDLESS SCROLL.
 * `gridRows` is how many tiles fill a column's height (so it sets the tile height) and
 * `gridColumns` how many sit side by side in one; past that the column scrolls, snapping
 * loosely to tile tops. No pages. EVERY tile can be dragged ANYWHERE in either column by its
 * grip (⠿, top right on hover): a session, a beta, a pack, a mini app. A drop lands before or
 * after the tile under the pointer (a bar shows where), or at the foot of a column on its +,
 * and the whole arrangement is written to the `gridOrder` setting (`shared/gridorder.ts`).
 * A tile nobody has placed takes a default that does not depend on what else is showing —
 * a session by its slot (odd left, even right), a beta or a pack beside its alpha, a mini app
 * by its place in PLUGIN_KEYS — sessions and packs ahead of the mini apps; View ▸ Grid ▸ Reset
 * Layout goes back to that. Each column ends in a + (the picker). A tile that needs you and is
 * scrolled out of sight raises a chip at that edge of its column; click = scroll to it. A
 * mini app's × puts it away; its tinted frame keeps it from passing for a session.
 */
export function Grid({ sessions, members, state, settings, openAgent }: { sessions: SessionView[]; members: Member[]; state: DeckState; settings: DeckSettings; /** The agent the center pane shows: its roster row is lit. */ openAgent: string | null }) {
  const focused = state.open.find((s) => s.slot === state.focusSlot) ?? null
  const canAdd = state.open.filter((s) => !s.pack).length < state.cap

  const items = useMemo(() => {
    const sideOf = (slot: number | null | undefined): GridSide => ((slot ?? 1) % 2 === 1 ? 'left' : 'right')
    const out: Item[] = sessions.map((s) => ({
      key: `slot:${s.slot}`,
      kind: 'session',
      prefer: sideOf(s.slot),
      needy: s.attention || s.status === 'blocked',
      node: <Tile session={s} />
    }))
    // A beta is a tile of its own (it has a terminal); an alpha's subagents share ONE pack tile.
    // A held agent waits on YOU (▶), so its pack counts as needing you.
    const seen = new Set<string>()
    for (const m of members) {
      if (m.kind === 'beta') {
        const alpha = state.open.find((s) => s.id === m.session.pack!.alpha)
        out.push({ key: `beta:${m.session.id}`, kind: 'member', prefer: sideOf(alpha?.slot), needy: m.session.attention || m.session.status === 'blocked', node: <Tile session={m.session} /> })
        continue
      }
      const alpha = m.agent.parent
      if (seen.has(alpha)) continue
      seen.add(alpha)
      const pack = members.flatMap((x) => (x.kind === 'agent' && x.agent.parent === alpha ? [x.agent] : []))
      out.push({ key: `pack:${alpha}`, kind: 'member', prefer: sideOf(m.parent?.slot), needy: pack.some((a) => a.held), node: <PackTile alpha={m.parent} agents={pack} openId={openAgent} /> })
    }
    for (const k of pluginCells(settings)) {
      const prefer: GridSide = PLUGIN_KEYS.indexOf(k) % 2 === 0 ? 'left' : 'right'
      // The Molecule plugin is as many cells as there are Molecule tiles, the sides taken in turn.
      if (k === 'mol') for (const n of settings.molTiles) out.push({ key: molKey(n), kind: 'plugin', prefer: n % 2 === 1 ? prefer : prefer === 'left' ? 'right' : 'left', needy: false, node: <MolTile tile={n} /> })
      else out.push({ key: k, kind: 'plugin', prefer, needy: false, node: plugin(k, settings, focused) })
    }
    return out
  }, [sessions, members, settings, focused, openAgent, state.open])

  // The columns in full (keys that are not showing keep their place), and what is drawn of them.
  const full = useMemo(() => arrange(items, settings.gridOrder), [items, settings.gridOrder])
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items])

  const save = (next: GridOrder, extra?: Partial<DeckSettings>) => patchSettings({ ...extra, gridOrder: pruned(next, new Set(byKey.keys())) })
  // The tile that was just dropped: its column scrolls it into view once it is drawn in its new place.
  const [landed, setLanded] = useState<{ key: string; n: number } | null>(null)
  const onDrop = (key: string, side: GridSide, target: string | null, after: boolean) => {
    if (key === target) return
    save(moved(full, key, side, target, after))
    setLanded((l) => ({ key, n: (l?.n ?? 0) + 1 }))
  }

  return (
    <>
      {(['left', 'right'] as const).map((side) => (
        <Column
          key={side}
          side={side}
          cells={full[side].flatMap((k) => byKey.get(k) ?? [])}
          state={state}
          settings={settings}
          canAdd={canAdd}
          landed={landed}
          onDrop={onDrop}
          onPlace={(k) => {
            // The Molecule pill while one is already showing = ANOTHER Molecule tile, at the foot of this column.
            const n = k === 'mol' && settings.showMol ? nextMolTile(settings.molTiles) : null
            if (n !== null) save(moved(full, molKey(n), side, null), { molTiles: [...settings.molTiles, n] })
            else save(moved(full, k === 'mol' ? molKey(settings.molTiles[0]) : k, side, null), { [PLUGINS.find((p) => p.key === k)!.setting]: true } as Partial<DeckSettings>)
          }}
        />
      ))}
    </>
  )
}

interface Item {
  key: string
  kind: 'session' | 'member' | 'plugin'
  /** The column it takes while `gridOrder` does not name it. */
  prefer: GridSide
  needy: boolean
  node: ReactNode
}

/** One side: the scroller, its cells, the + at its foot, and the chips for needy tiles out of sight. */
function Column({ side, cells, state, settings, canAdd, landed, onDrop, onPlace }: { side: GridSide; cells: Item[]; state: DeckState; settings: DeckSettings; canAdd: boolean; landed: { key: string; n: number } | null; onDrop: (key: string, side: GridSide, target: string | null, after: boolean) => void; onPlace: (k: PluginKey) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState({ above: 0, below: 0 })
  const needyKeys = cells.filter((c) => c.needy).map((c) => c.key).join(' ')

  // Which needy tiles are scrolled out of sight, and which way.
  const measure = useCallback(() => {
    const el = box.current
    if (!el) return
    const view = el.getBoundingClientRect()
    let above = 0
    let below = 0
    for (const n of el.querySelectorAll<HTMLElement>('.cell[data-needy="1"]')) {
      const r = n.getBoundingClientRect()
      if (r.bottom <= view.top + 8) above++
      else if (r.top >= view.bottom - 8) below++
    }
    setAway((a) => (a.above === above && a.below === below ? a : { above, below }))
  }, [])
  useEffect(measure, [measure, needyKeys, cells.length, settings.gridRows, settings.gridColumns])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  // A dropped tile is brought into view where it landed (after the new order is drawn).
  const order = cells.map((c) => c.key).join(' ')
  useEffect(() => {
    if (!landed) return
    const n = box.current?.querySelector<HTMLElement>(`.cell[data-key="${CSS.escape(landed.key)}"]`)
    n?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [landed, order])

  // AUTOSCROLL while a tile is dragged: within EDGE px of the column's top or bottom the column
  // scrolls that way, faster the closer the pointer is. A rAF loop carries the speed the last
  // dragover set (dragover keeps firing while the pointer is still), and scroll-snap is off for
  // the drag (`is-dragging`) or it would pull each small step back to a tile top.
  const speed = useRef(0)
  const raf = useRef(0)
  const [dragging, setDragging] = useState(false)
  const stopScroll = useCallback(() => {
    speed.current = 0
    cancelAnimationFrame(raf.current)
    raf.current = 0
    setDragging(false)
  }, [])
  useEffect(() => {
    window.addEventListener('dragend', stopScroll)
    window.addEventListener('drop', stopScroll)
    return () => {
      window.removeEventListener('dragend', stopScroll)
      window.removeEventListener('drop', stopScroll)
      cancelAnimationFrame(raf.current)
    }
  }, [stopScroll])
  const onDragOver = (e: React.DragEvent) => {
    const el = box.current
    if (!el || !e.dataTransfer.types.includes(MIME)) return
    if (!dragging) setDragging(true)
    const r = el.getBoundingClientRect()
    const up = r.top + EDGE - e.clientY
    const down = e.clientY - (r.bottom - EDGE)
    speed.current = up > 0 ? -Math.min(1, up / EDGE) * MAX_SPEED : down > 0 ? Math.min(1, down / EDGE) * MAX_SPEED : 0
    if (speed.current !== 0 && !raf.current) {
      const step = () => {
        raf.current = 0
        if (speed.current === 0 || !box.current) return
        box.current.scrollTop += speed.current
        raf.current = requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
    }
  }

  const jump = (dir: 'above' | 'below') => {
    const el = box.current
    if (!el) return
    const view = el.getBoundingClientRect()
    const all = [...el.querySelectorAll<HTMLElement>('.cell[data-needy="1"]')]
    const hit = dir === 'above' ? all.filter((n) => n.getBoundingClientRect().bottom <= view.top + 8).pop() : all.find((n) => n.getBoundingClientRect().top >= view.bottom - 8)
    hit?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  return (
    <section className={`grid-col grid-${side}`} onDragOver={onDragOver} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && (speed.current = 0)}>
      <div className={`grid-scroll ${dragging ? 'is-dragging' : ''}`} ref={box} onScroll={measure}>
        <div className="grid" style={{ ['--cols' as string]: settings.gridColumns, ['--rows' as string]: settings.gridRows }}>
          {cells.map((c) => (
            <GridCell key={c.key} cell={c} side={side} across={settings.gridColumns > 1} onDrop={onDrop} />
          ))}
          <GridCell cell={null} side={side} across={false} onDrop={onDrop}>
            <PlusTile state={state} onPlace={onPlace} canAdd={canAdd} />
          </GridCell>
        </div>
      </div>
      {away.above > 0 && (
        <button className="grid-needy grid-needy-above" onClick={() => jump('above')} title="Scroll up to it">
          <ChevronUp size={12} /> {away.above} need{away.above === 1 ? 's' : ''} you
        </button>
      )}
      {away.below > 0 && (
        <button className="grid-needy grid-needy-below" onClick={() => jump('below')} title="Scroll down to it">
          <ChevronDown size={12} /> {away.below} need{away.below === 1 ? 's' : ''} you
        </button>
      )}
    </section>
  )
}

function plugin(k: PluginKey, settings: DeckSettings, focused: SessionView | null): ReactNode {
  switch (k) {
    case 'wiki':
      return <WikiTile />
    case 'music':
      return <MusicTile source={settings.music} />
    case 'studio':
      return <StudioTile />
    case 'pokemon':
      return <PokemonTile />
    case 'git':
      return <GitTile session={focused} />
    case 'vocab':
      return <VocabTile />
    case 'translate':
      return <TranslateTile />
    case 'mol':
      // A cell per Molecule tile: the grid makes those itself.
      return null
  }
}

const MIME = 'application/x-deck-tile'
/** Autoscroll during a drag: how close to a column's edge it starts (px), and its top speed (px a frame). */
const EDGE = 72
const MAX_SPEED = 18

/**
 * What rides under the pointer during a drag: a small DETACHED card, the tile's own head cloned
 * (or its name, for a tile without one). Never the live cell: Chromium snapshots an element
 * inside a scroller together with its neighbours, and a full-size tile would hide the drop bar.
 * The browser takes its picture synchronously, so the caller removes it a tick later.
 */
function dragGhost(cell: HTMLElement | null, label: string): HTMLElement {
  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  const head = cell?.querySelector(':scope > .tile > .pane-head')
  if (head) {
    const copy = head.cloneNode(true) as HTMLElement
    for (const b of copy.querySelectorAll('button:not(.slot), .spacer')) b.remove()
    ghost.append(copy)
  } else ghost.textContent = label
  document.body.append(ghost)
  return ghost
}

/**
 * One cell: the tile, its grip (and a mini app's ×), and a drop target — the dragged tile lands
 * before or after this one, by which half the pointer is over (left / right halves when the
 * column is two wide). The + (`cell` null) has no grip and takes a drop as "the foot of this column".
 */
function GridCell({ cell, side, across, onDrop, children }: { cell: Item | null; side: GridSide; across: boolean; onDrop: (key: string, side: GridSide, target: string | null, after: boolean) => void; children?: ReactNode }) {
  const [over, setOver] = useState<'before' | 'after' | null>(null)
  const el = useRef<HTMLDivElement>(null)
  const molTile = cell?.kind === 'plugin' ? molTileOf(cell.key) : null
  const plugin = cell?.kind === 'plugin' ? PLUGINS.find((p) => p.key === (molTile !== null ? 'mol' : cell.key)) : undefined
  const { molTiles } = useSettings()
  const half = (e: React.DragEvent): 'before' | 'after' => {
    if (!cell) return 'before'
    const r = e.currentTarget.getBoundingClientRect()
    return (across ? e.clientX - r.left > r.width / 2 : e.clientY - r.top > r.height / 2) ? 'after' : 'before'
  }
  return (
    <div
      ref={el}
      className={`cell cell-${cell?.kind ?? 'empty'} ${over ? `drop-${over}` : ''} ${across ? 'drop-across' : ''}`}
      data-needy={cell?.needy ? '1' : undefined}
      data-key={cell?.key}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const h = half(e)
        if (over !== h) setOver(h)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
      }}
      onDrop={(e) => {
        setOver(null)
        const key = e.dataTransfer.getData(MIME)
        if (!key) return
        e.preventDefault()
        e.stopPropagation()
        onDrop(key, side, cell?.key ?? null, half(e) === 'after')
      }}
    >
      {cell ? cell.node : children}
      {plugin && (
        <button
          className="cell-x"
          title={molTile !== null && molTiles.length > 1 ? 'Close this Molecule tile (its scene goes with it)' : `Put ${plugin.label} away (a +, or the launcher, brings it back)`}
          onClick={(e) => {
            e.stopPropagation()
            // One of several Molecule tiles closes for good; the last one is put away like any mini app.
            if (molTile !== null && molTiles.length > 1) patchSettings({ molTiles: molTiles.filter((n) => n !== molTile) })
            else patchSettings({ [plugin.setting]: false } as Partial<DeckSettings>)
          }}
        >
          ×
        </button>
      )}
      {cell && (
        <span
          className="grip"
          draggable
          title="Drag to anywhere in either column"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.stopPropagation()
            e.dataTransfer.setData(MIME, cell.key)
            e.dataTransfer.effectAllowed = 'move'
            const ghost = dragGhost(el.current, plugin?.label ?? cell.key)
            e.dataTransfer.setDragImage(ghost, ghost.offsetWidth - 14, 12)
            window.setTimeout(() => ghost.remove(), 0)
          }}
        >
          ⠿
        </span>
      )}
    </div>
  )
}
