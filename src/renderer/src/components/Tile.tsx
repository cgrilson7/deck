import type { SessionView } from '@shared/types'
import { StatusDot } from './StatusDot'
import { TermHost } from './TermHost'

export function Tile({ session: s }: { session: SessionView }) {
  const focus = () => void window.deck.command({ type: 'focus', slot: s.slot! })
  return (
    <div className={`tile status-${s.status} ${s.attention ? 'attention' : ''}`} onClick={focus} title={`Focus slot ${s.slot} (⌘${s.slot})`}>
      <header className="pane-head">
        <span className="slot">{s.slot}</span>
        <StatusDot status={s.status} attention={s.attention} />
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
