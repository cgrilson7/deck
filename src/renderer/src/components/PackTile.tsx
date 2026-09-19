import type { AgentView, SessionView } from '@shared/types'
import { agentName } from '@shared/types'
import { modelLabel } from '@shared/models'
import { Pause, Play } from 'lucide-react'
import { Fox } from './Fox'
import { ChatView } from './ChatView'
import { LeashButtons } from './LeashButtons'
import { AgentStatus } from './AgentStatus'
import { agentPose, agentState, blockLine, closeAgentPane, closesIn, isKept, keepAgent, openAgentPane, packSummary, useKeptVersion, useLastBlock, useNow } from '../lib/agents'
import { leashOfAgent } from '../lib/leash'
import { closeStudio } from '../lib/studio'
import { closePokemon } from '../lib/pokemon'

/** Past this many, a row is one line instead of two. */
const DENSE_FROM = 5

/**
 * A session's PACK as one grid cell: the tile that ties the subagents to the session that runs
 * them. The head is the alpha (`α<slot>` + its name, click = focus it) and the pack's tally; the
 * body is a ROSTER, a row per agent: a miniature gold fox in the agent's pose (running while it
 * works, sitting up when held, asleep once finished, down when cancelled), its name and type,
 * the line it is on right now (its transcript's last block, live), and its state with the clock.
 * The leash sits on each row (on hover; ▶ always while paused). A row opens that agent in the
 * CENTER column (AgentPane). A pack of ONE has the room for the full thing, so the agent's
 * conversation runs under its row; five or more go to one line each and the roster scrolls.
 * A FINISHED agent puts itself away: its row counts down 15s (`lib/agents.ts`, the auto-killer)
 * where its state was, and that count is a button — click holds it (▶ lets it go again, from 15);
 * its × is always there, and "clear n" in the head takes every finished one, a pack of one too.
 */
export function PackTile({ alpha, agents, openId }: { alpha: SessionView | null; agents: AgentView[]; /** The agent the center pane is showing, if any. */ openId: string | null }) {
  useKeptVersion()
  const now = useNow(agents.some((a) => a.endedAt === null || !isKept(a.id)))
  const solo = agents.length === 1
  const finished = agents.filter((a) => a.endedAt !== null)
  const focusAlpha = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!alpha) return
    closeAgentPane()
    closeStudio()
    closePokemon()
    void window.deck.command({ type: 'focus', slot: alpha.slot! })
  }
  return (
    <div className={`tile tile-pack ${solo ? 'pack-solo' : agents.length >= DENSE_FROM ? 'pack-dense' : ''}`} onClick={solo ? () => !window.getSelection()?.toString() && openAgentPane(agents[0].id) : undefined}>
      <header className="pane-head">
        <button className="slot slot-beta pack-alpha" title={alpha ? `The pack of slot ${alpha.slot} “${alpha.name}” — click to focus it` : 'A pack whose session is gone'} onClick={focusAlpha}>
          α{alpha?.slot ?? '?'}
        </button>
        <span className="name" title={alpha?.name}>
          {alpha?.name ?? 'pack'}
        </span>
        <span className="pack-tally">{packSummary(agents)}</span>
        <span className="spacer" />
        {finished.length > 0 && (
          <button
            className="ghost pack-clear"
            title="Put the finished ones away"
            onClick={(e) => {
              e.stopPropagation()
              for (const a of finished) void window.deck.command({ type: 'agentDismiss', id: a.id, force: false })
            }}
          >
            clear {finished.length}
          </button>
        )}
      </header>
      <div className="pack-roster">
        {agents.map((a) => (
          <PackRow key={a.id} agent={a} now={now} open={a.id === openId} />
        ))}
      </div>
      {solo && (
        <div className="tile-body tile-body-agent">
          <ChatView id={`agent:${agents[0].id}`} cwd={alpha?.cwd ?? ''} status={agents[0].endedAt !== null ? 'idle' : 'busy'} attention={false} />
        </div>
      )}
    </div>
  )
}

function PackRow({ agent: a, now, open }: { agent: AgentView; now: number; open: boolean }) {
  const state = agentState(a)
  const done = a.endedAt !== null
  const last = useLastBlock(a.id)
  const left = closesIn(a, now)
  const name = agentName(a)
  // What it is on: the reason it was cancelled, what it said last once finished, else its newest block.
  const line = a.cancelled ? `cancelled: ${a.cancelled.reason}` : done && a.lastText ? a.lastText.replace(/\s+/g, ' ').trim() : last ? blockLine(last) : done ? '' : 'starting…'
  return (
    <div
      className={`pack-row is-${state} ${open ? 'is-open' : ''}`}
      title={`${name} (${a.type}) — click to open it in the center`}
      onClick={(e) => {
        e.stopPropagation()
        if (window.getSelection()?.toString()) return
        openAgentPane(a.id)
      }}
    >
      <Fox anim={agentPose(a)} scale={1} coat="gold" title={state} />
      <div className="pack-row-main">
        <div className="pack-row-top">
          <span className="pack-name">{name}</span>
          <span className="pack-type">
            {a.type}
            {a.model ? ` · ${modelLabel(a.model)}` : ''}
          </span>
        </div>
        <div className={`pack-line ${last?.kind === 'tool' && !done && !a.cancelled ? 'is-tool' : ''}`}>{line}</div>
      </div>
      <span className="pack-row-leash">
        <LeashButtons target={leashOfAgent(a)} paused={a.paused} done={done || !!a.cancelled} onDismiss={() => void window.deck.command({ type: 'agentDismiss', id: a.id, force: !done })} />
      </span>
      {left !== null || (done && isKept(a.id)) ? (
        <button
          className={`pack-count ${left === null ? 'is-kept' : ''}`}
          title={left === null ? 'Kept. Click to let it go: it closes 15s later' : `Finished: this closes in ${left}s. Click to keep it`}
          onClick={(e) => {
            e.stopPropagation()
            keepAgent(a.id, left !== null)
          }}
        >
          {left === null ? <Play size={9} /> : <Pause size={9} />}
          {left === null ? 'kept' : `${left}s`}
        </button>
      ) : (
        <AgentStatus agent={a} now={now} short />
      )}
    </div>
  )
}
