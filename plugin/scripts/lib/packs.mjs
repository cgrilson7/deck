// Overlay packs, compiled: art the CLI knows (PNGs under plugin/data/sprites/) → the plain-data Pack the
// runtime in gbplaces.mjs paints (docs/sprites/reports/skill-design.md §3: packs are DATA, the places are
// code). Node-side — it reads files — so the renderer never imports it; the pack crosses the door as JSON.

import { readFileSync } from 'node:fs'
import { decodePng, foxFrames } from './sprites.mjs'
import { placeFrame } from './gbplaces.mjs'

const art = (name) => decodePng(readFileSync(new URL(`../../data/sprites/${name}`, import.meta.url)))

// lib/fox.ts's paces: idle 5 frames in 1400ms, run 8 in 550ms (sprites.mjs's FOX_MS).
const FOX_MS = { idle: 280, run: 69 }
// His coat as an OBJ palette: 0 is transparent for sprites (white here), 1 white, 2 Village's orange,
// 3 the outline — COPIED from sprites.mjs's FOX_COAT (not exported there; that file is the gag's).
export const FOX_COAT = ['#ffffff', '#ffffff', '#d67941', '#2f2f2e']

/** Foxtrot for a place: the idle tail-wag and the run cycle from fox-idle.png / fox-run.png, in OBJ palette 0 (Red's). */
export function foxtrotPlace() {
  const idle = foxFrames(art('fox-idle.png')).map(placeFrame)
  const run = foxFrames(art('fox-run.png')).map(placeFrame)
  return { frames: { idle, run }, ms: { ...FOX_MS }, palette: { obj: 0, colours: FOX_COAT.slice() } }
}

/** Foxtrot as the player AND the follower (two foxes; the follower wears the same palette, OBJ 0 is shared anyway). */
export function foxtrotPack() {
  const fox = foxtrotPlace()
  return { name: 'foxtrot', v: 1, places: { player: fox, follower: fox } }
}

/** Pikachu follows unseen: the follower's tiles zeroed. */
export function blankPack() {
  return { name: 'blank', v: 1, places: { follower: { blank: true } } }
}

/** The arts `sprite.mjs put <place> <art>` knows: each a Pack whose places are what the art can fill. */
export const ARTS = { foxtrot: foxtrotPack, blank: blankPack }
