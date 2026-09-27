// The leash on a wolfpack member, from the renderer's side. A pause, a resume, a kill: the
// commands are main's (`leashPause` / `leashResume` / `leashCancel`, main/agents.ts). A pause's
// optional note is asked for in one dialog the App renders (LeashDialog), raised by a window
// event, like a path opening the preview pane; a kill asks nothing.

import type { AgentView, SessionView } from '@shared/types'
import { agentName } from '@shared/types'

/** Who is being leashed: a subagent (by agent id) or a beta session (by deck id). */
export interface LeashTarget {
  kind: 'agent' | 'beta'
  id: string
  name: string
  /** The agent's type, or the beta's model: the dialog's subtitle. */
  detail: string
}

export interface LeashAsk {
  target: LeashTarget
  action: 'pause'
}

const EVENT = 'deck:leash'

export function leashOfAgent(a: AgentView): LeashTarget {
  return { kind: 'agent', id: a.id, name: agentName(a), detail: a.type }
}

export function leashOfBeta(s: SessionView): LeashTarget {
  return { kind: 'beta', id: s.id, name: s.pack?.task || s.name, detail: s.model || 'beta session' }
}

/** Open the pause dialog (an optional note for the alpha). */
export function askLeash(ask: LeashAsk): void {
  window.dispatchEvent(new CustomEvent<LeashAsk>(EVENT, { detail: ask }))
}

export function onLeash(cb: (ask: LeashAsk) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<LeashAsk>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

/** Resume needs no words: straight to main. */
export function resumeLeash(id: string): void {
  void window.deck.command({ type: 'leashResume', id })
}

/** Kill a member, no questions asked (the alpha is told in one line). */
export function killLeash(id: string): void {
  void window.deck.command({ type: 'leashCancel', id })
}

/** Kill a session's whole wolfpack: every subagent and beta, the alpha told once. */
export function killPack(alpha: string): void {
  void window.deck.command({ type: 'killPack', alpha })
}
