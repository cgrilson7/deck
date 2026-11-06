// The PS1 pane's window event (open / close / toggle), the Pokemon way: kept apart from lib/ps1.ts so a
// tile that only closes the pane (Tile, PackTile) never pulls the emulator into its chunk.

const EVENT = 'deck:ps1'

export type Ps1Want = boolean | 'toggle'

export function openPs1(): void {
  window.dispatchEvent(new CustomEvent<Ps1Want>(EVENT, { detail: true }))
}
export function closePs1(): void {
  window.dispatchEvent(new CustomEvent<Ps1Want>(EVENT, { detail: false }))
}
export function togglePs1(): void {
  window.dispatchEvent(new CustomEvent<Ps1Want>(EVENT, { detail: 'toggle' }))
}

export function onPs1(cb: (want: Ps1Want) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<Ps1Want>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
