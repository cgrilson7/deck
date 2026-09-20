import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AgentView, SessionView } from '@shared/types'
import { agentName } from '@shared/types'
import { modelLabel } from '@shared/models'
import { Fox } from './Fox'
import { ChatView } from './ChatView'
import { LeashButtons } from './LeashButtons'
import { AgentStatus } from './AgentStatus'
import { agentPose, agentState, openAgentPane, useNow } from '../lib/agents'
import { leashOfAgent } from '../lib/leash'

/**
 * A subagent in the CENTER column, the way the Studio takes it: the focus pane steps aside (the
 * focused session shows as a grid tile meanwhile) and a focus change, a session tile or Esc gives
 * the center back. The head says whose it is (`α<slot>`, click = back to that session); the hero
 * is the gold fox at full size in the agent's pose, its name, its state with a running clock,
 * what it is (type / model / background) and THE LEASH with words on it; under that the brief it
 * was given, the rest of the pack as a rail of miniature foxes to step between (← → too), and the
 * whole conversation. Read-only otherwise: there is no terminal behind a subagent.
 */
export function AgentPane({ agent: a, parent, pack, onClose }: { agent: AgentView; parent: SessionView | null; /** Every agent of the same parent, this one included, in order. */ pack: AgentView[]; onClose: () => void }) {
  const [briefOpen, setBriefOpen] = useState(false)
  const now = useNow(pack.some((p) => p.endedAt === null))
  const at = pack.findIndex((p) => p.id === a.id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('.xterm, .picker, input, textarea, select')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') onClose()
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && pack.length > 1 && at >= 0) {
        e.preventDefault()
        openAgentPane(pack[(at + (e.key === 'ArrowLeft' ? pack.length - 1 : 1)) % pack.length].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pack, at])

  const done = a.endedAt !== null
  const gone = done || !!a.cancelled
  const state = agentState(a)
  const name = agentName(a)
  const toAlpha = () => {
    onClose()
    if (parent) void window.deck.command({ type: 'focus', slot: parent.slot! })
  }
  return (
    <section className={`focus focus-beta agent-pane is-${state}`}>
      <header className="pane-head">
        <span className="slot slot-beta" title="A subagent">
          β
        </span>
        <span className="name">subagent</span>
        {parent && (
          <button className="badge badge-pack" title={`Its session: slot ${parent.slot} “${parent.name}” — click to go back to it`} onClick={toAlpha}>
            α{parent.slot} {parent.name}
          </button>
        )}
        <span className="spacer" />
        {pack.length > 1 && (
          <span className="agent-count" title="← → step through the pack">
            {at + 1} / {pack.length}
          </span>
        )}
        <button className="ghost" title="Give the center back to the session (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      <div className="agent-hero">
        <div className="agent-hero-fox">
          <Fox anim={agentPose(a)} scale={3} coat="gold" />
        </div>
        <div className="agent-hero-main">
          <h2 className="agent-hero-name" title={name}>
            {name}
          </h2>
          <div className="agent-hero-meta">
            <AgentStatus agent={a} now={now} />
            <span className="badge" title="Agent type">
              {a.type}
            </span>
            {a.phase && (
              <span className="badge" title="The Workflow phase this agent belongs to">
                {a.phase}
              </span>
            )}
            {a.model && (
              <span className="badge" title={`model: ${a.model}`}>
                {modelLabel(a.model)}
              </span>
            )}
            {a.background && (
              <span className="badge" title="Started with run_in_background: its session goes on working meanwhile">
                background
              </span>
            )}
          </div>
        </div>
        <div className="agent-hero-leash">
          <LeashButtons target={leashOfAgent(a)} paused={a.paused} done={gone} wide onDismiss={() => (void window.deck.command({ type: 'agentDismiss', id: a.id, force: !done }), onClose())} />
        </div>
      </div>

      {a.cancelled && <div className="agent-banner is-cancel">cancelled: {a.cancelled.reason}</div>}
      {a.paused && !a.cancelled && <div className="agent-banner is-pause">{a.held ? 'Paused: its tool call is waiting in the deck. Resume lets it through.' : 'Pausing: its next tool call will wait.'}</div>}

      {a.task && (
        <button className={`agent-brief ${briefOpen ? 'is-open' : ''}`} title="The brief it was given (its prompt's first line)" onClick={() => setBriefOpen((v) => !v)}>
          {briefOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="agent-brief-label">brief</span>
          <span className="agent-brief-text">{a.task}</span>
        </button>
      )}

      {pack.length > 1 && (
        <nav className="agent-rail" aria-label="The rest of the pack">
          {pack.map((p) => (
            <button key={p.id} className={`agent-chip is-${agentState(p)} ${p.id === a.id ? 'on' : ''}`} title={`${agentName(p)} (${p.type}) — ${agentState(p)}`} onClick={() => openAgentPane(p.id)}>
              <Fox anim={agentPose(p)} scale={1} coat="gold" />
              <span className="agent-chip-name">{agentName(p)}</span>
              <AgentStatus agent={p} now={now} short />
            </button>
          ))}
        </nav>
      )}

      <div className="agent-chat">
        <ChatView key={a.id} id={`agent:${a.id}`} cwd={parent?.cwd ?? ''} status={done ? 'idle' : 'busy'} attention={false} />
      </div>
    </section>
  )
}
