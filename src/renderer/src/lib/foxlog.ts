// Foxtrot's log as the renderer sees it: what main kept (main/foxtrot.ts), plus each entry as
// he makes it. `live` is the newest entry that arrived while we were listening — never one
// loaded at boot or after a UI refresh — which is what makes the head in the top bar bark.

import { useEffect, useState } from 'react'
import type { FoxEntry } from '@shared/types'

const KEEP = 1000

export function useFoxLog(): { entries: FoxEntry[]; live: FoxEntry | null } {
  const [entries, setEntries] = useState<FoxEntry[]>([])
  const [live, setLive] = useState<FoxEntry | null>(null)

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
      setLive(e)
    })
    return () => {
      on = false
      off()
    }
  }, [])

  return { entries, live }
}
