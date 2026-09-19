import type { SessionView } from '@shared/types'
import { modelLabel } from '@shared/models'
import { FoxStatus } from './FoxStatus'
import { ChatView } from './ChatView'
import { TilePrompt } from './TilePrompt'
import { LeashButtons } from './LeashButtons'
import { useDropTarget } from './useDropTarget'
import { leashOfBeta } from '../lib/leash'
import { closeStudio } from '../lib/studio'
import { closePokemon } from '../lib/pokemon'

/**
 * A session's tile: its conversation and a prompt bar. A wolfpack's beta wears the gold coat and
 * a β instead of a slot number, and the leash on its head: pause / resume, cancel with a reason.
 */
export function Tile({ session: s }: { session: SessionView }) {
  const focus = () => {
    closeStudio() // …and the agent pane with it (App); the Game Boy too: the center goes back to the session
    closePokemon()
    void window.deck.command({ type: 'focus', slot: s.slot! })
  }
  const beta = !!s.pack
  const drop = useDropTarget(s.id, focus) // a drop also brings the tile into focus
  // Selecting text in the conversation should not swap the tile into focus on mouse-up.
  const onClick = () => {
    if (window.getSelection()?.toString()) return
    focus()
  }
  return (
    <div
      className={`tile status-${s.status} ${s.attention ? 'attention' : ''} ${drop.over ? 'drop-over' : ''} ${beta ? 'tile-beta' : ''} ${s.paused ? 'is-paused' : ''}`}
      onClick={onClick}
      title={beta ? `Focus this beta (${s.pack!.task})` : `Focus slot ${s.slot} (⌘${s.slot! % 10})`}
      {...drop.handlers}
    >
      <header className="pane-head">
        <span className={`slot ${beta ? 'slot-beta' : ''}`} title={beta ? 'A wolfpack beta' : undefined}>
          {beta ? 'β' : s.slot}
        </span>
        <FoxStatus id={s.id} status={s.status} attention={s.attention} coat={beta ? 'gold' : undefined} />
        <span className="name">{s.name}</span>
        {s.worktree && <span className="badge">wt</span>}
        {s.model && (
          <span className="badge" title={`--model ${s.model}`}>
            {modelLabel(s.model)}
          </span>
        )}
        {s.paused && <span className="badge badge-state is-paused">paused</span>}
        {beta && (
          <>
            <span className="spacer" />
            <LeashButtons target={leashOfBeta(s)} paused={s.paused} />
          </>
        )}
      </header>
      <div className="tile-body">
        {/* The conversation itself, not the CLI's screen; the terminal lives in the focus pane. */}
        <ChatView id={s.id} cwd={s.cwd} status={s.status} attention={s.attention} />
        <TilePrompt id={s.id} />
      </div>
    </div>
  )
}
