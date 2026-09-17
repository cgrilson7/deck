// The Studio from the renderer's side. Opening it is a window event, like a path opening the
// preview pane, so the tile, the menu (⌘⇧I) and anything else can raise the pane in the
// center without a prop chain; App owns the open/closed state. `useStudioJobs` is the gallery:
// main's list, loaded once and replaced wholesale on every `studio:update`.

import { useEffect, useState } from 'react'
import type { StudioJob } from '@shared/types'

const EVENT = 'deck:studio'

export type StudioWant = boolean | 'toggle'

export function openStudio(): void {
  window.dispatchEvent(new CustomEvent<StudioWant>(EVENT, { detail: true }))
}
export function closeStudio(): void {
  window.dispatchEvent(new CustomEvent<StudioWant>(EVENT, { detail: false }))
}
export function toggleStudio(): void {
  window.dispatchEvent(new CustomEvent<StudioWant>(EVENT, { detail: 'toggle' }))
}

export function onStudio(cb: (want: StudioWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<StudioWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

/** Every Studio job, newest first, live. */
export function useStudioJobs(): StudioJob[] {
  const [jobs, setJobs] = useState<StudioJob[]>([])
  useEffect(() => {
    let alive = true
    void window.deck
      .studioJobs()
      .then((j) => alive && setJobs(j))
      .catch(() => {})
    const off = window.deck.onStudio(setJobs)
    return () => {
      alive = false
      off()
    }
  }, [])
  return jobs
}
