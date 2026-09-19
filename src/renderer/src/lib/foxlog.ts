// Foxtrot's log as the renderer sees it: what main kept (main/foxtrot.ts), plus each entry as
// he makes it.

import { useEffect, useState } from 'react'
import type { FoxEntry } from '@shared/types'

const KEEP = 1000

export function useFoxLog(): FoxEntry[] {
  const [entries, setEntries] = useState<FoxEntry[]>([])

  useEffect(() => {
    let on = true
    void window.deck.foxLog().then((xs) => {
      if (!on) return
      // Anything that arrived live before the fetch resolved stays, after what main kept.
      setEntries((cur) => {
        const ids = new Set(xs.map((x) => x.id))
        return [...xs, ...cur.filter((x) => !ids.has(x.id))].slice(-KEEP)
      })
    })
    const off = window.deck.onFoxEntry((e) => {
      setEntries((cur) => (cur.some((x) => x.id === e.id) ? cur : [...cur, e].slice(-KEEP)))
    })
    return () => {
      on = false
      off()
    }
  }, [])

  return entries
}
