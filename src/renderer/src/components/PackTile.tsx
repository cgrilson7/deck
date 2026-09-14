import type { AgentView } from '@shared/types'
import { agentName } from '@shared/types'
import { agentState } from './AgentTile'

/**
 * Subagents collapsed into compact rows: a status mark + name per agent, nothing more. Tap a
 * row to open the AgentPane (the modal with the full transcript and leash controls). If more
 * agents than `PER_TILE` are present the list splits across multiple tiles so no single cell
 * overflows.
 */

const PER_TILE = 8

export function packTiles(agents: AgentView[], onOpenAgent: (id: string) => void): { key: string; node: React.ReactNode }[] {
  if (agents.length === 0) return []
  const chunks: AgentView[][] = []
  for (let i = 0; i < agents.length; i += PER_TILE) chunks.push(agents.slice(i, i + PER_TILE))
  return chunks.map((chunk, ci) => ({
    key: `pack:${ci}`,
    node: <PackTile agents={chunk} onOpenAgent={onOpenAgent} />
  }))
}

function PackTile({ agents, onOpenAgent }: { agents: AgentView[]; onOpenAgent: (id: string) => void }) {
  return (
    <div className="tile tile-pack">
      <div className="pack-list">
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} onClick={() => onOpenAgent(a.id)} />
        ))}
      </div>
    </div>
  )
}

function AgentRow({ agent: a, onClick }: { agent: AgentView; onClick: () => void }) {
  const state = agentState(a)
  return (
    <button type="button" className={`pack-row is-${state}`} onClick={onClick} title={a.task || agentName(a)}>
      <Mark state={state} />
      <span className="pack-name">{agentName(a)}</span>
    </button>
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
