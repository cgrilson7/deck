// The leash on a wolfpack member, from the renderer's side. A pause, a resume, a cancel with a
// reason: the commands are main's (`leashPause` / `leashResume` / `leashCancel`, main/agents.ts),
// and the reason (or a pause note) is asked for in one dialog the App renders (LeashDialog), so
// a tile head, the agent pane, a beta's focus pane and the phone all ask the same way: a window
// event, like a path opening the preview pane.

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
  action: 'pause' | 'cancel'
}

const EVENT = 'deck:leash'

export function leashOfAgent(a: AgentView): LeashTarget {
  return { kind: 'agent', id: a.id, name: agentName(a), detail: a.type }
}

export function leashOfBeta(s: SessionView): LeashTarget {
  return { kind: 'beta', id: s.id, name: s.pack?.task || s.name, detail: s.model || 'beta session' }
}

/** Open the dialog: a pause asks for an optional note, a cancel for the reason the alpha will act on. */
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
