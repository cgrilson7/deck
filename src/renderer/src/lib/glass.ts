// THE GLASS THEME's moving part: the wall behind the window (a Wikipedia picture of the day,
// blurred by CSS — `.glass-wall` in styles.css) and the tint read off it, which
// `glassVariant` (shared/themes.ts) turns into the chrome colors. lib/theme.ts calls `syncGlass`
// on every settings change; when a picture arrives (or the day turns) `onChange` has the theme
// applied again. The last picture + tint are kept in localStorage so a boot paints glass at
// once, before main has answered. No xterm in here: the phone loads this too (where
// `wikiBackdrop` rejects, and the wall stays the plain panel color).

import { GLASS_ID, type GlassTint } from '@shared/themes'
import type { DeckSettings, WikiBackdrop } from '@shared/types'

const KEEP = 'glass:last'
/** Today's picture is asked for again this often, so the wall follows the day. */
const RECHECK_MS = 30 * 60 * 1000

interface Kept {
  /** The `glassDate` setting it answers ('' = today's). */
  want: string
  date: string
  title: string
  dataUrl: string
  tint: GlassTint
}

let kept: Kept | null = null
try {
  kept = JSON.parse(localStorage.getItem(KEEP) ?? 'null') as Kept | null
} catch {
  kept = null
}

let wall: HTMLDivElement | null = null
let layers: HTMLDivElement[] = []
let front = 0
let shown = ''
let asked = ''
let askedAt = 0
let timer = 0
let onChange: () => void = () => {}

/** lib/theme.ts registers the re-apply here (it imports us, so not the other way round). */
export function setGlassListener(fn: () => void): void {
  onChange = fn
}

/** The tint of the picture on the wall, or null while there is none (`glassVariant` goes neutral). */
export function glassTint(): GlassTint | null {
  return kept?.tint ?? null
}

/** What is on the wall, for the theme popover. */
export function glassBackdrop(): { date: string; title: string } | null {
  return kept ? { date: kept.date, title: kept.title } : null
}

function paint(dataUrl: string): void {
  if (!wall) {
    wall = document.createElement('div')
    wall.className = 'glass-wall'
    layers = [document.createElement('div'), document.createElement('div')]
    wall.append(...layers)
    document.body.prepend(wall)
  }
  if (dataUrl === shown) return
  shown = dataUrl
  // Two layers trading places: the new picture fades in over the old one.
  front = 1 - front
  layers[front].style.backgroundImage = `url("${dataUrl}")`
  layers[front].classList.add('on')
  layers[1 - front].classList.remove('on')
}

/**
 * The picture's tint, off a 40×40 copy of it: `hue` is the saturation-weighted circular mean
 * (what the picture leans to as a whole), `accentHue` the fullest of 24 hue bins weighted by
 * how vivid the pixel is — the orange of a fox on a field of green, not the green.
 */
async function tintOf(dataUrl: string): Promise<GlassTint> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const n = 40
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = n
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0, n, n)
  const px = ctx.getImageData(0, 0, n, n).data
  const bins = new Array<number>(24).fill(0)
  let x = 0
  let y = 0
  let sat = 0
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255
    const g = px[i + 1] / 255
    const b = px[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    if (d < 0.02) continue
    const s = d / (1 - Math.abs(2 * l - 1))
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = (h * 60 + 360) % 360
    const rad = (h * Math.PI) / 180
    x += Math.cos(rad) * d
    y += Math.sin(rad) * d
    sat += s
    bins[Math.floor(h / 15) % 24] += s * s * (1 - Math.abs(2 * l - 1))
  }
  const hue = (Math.atan2(y, x) * 180) / Math.PI
  const top = bins.indexOf(Math.max(...bins))
  return {
    hue: (hue + 360) % 360,
    sat: sat / (n * n),
    // A picture with no color to speak of: a warm accent rather than a random bin.
    accentHue: bins[top] > 1 ? top * 15 + 7.5 : 18
  }
}

async function load(want: string): Promise<void> {
  let item: WikiBackdrop | null = null
  try {
    item = await window.deck.wikiBackdrop(want)
  } catch {
    item = null
  }
  // Settings moved on while main was fetching, or nothing new: leave the wall as it is.
  if (!item || want !== asked || (kept && kept.want === want && kept.date === item.date)) return
  try {
    kept = { want, date: item.date, title: item.title, dataUrl: item.dataUrl, tint: await tintOf(item.dataUrl) }
  } catch {
    return
  }
  try {
    localStorage.setItem(KEEP, JSON.stringify(kept))
  } catch {
    // over quota: the next boot asks main again
  }
  paint(kept.dataUrl)
  onChange()
}

/** Settings changed: put the wall up (or take it down) and see that its picture is the one wanted. */
export function syncGlass(s: DeckSettings): void {
  window.clearTimeout(timer)
  if (s.theme !== GLASS_ID) {
    wall?.remove()
    wall = null
    shown = ''
    asked = ''
    return
  }
  if (kept) paint(kept.dataUrl)
  else paint('')
  const want = s.glassDate
  const stale = want === '' && Date.now() - askedAt > RECHECK_MS
  if (want !== asked || stale || !kept || kept.want !== want) {
    asked = want
    askedAt = Date.now()
    void load(want)
  }
  if (want === '') timer = window.setTimeout(() => syncGlass(s), RECHECK_MS)
}
