// The Rushing Attack marathon as the renderer sees it: main's count (main/marathon.ts), pushed on every
// change, plus when it arrived — the race clock ticks on from there between pushes.

import { useEffect, useState } from 'react'
import type { MarathonState } from '@shared/types'

export type MarathonView = MarathonState & { receivedAt: number }

let current: MarathonView | null = null
const listeners = new Set<(m: MarathonView) => void>()
let wired = false

function wire(): void {
  if (wired) return
  wired = true
  const take = (s: MarathonState) => {
    current = { ...s, receivedAt: Date.now() }
    for (const l of listeners) l(current)
  }
  window.deck.onMarathon(take)
  window.deck.marathon().then(take, () => {})
}

export function useMarathon(): MarathonView | null {
  const [m, setM] = useState<MarathonView | null>(current)
  useEffect(() => {
    wire()
    listeners.add(setM)
    if (current) setM(current)
    return () => {
      listeners.delete(setM)
    }
  }, [])
  return m
}
