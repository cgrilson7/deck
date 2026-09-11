import type { SessionView } from '@shared/types'
import { FoxStatus } from './FoxStatus'
import { ChatView } from './ChatView'
import { TilePrompt } from './TilePrompt'
import { useDropTarget } from './useDropTarget'

export function Tile({ session: s }: { session: SessionView }) {
  const focus = () => void window.deck.command({ type: 'focus', slot: s.slot! })
  const drop = useDropTarget(s.id, focus) // a drop also brings the tile into focus
  // Selecting text in the conversation should not swap the tile into focus on mouse-up.
  const onClick = () => {
    if (window.getSelection()?.toString()) return
    focus()
  }
  return (
    <div
      className={`tile status-${s.status} ${s.attention ? 'attention' : ''} ${drop.over ? 'drop-over' : ''}`}
      onClick={onClick}
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
        {/* The conversation itself, not the CLI's screen; the terminal lives in the focus pane. */}
        <ChatView id={s.id} cwd={s.cwd} status={s.status} attention={s.attention} />
        <TilePrompt id={s.id} />
      </div>
    </div>
  )
}
