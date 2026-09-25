// A subagent from the renderer's side: what its fox does, the one word for its state, how long
// it has been at it, the line it is on right now, and the window event that opens it in the
// center (App owns which one is open, like the Studio).

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AgentView, ChatBlock } from '@shared/types'
import type { FoxAnim } from '../components/Fox'

export type AgentState = 'working' | 'pausing' | 'paused' | 'cancelling' | 'cancelled' | 'done'

/** One word for the head. */
export function agentState(a: AgentView): AgentState {
  if (a.cancelled) return a.endedAt !== null ? 'cancelled' : 'cancelling'
  if (a.endedAt !== null) return 'done'
  if (a.paused) return a.held ? 'paused' : 'pausing'
  return 'working'
}

/** The pose of a subagent's fox: running while it works, held still when paused, down when cancelled, asleep once done. */
export function agentPose(a: AgentView): FoxAnim {
  if (a.cancelled) return 'down'
  if (a.endedAt !== null) return 'sleep'
  if (a.paused) return 'look'
  return 'run'
}

/** "42s", "3m 12s", "1h 04m": how long it has run (or ran). */
export function agentElapsed(a: AgentView, now: number): string {
  const s = Math.max(0, Math.round(((a.endedAt ?? now) - a.startedAt) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** "2 working · 1 paused · 3 finished" for a pack's head. */
export function packSummary(agents: AgentView[]): string {
  let working = 0
  let paused = 0
  let done = 0
  let cancelled = 0
  for (const a of agents) {
    const st = agentState(a)
    if (st === 'working') working++
    else if (st === 'paused' || st === 'pausing') paused++
    else if (st === 'done') done++
    else cancelled++
  }
  const bits: string[] = []
  if (working) bits.push(`${working} working`)
  if (paused) bits.push(`${paused} paused`)
  if (done) bits.push(`${done} finished`)
  if (cancelled) bits.push(`${cancelled} cancelled`)
  return bits.join(' · ')
}

/** A clock that ticks each second while `active`, for the running timers. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}

/** What the agent is on right now: its transcript's last block, live. Null until it has one. */
export function useLastBlock(id: string): ChatBlock | null {
  const [b, setB] = useState<ChatBlock | null>(null)
  useEffect(() => {
    let live = true
    const key = `agent:${id}`
    const last = (blocks: ChatBlock[]) => blocks[blocks.length - 1] ?? null
    setB(null)
    void window.deck.getTranscript(key).then((t) => live && t && setB(last(t.blocks)))
    const off = window.deck.onTranscript((t) => {
      if (t.id === key) setB(last(t.blocks))
    })
    return () => {
      live = false
      off()
    }
  }, [id])
  return b
}

/** A block as one line of plain text (a roster row's second line). */
export function blockLine(b: ChatBlock): string {
  if (b.kind === 'tool') return b.label ? `${b.name} ${b.label}` : b.name
  return b.text.replace(/\s+/g, ' ').trim()
}

const EVENT = 'deck:agentpane'

/** Open a subagent in the center column (null = close it). One you opened is one you are reading: it is kept. */
export function openAgentPane(id: string | null): void {
  if (id) keepAgent(id, true)
  window.dispatchEvent(new CustomEvent<string | null>(EVENT, { detail: id }))
}
export function closeAgentPane(): void {
  openAgentPane(null)
}
export function onAgentPane(cb: (id: string | null) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<string | null>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

// THE AUTO-KILLER: a finished (or cancelled and stopped) agent's row counts down AUTO_DISMISS_MS
// and then its tile entry is dismissed, unless it is KEPT — the row's hold button, or having been
// opened in the center. Letting a kept one go again restarts the count from that moment. The
// state is the renderer's (module level, so paging the grid or a tile remount does not lose it).

export const AUTO_DISMISS_MS = 15_000

const kept = new Set<string>()
/** Agent id → when its count was restarted (a hold let go); else it counts from `endedAt`. */
const restarted = new Map<string, number>()
const sent = new Set<string>()
const subs = new Set<() => void>()
let version = 0

function bump(): void {
  version++
  for (const cb of subs) cb()
}

export function keepAgent(id: string, keep: boolean): void {
  if (kept.has(id) === keep) return
  if (keep) kept.add(id)
  else {
    kept.delete(id)
    restarted.set(id, Date.now())
  }
  bump()
}

/** Re-renders when a hold changes; the value is only a version. */
export function useKeptVersion(): number {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => version
  )
}

export function isKept(id: string): boolean {
  return kept.has(id)
}

/** When this agent's entry goes away by itself: null while it runs or is kept. */
export function dismissAt(a: AgentView): number | null {
  if (a.endedAt === null || kept.has(a.id)) return null
  return Math.max(a.endedAt, restarted.get(a.id) ?? 0) + AUTO_DISMISS_MS
}

/** Whole seconds left on the count, null when there is none. */
export function closesIn(a: AgentView, now: number): number | null {
  const at = dismissAt(a)
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

/** The killer itself, mounted once (App): one timer to the soonest count, dismissing what is due. */
export function useAutoDismiss(agents: AgentView[]): void {
  const v = useKeptVersion()
  useEffect(() => {
    const live = new Set(agents.map((a) => a.id))
    for (const id of [...kept, ...restarted.keys(), ...sent]) {
      if (live.has(id)) continue
      kept.delete(id)
      restarted.delete(id)
      sent.delete(id)
    }
    let soonest = Infinity
    for (const a of agents) {
      const at = dismissAt(a)
      if (at !== null && !sent.has(a.id)) soonest = Math.min(soonest, at)
    }
    if (soonest === Infinity) return
    const t = window.setTimeout(() => {
      const now = Date.now()
      for (const a of agents) {
        const at = dismissAt(a)
        if (at === null || at > now || sent.has(a.id)) continue
        sent.add(a.id)
        void window.deck.command({ type: 'agentDismiss', id: a.id, force: false })
      }
      bump() // anything still counting gets its own timer
    }, Math.max(0, soonest - Date.now()) + 20)
    return () => window.clearTimeout(t)
  }, [agents, v])
}
