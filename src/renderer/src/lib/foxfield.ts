// THE FOXTROT TILE'S FIELD, an endless runner: Foxtrot stays at the middle of the tile, running
// left to right and gaining no ground, while the WORLD moves right to left under him — the grass
// tufts and the far hills (by background position), OBSTACLES (Kenney's Pixel Platformer tiles,
// assets/obstacles/, CC0) that come in from the right edge every few seconds and which he JUMPS,
// and CLOUDS (painted here: pixel-art puffs on a flat bottom) drifting slower, high in the sky.
// It is imperative on purpose: one rAF loop moves plain DOM nodes, and React only hears about a
// jump starting and ending (the fox's pose). `stop()` freezes the world where it is (bad posture);
// `go()` carries on. It also rests while the tile is out of view.

import crate from '../assets/obstacles/crate.png'
import fence from '../assets/obstacles/fence.png'
import pine from '../assets/obstacles/pine.png'
import cactus from '../assets/obstacles/cactus.png'
import mushroom from '../assets/obstacles/mushroom.png'
import sprout from '../assets/obstacles/sprout.png'

/** The world's speed past him (px/s): the grass and the obstacles. */
export const RUN_PX_PER_S = 120
/** One jump: the `leap` row's own cycle (11 frames in 750ms), and how high his feet go (px). */
export const JUMP_MS = 750
const JUMP_PX = 56
/** An obstacle this far ahead of his middle (px) is when he takes off: half a jump's travel, so he lands as far past it. */
const TAKEOFF_PX = (RUN_PX_PER_S * JUMP_MS) / 1000 / 2
/** The next obstacle comes this long after the last (ms, uniform). */
const OBSTACLE_EVERY: [number, number] = [2600, 6200]
const OBSTACLE_SCALE = 2
/** Every png is 18×18 with its art standing on the bottom row, so all of them sit on the grass line. */
const OBSTACLES = [crate, fence, pine, cactus, mushroom, sprout]
/** Far hills drift at this share of the run; clouds at their own slow speed. */
const HILL_PARALLAX = 0.15
const CLOUD_PX_PER_S: [number, number] = [10, 22]
const CLOUD_EVERY: [number, number] = [7000, 14000]
const CLOUD_SCALE = 3
const CLOUDS_MAX = 4

const rand = (a: number, b: number) => a + Math.random() * (b - a)

interface Thing {
  el: HTMLElement
  x: number
  w: number
}
interface Cloud extends Thing {
  speed: number
  seed: number
}

export class FoxField {
  private raf = 0
  private last = 0
  private running = false
  private visible = true
  private scroll = 0
  private obstacles: Thing[] = []
  private clouds: Cloud[] = []
  private nextObstacle = 0
  private nextCloud = 0
  private jumpAt: number | null = null
  private io: IntersectionObserver

  constructor(
    private field: HTMLElement,
    private sky: HTMLElement,
    private ground: HTMLElement,
    private foxLift: HTMLElement,
    /** Told when a jump starts (true) and ends (false). */
    private onJump: (up: boolean) => void
  ) {
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting
      this.loop()
    })
    this.io.observe(field)
    // A sky with clouds in it already, not an empty one waiting for the first.
    const w = field.clientWidth || 300
    for (let i = 0; i < 2; i++) this.addCloud(rand(0.1, 0.9) * w)
    this.nextCloud = rand(...CLOUD_EVERY)
    this.nextObstacle = rand(1200, 2400)
  }

  go(): void {
    this.running = true
    this.loop()
  }

  /** Freeze the world (and land him, if he was in the air). */
  stop(): void {
    this.running = false
    this.loop()
    if (this.jumpAt !== null) {
      this.jumpAt = null
      this.foxLift.style.transform = ''
      this.onJump(false)
    }
  }

  /** A jump now (a click on him), unless he is already up or the world is stopped. */
  jump(): void {
    if (!this.running || this.jumpAt !== null) return
    this.jumpAt = performance.now()
    this.onJump(true)
  }

  dispose(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.io.disconnect()
    for (const t of [...this.obstacles, ...this.clouds]) t.el.remove()
    this.obstacles = []
    this.clouds = []
  }

  /** Repaint the clouds in the theme's colours (a theme or glass change). */
  retheme(): void {
    for (const c of this.clouds) paintCloud(c.el as HTMLCanvasElement, c.seed, this.field)
  }

  private loop(): void {
    cancelAnimationFrame(this.raf)
    if (!this.running || !this.visible) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.step)
  }

  private step = (now: number): void => {
    const ms = Math.min(100, now - this.last)
    this.last = now
    const dt = ms / 1000
    const w = this.field.clientWidth
    const mid = w / 2

    // The ground and the hills: background positions.
    this.scroll += RUN_PX_PER_S * dt
    this.ground.style.setProperty('--scroll', `${-this.scroll}px`)
    this.field.style.setProperty('--hills', `${-this.scroll * HILL_PARALLAX}px`)

    // Obstacles: in from the right, out at the left; he takes off TAKEOFF_PX before one reaches him.
    this.nextObstacle -= ms
    if (this.nextObstacle <= 0) {
      this.addObstacle(w)
      this.nextObstacle = rand(...OBSTACLE_EVERY)
    }
    for (const o of this.obstacles) {
      o.x -= RUN_PX_PER_S * dt
      o.el.style.transform = `translateX(${o.x}px)`
      const centre = o.x + o.w / 2
      if (this.jumpAt === null && centre > mid && centre - mid <= TAKEOFF_PX) {
        this.jumpAt = now
        this.onJump(true)
      }
    }
    this.obstacles = this.obstacles.filter((o) => (o.x + o.w < -8 ? (o.el.remove(), false) : true))

    // The jump: a parabola on a wrapper around the fox (the sprite's leap plays inside it).
    if (this.jumpAt !== null) {
      const t = (now - this.jumpAt) / JUMP_MS
      if (t >= 1) {
        this.jumpAt = null
        this.foxLift.style.transform = ''
        this.onJump(false)
      } else this.foxLift.style.transform = `translateY(${-4 * JUMP_PX * t * (1 - t)}px)`
    }

    // Clouds: slower, each at its own speed.
    this.nextCloud -= ms
    if (this.nextCloud <= 0) {
      if (this.clouds.length < CLOUDS_MAX) this.addCloud(w)
      this.nextCloud = rand(...CLOUD_EVERY)
    }
    for (const c of this.clouds) {
      c.x -= c.speed * dt
      c.el.style.transform = `translateX(${c.x}px)`
    }
    this.clouds = this.clouds.filter((c) => (c.x + c.w < -8 ? (c.el.remove(), false) : true))

    this.raf = requestAnimationFrame(this.step)
  }

  private addObstacle(w: number): void {
    const img = document.createElement('img')
    img.src = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)]
    img.className = 'foxtrot-obstacle'
    img.alt = ''
    img.draggable = false
    const size = 18 * OBSTACLE_SCALE
    img.style.width = img.style.height = `${size}px`
    const o = { el: img, x: w + 8, w: size }
    img.style.transform = `translateX(${o.x}px)`
    this.ground.parentElement!.appendChild(img)
    this.obstacles.push(o)
  }

  private addCloud(x: number): void {
    const cv = document.createElement('canvas')
    cv.className = 'foxtrot-cloud'
    const seed = Math.floor(Math.random() * 1e9)
    paintCloud(cv, seed, this.field)
    const h = this.sky.clientHeight || 80
    const ch = cv.height * CLOUD_SCALE
    cv.style.width = `${cv.width * CLOUD_SCALE}px`
    cv.style.height = `${ch}px`
    // High in the sky, never below the hills.
    cv.style.top = `${Math.max(2, rand(0.02, 0.45) * Math.max(0, h - ch * 0.8))}px`
    const c = { el: cv, x, w: cv.width * CLOUD_SCALE, speed: rand(...CLOUD_PX_PER_S), seed }
    cv.style.transform = `translateX(${x}px)`
    this.sky.appendChild(cv)
    this.clouds.push(c)
  }
}

// ---- the clouds ----------------------------------------------------------------------------

/** A seeded PRNG (mulberry32), so a cloud keeps its shape when it is repainted for a new theme. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A CSS colour (theme variables and color-mix welcome) as the canvas can take it, resolved inside `host`. */
function resolve(css: string, host: HTMLElement): string {
  const probe = document.createElement('span')
  probe.style.color = css
  probe.style.display = 'none'
  host.appendChild(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c
}

/**
 * A CLOUD in pixel art, one canvas pixel per art pixel (drawn 3× with `pixelated`): a few round
 * puffs, the biggest in the middle, sitting on a FLAT BOTTOM. The bottom two rows in shade, a
 * one-pixel outline a step darker. Colours are the theme's: near the panel colour in a light
 * theme, lifted toward the ink in a dark one, so a cloud is always brighter than its sky.
 */
function paintCloud(cv: HTMLCanvasElement, seed: number, host: HTMLElement): void {
  const r = prng(seed)
  const W = 30 + Math.floor(r() * 16)
  const H = 16 + Math.floor(r() * 4)
  cv.width = W
  cv.height = H
  const base = H - 2
  // Puffs along the bottom, taller toward the middle: [x, y, radius].
  const n = 4 + Math.floor(r() * 2)
  const puffs: [number, number, number][] = []
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1)
    const mid = 1 - Math.abs(f - 0.5) * 2
    const rad = 3.5 + Math.sqrt(mid) * (H * 0.34 - 3.5) + r() * 2
    // Inside the canvas, the ends' puffs mostly below the flat bottom so the ends round off low.
    const x = rad + 1 + f * (W - 2 * rad - 2)
    puffs.push([x, base - rad * (0.3 + mid * 0.4), rad])
  }
  const inside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y > base) return false
    return puffs.some(([px, py, pr]) => (x - px) ** 2 + (y - py) ** 2 <= pr * pr)
  }
  const dark = document.documentElement.dataset.dark === 'true'
  const body = resolve(dark ? 'color-mix(in oklab, var(--ink) 30%, var(--panel))' : 'var(--panel)', host)
  const shade = resolve(dark ? 'color-mix(in oklab, var(--ink) 18%, var(--panel))' : 'color-mix(in oklab, var(--blue) 16%, color-mix(in oklab, var(--ink) 8%, var(--panel)))', host)
  const line = resolve(dark ? 'color-mix(in oklab, var(--ink) 10%, var(--panel))' : 'color-mix(in oklab, var(--blue) 22%, color-mix(in oklab, var(--ink) 16%, var(--panel)))', host)
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (inside(x, y)) {
        ctx.fillStyle = y >= base - 1 ? shade : body
        ctx.fillRect(x, y, 1, 1)
      } else if (inside(x + 1, y) || inside(x - 1, y) || inside(x, y + 1) || inside(x, y - 1)) {
        ctx.fillStyle = line
        ctx.fillRect(x, y, 1, 1)
      }
    }
}
