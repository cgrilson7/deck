import { useEffect, useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import type { AgentView, SessionView } from '@shared/types'
import { agentName } from '@shared/types'
import { modelLabel } from '@shared/models'
import { Fox } from './Fox'
import { ChatView } from './ChatView'
import { LeashButtons } from './LeashButtons'
import { agentPose, agentState } from './AgentTile'
import { leashOfAgent } from '../lib/leash'

const WIDE_KEY = 'deck.agentPane.wide'

/**
 * A subagent tapped into: the pane over the right column (where the file preview and Foxtrot's
 * log go, one at a time) with its whole conversation full size, and the leash on the head —
 * pause / resume, cancel with a reason — plus its parent to jump to. Read-only otherwise: there
 * is no terminal behind a subagent. ⤢ takes the whole window; Esc closes, unless the keystroke
 * came from a terminal.
 */
export function AgentPane({ agent: a, parent, onClose }: { agent: AgentView; parent: SessionView | null; onClose: () => void }) {
  const [wide, setWide] = useState(() => localStorage.getItem(WIDE_KEY) === '1')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest('.xterm, .picker')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const toggleWide = () => {
    setWide((w) => {
      localStorage.setItem(WIDE_KEY, w ? '0' : '1')
      return !w
    })
  }

  const done = a.endedAt !== null
  const state = agentState(a)
  const started = new Date(a.startedAt)
  const mins = Math.round(((a.endedAt ?? Date.now()) - a.startedAt) / 60_000)
  return (
    <section className={`doc agent-pane is-${state} ${wide ? 'is-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="doc-scrim" onClick={onClose} />
      <div className="doc-panel">
        <header className="doc-head">
          <Fox anim={agentPose(a)} scale={1} coat="gold" />
          <span className="doc-name" title={a.task || agentName(a)}>
            {agentName(a)}
          </span>
          <span className="doc-where">
            {a.type}
            {a.model ? ` · ${modelLabel(a.model)}` : ''}
            {a.background ? ' · background' : ''}
          </span>
          <span className="doc-meta" title={`started ${started.toLocaleTimeString()}`}>
            {state} · {mins < 1 ? 'under a minute' : `${mins} min`}
          </span>
          <span className="spacer" />
          {parent && (
            <button className="doc-btn wide" title={`Its parent: slot ${parent.slot} “${parent.name}” — focus it`} onClick={() => void window.deck.command({ type: 'focus', slot: parent.slot! })}>
              α{parent.slot}
            </button>
          )}
          <LeashButtons target={leashOfAgent(a)} paused={a.paused} done={done} wide onDismiss={() => (void window.deck.command({ type: 'agentDismiss', id: a.id }), onClose())} />
          <button className={`doc-btn ${wide ? 'on' : ''}`} title={wide ? 'Back over the grid' : 'The whole window'} onClick={toggleWide}>
            {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className="doc-btn" title="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        {a.cancelled && <div className="doc-problem">cancelled: {a.cancelled.reason}</div>}
        {a.paused && !a.cancelled && <div className="doc-problem is-pause">{a.held ? 'paused: its tool call is waiting in the deck' : 'pausing: its next tool call will wait'}</div>}
        {a.task && a.description && (
          <div className="agent-task" title={a.task}>
            {a.task}
          </div>
        )}
        <div className="agent-chat">
          <ChatView id={`agent:${a.id}`} cwd={parent?.cwd ?? ''} status={done ? 'idle' : 'busy'} attention={false} />
        </div>
      </div>
    </section>
  )
}
