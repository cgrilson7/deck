// Types for gbplaces.mjs, THE OVERWORLD RUNTIME both Game Boy ends step after every core step (the
// headless door's `step()`, the renderer's `stepCore`). Pure JS like gbcore.mjs; keep this file in step
// with gbplaces.mjs by hand (it is the renderer's only view of it).

import type { GbColour, GbCore } from './gbcore.mjs'

/** The places this runtime knows, in the order `step` keeps them. */
export const PLACES: readonly ['player', 'follower']
export type Place = (typeof PLACES)[number]
/** Bytes in one place frame: 3 standing frames (down / up / left) × 4 tiles × 16 bytes. */
export const FRAME_BYTES: 192

/** An OBJ sprite place's art: base64 frames of FRAME_BYTES each, the animation's pace, and the OBJ palette it wears. */
export interface ObjPlace {
  frames: { idle: string[]; run: string[] }
  ms: { idle: number; run: number }
  palette?: { obj: number; colours: GbColour[] }
}

/** A named overlay pack: data the CLI compiles (plugin/scripts/lib/packs.mjs), painted by the runtime. */
export interface Pack {
  name: string
  v: 1
  places: { player?: ObjPlace; follower?: ObjPlace | { blank: true } }
}

/** What `step` last did in a place: wrote something, found it ours, stood back (text box / menu, or not stepped yet), or a battle. */
export type PlaceState = 'painted' | 'kept' | 'idle' | 'battle'

/** The packs that are on, per place the newest; `step` keeps them in VRAM (compare first, write only on difference). */
export class Overlays {
  constructor()
  /** Install or replace a pack by name (it then wins every place it fills). Throws on a bad pack: nothing changes. */
  set(pack: Pack): void
  /** Remove a pack; false when there was none. A place left with no pack gets the game's own tiles (and coat) back at the next step that may write. */
  clear(name: string): boolean
  list(): Array<{ name: string; places: string[] }>
  status(): Partial<Record<Place, { pack: string; state: PlaceState }>>
  /** After EVERY core step. `now` in milliseconds picks the animation frame. */
  step(core: GbCore, now: number): void
  toJSON(): { v: 1; packs: Pack[]; last: Record<string, { pack: string; state: PlaceState }> }
  static fromJSON(data: { packs?: Pack[]; last?: Record<string, { pack: string; state: PlaceState }> }): Overlays
}

/** A 64-byte 16×16 frame (four tiles row-major) → a place frame (that view thrice), base64. */
export function placeFrame(frame64: Uint8Array): string
