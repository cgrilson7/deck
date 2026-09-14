import type { AgentView, SessionView } from '@shared/types'
import { agentName } from '@shared/types'
import { modelLabel } from '@shared/models'
import { Fox, type FoxAnim } from './Fox'
import { ChatView } from './ChatView'
import { LeashButtons } from './LeashButtons'
import { leashOfAgent } from '../lib/leash'

/** The pose of a subagent's fox: running while it works, held still when paused, down when cancelled, asleep once done. */
export function agentPose(a: AgentView): FoxAnim {
  if (a.cancelled) return 'down'
  if (a.endedAt !== null) return 'sleep'
  if (a.paused) return a.held ? 'alert' : 'look'
  return 'run'
}

/** One word for the head. */
export function agentState(a: AgentView): string {
  if (a.cancelled) return a.endedAt !== null ? 'cancelled' : 'cancelling'
  if (a.endedAt !== null) return 'done'
  if (a.paused) return a.held ? 'paused' : 'pausing'
  return 'working'
}

/**
 * A subagent as a grid cell of its own: the conversation it is having (its own transcript,
 * tailed under `agent:<id>`), the gold fox running while it works, a β in place of a slot. No
 * terminal behind it and nothing to type into: it is the parent session's. What you CAN do is
 * on the head: pause it, resume it, cancel it with a reason (the alpha is told). Click the tile
 * to watch it full size in the agent pane over the right column.
 */
export function AgentTile({ agent: a, parent, onOpen }: { agent: AgentView; parent: SessionView | null; onOpen: () => void }) {
  const done = a.endedAt !== null
  const name = agentName(a)
  const state = agentState(a)
  const onClick = () => {
    if (window.getSelection()?.toString()) return
    onOpen()
  }
  return (
    <div
      className={`tile tile-beta tile-agent is-${state} ${done ? 'status-idle' : a.paused ? 'status-blocked' : 'status-busy'}`}
      title={`${name} (${a.type}) — click to watch it full size`}
      onClick={onClick}
    >
      <header className="pane-head">
        <span className="slot slot-beta" title={parent ? `A subagent of slot ${parent.slot} “${parent.name}”` : 'A subagent'}>
          β
        </span>
        <Fox anim={agentPose(a)} scale={1} coat="gold" title={state} />
        <span className="name" title={a.task || name}>
          {name}
        </span>
        <span className="badge" title="Agent type">
          {a.type}
        </span>
        {a.model && (
          <span className="badge" title={`model: ${a.model}`}>
            {modelLabel(a.model)}
          </span>
        )}
        {state !== 'working' && <span className={`badge badge-state is-${state}`}>{state}</span>}
        <span className="spacer" />
        <LeashButtons target={leashOfAgent(a)} paused={a.paused} done={done} onDismiss={() => void window.deck.command({ type: 'agentDismiss', id: a.id })} />
      </header>
      {a.cancelled && (
        <div className="agent-reason" title={a.cancelled.reason}>
          cancelled: {a.cancelled.reason}
        </div>
      )}
      <div className="tile-body tile-body-agent">
        <ChatView id={`agent:${a.id}`} cwd={parent?.cwd ?? ''} status={done ? 'idle' : 'busy'} attention={false} />
      </div>
    </div>
  )
}
