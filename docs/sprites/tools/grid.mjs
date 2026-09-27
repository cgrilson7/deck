// text grid → greys PNG (255/170/85/0 = shades 0-3) + an 8x preview (+ optional 2x-on-white "screen size" preview)
// usage: node grid.mjs <in.txt> <outbase>   chars: 0 . = shade0  1 : = shade1  2 + = shade2  3 # = shade3 ; lines starting with ';' ignored
import { readFileSync, writeFileSync } from 'node:fs'
import { encodePng } from '/Users/colin/deck/plugin/scripts/lib/door.mjs'
const MAP = { '0': 0, '.': 0, '1': 1, ':': 1, '2': 2, '+': 2, '3': 3, '#': 3 }
const GREY = [255, 170, 85, 0]
export function parse(txt) {
  const rows = txt.split('\n').filter((l) => l.length && !l.startsWith(';')).map((l) => [...l.replace(/\s+$/, '')].map((c) => { if (!(c in MAP)) throw new Error(`bad char ${c}`); return MAP[c] }))
  const w = Math.max(...rows.map((r) => r.length))
  return { w, h: rows.length, px: rows.map((r) => [...r, ...Array(w - r.length).fill(0)]) }
}
export function toRgba(g, pal = GREY) {
  const out = new Uint8Array(g.w * g.h * 4)
  g.px.flat().forEach((s, i) => { const v = pal[s]; out.set(Array.isArray(v) ? [...v, 255] : [v, v, v, 255], i * 4) })
  return out
}
if (process.argv[1].endsWith('grid.mjs')) {
  const [, , inp, base] = process.argv
  const g = parse(readFileSync(inp, 'utf8'))
  writeFileSync(`${base}.png`, encodePng(toRgba(g), g.w, g.h, 1))
  writeFileSync(`${base}-8x.png`, encodePng(toRgba(g), g.w, g.h, 8))
  const gbc = process.env.PAL === 'fox' ? [[190, 230, 190], [255, 255, 255], [214, 121, 65], [47, 47, 46]] : [[255, 255, 255], [248, 208, 72], [200, 88, 32], [24, 16, 16]]
  writeFileSync(`${base}-8x-color.png`, encodePng(toRgba(g, gbc), g.w, g.h, 8))
  console.log(`${g.w}x${g.h} rows=${g.h}`, g.px.some((r) => r.length !== g.w) ? 'RAGGED' : '')
}
