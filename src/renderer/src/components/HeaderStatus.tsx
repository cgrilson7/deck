import { useRef } from 'react'
import { PERMISSION_MODES } from '@shared/models'
import type { AgentView, DeckState, SessionView } from '@shared/types'
import { openAgentPane } from '../lib/agents'

/**
 * The deck in a few words, in the top bar: `3 working · 2 need you · 1 held · 2 unattended`.
 * Each is a chip that is only there while its count is not zero, and each GOES somewhere — a
 * click focuses the next session it counts (round and round), `held` opens the held agent in
 * the center — so none of them is a number with nowhere to go. NAVIGATION ONLY: nothing here
 * stops, kills or dismisses anything. `unattended` = sessions in a permission mode that does not
 * ask (auto / dontAsk / bypassPermissions): worth knowing at a glance, tinted as the warning it is.
 */
export function HeaderStatus({ state, agents }: { state: DeckState; agents: AgentView[] }) {
  const top = state.open.filter((s) => !s.pack)
  const needs = (s: SessionView) => s.attention || s.status === 'blocked'
  const working = state.open.filter((s) => s.status === 'busy' && !needs(s))
  // The one you are looking at does not need pointing out.
  const needy = state.open.filter((s) => needs(s) && s.slot !== state.focusSlot)
  const held = agents.filter((a) => a.held)
  const risky = top.filter((s) => PERMISSION_MODES.find((m) => m.id === s.permissionMode)?.risky)

  // Where each chip's last click went, so the next one goes on from there.
  const at = useRef<Record<string, string>>({})
  const next = (chip: string, list: SessionView[]) => {
    if (list.length === 0) return
    const i = list.findIndex((s) => s.id === at.current[chip])
    const focused = list.findIndex((s) => s.slot === state.focusSlot)
    const s = list[((i >= 0 ? i : focused) + 1) % list.length]
    at.current[chip] = s.id
    void window.deck.command({ type: 'focus', slot: s.slot! })
  }
  const names = (list: { name: string }[]) => list.map((s) => `“${s.name}”`).join(', ')

  return (
    <div className="hstat">
      {working.length > 0 && (
        <button className="hchip is-working" onClick={() => next('working', working)} title={`Working: ${names(working)} — click to step through them`}>
          <b>{working.length}</b> working
        </button>
      )}
      {needy.length > 0 && (
        <button className="hchip is-needy" onClick={() => window.deck.command({ type: 'jumpAttention' })} title={`${names(needy)} — jump to the next one that needs you (⌘↩)`}>
          <b>{needy.length}</b> need{needy.length === 1 ? 's' : ''} you
        </button>
      )}
      {held.length > 0 && (
        <button className="hchip is-held" onClick={() => openAgentPane(held[0].id)} title={`Held on the leash, waiting for ▶: ${held.map((a) => `“${a.description || a.task || a.type}”`).join(', ')} — click to open`}>
          <b>{held.length}</b> held
        </button>
      )}
      {risky.length > 0 && (
        <button className="hchip is-risky" onClick={() => next('risky', risky)} title={`In a permission mode that does not ask: ${risky.map((s) => `“${s.name}” (${s.permissionMode})`).join(', ')} — click to step through them`}>
          <b>{risky.length}</b> unattended
        </button>
      )}
      {top.length === 0 && <span className="hstat-none">no sessions open</span>}
    </div>
  )
}
