import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { pageSize, pluginCells, type DeckSettings, type DeckState, type PluginKey, type SessionView } from '@shared/types'
import { GitTile } from './GitTile'
import { PLUGINS, PlusTile } from './PlusTile'
import { Tile } from './Tile'
import { TranslateTile } from './TranslateTile'
import { VocabTile } from './VocabTile'
import { WikiTile } from './WikiTile'
import { MusicTile } from './MusicTile'
import { PackTile, type Pack } from './PackTile'
import { patchSettings } from '../lib/theme'

/**
 * The grid: two columns of tiles either side of the focus pane, `gridColumns` wide and
 * `gridRows` tall each (1 × 4 by default, so eight tiles around the center). That many tiles
 * make a page; the rest page on, and the arrows show on hover at the outer edges (an arrow
 * turns accent when a session needing you is on another page). SESSIONS ALWAYS COME FIRST, in
 * order (needing you first, then by slot), filling the left column top to bottom, then the
 * right, then the next page — they are never pinned. After them the wolfpacks and the plugins
 * flow into the free cells, except where one is pinned (`gridLayout`, a setting: a mini app
 * picked from an empty cell's +, or a drag by the grip ⠿ that shows on hover; a pin inside the
 * session block is deferred until the sessions leave it; View ▸ Grid ▸ Reset Layout unpins).
 * Every EMPTY cell is a +, a full page grows one more while a session can still be added, and
 * a plugin tile's × puts it away. Plugin tiles wear a tinted frame so they never pass for a
 * session.
 */
export function Grid({ sessions, packs, state, settings, onOpenPack }: { sessions: SessionView[]; packs: Pack[]; state: DeckState; settings: DeckSettings; onOpenPack: (alphaId: string) => void }) {
  const per = pageSize(settings)
  const half = settings.gridColumns * settings.gridRows
  const focused = state.open.find((s) => s.slot === state.focusSlot) ?? null
  const canAdd = state.open.filter((s) => !s.pack).length < state.cap

  const items = useMemo(() => {
    const out: Item[] = sessions.map((s) => ({
      key: `slot:${s.slot}`,
      kind: 'session',
      needy: s.attention || s.status === 'blocked',
      node: <Tile session={s} />
    }))
    for (const p of packs)
      out.push({
        key: `pack:${p.alpha.id}`,
        kind: 'pack',
        needy: p.betas.some((b) => b.attention || b.status === 'blocked'),
        node: <PackTile pack={p} onOpen={() => onOpenPack(p.alpha.id)} />
      })
    for (const k of pluginCells(settings))
      out.push({
        key: k,
        kind: 'plugin',
        needy: false,
        node: plugin(k, settings, focused)
      })
    return out
  }, [sessions, packs, settings, focused, onOpenPack])

  const cells = useMemo(() => place(items, settings.gridLayout, per, canAdd), [items, settings.gridLayout, per, canAdd])
  const pages = Math.max(1, Math.ceil(cells.length / per))
  const [page, setPage] = useState(0)
  const cur = Math.min(page, pages - 1)
  useEffect(() => {
    if (page !== cur) setPage(cur)
  }, [page, cur])

  // A session needing you on another page: the arrow that way lights up.
  const needyBefore = cells.slice(0, cur * per).some((c) => c?.needy)
  const needyAfter = cells.slice((cur + 1) * per).some((c) => c?.needy)

  const onDrop = (to: number, key: string) => {
    const from = cells.findIndex((c) => c?.key === key)
    if (from < 0 || from === to || key.startsWith('slot:') || cells[to]?.kind === 'session') return
    const layout = [...settings.gridLayout]
    while (layout.length < cells.length) layout.push('')
    layout[to] = key
    layout[from] = cells[to]?.key ?? ''
    patchSettings({ gridLayout: layout })
  }

  const side = (which: 'left' | 'right') => {
    const start = cur * per + (which === 'left' ? 0 : half)
    const slice: (Cell | null)[] = []
    for (let i = 0; i < half; i++) slice.push(cells[start + i] ?? null)
    const prev = which === 'left'
    const at = prev ? cur > 0 : cur < pages - 1
    return (
      <section className={`grid-col grid-${which}`}>
        <div
          className="grid"
          style={{
            ['--cols' as string]: settings.gridColumns,
            ['--rows' as string]: settings.gridRows
          }}
        >
          {slice.map((c, i) => (
            <GridCell key={c?.key ?? `empty-${start + i}`} index={start + i} cell={c} state={state} canAdd={canAdd} onDrop={onDrop} />
          ))}
        </div>
        {pages > 1 && (
          <button
            className={`page-arrow page-${prev ? 'prev' : 'next'} ${(prev ? needyBefore : needyAfter) ? 'needy' : ''}`}
            disabled={!at}
            onClick={() => setPage(cur + (prev ? -1 : 1))}
            title={prev ? `Previous page (${cur} more)` : `Next page (${pages - 1 - cur} more)`}
          >
            {prev ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        )}
        {pages > 1 && which === 'right' && (
          <span className="pager" aria-label={`Page ${cur + 1} of ${pages}`}>
            {Array.from({ length: pages }, (_, i) => (
              <button key={i} className={`pager-dot ${i === cur ? 'on' : ''}`} onClick={() => setPage(i)} title={`Page ${i + 1}`} />
            ))}
          </span>
        )}
      </section>
    )
  }

  return (
    <>
      {side('left')}
      {side('right')}
    </>
  )
}

interface Item {
  key: string
  kind: 'session' | 'pack' | 'plugin'
  needy: boolean
  node: ReactNode
}
type Cell = Item

/**
 * Cells across every page: the sessions first, in order, from cell 0; then pinned keys (a pin
 * inside the session block waits; one past the end of what is here is honored, the pages grow
 * to reach it); then the rest in order into the free cells. Trailing empty pages are dropped,
 * there is always at least one page, and while a session can still be added there is always
 * an empty cell (a full last page gets one more).
 */
function place(items: Item[], layout: string[], per: number, canAdd: boolean): (Cell | null)[] {
  const byKey = new Map(items.map((i) => [i.key, i]))
  const placed = new Set<string>()
  const cells: (Cell | null)[] = items.filter((it) => it.kind === 'session')
  for (const c of cells) placed.add(c!.key)
  const block = cells.length
  layout.forEach((k, i) => {
    const it = k && byKey.get(k)
    if (!it || placed.has(k) || it.kind === 'session' || i < block) return
    while (cells.length <= i) cells.push(null)
    cells[i] = it
    placed.add(k)
  })
  let i = block
  for (const it of items) {
    if (placed.has(it.key)) continue
    while (cells[i]) i++
    while (cells.length <= i) cells.push(null)
    cells[i] = it
  }
  let last = cells.length - 1
  while (last >= 0 && !cells[last]) last--
  let n = Math.max(per, Math.ceil((last + 1) / per) * per)
  if (canAdd && last + 1 >= n) n += per
  while (cells.length < n) cells.push(null)
  return cells.slice(0, n)
}

function plugin(k: PluginKey, settings: DeckSettings, focused: SessionView | null): ReactNode {
  switch (k) {
    case 'wiki':
      return <WikiTile />
    case 'music':
      return <MusicTile source={settings.music} />
    case 'git':
      return <GitTile session={focused} />
    case 'vocab':
      return <VocabTile />
    case 'translate':
      return <TranslateTile />
  }
}

const MIME = 'application/x-deck-tile'

/** One cell: the tile, its grip (and a plugin's ×), and a drop target. An empty cell is a + you can also drop onto. */
function GridCell({ index, cell, state, canAdd, onDrop }: { index: number; cell: Cell | null; state: DeckState; canAdd: boolean; onDrop: (to: number, key: string) => void }) {
  const [over, setOver] = useState(false)
  const plugin = cell?.kind === 'plugin' ? PLUGINS.find((p) => p.key === cell.key) : undefined
  return (
    <div
      className={`cell cell-${cell?.kind ?? 'empty'} ${over ? 'cell-over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const key = e.dataTransfer.getData(MIME)
        if (!key) return
        e.preventDefault()
        e.stopPropagation()
        onDrop(index, key)
      }}
    >
      {cell ? cell.node : <PlusTile state={state} cell={index} canAdd={canAdd} />}
      {plugin && (
        <button
          className="cell-x"
          title={`Put ${plugin.label} away (an empty cell's + brings it back)`}
          onClick={(e) => {
            e.stopPropagation()
            patchSettings({ [plugin.setting]: false } as Partial<DeckSettings>)
          }}
        >
          ×
        </button>
      )}
      {cell && cell.kind !== 'session' && (
        <span
          className="grip"
          draggable
          title="Drag to another cell (both stay put after)"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.stopPropagation()
            e.dataTransfer.setData(MIME, cell.key)
            e.dataTransfer.effectAllowed = 'move'
          }}
        >
          ⠿
        </span>
      )}
    </div>
  )
}
