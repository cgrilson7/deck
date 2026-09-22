#!/usr/bin/env node
// Regenerates plugin/data/sprites/, the two 56×56 four-shade battle pictures the trainer's
// `sprite` command paints over a battle (plugin/scripts/lib/sprites.mjs): the Notes app icon
// for the enemy's front picture, the Village logo for your mon's back picture. Both are
// CONVERTED from the real artwork, never redrawn:
//
//   node scripts/sprites.mjs [--village <1024.png>] [--notes <icon.png>] [--preview <dir>]
//
//   village.png  ~/slay/ios/slay/Images.xcassets/AppIcon.appiconset/1024.png — white strokes on a
//                gradient square. Only the strokes are kept (a pixel is stroke when min(r,g,b) is
//                high; a 56×56 cell is stroke when enough of it is): the big ring, the three small
//                rings, the three pills = shade 0; the disc inside the ring dithered from shade 1
//                to shade 2, the icon's own gradient, so the white reads; one cell of shade 3 outside the ring, since white on the battle screen's
//                white would not; the square itself is dropped (shade 0 = see-through).
//   notes.png    ~/Downloads/Notes_(iOS_26)_app_icon.png — boxed down to 56×56: the yellow header
//                shade 1, the grey rules and the perforation shade 2, the paper shade 0, and the
//                opaque cells that border transparency shade 3, or the paper would vanish too.
//
// The PNGs are greys (255 / 170 / 85 / 0 = shades 0–3), which is all `shadesOf` looks at; the
// colours on screen are whatever palette the game gave that slot's species.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PIC, decodePng, shadesOf } from '../plugin/scripts/lib/sprites.mjs'
import { encodePng } from '../plugin/scripts/lib/door.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'data', 'sprites')

const argv = process.argv.slice(2)
const flag = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const VILLAGE = flag('village', join(homedir(), 'slay/ios/slay/Images.xcassets/AppIcon.appiconset/1024.png'))
const NOTES = flag('notes', join(homedir(), 'Downloads/Notes_(iOS_26)_app_icon.png'))
const PREVIEW = flag('preview', null)

/** Every 56×56 cell of a picture as the source pixels under it: fn(pixel) summed, over the count. */
function cells(png, fns) {
  const out = fns.map(() => new Float64Array(PIC * PIC))
  const count = new Float64Array(PIC * PIC)
  for (let y = 0; y < png.h; y++)
    for (let x = 0; x < png.w; x++) {
      const i = Math.floor((y * PIC) / png.h) * PIC + Math.floor((x * PIC) / png.w)
      const p = png.rgba.subarray((y * png.w + x) * 4, (y * png.w + x) * 4 + 4)
      count[i]++
      fns.forEach((fn, k) => (out[k][i] += fn(p)))
    }
  for (const o of out) for (let i = 0; i < o.length; i++) o[i] /= count[i]
  return out
}

const at = (a, x, y) => (x < 0 || y < 0 || x >= PIC || y >= PIC ? 0 : a[y * PIC + x])
const near = (a, x, y, diagonal) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && (diagonal || !dx || !dy) && at(a, x + dx, y + dy)) return true
  return false
}

// ---- Village ------------------------------------------------------------------------------------

const STROKE_WHITE = 232 // min(r,g,b) of a stroke pixel; the square's blue never gets near
const STROKE_COVER = 0.42 // how much of a cell must be stroke: the strokes are ~1.7 cells wide
// The disc runs shade 1 (top left) to shade 2 (bottom right) through an ordered dither: the
// icon's own yellow-to-salmon gradient, in whatever two colours the slot's palette has.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const disc = (x, y) => (((x + y) / (2 * (PIC - 1))) * 1.5 - 0.25 > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 2 : 1)

function village(png) {
  const [cover] = cells(png, [(p) => (Math.min(p[0], p[1], p[2]) >= STROKE_WHITE ? 1 : 0)])
  const stroke = Uint8Array.from(cover, (c) => (c >= STROKE_COVER ? 1 : 0))
  // The big ring's radius, in cells: the farthest stroke cell from the centre.
  let ring = 0
  for (let y = 0; y < PIC; y++) for (let x = 0; x < PIC; x++) if (stroke[y * PIC + x]) ring = Math.max(ring, Math.hypot(x + 0.5 - PIC / 2, y + 0.5 - PIC / 2))
  const shades = new Uint8Array(PIC * PIC)
  for (let y = 0; y < PIC; y++)
    for (let x = 0; x < PIC; x++) {
      const i = y * PIC + x
      if (stroke[i]) continue
      const inside = Math.hypot(x + 0.5 - PIC / 2, y + 0.5 - PIC / 2) < ring - 0.5
      shades[i] = inside ? disc(x, y) : near(stroke, x, y, true) ? 3 : 0
    }
  return shades
}

// ---- Notes --------------------------------------------------------------------------------------

const INK_COVER = 0.16 // how much of a cell must be grey ink (a rule, a perforation dot)

function notes(png) {
  const [alpha, yellow, ink] = cells(png, [
    (p) => p[3] / 255,
    (p) => (p[3] > 200 && p[0] - p[2] > 90 ? 1 : 0),
    (p) => (p[3] > 200 && p[0] - p[2] < 30 && 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] < 212 ? 1 : 0)
  ])
  const solid = Uint8Array.from(alpha, (a) => (a >= 0.5 ? 1 : 0))
  const clear = Uint8Array.from(solid, (s) => 1 - s)
  const shades = new Uint8Array(PIC * PIC)
  for (let y = 0; y < PIC; y++)
    for (let x = 0; x < PIC; x++) {
      const i = y * PIC + x
      if (!solid[i]) continue
      const edge = x === 0 || y === 0 || x === PIC - 1 || y === PIC - 1 || near(clear, x, y, false)
      shades[i] = edge ? 3 : yellow[i] >= 0.5 ? 1 : ink[i] >= INK_COVER ? 2 : 0
    }
  return shades
}

// ---- out ----------------------------------------------------------------------------------------

function png(shades, scale = 1) {
  const rgba = new Uint8Array(PIC * PIC * 4)
  shades.forEach((s, i) => rgba.set([255 - s * 85, 255 - s * 85, 255 - s * 85, 255], i * 4))
  return encodePng(rgba, PIC, PIC, scale)
}

mkdirSync(OUT, { recursive: true })
for (const [name, src, make] of [['village', VILLAGE, village], ['notes', NOTES, notes]]) {
  const shades = make(decodePng(readFileSync(src)))
  const bytes = png(shades)
  // What is written must read back as what was meant.
  if (Buffer.compare(Buffer.from(shadesOf(decodePng(bytes))), Buffer.from(shades))) throw new Error(`${name}: the PNG does not read back`)
  writeFileSync(join(OUT, `${name}.png`), bytes)
  if (PREVIEW) writeFileSync(join(PREVIEW, `${name}@8.png`), png(shades, 8))
  const tally = [0, 1, 2, 3].map((s) => shades.filter((v) => v === s).length)
  console.log(`${name}.png  ← ${src}\n  shades 0–3: ${tally.join(' / ')}`)
}
