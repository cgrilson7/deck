import { Maximize2 } from 'lucide-react'
import type { AgentView, SessionView } from '@shared/types'
import { AgentTile } from './AgentTile'
import { Fox, type FoxAnim } from './Fox'
import { Tile } from './Tile'

/**
 * A wolfpack as one grid cell: the alpha's slot on the head, and beneath it, as small tiles,
 * its SUBAGENTS (what the Agent tool and a Workflow run inside the session: the canonical pack,
 * read-only tiles of their transcripts) and its BETAS (Opus sessions of their own, spawned
 * through scripts/wolfpack.mjs: real tiles you can prompt and focus).
 */
export interface Pack {
  alpha: SessionView
  betas: SessionView[]
  agents: AgentView[]
}

export const packSize = (p: Pack) => p.betas.length + p.agents.length
export const packWorking = (p: Pack) => p.betas.filter((b) => b.status === 'busy' || b.status === 'starting').length + p.agents.filter((a) => a.endedAt === null).length
export const packNeedy = (p: Pack) => p.betas.filter((b) => b.attention || b.status === 'blocked').length

/** The pose that stands for the whole pack: needing you beats working beats sleeping. */
export function packPose(p: Pack): FoxAnim {
  if (packNeedy(p) > 0) return 'alert'
  if (packWorking(p) > 0) return 'run'
  if (p.betas.length > 0 && p.agents.length === 0 && p.betas.every((b) => b.status === 'dead')) return 'down'
  return 'sleep'
}

/** Every member as a tile, subagents first (they are this turn's work), then the betas. */
export function packTiles(p: Pack) {
  return [...p.agents.map((a) => <AgentTile key={`agent:${a.id}`} agent={a} cwd={p.alpha.cwd} />), ...p.betas.map((b) => <Tile key={b.id} session={b} />)]
}

/**
 * The pack tile: one cell for every beta of an alpha, each a real (small) tile — its conversation,
 * the gold fox, a click to focus it. The alpha's own tile (or the focus pane, where it usually is)
 * stays where it was; this cell stands for the pack. ⤢ opens the pack over the grid with every
 * beta full size and a prompt bar each.
 */
export function PackTile({ pack, onOpen }: { pack: Pack; onOpen: () => void }) {
  const { alpha } = pack
  const needs = packNeedy(pack)
  const working = packWorking(pack)
  const n = packSize(pack)
  const cols = n <= 2 ? 1 : 2
  return (
    <div className={`tile tile-pack ${needs ? 'attention' : ''}`}>
      <header className="pane-head">
        <button className="slot slot-pack" title={`The alpha: slot ${alpha.slot} “${alpha.name}” (click to focus it)`} onClick={() => void window.deck.command({ type: 'focus', slot: alpha.slot! })}>
          α{alpha.slot}
        </button>
        <Fox anim={packPose(pack)} scale={1} coat="gold" title={needs ? `${needs} need${needs === 1 ? 's' : ''} you` : working ? `${working} working` : 'waiting'} />
        <span className="name" title={alpha.name}>
          wolfpack · {alpha.name}
        </span>
        <span className="badge" title={`${working} working, ${needs} needing you`}>
          {n} {n === 1 ? 'agent' : 'agents'}
        </span>
        <span className="spacer" />
        <button className="ghost pack-open" title="Open the pack over the grid: every beta full size, a prompt bar each" onClick={onOpen}>
          <Maximize2 size={12} />
        </button>
      </header>
      <div className="pack-mini" style={{ ['--pc' as string]: cols }}>
        {packTiles(pack)}
      </div>
    </div>
  )
}
