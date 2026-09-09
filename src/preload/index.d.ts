import type { DeckApi } from '@shared/types'

declare global {
  interface Window {
    deck: DeckApi
    deckErrors: { onError(cb: (msg: string) => void): () => void }
  }
}

export {}
