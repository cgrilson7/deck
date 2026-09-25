// THE POSTURE TRACKER: Posture Pal (github.com/cgrilson7/posture-pal) inside the deck, one tracker
// for the whole window (`posture()`, made on first use) the way the Game Boy is one machine. The
// camera and MediaPipe's pose model run here in the renderer; main serves the model and the wasm
// over `pose:` (main/posture.ts). It runs while the `showPosture` setting is on and it is not
// paused — whether or not the tile is scrolled into view — and the tile and the pane only draw it.
//
// What it keeps: THE STREAK (how long you have sat well, since the last slouch or since you came
// back into frame), and THE HISTORY — segments of good / bad / away over the last hours, kept in
// localStorage so a ⌘R does not forget them (a gap between ticks longer than GAP_MS is untracked
// time: the deck was closed, the Mac asleep, the tracker paused). A slouch has to last GRACE_MS
// before it breaks a streak (a glance at the keyboard is not one), and is then counted from where
// it began. ALERT_MS of slouching in one go is a bark: Foxtrot's log and a macOS notification
// (main), again every REALERT_MS while it goes on.

import { useEffect, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { assess, buildBaseline, computeMetrics, isBaseline, ISSUE_TEXT, LM, type Baseline, type Check, type Landmark, type Metrics } from './postureMath'

export type PostureStatus = 'off' | 'starting' | 'error' | 'paused' | 'uncalibrated' | 'calibrating' | 'good' | 'bad' | 'away'
export type SegKind = 'good' | 'bad' | 'away'
/** A stretch of one kind, [a, b] in epoch ms. */
export interface Seg {
  s: SegKind
  a: number
  b: number
}

export interface PostureView {
  status: PostureStatus
  /** What to say under the status: the error, the calibration prompt, the slouch's issue. */
  note: string
  /** When the current good streak began (null = none running). */
  streakSince: number | null
  /** The last streak's length, once it ended (ms). */
  lastStreak: number
  /** When the current slouch began (null = not slouching). */
  badSince: number | null
  calib: { phase: 'countdown' | 'sampling'; left: number; frac: number } | null
  /** The smoothed score: 0 = your calibrated posture, 1 = the line. */
  score: number
  checks: Record<Check, number> | null
  worst: Check | null
  calibrated: boolean
  paused: boolean
  sensitivity: number
  history: Seg[]
}

/** Detections a second: posture is slow, and the model runs on the CPU (the deck needs its WebGL contexts). */
const FRAME_MS = 200
/** No body this long = away (counted from the last frame you were seen in). */
const AWAY_MS = 2500
/** Hysteresis on the smoothed score (Posture Pal's). */
const BAD_ON = 1.0
const BAD_OFF = 0.8
/** A slouch this long breaks the streak (and is counted from its start). */
const GRACE_MS = 3000
export const ALERT_MS = 10_000
const REALERT_MS = 5 * 60_000
const CALIB_COUNTDOWN_MS = 3000
const CALIB_SAMPLE_MS = 4000
/** What the pane shows, and what is kept (a little more). */
export const WINDOW_MS = 2 * 60 * 60_000
const KEEP_MS = 3 * 60 * 60_000
/** Ticks further apart than this leave the time between untracked. */
const GAP_MS = 5000
const SAVE_MS = 15_000

const K_BASELINE = 'posture:baseline'
const K_HISTORY = 'posture:history'
const K_PAUSED = 'posture:paused'
const K_SENS = 'posture:sensitivity'

const load = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v === null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const save = (k: string, v: unknown): void => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {}
}

const WASM = { wasmLoaderPath: 'pose://wasm/vision_wasm_internal.js', wasmBinaryPath: 'pose://wasm/vision_wasm_internal.wasm' }
const MODEL = 'pose://model/pose_landmarker_lite.task'

class Tracker {
  private status: PostureStatus = 'off'
  private note = ''
  private enabled = false
  private paused = load<boolean>(K_PAUSED, false) === true
  private sensitivity = (() => {
    const v = Number(load<number>(K_SENS, 1))
    return Number.isFinite(v) ? Math.min(2, Math.max(0.5, v)) : 1
  })()
  private baseline: Baseline | null = (() => {
    const b = load<unknown>(K_BASELINE, null)
    return isBaseline(b) ? b : null
  })()
  private history: Seg[] = load<Seg[]>(K_HISTORY, []).filter((x) => x && (x.s === 'good' || x.s === 'bad' || x.s === 'away') && Number.isFinite(x.a) && Number.isFinite(x.b) && x.b >= x.a)

  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private landmarker: PoseLandmarker | null = null
  private landmarkerJob: Promise<PoseLandmarker> | null = null
  private timer: number | undefined
  private saveTimer: number | undefined
  /** Bumped by every start / stop, so a start that finishes after a stop gives its camera back. */
  private gen = 0

  private lm: Landmark[] | null = null
  private lastSeen = 0
  private lastTick = 0
  private score = 0
  private isBad = false
  private checks: Record<Check, number> | null = null
  private worst: Check | null = null
  private pendingBad: number | null = null
  private streakSince: number | null = null
  private lastStreak = 0
  private badSince: number | null = null
  private nextAlert = Infinity
  private calib: { phase: 'countdown' | 'sampling'; start: number; samples: Metrics[] } | null = null

  private listeners = new Set<(v: PostureView) => void>()
  private canvases = new Set<HTMLCanvasElement>()
  private raf = 0
  private colors = { good: '#3ecf8e', bad: '#d3402a', read: 0 }

  constructor() {
    window.addEventListener('pagehide', () => this.flush())
  }

  get view(): PostureView {
    const c = this.calib
    const now = Date.now()
    return {
      status: this.status,
      note: this.note,
      streakSince: this.streakSince,
      lastStreak: this.lastStreak,
      badSince: this.badSince,
      calib: c
        ? c.phase === 'countdown'
          ? { phase: c.phase, left: Math.max(1, Math.ceil((CALIB_COUNTDOWN_MS - (now - c.start)) / 1000)), frac: 0 }
          : { phase: c.phase, left: Math.max(1, Math.ceil((CALIB_SAMPLE_MS - (now - c.start)) / 1000)), frac: Math.min(1, (now - c.start) / CALIB_SAMPLE_MS) }
        : null,
      score: this.score,
      checks: this.checks,
      worst: this.worst,
      calibrated: !!this.baseline,
      paused: this.paused,
      sensitivity: this.sensitivity,
      history: this.history.slice()
    }
  }

  subscribe(cb: (v: PostureView) => void): () => void {
    this.listeners.add(cb)
    cb(this.view)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private emit(): void {
    const v = this.view
    for (const l of this.listeners) l(v)
  }

  // ---- on / off ----------------------------------------------------------------

  /** The setting: on = watch (unless paused), off = camera off. */
  enable(on: boolean): void {
    this.enabled = on
    this.sync()
  }

  setPaused(p: boolean): void {
    this.paused = p
    save(K_PAUSED, p)
    this.sync()
  }

  setSensitivity(v: number): void {
    this.sensitivity = Math.min(2, Math.max(0.5, Math.round(v * 10) / 10))
    save(K_SENS, this.sensitivity)
    this.emit()
  }

  private sync(): void {
    const want = this.enabled && !this.paused
    if (want && !this.stream && this.status !== 'starting') void this.start()
    if (!want) this.stop(this.enabled ? 'paused' : 'off')
  }

  private async start(): Promise<void> {
    const gen = ++this.gen
    this.set('starting', 'asking for the camera…')
    window.deck.postureTracking(true)
    try {
      if (!(await window.deck.postureCamera())) throw new Error('No camera access: System Settings ▸ Privacy & Security ▸ Camera')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false })
      if (gen !== this.gen) return stream.getTracks().forEach((t) => t.stop())
      this.stream = stream
      const video = this.videoEl()
      video.srcObject = stream
      await video.play()
      if (gen !== this.gen) return
      this.set('starting', 'loading the pose model…')
      this.landmarker = await this.loadLandmarker()
      if (gen !== this.gen) return
    } catch (err) {
      if (gen !== this.gen) return
      this.release()
      window.deck.postureTracking(false)
      this.set('error', String((err as Error)?.message ?? err))
      return
    }
    this.lastSeen = Date.now()
    this.status = this.baseline ? 'away' : 'uncalibrated'
    this.note = ''
    this.timer = window.setInterval(() => this.tick(), FRAME_MS)
    this.saveTimer = window.setInterval(() => this.flush(), SAVE_MS)
    this.draw()
    this.emit()
  }

  private stop(status: PostureStatus): void {
    this.gen++
    window.clearInterval(this.timer)
    window.clearInterval(this.saveTimer)
    this.timer = this.saveTimer = undefined
    this.endStreak(Date.now())
    this.flush()
    this.release()
    window.deck.postureTracking(false)
    this.calib = null
    this.lm = null
    this.set(status, '')
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.video) this.video.srcObject = null
  }

  private videoEl(): HTMLVideoElement {
    if (this.video) return this.video
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    // Kept in the document (a detached <video> may stop decoding) but never seen: the canvases show it.
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
    document.body.appendChild(v)
    this.video = v
    return v
  }

  private loadLandmarker(): Promise<PoseLandmarker> {
    if (this.landmarker) return Promise.resolve(this.landmarker)
    this.landmarkerJob ??= import('@mediapipe/tasks-vision')
      .then(({ PoseLandmarker }) =>
        PoseLandmarker.createFromOptions(WASM, { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1 })
      )
      .finally(() => {
        this.landmarkerJob = null
      })
    return this.landmarkerJob
  }

  private set(status: PostureStatus, note: string): void {
    this.status = status
    this.note = note
    this.emit()
  }

  // ---- calibration -------------------------------------------------------------

  calibrate(): void {
    if (this.paused) this.setPaused(false)
    this.calib = { phase: 'countdown', start: Date.now(), samples: [] }
    this.endStreak(Date.now())
    this.status = 'calibrating'
    this.note = 'Sit the way you want to sit: shoulders back, chin level'
    this.emit()
  }

  cancelCalibration(): void {
    this.calib = null
    this.status = this.baseline ? 'away' : 'uncalibrated'
    this.note = ''
    this.emit()
  }

  private stepCalib(now: number, m: Metrics | null): void {
    const c = this.calib!
    const elapsed = now - c.start
    if (c.phase === 'countdown') {
      if (elapsed >= CALIB_COUNTDOWN_MS) {
        this.calib = { phase: 'sampling', start: now, samples: [] }
        this.note = 'Hold still — measuring your good posture'
      }
      return
    }
    if (m) c.samples.push(m)
    if (elapsed < CALIB_SAMPLE_MS) return
    const b = buildBaseline(c.samples)
    if (!b) {
      this.calib = { phase: 'countdown', start: now, samples: [] }
      this.note = "Couldn't see you clearly: head and both shoulders in frame, and some light. Again…"
      return
    }
    this.baseline = b
    save(K_BASELINE, b)
    this.calib = null
    this.score = 0
    this.isBad = false
    this.status = 'away' // the next tick enters good (or bad) from here
    this.note = ''
  }

  // ---- the loop ----------------------------------------------------------------

  private tick(): void {
    const video = this.video
    if (!this.landmarker || !video || video.readyState < 2) return
    const now = Date.now()
    // A long gap (the Mac slept, the window was throttled after all) is untracked: nothing carries across it.
    if (this.lastTick && now - this.lastTick > GAP_MS && (this.status === 'good' || this.status === 'bad')) {
      this.endStreak(this.lastTick)
      this.status = 'away'
    }
    this.lastTick = now
    let lm: Landmark[] | null = null
    try {
      lm = (this.landmarker.detectForVideo(video, performance.now()).landmarks?.[0] as Landmark[] | undefined) ?? null
    } catch (err) {
      console.warn('[posture] detect failed', err)
      return
    }
    this.lm = lm
    const m = computeMetrics(lm)
    if (m) this.lastSeen = now

    if (this.calib) {
      this.stepCalib(now, m)
      return this.emit()
    }
    if (!this.baseline) {
      if (this.status !== 'uncalibrated') this.set('uncalibrated', '')
      else this.emit()
      return
    }
    if (!m) {
      if (now - this.lastSeen > AWAY_MS) {
        if (this.status !== 'away') this.enter('away', this.lastSeen, now)
        else this.paint('away', now, now)
      } else if (this.status === 'good' || this.status === 'bad') this.paint(this.status, now, now)
      return this.emit()
    }

    const a = assess(m, this.baseline, this.sensitivity)
    this.score += (a.score - this.score) * 0.35
    this.isBad = this.isBad ? this.score > BAD_OFF : this.score > BAD_ON
    this.checks = a.checks
    this.worst = a.worst

    if (this.isBad) {
      if (this.status === 'bad') this.paint('bad', now, now)
      else if (this.status === 'good') {
        this.pendingBad ??= now
        if (now - this.pendingBad >= GRACE_MS) this.enter('bad', this.pendingBad, now)
        else this.paint('good', now, now)
      } else this.enter('bad', now, now)
    } else {
      this.pendingBad = null
      if (this.status === 'good') this.paint('good', now, now)
      else this.enter('good', now, now)
    }
    if (this.status === 'bad') {
      this.note = ISSUE_TEXT[a.worst]
      if (now >= this.nextAlert) {
        const first = now - this.badSince! < ALERT_MS + REALERT_MS
        window.dispatchEvent(new Event(BARK_EVENT))
        window.deck.postureAlert(first ? `Slouching for ${span(now - this.badSince!)}. ${ISSUE_TEXT[a.worst]}.` : `Still slouching, ${span(now - this.badSince!)} now. ${ISSUE_TEXT[a.worst]}.`)
        this.nextAlert = now + REALERT_MS
      }
    } else this.note = ''
    this.emit()
  }

  /** A new state, counted from `from` (a slouch from where it began, away from the last frame you were in). */
  private enter(kind: SegKind, from: number, now: number): void {
    if (kind === 'good') {
      this.streakSince = from
      this.badSince = null
      this.nextAlert = Infinity
    } else {
      this.endStreak(from)
      this.badSince = kind === 'bad' ? from : null
      this.nextAlert = kind === 'bad' ? from + ALERT_MS : Infinity
    }
    this.pendingBad = null
    this.status = kind
    this.paint(kind, from, now)
  }

  private endStreak(at: number): void {
    if (this.streakSince !== null) this.lastStreak = Math.max(0, at - this.streakSince)
    this.streakSince = null
    this.badSince = null
    this.pendingBad = null
    this.nextAlert = Infinity
  }

  /** The history from `from` to `now` is `kind`: what was painted after `from` is painted over. */
  private paint(kind: SegKind, from: number, now: number): void {
    const h = this.history
    if (from < now) {
      while (h.length && h[h.length - 1].a >= from) h.pop()
      const cut = h[h.length - 1]
      if (cut && cut.b > from) cut.b = from
    }
    const last = h[h.length - 1]
    if (last && last.s === kind && from - last.b <= GAP_MS) last.b = Math.max(last.b, now)
    else h.push({ s: kind, a: from, b: now })
    const old = now - KEEP_MS
    while (h.length && h[0].b < old) h.shift()
  }

  private flush(): void {
    save(K_HISTORY, this.history)
  }

  // ---- the feed ----------------------------------------------------------------

  /** Draw the camera (mirrored, cropped to fill) and the pose lines into this canvas while it is attached. */
  attach(canvas: HTMLCanvasElement): () => void {
    this.canvases.add(canvas)
    this.draw()
    return () => {
      this.canvases.delete(canvas)
    }
  }

  private draw = (): void => {
    cancelAnimationFrame(this.raf)
    if (!this.canvases.size || !this.stream) {
      for (const c of this.canvases) c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
      return
    }
    const video = this.video!
    const now = performance.now()
    if (now - this.colors.read > 2000) {
      const cs = getComputedStyle(document.documentElement)
      this.colors = { good: cs.getPropertyValue('--green').trim() || '#3ecf8e', bad: cs.getPropertyValue('--blocked').trim() || '#d3402a', read: now }
    }
    const vw = video.videoWidth
    const vh = video.videoHeight
    for (const c of this.canvases) {
      const w = Math.round(c.clientWidth * devicePixelRatio)
      const hgt = Math.round(c.clientHeight * devicePixelRatio)
      if (!w || !hgt || !vw || !vh) continue
      if (c.width !== w || c.height !== hgt) {
        c.width = w
        c.height = hgt
      }
      const ctx = c.getContext('2d')
      if (!ctx) continue
      // Cover: the video scaled to fill, centred, the overflow cropped.
      const k = Math.max(w / vw, hgt / vh)
      const dw = vw * k
      const dh = vh * k
      const ox = (w - dw) / 2
      const oy = (hgt - dh) / 2
      ctx.save()
      ctx.translate(w, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, ox, oy, dw, dh)
      this.drawPose(ctx, ox, oy, dw, dh, Math.max(1.5, w / 160))
      ctx.restore()
    }
    this.raf = requestAnimationFrame(this.draw)
  }

  private drawPose(ctx: CanvasRenderingContext2D, ox: number, oy: number, dw: number, dh: number, lw: number): void {
    const lm = this.lm
    if (!lm || this.status === 'calibrating') return
    const P = (i: number): [number, number] => [ox + lm[i].x * dw, oy + lm[i].y * dh]
    const color = this.status === 'bad' ? this.colors.bad : this.colors.good
    ctx.lineWidth = lw
    ctx.strokeStyle = color
    ctx.fillStyle = color
    const line = (a: [number, number], b: [number, number]) => {
      ctx.beginPath()
      ctx.moveTo(...a)
      ctx.lineTo(...b)
      ctx.stroke()
    }
    line(P(LM.L_SHOULDER), P(LM.R_SHOULDER))
    line(P(LM.L_EAR), P(LM.NOSE))
    line(P(LM.NOSE), P(LM.R_EAR))
    const sm: [number, number] = [(P(LM.L_SHOULDER)[0] + P(LM.R_SHOULDER)[0]) / 2, (P(LM.L_SHOULDER)[1] + P(LM.R_SHOULDER)[1]) / 2]
    const em: [number, number] = [(P(LM.L_EAR)[0] + P(LM.R_EAR)[0]) / 2, (P(LM.L_EAR)[1] + P(LM.R_EAR)[1]) / 2]
    line(sm, em)
    for (const i of [LM.NOSE, LM.L_EAR, LM.R_EAR, LM.L_SHOULDER, LM.R_SHOULDER]) {
      ctx.beginPath()
      ctx.arc(...P(i), lw * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
    // Where your head sat when you calibrated: a dashed line, so a sinking head shows.
    const b = this.baseline
    if (!b) return
    const sw = Math.hypot(lm[LM.L_SHOULDER].x - lm[LM.R_SHOULDER].x, lm[LM.L_SHOULDER].y - lm[LM.R_SHOULDER].y)
    const y = sm[1] - b.neck * sw * dh
    const half = Math.abs(lm[LM.L_SHOULDER].x - lm[LM.R_SHOULDER].x) * dw * 0.4
    ctx.setLineDash([lw * 3, lw * 3])
    ctx.lineWidth = Math.max(1, lw * 0.6)
    ctx.strokeStyle = 'rgba(255,255,255,.6)'
    line([sm[0] - half, y], [sm[0] + half, y])
    ctx.setLineDash([])
  }
}

let tracker: Tracker | null = null
export function posture(): Tracker {
  tracker ??= new Tracker()
  return tracker
}

export function usePosture(): PostureView {
  const [v, setV] = useState<PostureView>(() => posture().view)
  useEffect(() => posture().subscribe(setV), [])
  return v
}

/** A clock that ticks every second, for streaks and totals between the tracker's own updates (paused / off). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

/** The last `span` ms of the history, clipped: the time in each kind, and the longest good stretch. */
export function summarize(history: Seg[], now: number, span = WINDOW_MS): { good: number; bad: number; away: number; best: number; segs: Seg[] } {
  const from = now - span
  const segs: Seg[] = []
  const t = { good: 0, bad: 0, away: 0, best: 0 }
  for (const x of history) {
    if (x.b <= from) continue
    const s = { s: x.s, a: Math.max(x.a, from), b: Math.min(x.b, now) }
    if (s.b <= s.a) continue
    segs.push(s)
    t[s.s] += s.b - s.a
    if (s.s === 'good') t.best = Math.max(t.best, s.b - s.a)
  }
  return { ...t, segs }
}

/** 12:34, or 1:02:03 past the hour. */
export function stopwatch(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 1h 12m, 8m 30s, 45s. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 && m < 10 ? `${m}m ${s % 60}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// ---- the head's bark ---------------------------------------------------------------

/** Fired with every alert: Foxtrot in the top bar barks it (FoxHead). */
const BARK_EVENT = 'deck:posture-bark'

/**
 * For Foxtrot in the top bar: `alarm` while a slouch has run past ALERT_MS (he sits up alert
 * until you do), and `barks`, bumped at each alert (a bark run each). Re-renders only on those.
 */
export function usePostureAlarm(): { alarm: boolean; barks: number } {
  const [alarm, setAlarm] = useState(false)
  const [barks, setBarks] = useState(0)
  useEffect(() => {
    const off = posture().subscribe((v) => setAlarm(v.status === 'bad' && v.badSince !== null && Date.now() - v.badSince >= ALERT_MS))
    const bark = () => setBarks((n) => n + 1)
    window.addEventListener(BARK_EVENT, bark)
    return () => {
      off()
      window.removeEventListener(BARK_EVENT, bark)
    }
  }, [])
  return { alarm, barks }
}

// ---- the pane's door ---------------------------------------------------------------

const EVENT = 'deck:posture'
export type PostureWant = boolean | 'toggle'
export function openPosture(): void {
  window.dispatchEvent(new CustomEvent<PostureWant>(EVENT, { detail: true }))
}
export function onPosturePane(cb: (want: PostureWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<PostureWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
