// The Broadcast pane's door: the tile (or the menu) asks App for the center column with a window
// event, the Space / Posture way; App keeps the one-pane-at-a-time bookkeeping.

const EVENT = 'deck:broadcast'

export type BroadcastWant = boolean | 'toggle'

export function openBroadcast(): void {
  window.dispatchEvent(new CustomEvent<BroadcastWant>(EVENT, { detail: true }))
}

export function onBroadcastPane(cb: (want: BroadcastWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<BroadcastWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
