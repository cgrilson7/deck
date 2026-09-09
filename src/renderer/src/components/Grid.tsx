import type { DeckState, SessionView } from '@shared/types'
import { PlusTile } from './PlusTile'
import { Tile } from './Tile'

/**
 * The right-hand grid: cap-1 cells. Sessions needing you come first, then slot order.
 * The first empty cell is the +, unless every slot is open.
 */
export function Grid({ sessions, state }: { sessions: SessionView[]; state: DeckState }) {
  const cells = state.cap - 1
  const cols = Math.max(1, Math.min(cells, state.gridColumns))
  const rows = Math.ceil(cells / cols)
  const canAdd = state.open.length < state.cap

  const items: React.ReactNode[] = sessions.map((s) => <Tile key={s.id} session={s} />)
  if (canAdd && items.length < cells) items.push(<PlusTile key="plus" state={state} />)
  while (items.length < cells) items.push(<div key={`blank-${items.length}`} className="tile tile-blank" />)

  return (
    <section className="grid" style={{ ['--cols' as string]: cols, ['--rows' as string]: rows }}>
      {items}
    </section>
  )
}
