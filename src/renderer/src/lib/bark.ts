// Foxtrot's bark, the slay kind: silent comic bursts ("YIP!" "ARF!" "CHRRP!") in Press
// Start 2P, three of them 280ms apart, each alive 620ms (the same run as slay's
// FoxBarkHero). `useBark` is the edge detector that decides when one happens: the moment
// a session starts needing you (Notification / blocked / bell / a dead pane) or the
// moment Claude finishes writing (Stop → idle). Steady states never bark; only the
// transition.

import { useEffect, useRef, useState } from 'react'
import type { SessionStatus } from '@shared/types'

export const BARK_WORDS = ['YIP!', 'ARF!', 'CHRRP!'] as const
export const BARK_EVERY_MS = 280
export const BARK_LIFE_MS = 620
/** Rotation and offset per burst, so the three don't stack. */
export const BARK_SCATTER = [
  { rot: -8, dx: 0, dy: 0 },
  { rot: 7, dx: 20, dy: -6 },
  { rot: -3, dx: 8, dy: -10 }
] as const
/** The whole run: last burst starts at 2 × EVERY and lives LIFE. */
export const BARK_MS = BARK_EVERY_MS * (BARK_WORDS.length - 1) + BARK_LIFE_MS
/** Two signals within this window (hook, then the fleet poll agreeing) are one bark. */
const REBARK_MS = 3000

const lastBark = new Map<string, number>()

/**
 * A run id that increments each time a session starts needing you or finishes a turn,
 * and drops back to 0 when the run is over. The first render never barks (mount,
 * refresh UI, and a tile swapping panes all start fresh), so a full grid of waiting
 * sessions is quiet at boot.
 */
export function useBark(id: string, status: SessionStatus, attention: boolean): number {
  const [run, setRun] = useState(0)
  const prev = useRef<{ status: SessionStatus; needs: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const count = useRef(0)

  useEffect(() => {
    const needs = attention || status === 'blocked'
    const p = prev.current
    prev.current = { status, needs }
    if (!p) return
    const finished = p.status === 'busy' && status === 'idle'
    if (!(needs && !p.needs) && !finished) return
    const now = Date.now()
    if (now - (lastBark.get(id) ?? 0) < REBARK_MS) return
    lastBark.set(id, now)
    setRun(++count.current)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setRun(0), BARK_MS)
  }, [id, status, attention])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  return run
}
