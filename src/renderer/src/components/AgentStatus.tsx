import type { AgentView } from '@shared/types'
import { agentElapsed, agentState, type AgentState } from '../lib/agents'

const WORD: Record<AgentState, string> = {
  working: 'working',
  pausing: 'pausing',
  paused: 'paused',
  cancelling: 'cancelling',
  cancelled: 'cancelled',
  done: 'finished'
}

/**
 * A subagent's state as a pill: a pip (pulsing while it works, a tick once it finished), the
 * word, and the clock — running while it runs, the total once it stopped. `short` is the roster
 * row's: the clock alone while working, the word alone when the word matters more.
 */
export function AgentStatus({ agent: a, now, short }: { agent: AgentView; now: number; short?: boolean }) {
  const state = agentState(a)
  const time = agentElapsed(a, now)
  const text = short ? (state === 'working' ? time : state === 'done' ? `✓ ${time}` : WORD[state]) : `${WORD[state]} · ${time}`
  return (
    <span className={`agent-status is-${state}`} title={`${WORD[state]} · ${time} · started ${new Date(a.startedAt).toLocaleTimeString()}`}>
      {!(short && state === 'done') && <i className="agent-pip" />}
      {text}
    </span>
  )
}
