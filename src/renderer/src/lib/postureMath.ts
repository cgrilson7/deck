// Posture Pal's math (~/posture3 renderer/posture.js, github.com/cgrilson7/posture-pal), typed: pure,
// no DOM. The four baseline checks are Posture Pal's unchanged (keep the two in step when they are
// tuned); the fifth, CHIN ON HAND, is the deck's own and needs no baseline.
//
// MediaPipe Pose landmarks are normalized image coords (x right, y down). Every metric is divided
// by shoulder width so it holds steady as you move nearer to or farther from the camera.

export const LM = { NOSE: 0, L_EAR: 7, R_EAR: 8, MOUTH_L: 9, MOUTH_R: 10, L_SHOULDER: 11, R_SHOULDER: 12 } as const
/** Each hand as the pose model sees it: wrist, pinky, index and thumb knuckles (left, then right). */
export const HANDS = [
  [15, 17, 19, 21],
  [16, 18, 20, 22]
] as const

export interface Landmark {
  x: number
  y: number
  visibility?: number
}

export interface Metrics {
  /** Vertical head-to-shoulder gap: shrinks when you slouch or crane forward. */
  neck: number
  /** Apparent body size: grows when you lean in toward the screen. */
  size: number
  /** Where the shoulders sit in the frame: drops when you slump down in the chair. */
  shoulderY: number
  /** Shoulder line tilt in degrees: leaning to one side. */
  shoulderTilt: number
  /** The nearest hand point to the chin, in shoulder widths (Infinity with no hand in view): the chin resting on a hand, either side. */
  handChin: number
  /** The same per hand — YOUR left and right — so a side that is never seen shows. */
  hands: { left: number; right: number }
  /** Where the chin was taken to be and the hand point nearest it (image coords), for the feed's overlay. */
  chinAt: { x: number; y: number }
  handAt: { x: number; y: number } | null
}

/** What calibration keeps: the four measures that are judged against how you sat. The chin check is absolute. */
export interface Baseline extends Pick<Metrics, 'neck' | 'size' | 'shoulderY' | 'shoulderTilt'> {
  createdAt: number
}

export type Check = 'neck' | 'lean' | 'slump' | 'tilt' | 'chin'

export interface Assessment {
  score: number
  worst: Check
  checks: Record<Check, number>
}

const MIN_VISIBILITY = 0.5
/** The pose model's hand points go faint against the face even when it has them right: a lower bar for those. */
const HAND_VISIBILITY = 0.3

type P = { x: number; y: number }
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y)
const angleDeg = (a: P, b: P): number => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI

/**
 * Posture metrics from one frame's landmarks, or null if the upper body isn't visible. `hands` are
 * the hand landmarker's (21 points each, the same image coords), when it ran: the chin check takes
 * the nearest of those and of the pose model's own four points a hand.
 */
export function computeMetrics(lm: Landmark[] | null, hands: Landmark[][] = []): Metrics | null {
  if (!lm) return null
  const ls = lm[LM.L_SHOULDER]
  const rs = lm[LM.R_SHOULDER]
  const le = lm[LM.L_EAR]
  const re = lm[LM.R_EAR]
  const nose = lm[LM.NOSE]
  const visible = (p: Landmark | undefined): p is Landmark => !!p && (p.visibility ?? 1) >= MIN_VISIBILITY
  if (!visible(ls) || !visible(rs) || !visible(nose)) return null

  const shoulderW = dist(ls, rs)
  if (shoulderW < 0.05) return null
  const shoulders = mid(ls, rs)

  // Ears are a steadier "head height" reference than the nose, which drops whenever you glance
  // down at the keyboard. Fall back to the nose if needed.
  const head = visible(le) && visible(re) ? mid(le, re) : nose

  // Mirrored video means left/right swap; take the tilt from horizontal.
  const tilt = (a: P, b: P): number => {
    let d = angleDeg(a, b)
    if (d > 90) d -= 180
    if (d < -90) d += 180
    return d
  }

  // The chin: below the mouth by about the nose-to-mouth drop again. The model places the mouth even
  // when a hand covers it, so it is used whatever its visibility says.
  const ml = lm[LM.MOUTH_L]
  const mr = lm[LM.MOUTH_R]
  const mouth = ml && mr ? mid(ml, mr) : { x: nose.x, y: nose.y + 0.12 * shoulderW }
  const chin = { x: mouth.x + (mouth.x - nose.x) * 1.3, y: mouth.y + (mouth.y - nose.y) * 1.3 }
  let handChin = Infinity
  let handAt: P | null = null
  const side = { left: Infinity, right: Infinity }
  const consider = (p: P, who: 'left' | 'right') => {
    const d = dist(p, chin) / shoulderW
    if (d < side[who]) side[who] = d
    if (d < handChin) {
      handChin = d
      handAt = { x: p.x, y: p.y }
    }
  }
  // The pose model's: 15… is YOUR left hand, 16… your right.
  HANDS.forEach((hand, h) => {
    for (const i of hand) {
      const p = lm[i]
      if (p && (p.visibility ?? 1) >= HAND_VISIBILITY) consider(p, h === 0 ? 'left' : 'right')
    }
  })
  // The hand landmarker's: whose hand by where its wrist is against the shoulders' middle (the camera's
  // image is not mirrored, so your left is at the larger x, as the pose model's left shoulder is).
  for (const hand of hands) {
    if (!hand[0]) continue
    const who = hand[0].x > shoulders.x ? 'left' : 'right'
    for (const p of hand) consider(p, who)
  }

  return {
    neck: (shoulders.y - head.y) / shoulderW,
    size: shoulderW,
    shoulderY: shoulders.y,
    shoulderTilt: tilt(ls, rs),
    handChin,
    hands: side,
    chinAt: chin,
    handAt
  }
}

/** Collapse calibration samples into a baseline using the median (robust to a fidget or two). */
export function buildBaseline(samples: Metrics[]): Baseline | null {
  if (samples.length < 10) return null
  const median = (key: 'neck' | 'size' | 'shoulderY' | 'shoulderTilt'): number => {
    const v = samples.map((s) => s[key]).sort((a, b) => a - b)
    const m = v.length >> 1
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
  }
  return { neck: median('neck'), size: median('size'), shoulderY: median('shoulderY'), shoulderTilt: median('shoulderTilt'), createdAt: Date.now() }
}

export const isBaseline = (b: unknown): b is Baseline => {
  const x = b as Baseline | null
  return !!x && (['neck', 'size', 'shoulderY', 'shoulderTilt'] as const).every((k) => Number.isFinite(x[k])) && x.neck > 0 && x.size > 0
}

// Deviation from baseline at which each check counts as fully "bad" (score 1.0) at sensitivity 1.
// Higher sensitivity divides these, making it stricter.
const TOLERANCE = {
  neck: 0.18, // fraction of baseline neck gap lost
  lean: 0.15, // fraction bigger than baseline (leaning in)
  slump: 0.35, // shoulder drop, in baseline shoulder-widths
  tilt: 9 // degrees of extra shoulder tilt
}

// Chin on hand, in shoulder widths from the chin to the nearest hand point: nothing past FAR, fully
// bad (1.0) at NEAR, worse still closer. A palm under the chin or a fist against the jaw sits at
// ~0.1–0.3; hands on the keyboard are well past 1. Sensitivity scales the score.
const CHIN_FAR = 0.7
const CHIN_NEAR = 0.35

/** Each check yields 0 (matches baseline) … 1 (at tolerance) … >1 (worse); the score is the worst. */
export function assess(m: Metrics, base: Baseline, sensitivity = 1): Assessment {
  const s = Math.max(0.25, sensitivity)
  const checks: Record<Check, number> = {
    neck: Math.max(0, (base.neck - m.neck) / base.neck) / (TOLERANCE.neck / s),
    lean: Math.max(0, m.size / base.size - 1) / (TOLERANCE.lean / s),
    slump: Math.max(0, (m.shoulderY - base.shoulderY) / base.size) / (TOLERANCE.slump / s),
    tilt: Math.abs(m.shoulderTilt - base.shoulderTilt) / (TOLERANCE.tilt / s),
    chin: (Math.max(0, CHIN_FAR - m.handChin) / (CHIN_FAR - CHIN_NEAR)) * s
  }
  let worst: Check = 'neck'
  for (const k of Object.keys(checks) as Check[]) if (checks[k] > checks[worst]) worst = k
  return { score: checks[worst], worst, checks }
}

export const ISSUE_TEXT: Record<Check, string> = {
  neck: 'Head is dropping — lift your chin and sit tall',
  lean: 'Leaning toward the screen — sit back',
  slump: 'Slumping down in your chair — sit up',
  tilt: 'Leaning to one side — level your shoulders',
  chin: 'Chin on your hand — hands down, let your neck hold your head'
}
