// The PS2 pane's window event (open / close / toggle), the Pokemon way: kept apart from lib/ps2.ts so a
// tile that only closes the pane (Tile, PackTile) never pulls the emulator into its chunk.

const EVENT = 'deck:ps2'

export type Ps2Want = boolean | 'toggle'

export function openPs2(): void {
  window.dispatchEvent(new CustomEvent<Ps2Want>(EVENT, { detail: true }))
}
export function closePs2(): void {
  window.dispatchEvent(new CustomEvent<Ps2Want>(EVENT, { detail: false }))
}
export function togglePs2(): void {
  window.dispatchEvent(new CustomEvent<Ps2Want>(EVENT, { detail: 'toggle' }))
}

export function onPs2(cb: (want: Ps2Want) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<Ps2Want>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
