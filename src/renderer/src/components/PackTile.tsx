import type { AgentView } from '@shared/types'
import { agentName } from '@shared/types'
import { agentState } from './AgentTile'
import { ChatView } from './ChatView'

/**
 * Subagents in a 4-wide grid: each quarter shows a status mark, the name, and the agent's
 * transcript scrolling vertically with text wrapping. Tap a quarter to open the AgentPane
 * (full transcript + leash controls). Splits across multiple tiles when there are more than 4.
 */

const COLS = 4

export function packTiles(agents: AgentView[], parents: Map<string, string>, onOpenAgent: (id: string) => void): { key: string; node: React.ReactNode }[] {
  if (agents.length === 0) return []
  const chunks: AgentView[][] = []
  for (let i = 0; i < agents.length; i += COLS) chunks.push(agents.slice(i, i + COLS))
  return chunks.map((chunk, ci) => ({
    key: `pack:${ci}`,
    node: <PackTile agents={chunk} parents={parents} onOpenAgent={onOpenAgent} />
  }))
}

function PackTile({ agents, parents, onOpenAgent }: { agents: AgentView[]; parents: Map<string, string>; onOpenAgent: (id: string) => void }) {
  return (
    <div className="tile tile-pack">
      <div className="pack-grid">
        {agents.map((a) => (
          <AgentQuarter key={a.id} agent={a} cwd={parents.get(a.parent) ?? ''} onClick={() => onOpenAgent(a.id)} />
        ))}
      </div>
    </div>
  )
}

function AgentQuarter({ agent: a, cwd, onClick }: { agent: AgentView; cwd: string; onClick: () => void }) {
  const state = agentState(a)
  const done = a.endedAt !== null
  return (
    <div className={`pack-quarter is-${state}`} onClick={onClick} title={`${agentName(a)} — tap to manage`}>
      <header className="pack-head">
        <Mark state={state} />
        <span className="pack-name">{agentName(a)}</span>
      </header>
      <div className="pack-transcript">
        <ChatView id={`agent:${a.id}`} cwd={cwd} status={done ? 'idle' : 'busy'} attention={false} />
      </div>
    </div>
  )
}

function Mark({ state }: { state: string }) {
  switch (state) {
    case 'done':
      return <span className="pack-mark is-done">✓</span>
    case 'cancelled':
    case 'cancelling':
      return <span className="pack-mark is-cancel">✗</span>
    case 'paused':
    case 'pausing':
      return <span className="pack-mark is-pause">⏸</span>
    default:
      return <span className="pack-mark is-work">·</span>
  }
}
