#!/usr/bin/env node
// Regenerates plugin/data/sprites/, the two 56×56 four-shade battle pictures the trainer's
// `sprite` command paints over a battle (plugin/scripts/lib/sprites.mjs): the Notes app icon
// for the enemy's front picture, the Village logo for your mon's back picture. Both are
// CONVERTED from the real artwork, never redrawn:
//
//   node scripts/sprites.mjs [--village <1024.png>] [--notes <icon.png>] [--preview <dir>]
//
//   fox-idle.png / fox-run.png   FOXTROT for the overworld, from the deck's own sheet
//                (src/renderer/src/assets/fox.png: 14×7 frames of 32px, the art at x 4–25, y 14–31;
//                row 0 = idle tail-wag, 5 frames; row 2 = run, 8 frames — lib/fox.ts): each frame's
//                22×18 art boxed down to fill a 16×16 cell (Red's size; a little taller than true), as
//                a strip of frames 16px apart, MIRRORED to face left (the game's frame set; right is its
//                flip). Per cell the source pixels under it VOTE: outline
//                (the dark grey) = 3, the oranges = 2, white and the light grey = 1, clear = 0; an
//                outline vote wins a tie, so the line around him survives the shrink. (Kept as the
//                `-fit` preview; what ships is the SQUEEZE: rows 1:1, the 22 columns voted into 16 —
//                the whole fox, tail tip and all; the full shrink was unreadable, a crop lost the tail.)
//   fox-back.png   Foxtrot for the battle intro, in Red's back slot (56×56): the idle frames with rows
//                at 3× (54, on the floor) and the 22 columns spread over the 56 (2.5×), facing the
//                enemy as the sheet faces.
//
//   village.png  ~/slay/ios/slay/Images.xcassets/AppIcon.appiconset/1024.png — white strokes on a
//                gradient square. Only the strokes are kept (a pixel is stroke when min(r,g,b) is
//                high; a 56×56 cell is stroke when enough of it is): the big ring, the three small
//                rings, the three pills = shade 0; the disc inside the ring dithered from shade 1
//                to shade 2, the icon's own gradient, so the white reads; one cell of shade 3 outside the ring, since white on the battle screen's
//                white would not; the square itself is dropped (shade 0 = see-through).
//   notes.png    ~/Downloads/Notes_(iOS_26)_app_icon.png — boxed down to 48×48, centred in the 56: the yellow header
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

/** Every 56×56 cell of a picture as the source pixels under it: fn(pixel) summed, over the count. The picture fills a `size` box at `off` (the rest is empty). */
function cells(png, fns, size = PIC, off = 0) {
  const out = fns.map(() => new Float64Array(PIC * PIC))
  const count = new Float64Array(PIC * PIC).fill(1)
  for (let y = 0; y < png.h; y++)
    for (let x = 0; x < png.w; x++) {
      const i = (off + Math.floor((y * size) / png.h)) * PIC + off + Math.floor((x * size) / png.w)
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
const NOTES_SIZE = 48 // the icon boxed to 48 of the 56, centred: full bleed was a little too large beside Village

function notes(png) {
  const [alpha, yellow, ink] = cells(png, [
    (p) => p[3] / 255,
    (p) => (p[3] > 200 && p[0] - p[2] > 90 ? 1 : 0),
    (p) => (p[3] > 200 && p[0] - p[2] < 30 && 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] < 212 ? 1 : 0)
  ], NOTES_SIZE, (PIC - NOTES_SIZE) / 2)
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

// ---- Foxtrot ------------------------------------------------------------------------------------

const FOX = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src', 'assets', 'fox.png')
const FOX_ART = { x: 4, y: 14, w: 22, h: 18 }
const FOX_ROWS = { idle: [0, 5], run: [2, 8] }
const CELL = 16
const FOX_W = 16
const FOX_H = 16 // the whole cell: 22×18 → 16×16 stretches him a little taller, which reads better than 16×13 with air above

function foxShade(p) {
  if (p[3] < 128) return 0
  const [r, g, b] = p
  if (r < 100 && g < 100 && b < 100) return 3 // the outline (47,47,46) and its shadows
  if (r > 140 && g < 140) return 2 // the two oranges
  return 1 // white, the light grey
}

/** One 32px frame of the sheet → 16×16 shades, the fox on the floor. */
function foxFrame(png, row, col) {
  const votes = Array.from({ length: CELL * CELL }, () => [0, 0, 0, 0])
  for (let sy = 0; sy < FOX_ART.h; sy++)
    for (let sx = 0; sx < FOX_ART.w; sx++) {
      const p = png.rgba.subarray(((row * 32 + FOX_ART.y + sy) * png.w + col * 32 + FOX_ART.x + sx) * 4)
      const dx = FOX_W - 1 - Math.floor((sx * FOX_W) / FOX_ART.w) // mirrored: the sheet faces right, the game's frame set faces LEFT (right is its flip)
      const dy = CELL - FOX_H + Math.floor((sy * FOX_H) / FOX_ART.h)
      votes[dy * CELL + dx][foxShade(p)]++
    }
  return Uint8Array.from(votes, settle)
}

/** The votes of a cell → its shade: nothing under it (or mostly air) is clear; an outline vote wins a tie. */
function settle(v) {
  const opaque = v[1] + v[2] + v[3]
  if (!opaque || (opaque < v[0] && opaque < 2)) return 0
  let best = 3
  for (const s of [2, 1]) if (v[s] > v[best]) best = s
  return best
}

/** One frame with rows 2–17 of the art at 1:1 and its 22 columns SQUEEZED into 16 (a vote per cell), mirrored — the whole fox, tail tip and all. */
function foxSqueeze(png, row, col) {
  const votes = Array.from({ length: CELL * CELL }, () => [0, 0, 0, 0])
  for (let dy = 0; dy < CELL; dy++)
    for (let sx = 0; sx < FOX_ART.w; sx++) {
      const sy = dy + 2
      const dx = CELL - 1 - Math.floor((sx * CELL) / FOX_ART.w) // mirrored: the head, at the sheet's right, lands at the left
      votes[dy * CELL + dx][foxShade(png.rgba.subarray(((row * 32 + FOX_ART.y + sy) * png.w + col * 32 + FOX_ART.x + sx) * 4))]++
    }
  return Uint8Array.from(votes, settle)
}

/** One idle frame into a 56×56 back picture: rows at 3× (54), the 22 columns spread over all 56 (2.5×: nearest-neighbour, so a column is two or three wide), on the floor — the whole fox. */
function foxBackFrame(png, row, col) {
  const out = new Uint8Array(PIC * PIC)
  const top = PIC - FOX_ART.h * 3
  for (let dy = top; dy < PIC; dy++)
    for (let dx = 0; dx < PIC; dx++) {
      const sx = Math.floor((dx * FOX_ART.w) / PIC)
      const sy = Math.floor((dy - top) / 3)
      out[dy * PIC + dx] = foxShade(png.rgba.subarray(((row * 32 + FOX_ART.y + sy) * png.w + col * 32 + FOX_ART.x + sx) * 4))
    }
  return out
}

function foxBackStrip() {
  const png = decodePng(readFileSync(FOX))
  const [row, n] = FOX_ROWS.idle
  const shades = new Uint8Array(PIC * n * PIC)
  for (let i = 0; i < n; i++) { const f = foxBackFrame(png, row, i); for (let y = 0; y < PIC; y++) shades.set(f.subarray(y * PIC, y * PIC + PIC), y * PIC * n + i * PIC) }
  return { shades, w: PIC * n, h: PIC }
}

function foxStrip(name, crop = false) {
  const png = decodePng(readFileSync(FOX))
  const [row, n] = FOX_ROWS[name]
  const frames = Array.from({ length: n }, (_, i) => (crop ? foxSqueeze : foxFrame)(png, row, i))
  const shades = new Uint8Array(CELL * n * CELL)
  frames.forEach((f, i) => { for (let y = 0; y < CELL; y++) shades.set(f.subarray(y * CELL, y * CELL + CELL), y * CELL * n + i * CELL) })
  return { shades, w: CELL * n, h: CELL }
}

// ---- out ----------------------------------------------------------------------------------------

function png(shades, scale = 1, w = PIC, h = PIC) {
  const rgba = new Uint8Array(w * h * 4)
  shades.forEach((s, i) => rgba.set([255 - s * 85, 255 - s * 85, 255 - s * 85, 255], i * 4))
  return encodePng(rgba, w, h, scale)
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
for (const name of ['idle', 'run']) {
  const { shades, w, h } = foxStrip(name, true)
  writeFileSync(join(OUT, `fox-${name}.png`), png(shades, 1, w, h))
  if (PREVIEW) writeFileSync(join(PREVIEW, `fox-${name}@8.png`), png(shades, 8, w, h))
  if (PREVIEW) { const fit = foxStrip(name); writeFileSync(join(PREVIEW, `fox-${name}-fit@8.png`), png(fit.shades, 8, fit.w, fit.h)) }
  console.log(`fox-${name}.png  ← ${FOX} row ${FOX_ROWS[name][0]}: ${FOX_ROWS[name][1]} frames of ${CELL}×${CELL}`)
}
{
  const { shades, w, h } = foxBackStrip()
  writeFileSync(join(OUT, 'fox-back.png'), png(shades, 1, w, h))
  if (PREVIEW) writeFileSync(join(PREVIEW, 'fox-back@3.png'), png(shades, 3, w, h))
  console.log(`fox-back.png  ← ${FOX} row ${FOX_ROWS.idle[0]} at 3×: ${FOX_ROWS.idle[1]} frames of ${PIC}×${PIC}`)
}
