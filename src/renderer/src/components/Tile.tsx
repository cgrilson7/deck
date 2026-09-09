import type { SessionView } from '@shared/types'
import { FoxStatus } from './FoxStatus'
import { TermHost } from './TermHost'
import { useDropTarget } from './useDropTarget'

export function Tile({ session: s }: { session: SessionView }) {
  const focus = () => void window.deck.command({ type: 'focus', slot: s.slot! })
  const drop = useDropTarget(s.id, focus) // a drop also brings the tile into focus
  return (
    <div
      className={`tile status-${s.status} ${s.attention ? 'attention' : ''} ${drop.over ? 'drop-over' : ''}`}
      onClick={focus}
      title={`Focus slot ${s.slot} (⌘${s.slot})`}
      {...drop.handlers}
    >
      <header className="pane-head">
        <span className="slot">{s.slot}</span>
        <FoxStatus id={s.id} status={s.status} attention={s.attention} />
        <span className="name">{s.name}</span>
        {s.worktree && <span className="badge">wt</span>}
      </header>
      <div className="tile-body">
        <TermHost id={s.id} mode="tile" />
        {/* Tiles are for watching; the overlay keeps clicks from landing in the terminal. */}
        <div className="tile-click" />
      </div>
    </div>
  )
}
