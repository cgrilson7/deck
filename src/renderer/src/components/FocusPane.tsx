import type { SessionView } from '@shared/types'
import { FoxStatus } from './FoxStatus'
import { TermHost } from './TermHost'
import { Fox } from './Fox'
import { shortPath } from '../lib/format'
import { useDropTarget } from './useDropTarget'

export function FocusPane({ session, recent }: { session: SessionView | null; recent: string[] }) {
  if (!session) {
    return (
      <section className="focus focus-empty">
        <Fox anim="idle" scale={3} />
        <button className="plus plus-big" onClick={(e) => window.deck.command({ type: 'new', worktree: e.altKey })} title="New session (⌘N) · ⌥-click for a worktree">
          +
        </button>
        <p>No session in focus. Click + or press ⌘N.</p>
        <div className="recent">
          {recent.length > 0 && <div className="recent-title">Or pick up where you left off</div>}
          {recent.map((dir) => (
            <button key={dir} className="recent-dir" title={`${dir} · ⌥-click for a worktree`} onClick={(e) => window.deck.command({ type: 'new', cwd: dir, worktree: e.altKey })}>
              {shortPath(dir)}
            </button>
          ))}
          <button className="recent-dir" onClick={(e) => window.deck.command({ type: 'chooseFolder', worktree: e.altKey })} title="Pick any folder (⌘O) · ⌥-click for a worktree">
            Choose folder…
          </button>
        </div>
      </section>
    )
  }

  const s = session
  const drop = useDropTarget(s.id)
  return (
    <section className={`focus status-${s.status} ${s.attention ? 'attention' : ''} ${drop.over ? 'drop-over' : ''}`} {...drop.handlers}>
      <header className="pane-head">
        <span className="slot">{s.slot}</span>
        <FoxStatus id={s.id} status={s.status} attention={s.attention} />
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
