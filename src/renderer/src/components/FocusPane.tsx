import type { SessionView } from '@shared/types'
import { StatusDot } from './StatusDot'
import { TermHost } from './TermHost'
import { shortPath } from '../lib/format'
import { useDropTarget } from './useDropTarget'

export function FocusPane({ session }: { session: SessionView | null }) {
  if (!session) {
    return (
      <section className="focus focus-empty">
        <button className="plus plus-big" onClick={(e) => window.deck.command({ type: 'new', worktree: e.altKey })} title="New session (⌘N) · ⌥-click for a worktree">
          +
        </button>
        <p>No session in focus. Click + or press ⌘N.</p>
      </section>
    )
  }

  const s = session
  const drop = useDropTarget(s.id)
  return (
    <section className={`focus status-${s.status} ${s.attention ? 'attention' : ''} ${drop.over ? 'drop-over' : ''}`} {...drop.handlers}>
      <header className="pane-head">
        <span className="slot">{s.slot}</span>
        <StatusDot status={s.status} attention={s.attention} />
        <span className="name" title={s.name}>
          {s.name}
        </span>
        {s.worktree && <span className="badge">worktree</span>}
        <span className="cwd" title={s.cwd}>
          {shortPath(s.cwd)}
        </span>
        <span className="spacer" />
        <button className="ghost" title="Close tile, keep the session (⌘W)" onClick={() => window.deck.command({ type: 'detach', slot: s.slot! })}>
          park
        </button>
        <button
          className="ghost danger"
          title="Kill the tmux session and forget it"
          onClick={() => {
            if (confirm(`Kill "${s.name}"? The Claude conversation stays on disk, but deck forgets it.`)) void window.deck.command({ type: 'kill', id: s.id })
          }}
        >
          kill
        </button>
      </header>
      <TermHost id={s.id} mode="focus" autoFocus />
    </section>
  )
}
