// A one-channel bus between plugin tiles: the translator announces each finished translation
// and the vocabulary tile looks up single words from it. Plain DOM events on window, so the
// tiles stay independent components with no shared store.

import type { TranslateResult } from '@shared/types'

const EVENT = 'deck:translated'

/** A translation plus the store row it was saved as (null when it was not saved yet). */
export type Announced = TranslateResult & { id: number | null }

export function announceTranslation(r: Announced): void {
  window.dispatchEvent(new CustomEvent<Announced>(EVENT, { detail: r }))
}

export function onTranslation(cb: (r: Announced) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<Announced>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
