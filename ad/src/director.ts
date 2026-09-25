// The director: one timeline (seconds) of camera moves, Foxtrot-the-cursor moves, clicks, typing,
// captions and world events, played off requestAnimationFrame — the page's real one in preview,
// the virtual one under capture (public/clock.js), so both see the same film.
//
// The WORLD is the deck's window at a fixed size (WORLD_W × WORLD_H); the camera is a 2D view of
// it ({x, y} = the world point at the frame's anchor, s = frame px per world px), applied as one
// transform. Foxtrot lives in FRAME space above it, so he stays the same size however far in we are.

/** The deck's window: landscape for the 16:9 cut, a tall one for 9:16 (the app reflows; main.tsx picks). */
export const WORLD = { w: 1600, h: 1000 }

export interface View {
  x: number
  y: number
  s: number
}
type Rect = { x: number; y: number; w: number; h: number }
/** A selector (first match), an element getter, a world rect, or the whole window. */
export type Target = string | (() => Element | null | undefined) | Rect | 'window'

export interface Fit {
  /** The most of the frame's width / height the target may take (defaults 0.92 / 0.62). */
  w?: number
  h?: number
  /** Nudge the framing, in world px. */
  dx?: number
  dy?: number
  /** Where in the target to look, 0..1 (default its middle). */
  ax?: number
  ay?: number
}

const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const clamp01 = (p: number): number => Math.max(0, Math.min(1, p))

interface CamKey {
  t: number
  dur: number
  target: Target
  fit: Fit
  from?: View
  to?: View
}
interface FoxKey {
  t: number
  dur: number
  target: Target
  ax: number
  ay: number
  follow?: boolean
  from?: { x: number; y: number }
  to?: { x: number; y: number }
}
interface Ev {
  t: number
  fn: () => void
  done?: boolean
}

export class Director {
  private cams: CamKey[] = []
  private foxes: FoxKey[] = []
  private evs: Ev[] = []
  private view: View = { x: WORLD.w / 2, y: WORLD.h / 2, s: 0.3 }
  /** Foxtrot's nose, in world px. */
  private foxAt = { x: -80, y: 500 }
  private foxFlip = false
  private foxPose = 'idle'
  private poseUntil = 0
  private t0 = -1
  duration = 30
  onTick: (t: number) => void = () => {}

  constructor(
    private frame: HTMLElement,
    private worldEl: HTMLElement,
    private foxEl: HTMLElement,
    private captionEl: HTMLElement,
    private fxEl: HTMLElement
  ) {}

  /* ───────────── writing the film ───────────── */

  at(t: number, fn: () => void): void {
    this.evs.push({ t, fn })
  }
  cam(t: number, dur: number, target: Target, fit: Fit = {}): void {
    this.cams.push({ t, dur, target, fit })
  }
  /** `follow`: once there he keeps to the target as it moves (the terminal's cursor while a prompt is typed). */
  fox(t: number, dur: number, target: Target, ax = 0.5, ay = 0.5, follow = false): void {
    this.foxes.push({ t, dur, target, ax, ay, follow })
  }
  /** Foxtrot hops, a ring goes out from his nose, and the element under it is really clicked. */
  click(t: number, target: Target, real = true): void {
    this.at(t, () => {
      this.pose('leap', 380)
      this.ring()
      const el = this.el(target)
      if (real && el instanceof HTMLElement) el.click()
    })
  }
  /** Type into a React-controlled field, a letter at a time, from t over dur. */
  type(t: number, dur: number, target: Target, text: string): void {
    for (let i = 1; i <= text.length; i++) {
      this.at(t + (dur * i) / text.length, () => {
        const el = this.el(target)
        if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text.slice(0, i))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
  }
  key(t: number, target: Target, key: string): void {
    this.at(t, () => this.el(target)?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
  }
  caption(t: number, dur: number, title: string, sub = ''): void {
    this.at(t, () => {
      this.captionEl.innerHTML = ''
      const h = document.createElement('div')
      h.className = 'ad-cap-title'
      h.textContent = title
      this.captionEl.appendChild(h)
      if (sub) {
        const p = document.createElement('div')
        p.className = 'ad-cap-sub'
        p.textContent = sub
        this.captionEl.appendChild(p)
      }
      this.captionEl.classList.remove('out')
      this.captionEl.classList.add('in')
    })
    this.at(t + dur, () => {
      this.captionEl.classList.remove('in')
      this.captionEl.classList.add('out')
    })
  }
  /** CSS :hover cannot be faked, so what appears on hover in the deck also appears under `.ad-hover` (ad.css). */
  hover(t: number, target: Target, on: boolean): void {
    this.at(t, () => this.el(target)?.classList.toggle('ad-hover', on))
  }
  /** Scroll a tile's column so the target sits in view, eased over dur (the column's own smooth scroll is real-time, so not used). */
  scroll(t: number, dur: number, target: Target): void {
    let from = 0
    let to = 0
    let box: Element | null = null
    const steps = Math.max(1, Math.round(dur * 60))
    for (let i = 0; i <= steps; i++) {
      this.at(t + (dur * i) / steps, () => {
        if (i === 0) {
          const el = this.el(target)
          box = el?.closest('.grid-scroll') ?? null
          if (!el || !box) return
          from = box.scrollTop
          const k = box.getBoundingClientRect().height / (box as HTMLElement).offsetHeight || 1
          const delta = (el.getBoundingClientRect().top - box.getBoundingClientRect().top) / k - ((box as HTMLElement).offsetHeight - (el as HTMLElement).offsetHeight) / 2
          to = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, from + delta))
        }
        if (box) box.scrollTop = from + (to - from) * ease(i / steps)
      })
    }
  }
  pose(name: string, ms: number): void {
    this.foxPose = name
    this.poseUntil = this.now() + ms / 1000
  }

  /* ───────────── measuring the world ───────────── */

  el(target: Target): Element | null {
    if (typeof target === 'string') return target === 'window' ? this.worldEl : this.worldEl.querySelector(target)
    if (typeof target === 'function') return target() ?? null
    return null
  }

  /** A target's rect in world px: its screen rect taken back through the camera (a pure scale + shift, so the world's own rect says both). */
  rect(target: Target): Rect | null {
    if (typeof target === 'object') return target
    if (target === 'window') return { x: 0, y: 0, w: WORLD.w, h: WORLD.h }
    const el = this.el(target)
    if (!el) return null
    const w = this.worldEl.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const k = w.width / WORLD.w || 1
    return { x: (r.x - w.x) / k, y: (r.y - w.y) / k, w: r.width / k, h: r.height / k }
  }

  private frameSize(): { w: number; h: number; ay: number } {
    const w = this.frame.clientWidth
    const h = this.frame.clientHeight
    // Portrait: the caption band sits on top, so the subject is framed a little below the middle.
    return { w, h, ay: h > w ? 0.6 : 0.56 }
  }

  private viewOf(k: CamKey): View {
    const r = this.rect(k.target)
    if (!r) return this.view
    const f = this.frameSize()
    const s = Math.min((f.w * (k.fit.w ?? 0.92)) / r.w, (f.h * (k.fit.h ?? 0.62)) / r.h)
    return { x: r.x + r.w * (k.fit.ax ?? 0.5) + (k.fit.dx ?? 0), y: r.y + r.h * (k.fit.ay ?? 0.5) + (k.fit.dy ?? 0), s }
  }

  /* ───────────── playing it ───────────── */

  private now(): number {
    return this.t0 < 0 ? 0 : (performance.now() - this.t0) / 1000
  }

  start(): void {
    this.cams.sort((a, b) => a.t - b.t)
    this.foxes.sort((a, b) => a.t - b.t)
    this.evs.sort((a, b) => a.t - b.t)
    this.t0 = performance.now()
    const loop = (): void => {
      this.step(this.now())
      requestAnimationFrame(loop)
    }
    loop()
  }

  private step(t: number): void {
    for (const e of this.evs) {
      if (e.done || e.t > t) continue
      e.done = true
      try {
        e.fn()
      } catch (err) {
        console.error('ad event', e.t, err)
      }
    }
    this.onTick(t)

    // The camera: the last key that has begun. It eases in log-scale so a long zoom feels even, and breathes once it has landed.
    let cam: CamKey | undefined
    for (const k of this.cams) if (k.t <= t) cam = k
    if (cam) {
      if (!cam.to) {
        cam.from = { ...this.view }
        cam.to = this.viewOf(cam)
      }
      const p = ease(clamp01((t - cam.t) / Math.max(0.001, cam.dur)))
      // Still travelling: look again, since what it is going to may be growing into place (a dialog opening, a tile reflowing).
      if (p < 1 && typeof cam.target !== 'object' && this.rect(cam.target)) cam.to = this.viewOf(cam)
      const a = cam.from!
      const b = cam.to
      const breathe = 1 + 0.012 * Math.max(0, t - cam.t - cam.dur)
      this.view = { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * p) * breathe }
    }
    // Focusing a field (the leash dialog's autofocus, a clicked prompt bar) makes Chromium scroll clipped
    // ancestors to show it; the camera is the only thing allowed to move the world.
    for (const el of [this.frame, this.worldEl, this.worldEl.querySelector('.app'), this.worldEl.querySelector('.main'), document.documentElement, document.body])
      if (el && (el.scrollLeft || el.scrollTop)) el.scrollLeft = el.scrollTop = 0
    const f = this.frameSize()
    const v = this.view
    this.worldEl.style.transform = `translate(${(f.w / 2 - v.x * v.s).toFixed(2)}px, ${(f.h * f.ay - v.y * v.s).toFixed(2)}px) scale(${v.s.toFixed(5)})`

    // Foxtrot: runs between targets (facing the way he goes), otherwise whatever pose was asked, else the tail wag.
    let fk: FoxKey | undefined
    for (const k of this.foxes) if (k.t <= t) fk = k
    let running = false
    if (fk) {
      if (!fk.to) {
        const r = this.rect(fk.target)
        fk.from = { ...this.foxAt }
        fk.to = r ? { x: r.x + r.w * fk.ax, y: r.y + r.h * fk.ay } : { ...this.foxAt }
        if (Math.abs(fk.to.x - fk.from.x) > 4) this.foxFlip = fk.to.x < fk.from.x
      }
      if (fk.follow) {
        const r = this.rect(fk.target)
        if (r) fk.to = { x: r.x + r.w * fk.ax, y: r.y + r.h * fk.ay }
      }
      const raw = clamp01((t - fk.t) / Math.max(0.001, fk.dur))
      const p = ease(raw)
      running = raw < 1
      // A little arc, so a long run reads as a bound and not a slide.
      const arc = Math.sin(Math.PI * p) * Math.min(40, Math.hypot(fk.to.x - fk.from!.x, fk.to.y - fk.from!.y) * 0.08)
      this.foxAt = { x: fk.from!.x + (fk.to.x - fk.from!.x) * p, y: fk.from!.y + (fk.to.y - fk.from!.y) * p - arc }
    }
    const pose = running ? 'run' : t < this.poseUntil ? this.foxPose : 'idle'
    const cls = `fox fox-${pose}`
    if (this.foxEl.className !== cls) this.foxEl.className = cls
    const sx = f.w / 2 + (this.foxAt.x - v.x) * v.s
    const sy = f.h * f.ay + (this.foxAt.y - v.y) * v.s
    // A cursor's hot spot is its top-left, and so is his: he runs facing the way he goes, then turns to
    // put his nose on the spot, body out to the right and below, so he never sits on what he points at.
    const flip = running ? this.foxFlip : true
    const fw = this.foxEl.offsetWidth
    const fh = this.foxEl.offsetHeight
    this.foxEl.style.transform = `translate(${(sx - (running && !flip ? fw * 0.5 : 0)).toFixed(1)}px, ${(sy - fh * 0.3).toFixed(1)}px) scaleX(${flip ? -1 : 1})`
    this.fxEl.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`
  }

  /** His silent comic barks, the deck's own (`fox-bark` in styles.css), at cursor size. */
  bark(t: number): void {
    const words: [string, number, number, number][] = [['YIP!', 70, -46, -8], ['ARF!', 96, -14, 7], ['CHRRP!', 58, -78, -4]]
    words.forEach(([word, dx, dy, rot], i) =>
      this.at(t + i * 0.28, () => {
        if (i === 0) this.pose('look', 1400)
        const b = document.createElement('div')
        b.className = 'ad-bark'
        b.textContent = word
        b.style.setProperty('--dx', `${dx}px`)
        b.style.setProperty('--dy', `${dy}px`)
        b.style.setProperty('--rot', `${rot}deg`)
        this.fxEl.appendChild(b)
        setTimeout(() => b.remove(), 700)
      })
    )
  }

  private ring(): void {
    const r = document.createElement('div')
    r.className = 'ad-ring'
    this.fxEl.appendChild(r)
    setTimeout(() => r.remove(), 700)
  }
}
