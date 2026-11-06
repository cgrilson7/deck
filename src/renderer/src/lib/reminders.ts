// The Reminders pane's door (the tile or the menu asks App for the center column with a window event,
// the Broadcast way), plus the state both views draw: main owns it and pushes every change.

import { useEffect, useState } from 'react'
import type { RemindersState } from '@shared/reminders'

const EVENT = 'deck:reminders'

export type RemindersWant = boolean | 'toggle'

export function openReminders(): void {
  window.dispatchEvent(new CustomEvent<RemindersWant>(EVENT, { detail: true }))
}

export function onRemindersPane(cb: (want: RemindersWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<RemindersWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

export function useReminders(): RemindersState | null {
  const [state, setState] = useState<RemindersState | null>(null)
  useEffect(() => {
    let live = true
    void window.deck.reminders().then((s) => {
      if (live) setState(s)
    })
    const off = window.deck.onReminders(setState)
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}
