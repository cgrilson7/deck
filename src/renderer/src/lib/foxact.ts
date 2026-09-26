// FOXTROT'S ACTS: a one-off performance by the fox in the Foxtrot tile — a pose held for a while,
// with comic bursts over his head — asked for from anywhere in the renderer by a window event, the
// way a path opens the preview. The tile plays the posture alarm through the same thing; anything
// else that wants him to do something (a leap when a long job lands, a sleep, a look) calls
// `foxtrotAct` and needs to know nothing about the tile. No tile showing = nobody listening = no-op.

import type { FoxAnim } from '../components/Fox'

export interface FoxtrotAct {
  /** The pose he holds for the act (the sheet's rows: `leap` is the jump). */
  anim: FoxAnim
  /** How long he holds it (ms); the bursts, if longer, run to their end. */
  ms: number
  /** Comic bursts over his head, 280ms apart (silenced by the `foxBark` setting). */
  words?: readonly string[]
  /** Bursts in the alarm colour (`--blocked`) rather than ink. */
  alarm?: boolean
}

const EVENT = 'deck:foxtrot-act'

export function foxtrotAct(act: FoxtrotAct): void {
  window.dispatchEvent(new CustomEvent<FoxtrotAct>(EVENT, { detail: act }))
}

export function onFoxtrotAct(cb: (act: FoxtrotAct) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<FoxtrotAct>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
