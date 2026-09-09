// A one-channel bus between plugin tiles: the translator announces each finished translation
// and the vocabulary tile looks up single words from it. Plain DOM events on window, so the
// tiles stay independent components with no shared store.

import type { TranslateResult } from '@shared/types'

const EVENT = 'deck:translated'

export function announceTranslation(r: TranslateResult): void {
  window.dispatchEvent(new CustomEvent<TranslateResult>(EVENT, { detail: r }))
}

export function onTranslation(cb: (r: TranslateResult) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<TranslateResult>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
