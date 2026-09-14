import type { AgentView } from '@shared/types'
import { Fox } from './Fox'
import { ChatView } from './ChatView'

/**
 * A subagent as a tile: the conversation it is having (its own transcript, tailed under
 * `agent:<id>`), the gold fox running while it works and asleep once it stopped. There is no
 * terminal behind it and nothing to type into: it is the parent session's, and the parent's
 * permission prompts are the parent's. Read-only by nature, like every tile.
 */
export function AgentTile({ agent, cwd }: { agent: AgentView; cwd: string }) {
  const done = agent.endedAt !== null
  const name = agent.description || agent.task || agent.type
  return (
    <div className={`tile tile-beta tile-agent ${done ? 'status-idle' : 'status-busy'}`} title={agent.task ? `${agent.type}: ${agent.task}` : agent.type}>
      <header className="pane-head">
        <span className="slot slot-beta" title="A subagent of this session">
          β
        </span>
        <Fox anim={done ? 'sleep' : 'run'} scale={1} coat="gold" title={done ? 'finished' : 'working'} />
        <span className="name" title={name}>
          {name}
        </span>
        <span className="badge" title="Agent type">
          {agent.type}
        </span>
      </header>
      <div className="tile-body tile-body-agent">
        <ChatView id={`agent:${agent.id}`} cwd={cwd} status={done ? 'idle' : 'busy'} attention={false} />
      </div>
    </div>
  )
}
