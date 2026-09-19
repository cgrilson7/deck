// THE MOLECULE VIEWER: a 3Dmol.js viewer PER MOLECULE TILE (`mol(n)`, the `molTiles` setting's
// numbers; made on first use, disposed when its tile is closed — each holds a WebGL context).
// A tile and the pane opened from it show the SAME scene: the viewer lives in a host element of
// its own that is moved (one appendChild + a resize) to whichever view is asking loudest — the
// pane over the tile, a hidden staging box when neither is mounted, so the door answers (and
// `look` can photograph the scene) before the tile was ever scrolled to. What a tile shows is
// kept in localStorage (targets + looks) and shown again after a reload.
//
// Everything that changes the scene goes through drive(body), the ops of plugin/scripts/mol.mjs:
// the door (`POST /mol` → main, which resolves structures first → `mol:req`) and the UI call
// the same function, so a session and a click can never disagree about what a command does.
// The scene is STATE (models, style, colour, surface, labels, selection, highlights,
// measurements, callouts, picks) and redraw() paints all of it from scratch: no op has to know
// what another left on screen.
//
// 3Dmol is a dynamic import, out of first paint. Its surfaces are computed on this thread
// (setSyncSurface): its workers come from a blob: URL, which the CSP's script-src refuses.

import { useEffect, useState } from 'react'
import type { Atom, Label, Model, Viewer } from '3dmol/build/3Dmol.es6-min.js'
import type { MolStructure } from '@shared/types'

type Lib = typeof import('3dmol/build/3Dmol.es6-min.js')

export const MOL_STYLES = ['stick', 'ball-stick', 'sphere', 'line', 'cartoon', 'surface'] as const
export const MOL_COLORS = ['element', 'charge', 'hydrophobicity', 'residue', 'chain', 'secondary', 'plddt', 'bfactor', 'model'] as const
export const MOL_SURFACES = ['none', 'vdw', 'sas', 'electrostatic'] as const
export const MOL_LABELS = ['none', 'atoms', 'charges', 'residues'] as const
export type MolStyle = (typeof MOL_STYLES)[number]
export type MolColor = (typeof MOL_COLORS)[number]
export type MolSurface = (typeof MOL_SURFACES)[number]
export type MolLabels = (typeof MOL_LABELS)[number]

/** What a view needs to know about one atom: the pick readout, `look`, a measurement's ends. */
export interface AtomInfo {
  /** `12`, or `2.12` (model.atom) once the scene holds more than one model: what `measure` takes. */
  id: string
  elem: string
  element: string
  name?: string
  resn?: string
  resi?: number
  chain?: string
  charge?: number
  b?: number
  plddt?: number
  model: number
  x: number
  y: number
  z: number
}

export interface MolModelInfo {
  n: number
  target: string
  name: string
  formula?: string
  source: MolStructure['source']
  kind: 'small' | 'protein'
  atoms: number
  residues: number
  chains: string[]
  chargeMethod?: string
  plddt: boolean
}

export interface MolMeasure {
  kind: 'distance' | 'angle' | 'dihedral'
  atoms: AtomInfo[]
  value: number
  unit: 'Å' | '°'
}

export interface SeqResidue {
  key: string
  model: number
  chain: string
  resi: number
  resn: string
  one: string
  color: string | null
  picked: boolean
  selected: boolean
}

export interface MolState {
  ready: boolean
  busy: boolean
  error: string | null
  /** The Molecule tile this viewer belongs to (`molTiles`). */
  tile: number
  /** Which mount holds the viewer right now: 'pane', 'tile' or null (staging). */
  holder: string | null
  models: MolModelInfo[]
  style: MolStyle
  color: MolColor
  surface: MolSurface
  labels: MolLabels
  spin: boolean
  selection: { expr: string; atoms: number } | null
  picks: AtomInfo[]
  measures: MolMeasure[]
  callouts: { expr: string; text: string }[]
  hbonds: number | null
  contacts: number | null
  compare: { rmsd: number; pairs: number; core: number; coreRmsd: number } | null
  /** The protein chains as one-letter strings, coloured by the active scheme; empty for small molecules. */
  sequence: SeqResidue[]
  hover: string | null
}

const ELEMENTS: Record<string, string> = {
  H: 'hydrogen', C: 'carbon', N: 'nitrogen', O: 'oxygen', S: 'sulfur', P: 'phosphorus', F: 'fluorine', Cl: 'chlorine', Br: 'bromine', I: 'iodine',
  Na: 'sodium', K: 'potassium', Mg: 'magnesium', Ca: 'calcium', Fe: 'iron', Zn: 'zinc', Cu: 'copper', Mn: 'manganese', Se: 'selenium', B: 'boron', Si: 'silicon', Li: 'lithium'
}

const ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M', SEC: 'U', PYL: 'O'
}

/** Kyte–Doolittle hydropathy: +4.5 (isoleucine, oily) to −4.5 (arginine, charged). */
const HYDROPATHY: Record<string, number> = {
  ILE: 4.5, VAL: 4.2, LEU: 3.8, PHE: 2.8, CYS: 2.5, MET: 1.9, ALA: 1.8, GLY: -0.4, THR: -0.7, SER: -0.8, TRP: -0.9, TYR: -1.3, PRO: -1.6,
  HIS: -3.2, GLU: -3.5, GLN: -3.5, ASP: -3.5, ASN: -3.5, LYS: -3.9, ARG: -4.5, MSE: 1.9
}

/** Residues by side-chain chemistry, the grouping a first lesson uses: oily, polar, +, −, and the three odd ones. */
const RESIDUE_CLASS: Record<string, string> = {
  ALA: '#c8a24a', VAL: '#c8a24a', LEU: '#c8a24a', ILE: '#c8a24a', MET: '#c8a24a', MSE: '#c8a24a',
  PHE: '#b0762f', TRP: '#b0762f', TYR: '#b0762f',
  SER: '#4aa5a0', THR: '#4aa5a0', ASN: '#4aa5a0', GLN: '#4aa5a0',
  LYS: '#4f7fd9', ARG: '#4f7fd9', HIS: '#7f9fe0',
  ASP: '#d9584f', GLU: '#d9584f',
  GLY: '#9a9a9a', PRO: '#a06fc0', CYS: '#d8c23a'
}

const CHAIN_COLORS = ['#4f8fd9', '#e0873a', '#58a868', '#c8589a', '#8a74d0', '#c8b03a', '#4ab0b8', '#d0605a']
const MODEL_COLORS = ['#4f8fd9', '#e0873a', '#58a868', '#c8589a']
const SS_COLORS: Record<string, string> = { h: '#d9584f', s: '#d8b13a', c: '#8a9aa8' }
/** AlphaFold's own confidence bands: very high, confident, low, very low. */
const plddtColor = (v: number) => (v >= 90 ? '#0053d6' : v >= 70 ? '#65cbf3' : v >= 50 ? '#ffdb13' : '#ff7d45')

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0')).join('')
}
/** Red (negative, electron-rich) through white to blue (positive): the chemist's convention. */
const chargeColor = (q: number) => (q < 0 ? mix('#f2f2f2', '#d9362b', -q / 0.8) : mix('#f2f2f2', '#2b5fd9', q / 0.8))
const hydroColor = (h: number) => (h < 0 ? mix('#f2f2f2', '#3a7fd0', -h / 4.5) : mix('#f2f2f2', '#d98a2b', h / 4.5))

const isProteinAtom = (a: Atom) => !a.hetflag && !!a.resn && a.resn in ONE
const isWater = (a: Atom) => a.resn === 'HOH' || a.resn === 'WAT' || a.resn === 'DOD'
const BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT', 'H', 'HA'])

// ---- a little geometry ---------------------------------------------------------------------

type V3 = [number, number, number]
const v = (a: { x: number; y: number; z: number }): V3 => [a.x, a.y, a.z]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.sqrt(dot(a, a))
const dist = (a: Atom, b: Atom) => len(sub(v(a), v(b)))
const deg = (r: number) => (r * 180) / Math.PI
const angle = (a: Atom, b: Atom, c: Atom) => {
  const [p, q] = [sub(v(a), v(b)), sub(v(c), v(b))]
  return deg(Math.acos(Math.max(-1, Math.min(1, dot(p, q) / (len(p) * len(q))))))
}
const dihedral = (a: Atom, b: Atom, c: Atom, d: Atom) => {
  const [b1, b2, b3] = [sub(v(b), v(a)), sub(v(c), v(b)), sub(v(d), v(c))]
  const [n1, n2] = [cross(b1, b2), cross(b2, b3)]
  const m = cross(n1, b2.map((x) => x / len(b2)) as V3)
  return deg(Math.atan2(dot(m, n2), dot(n1, n2)))
}

/** Eigenvector of the largest eigenvalue of a symmetric 4×4 (Jacobi rotations). */
function topEigenvector(m: number[][]): number[] {
  const a = m.map((r) => [...r])
  const e: number[][] = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q]
    if (off < 1e-20) break
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < 4; k++) {
          const [akp, akq] = [a[k][p], a[k][q]]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < 4; k++) {
          const [apk, aqk] = [a[p][k], a[q][k]]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < 4; k++) {
          const [ekp, ekq] = [e[k][p], e[k][q]]
          e[k][p] = c * ekp - s * ekq
          e[k][q] = s * ekp + c * ekq
        }
      }
  }
  let best = 0
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i
  return e.map((r) => r[best])
}

/** The rigid motion that lays `mobile` on `fixed` (paired points), by Horn's quaternion method. */
function superpose(mobile: V3[], fixed: V3[]): { rot: number[][]; from: V3; to: V3 } {
  const n = mobile.length
  const cen = (ps: V3[]): V3 => ps.reduce<V3>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0])
  const [cm, cf] = [cen(mobile), cen(fixed)]
  const S = [0, 1, 2].map(() => [0, 0, 0])
  for (let i = 0; i < n; i++) {
    const [a, b] = [sub(mobile[i], cm), sub(fixed[i], cf)]
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += a[r] * b[c]
  }
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = [S[0][0], S[0][1], S[0][2], S[1][0], S[1][1], S[1][2], S[2][0], S[2][1], S[2][2]]
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]
  ]
  const [w, x, y, z] = topEigenvector(N)
  const rot = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z]
  ]
  return { rot, from: cm, to: cf }
}
const moved = (p: V3, t: { rot: number[][]; from: V3; to: V3 }): V3 => {
  const q = sub(p, t.from)
  return [0, 1, 2].map((r) => t.rot[r][0] * q[0] + t.rot[r][1] * q[1] + t.rot[r][2] * q[2] + t.to[r]) as V3
}

/** Pair two sequences end-gap-free (a 76-residue chain finds its place inside a 685-residue one): index pairs of the matched columns. */
function alignSequences(a: string, b: string): [number, number][] {
  const [n, m] = [a.length, b.length]
  if (n * m > 6_000_000) throw new Error('these two are too long to align here')
  const W = m + 1
  const score = new Float32Array((n + 1) * W)
  const back = new Uint8Array((n + 1) * W)
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const d = score[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 2 : -1)
      const u = score[(i - 1) * W + j] - 2
      const l = score[i * W + j - 1] - 2
      const best = Math.max(d, u, l)
      score[i * W + j] = best
      back[i * W + j] = best === d ? 1 : best === u ? 2 : 3
    }
  // The best end on the last row or column; of equals the EARLIEST, so a repeat matches its first copy.
  let [bi, bj, top] = [n, m, -Infinity]
  for (let j = 0; j <= m; j++) if (score[n * W + j] > top) [bi, bj, top] = [n, j, score[n * W + j]]
  for (let i = 0; i <= n; i++) if (score[i * W + m] > top) [bi, bj, top] = [i, m, score[i * W + m]]
  const pairs: [number, number][] = []
  while (bi > 0 && bj > 0) {
    const k = back[bi * W + bj]
    if (k === 1) {
      pairs.push([bi - 1, bj - 1])
      bi--
      bj--
    } else if (k === 2) bi--
    else bj--
  }
  return pairs.reverse()
}

// ---- the selection language ----------------------------------------------------------------

type Pred = (a: Atom) => boolean

/**
 * `resi 14,87` · `resi 10-20` · `chain A` · `resn HIS` · `elem O` · `atom CA` · `model 2` · `id 12`
 * · `protein` `water` `hetero` `backbone` `sidechain` `hydrogens` `helix` `sheet` `picked` `all`
 * · `within 5 of (…)` · `byres (…)` — joined by `and`, `or`, `not`, with parentheses.
 */
function compile(expr: string, ctx: { picked: Pred; atoms: () => Atom[]; modelNo: (a: Atom) => number }): Pred {
  const toks = expr.replace(/([()])/g, ' $1 ').replace(/,\s+/g, ',').trim().split(/\s+/).filter(Boolean)
  if (!toks.length) throw new Error('an empty selection')
  let i = 0
  const peek = () => toks[i]?.toLowerCase()
  const next = (what: string) => {
    if (i >= toks.length) throw new Error(`the selection ends where ${what} should be: “${expr}”`)
    return toks[i++]
  }
  const list = (what: string) => next(what).split(',').filter(Boolean)

  const or = (): Pred => {
    const parts = [and()]
    while (peek() === 'or') {
      i++
      parts.push(and())
    }
    return parts.length === 1 ? parts[0] : (a) => parts.some((p) => p(a))
  }
  const and = (): Pred => {
    const parts = [not()]
    while (peek() === 'and') {
      i++
      parts.push(not())
    }
    return parts.length === 1 ? parts[0] : (a) => parts.every((p) => p(a))
  }
  const not = (): Pred => {
    if (peek() === 'not') {
      i++
      const p = not()
      return (a) => !p(a)
    }
    return term()
  }
  const term = (): Pred => {
    const t = next('a term').toLowerCase()
    switch (t) {
      case '(': {
        const p = or()
        if (next('a closing parenthesis') !== ')') throw new Error(`a parenthesis is not closed in “${expr}”`)
        return p
      }
      case 'all':
      case '*':
        return () => true
      case 'resi':
      case 'resid': {
        const ranges = list('a residue number').map((r) => {
          const m = /^(-?\d+)(?:-(-?\d+))?$/.exec(r)
          if (!m) throw new Error(`“${r}” is not a residue number or a range like 10-20`)
          return [Number(m[1]), Number(m[2] ?? m[1])]
        })
        return (a) => a.resi != null && ranges.some(([lo, hi]) => a.resi! >= lo && a.resi! <= hi)
      }
      case 'chain': {
        const cs = list('a chain id')
        return (a) => cs.includes(a.chain ?? '')
      }
      case 'resn': {
        const rs = list('a residue name').map((r) => r.toUpperCase())
        return (a) => rs.includes((a.resn ?? '').toUpperCase())
      }
      case 'elem':
      case 'element': {
        const es = list('an element symbol').map((e) => e.toLowerCase())
        return (a) => es.includes(a.elem.toLowerCase())
      }
      case 'atom':
      case 'name': {
        const ns = list('an atom name').map((n) => n.toUpperCase())
        return (a) => ns.includes((a.atom ?? '').toUpperCase())
      }
      case 'model': {
        const ms = list('a model number').map(Number)
        return (a) => ms.includes(ctx.modelNo(a))
      }
      case 'id':
      case 'index': {
        const ids = list('an atom number')
        return (a) => ids.includes(String(a.index + 1)) || ids.includes(`${ctx.modelNo(a)}.${a.index + 1}`)
      }
      case 'protein':
        return isProteinAtom
      case 'water':
      case 'waters':
        return isWater
      case 'hetero':
      case 'ligand':
        return (a) => !!a.hetflag && !isWater(a)
      case 'backbone':
        return (a) => isProteinAtom(a) && BACKBONE.has(a.atom ?? '')
      case 'sidechain':
        return (a) => isProteinAtom(a) && !BACKBONE.has(a.atom ?? '')
      case 'hydrogens':
      case 'hydrogen':
        return (a) => a.elem === 'H'
      case 'helix':
        return (a) => a.ss === 'h'
      case 'sheet':
        return (a) => a.ss === 's'
      case 'picked':
      case 'picks':
        return ctx.picked
      case 'byres': {
        const p = not()
        const keys = new Set(ctx.atoms().filter(p).map(resKey))
        return (a) => keys.has(resKey(a))
      }
      case 'within': {
        const d = Number(next('a distance in Å'))
        if (!(d > 0)) throw new Error('`within` wants a distance in Å: within 5 of (resn HEM)')
        if (peek() === 'of') i++
        const p = not()
        const near = ctx.atoms().filter(p)
        return (a) => near.some((b) => dist(a, b) <= d)
      }
      default:
        throw new Error(`“${t}” is not a selection word. Try: resi 14,87 · chain A · resn HIS · elem O · atom CA · protein · water · hetero · backbone · sidechain · within 5 of (…) · picked — joined by and / or / not`)
    }
  }
  const p = or()
  if (i < toks.length) throw new Error(`could not read “${toks.slice(i).join(' ')}” in the selection (join terms with and / or)`)
  return p
}

const resKey = (a: Atom) => `${a.model}:${a.chain ?? ''}:${a.resi ?? a.index}`

// ---- the viewer ----------------------------------------------------------------------------

interface Loaded {
  model: Model
  id: number
  s: MolStructure
  kind: 'small' | 'protein'
  atoms: Atom[]
}

interface Hilite {
  hbonds: boolean
  contacts: number | null
  expr: string | null
}

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/**
 * How far one step of a PINCH zooms. Exponential in the raw deltaY, so the gesture reads as one
 * continuous motion and the same total pinch always zooms the same amount; each event is capped in
 * case the OS hands us one enormous delta. (3Dmol's own handler moves the camera by a fixed
 * FRACTION of the remaining distance per event — ~30% for a mouse notch — which a trackpad's
 * momentum turns into a molecule that jumps to the camera and vanishes.)
 */
const ZOOM_PER_DELTA = 0.01
const ZOOM_STEP_MAX = 0.3

class MolViewer {
  private lib: Lib | null = null
  private loading: Promise<void> | null = null
  private viewer: Viewer | null = null
  private readonly host: HTMLDivElement
  private staging: HTMLDivElement | null = null
  private mounts: { el: HTMLElement; name: string; rank: number }[] = []
  private readonly listeners = new Set<(s: MolState) => void>()

  private models: Loaded[] = []
  private style: MolStyle = 'ball-stick'
  private color: MolColor = 'element'
  private surface: MolSurface = 'none'
  private labels: MolLabels = 'none'
  private spinning = false
  private selExpr: string | null = null
  private hilite: Hilite | null = null
  private hbondCount: number | null = null
  private contactCount: number | null = null
  private contactResidues: string[] = []
  private picks: Atom[] = []
  private measures: { kind: MolMeasure['kind']; atoms: Atom[]; value: number }[] = []
  private callouts: { expr: string; text: string }[] = []
  private compared: MolState['compare'] = null
  private hover: string | null = null
  /** The strip and the selection's size, rebuilt by redraw(): a hover must not recount 5000 atoms. */
  private seq: Omit<SeqResidue, 'picked' | 'selected'>[] = []
  private selected: Atom[] = []
  private hoverLabel: Label | null = null
  private busy = false
  private error: string | null = null
  private bRange: [number, number] = [0, 1]
  private queue: Promise<unknown> = Promise.resolve()
  private readonly sizer: ResizeObserver
  /** True while restore() is bringing the saved scene back; any other op calls it off. */
  private restoring = false
  private gone = false

  state: MolState

  constructor(readonly tile: number) {
    this.host = document.createElement('div')
    this.host.className = 'mol-host'
    this.sizer = new ResizeObserver(() => {
      if (this.host.clientWidth > 0 && this.host.clientHeight > 0) this.viewer?.resize()
    })
    this.sizer.observe(this.host)
    // Capture, so 3Dmol's own listener on the canvas below never sees a wheel event.
    this.host.addEventListener('wheel', this.onWheel, { capture: true, passive: false })
    this.state = this.snapshot()
  }

  /**
   * A PINCH zooms the molecule; a two-finger SCROLL is the column's, so the grid still scrolls
   * under the tile. Either way 3Dmol's own handler never sees the event (it would zoom on both,
   * and hard) — stopping propagation keeps it out without touching the browser's default scroll.
   */
  private onWheel = (ev: WheelEvent): void => {
    ev.stopPropagation()
    // A trackpad pinch reaches the page as a wheel with ctrlKey; a plain scroll has none.
    if (!ev.ctrlKey) return
    ev.preventDefault()
    if (!this.viewer) return
    // Chromium sends pixels here, but a line-mode wheel would barely move.
    const delta = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? window.innerHeight : 1)
    // Spreading the fingers scrolls UP, and must draw the molecule nearer: inverted.
    const step = Math.max(-ZOOM_STEP_MAX, Math.min(ZOOM_STEP_MAX, -delta * ZOOM_PER_DELTA))
    this.viewer.zoom(Math.exp(step))
  }

  // -- plumbing --

  subscribe(cb: (s: MolState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    this.state = this.snapshot()
    for (const l of this.listeners) l(this.state)
  }

  /** The tile was closed: give the WebGL context back (Chromium caps them) and forget the scene. */
  dispose(): void {
    this.gone = true
    this.restoring = false
    this.sizer.disconnect()
    this.host.removeEventListener('wheel', this.onWheel, { capture: true })
    this.listeners.clear()
    try {
      this.viewer?.spin(false)
      this.viewer?.removeAllModels()
      const canvas = this.host.querySelector('canvas')
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      // Already lost.
    }
    this.viewer = null
    this.host.remove()
    this.staging?.remove()
    try {
      localStorage.removeItem(sceneKey(this.tile))
    } catch {
      // No storage: nothing was kept.
    }
  }

  /** What this tile showed before the reload, shown again (main has every structure cached). */
  async restore(): Promise<void> {
    let saved: { compare?: boolean; targets?: string[]; style?: string; color?: string; surface?: string; labels?: string } | null = null
    try {
      saved = JSON.parse(localStorage.getItem(sceneKey(this.tile)) ?? 'null')
    } catch {
      return
    }
    const targets = (saved?.targets ?? []).filter((t) => typeof t === 'string').slice(0, 4)
    if (!saved || !targets.length) return
    this.restoring = true
    try {
      const ss = await Promise.all(targets.map((t) => window.deck.molResolve(t)))
      const looks = { style: saved.style, color: saved.color, surface: saved.surface, labels: saved.labels }
      if (saved.compare && ss.length === 2) {
        if (this.restoring) await this.drive({ op: 'compare', structures: ss, ...looks }, true)
      } else
        for (let i = 0; i < ss.length; i++) {
          if (!this.restoring) return
          await this.drive({ op: 'show', structures: [ss[i]], add: i > 0, ...(i === ss.length - 1 ? looks : {}) }, true)
        }
    } catch {
      // A file that moved, a cache that was emptied offline: the tile just starts empty.
      this.error = null
      this.emit()
    } finally {
      this.restoring = false
    }
  }

  /** Nothing showing and nothing on its way back: what `--new` may take instead of opening another tile. */
  isEmpty(): boolean {
    return !this.models.length && !this.restoring && !this.busy
  }

  private remember(): void {
    try {
      if (!this.models.length) localStorage.removeItem(sceneKey(this.tile))
      else localStorage.setItem(sceneKey(this.tile), JSON.stringify({ compare: !!this.compared, targets: this.models.map((m) => m.s.target), style: this.style, color: this.color, surface: this.surface, labels: this.labels }))
    } catch {
      // No storage: the scene is this window's only.
    }
  }

  /** A view offers its box; the highest rank showing holds the viewer (the pane outranks the tile). */
  mount(el: HTMLElement, name: string, rank: number): () => void {
    const m = { el, name, rank }
    this.mounts.push(m)
    this.place()
    void this.ensure().catch(() => {})
    return () => {
      this.mounts = this.mounts.filter((x) => x !== m)
      this.place()
    }
  }

  private place(): void {
    const top = [...this.mounts].sort((a, b) => b.rank - a.rank)[0]
    if (this.gone) return
    if (!top && !this.staging) {
      this.staging = document.createElement('div')
      this.staging.className = 'mol-staging'
      document.body.appendChild(this.staging)
    }
    const want = top?.el ?? this.staging!
    if (this.host.parentElement !== want) {
      want.appendChild(this.host)
      this.viewer?.resize()
      this.viewer?.render()
    }
    if ((top?.name ?? null) !== this.state.holder) this.emit()
  }

  private ensure(): Promise<void> {
    if (this.viewer) return Promise.resolve()
    this.loading ??= import('3dmol/build/3Dmol.es6-min.js').then((lib) => {
      this.lib = lib
      lib.setSyncSurface(true)
      if (!this.host.parentElement) this.place()
      this.viewer = lib.createViewer(this.host, { backgroundColor: css('--panel', '#ffffff'), antialias: true })
      this.viewer.setHoverDuration(120)
      this.emit()
    })
    return this.loading
  }

  /** Theme change: the background and every label are the theme's, so paint again. */
  retheme(): void {
    if (!this.viewer) return
    this.viewer.setBackgroundColor(css('--panel', '#ffffff'))
    void this.redraw()
  }

  /** One op at a time: a `show` that is still computing a surface must not interleave with the next command. */
  drive(body: Record<string, unknown>, restoring = false): Promise<Record<string, unknown>> {
    if (!restoring) this.restoring = false
    const run = this.queue.then(async () => {
      if (this.gone) throw new Error(`Molecule tile ${this.tile} was closed`)
      await this.ensure()
      this.busy = true
      this.error = null
      this.emit()
      try {
        const out = await this.op(body)
        this.remember()
        return out
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
        throw e
      } finally {
        this.busy = false
        this.emit()
      }
    })
    this.queue = run.catch(() => {})
    return run
  }

  /** The UI's way in for a target: main resolves it (fetch + cache), then the same `show` the door runs. */
  async show(target: string, opts: Record<string, unknown> = {}): Promise<void> {
    this.busy = true
    this.error = null
    this.emit()
    try {
      const s = await window.deck.molResolve(target)
      await this.drive({ op: 'show', structures: [s], ...opts })
    } catch (e) {
      this.busy = false
      this.error = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      this.emit()
    }
  }

  /** The UI's other controls: the same ops, errors kept on the state instead of thrown. */
  act(body: Record<string, unknown>): void {
    void this.drive(body).catch(() => {})
  }

  // -- the ops --

  private async op(b: Record<string, unknown>): Promise<Record<string, unknown>> {
    const str = (k: string) => (typeof b[k] === 'string' && b[k] ? String(b[k]) : undefined)
    switch (b.op) {
      case 'show': {
        const s = (b.structures as MolStructure[] | undefined)?.[0]
        if (!s) throw new Error('show: no structure came with the request')
        if (!b.add) this.reset()
        if (this.models.length >= 4) throw new Error('four models is the most one scene holds: `clear`, or `show` without --add')
        const m = this.load(s)
        const first = this.models.length === 1
        if (first) this.defaults(m.kind)
        this.options(b)
        if (!first && this.models.length > 1 && !str('color') && this.color === 'element' && m.kind === 'protein') this.color = 'model'
        await this.redraw()
        this.viewer!.zoomTo()
        this.viewer!.render()
        return { shown: this.modelInfo(m), cached: s.cached, ...this.brief() }
      }
      case 'compare': {
        const ss = b.structures as MolStructure[] | undefined
        if (!ss || ss.length !== 2) throw new Error('compare wants two targets')
        this.reset()
        const [a, m] = [this.load(ss[0]), this.load(ss[1])]
        this.defaults(a.kind)
        this.color = 'model'
        const fit = this.fit(a, m)
        this.compared = fit
        this.options(b)
        await this.redraw()
        this.viewer!.zoomTo({ model: a.id })
        this.viewer!.render()
        return {
          rmsd: fit.rmsd,
          pairs: fit.pairs,
          core: { pairs: fit.core, rmsd: fit.coreRmsd },
          note: `${ss[1].name} was laid onto ${ss[0].name}: ${fit.pairs} ${a.kind === 'protein' ? 'Cα pairs matched by sequence' : 'atoms paired in order'}, RMSD ${fit.rmsd} Å (the ${fit.core} pairs that fit within 3 Å: ${fit.coreRmsd} Å). Model 1 is blue, model 2 orange.`,
          ...this.brief()
        }
      }
      case 'style': {
        this.options(b)
        await this.redraw()
        return this.brief()
      }
      case 'select': {
        const expr = str('expr')
        if (!expr || /^(none|clear)$/i.test(expr)) {
          this.selExpr = null
          await this.redraw()
          return { selected: 0, ...this.brief() }
        }
        const atoms = this.select(expr)
        if (!atoms.length) throw new Error(`nothing matches “${expr}” in this scene (${this.models.map((m) => m.s.name).join(', ') || 'it is empty'})`)
        this.selExpr = expr
        await this.redraw()
        return { selected: atoms.length, residues: this.residuesOf(atoms).slice(0, 60), atoms: atoms.length <= 24 ? atoms.map((a) => this.info(a)) : undefined, ...this.brief() }
      }
      case 'highlight': {
        if (!this.models.length) throw new Error('nothing to highlight: `show` something first')
        if (b.off) this.hilite = null
        else {
          const contacts = b.contacts != null && b.contacts !== false ? Number(b.contacts === true ? 4 : b.contacts) : null
          if (contacts != null && !(contacts > 0 && contacts <= 12)) throw new Error('--contacts wants a distance in Å, up to 12')
          const expr = str('select') ?? null
          if (expr) this.select(expr)
          if (!b.hbonds && contacts == null && !expr) throw new Error('highlight what? --hbonds, --contacts <Å>, and/or --select <expr>')
          this.hilite = { hbonds: !!b.hbonds, contacts, expr }
          if (expr && !b.hbonds && contacts == null) this.selExpr = expr
        }
        await this.redraw()
        return {
          hbonds: this.hbondCount ?? undefined,
          hbondMethod: this.hbondCount != null ? 'geometric: with hydrogens, H···acceptor ≤ 2.5 Å and the angle at H ≥ 120°; without (most crystal structures), N/O···N/O ≤ 3.5 Å between residues two or more apart' : undefined,
          contacts: this.contactCount ?? undefined,
          contactResidues: this.contactCount != null ? this.contactResidues.slice(0, 60) : undefined,
          ...this.brief()
        }
      }
      case 'measure': {
        const refs = (b.atoms as unknown[] | undefined)?.map(String) ?? []
        if (b.clear) {
          this.measures = []
          await this.redraw()
          return this.brief()
        }
        if (refs.length < 2 || refs.length > 4) throw new Error('measure wants 2 atoms (distance), 3 (angle) or 4 (dihedral): atom numbers from `look`, p1…p4 for the picks, or a selection that matches one atom ("resi 48 and atom NZ")')
        const atoms = refs.map((r) => this.atomRef(r))
        const kind = atoms.length === 2 ? 'distance' : atoms.length === 3 ? 'angle' : 'dihedral'
        const value = kind === 'distance' ? dist(atoms[0], atoms[1]) : kind === 'angle' ? angle(atoms[0], atoms[1], atoms[2]) : dihedral(atoms[0], atoms[1], atoms[2], atoms[3])
        this.measures.push({ kind, atoms, value })
        if (this.measures.length > 12) this.measures.shift()
        await this.redraw()
        return { measured: this.measureInfo(this.measures[this.measures.length - 1]), ...this.brief() }
      }
      case 'unmeasure': {
        this.measures.splice(Number(b.index ?? -1), 1)
        await this.redraw()
        return this.brief()
      }
      case 'label': {
        const expr = str('expr')
        const text = str('text')
        if (b.clear) this.callouts = []
        else {
          if (!expr || !text) throw new Error('label wants a selection and a text: label "elem O" "the oxygen hogs the electrons"')
          if (!this.select(expr).length) throw new Error(`nothing matches “${expr}” to pin a label to`)
          this.callouts = this.callouts.filter((c) => c.expr !== expr)
          this.callouts.push({ expr, text: text.slice(0, 120) })
          if (this.callouts.length > 8) this.callouts.shift()
        }
        await this.redraw()
        return this.brief()
      }
      case 'view': {
        if (!this.models.length) throw new Error('an empty scene has no view: `show` something first')
        if (b.spin != null) {
          this.spinning = b.spin === true || b.spin === 'on'
          this.viewer!.spin(this.spinning ? 'y' : false, 0.6)
        }
        if (b.reset) this.viewer!.zoomTo({}, 400)
        const zoom = str('zoom')
        if (zoom) {
          const atoms = this.select(zoom)
          if (!atoms.length) throw new Error(`nothing matches “${zoom}” to zoom to`)
          this.viewer!.zoomTo(this.spec(atoms), 500)
        }
        this.viewer!.render()
        return this.brief()
      }
      case 'pick': {
        // The sequence strip's click: a residue's Cα, as if it had been clicked in 3D.
        const a = this.atomRef(String(b.atom))
        this.togglePick(a)
        await this.redraw()
        return this.brief()
      }
      case 'unpick': {
        this.picks = []
        await this.redraw()
        return this.brief()
      }
      case 'look': {
        this.viewer!.render()
        const uri = this.viewer!.pngURI()
        const bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0))
        const image = await window.deck.molShot(bytes, this.tile)
        return { tile: this.tile, ...this.describe(), image, imageNote: this.state.holder ? undefined : 'the tile is not on screen: this is the viewer’s off-screen frame' }
      }
      case 'clear':
        this.reset()
        await this.redraw()
        return this.brief()
      default:
        throw new Error(`unknown op ${String(b.op)}`)
    }
  }

  private options(b: Record<string, unknown>): void {
    const pick = <T extends string>(k: string, all: readonly T[]): T | undefined => {
      const val = b[k]
      if (val == null || val === '') return undefined
      const s = String(val).toLowerCase().replace(/^ball.?and.?stick$|^ballstick$/, 'ball-stick') as T
      if (!all.includes(s)) throw new Error(`--${k} ${String(val)}: not one of ${all.join(' | ')}`)
      return s
    }
    const style = pick('style', MOL_STYLES)
    const color = pick('color', MOL_COLORS)
    const surface = pick('surface', MOL_SURFACES)
    const labels = pick('labels', MOL_LABELS)
    if (style === 'surface') {
      if (this.surface === 'none' && !surface) this.surface = 'vdw'
    } else if (style) this.style = style
    if (color) {
      if (color === 'plddt' && !this.models.some((m) => m.s.source === 'alphafold')) throw new Error('--color plddt reads an AlphaFold model’s confidence: nothing here is one (AF-<uniprot>). --color bfactor is the crystal-structure cousin')
      if (color === 'charge' && !this.models.some((m) => m.s.charges || m.kind === 'protein')) throw new Error('--color charge: this structure came with no partial charges (the built-in library, PubChem molecules and proteins have them)')
      this.color = color
    }
    if (surface) {
      if (surface === 'electrostatic' && !this.models.some((m) => m.s.charges || m.kind === 'protein')) throw new Error('--surface electrostatic colours the surface by partial charge, and this structure came with none')
      this.surface = surface
    }
    if (labels) {
      const n = this.models.reduce((s, m) => s + m.atoms.length, 0)
      if ((labels === 'atoms' || labels === 'charges') && n > 120) throw new Error(`--labels ${labels} on ${n} atoms would bury the molecule: use --labels residues, or \`label <expr> "<text>"\` on the few that matter`)
      this.labels = labels
    }
  }

  private defaults(kind: 'small' | 'protein'): void {
    this.style = kind === 'protein' ? 'cartoon' : 'ball-stick'
    this.color = kind === 'protein' ? 'chain' : 'element'
    this.surface = 'none'
    this.labels = 'none'
  }

  private reset(): void {
    this.viewer?.removeAllModels()
    this.models = []
    this.selExpr = null
    this.hilite = null
    this.picks = []
    this.measures = []
    this.callouts = []
    this.compared = null
    this.hover = null
    this.style = 'ball-stick'
    this.color = 'element'
    this.surface = 'none'
    this.labels = 'none'
  }

  private load(s: MolStructure): Loaded {
    let model: Model
    try {
      model = this.viewer!.addModel(s.data, s.format, { keepH: true })
    } catch (e) {
      throw new Error(`${s.name}: 3Dmol could not read it as ${s.format} (${e instanceof Error ? e.message : String(e)})`)
    }
    const atoms = model.selectedAtoms({})
    if (!atoms.length) {
      this.viewer!.removeModel(model)
      throw new Error(`${s.name}: no atoms in it (read as ${s.format})`)
    }
    const kind = atoms.filter(isProteinAtom).length >= 20 ? 'protein' : 'small'
    for (const a of atoms) {
      a.properties ??= {}
      if (s.charges) a.properties.partialCharge = s.charges[a.index] ?? 0
      else if (isProteinAtom(a)) this.lib!.applyPartialCharges(a, true)
    }
    const m: Loaded = { model, id: model.getID(), s, kind, atoms }
    this.models.push(m)
    const bs = this.allAtoms().map((a) => a.b ?? 0)
    this.bRange = [Math.min(...bs), Math.max(...bs)]
    return m
  }

  /** Lay model `m` onto `a`: Cα pairs by sequence for proteins, atoms in order for two copies of a small molecule. */
  private fit(a: Loaded, m: Loaded): NonNullable<MolState['compare']> {
    let pairs: [Atom, Atom][]
    if (a.kind === 'protein' && m.kind === 'protein') {
      const ca = (l: Loaded) => l.atoms.filter((x) => isProteinAtom(x) && x.atom === 'CA')
      const [x, y] = [ca(a), ca(m)]
      const seq = (as: Atom[]) => as.map((r) => ONE[r.resn!] ?? 'X').join('')
      pairs = alignSequences(seq(x), seq(y)).map(([i, j]) => [x[i], y[j]])
      if (pairs.length < 4) throw new Error('these two share too little sequence to superpose')
    } else {
      const heavy = (l: Loaded) => l.atoms.filter((x) => x.elem !== 'H')
      const [x, y] = [heavy(a), heavy(m)]
      if (x.length !== y.length || x.some((p, i) => p.elem !== y[i].elem)) throw new Error('compare superposes two proteins (by sequence) or two copies of the same small molecule (same atoms in the same order); these are neither. `show A` then `show B --add` puts them side by side instead')
      if (x.length < 3) throw new Error('too few atoms to superpose')
      pairs = x.map((p, i) => [p, y[i]])
    }
    const rmsdOf = (ps: [Atom, Atom][]) => Math.sqrt(ps.reduce((s, [p, q]) => s + dist(p, q) ** 2, 0) / ps.length)
    // Fit, then fit again on the pairs that agree: a floppy tail must not drag the core off.
    let core = pairs
    for (let round = 0; round < 3; round++) {
      const t = superpose(core.map(([, q]) => v(q)), core.map(([p]) => v(p)))
      for (const atom of m.atoms) [atom.x, atom.y, atom.z] = moved(v(atom), t)
      const close = pairs.filter(([p, q]) => dist(p, q) <= 3)
      if (close.length < 4 || close.length === core.length) break
      core = close
    }
    const close = pairs.filter(([p, q]) => dist(p, q) <= 3)
    const r2 = (n: number) => Math.round(n * 100) / 100
    return { rmsd: r2(rmsdOf(pairs)), pairs: pairs.length, core: close.length, coreRmsd: close.length ? r2(rmsdOf(close)) : 0 }
  }

  // -- reading the scene --

  private allAtoms(): Atom[] {
    return this.models.flatMap((m) => m.atoms)
  }

  private select(expr: string): Atom[] {
    const picked = new Set(this.picks)
    const all = this.allAtoms()
    return all.filter(compile(expr, { picked: (a) => picked.has(a), atoms: () => all, modelNo: (a) => this.modelNo(a) }))
  }

  /** Atoms → a 3Dmol selection (by model and index: our predicates never have to be 3Dmol's). */
  private spec(atoms: Atom[]): Record<string, unknown> {
    const by = new Map<number, number[]>()
    for (const a of atoms) by.set(a.model, [...(by.get(a.model) ?? []), a.index])
    const parts = [...by].map(([model, index]) => ({ model, index }))
    return parts.length === 1 ? parts[0] : { or: parts }
  }

  private atomRef(ref: string): Atom {
    const p = /^p([1-4])$/i.exec(ref)
    if (p) {
      const a = this.picks[Number(p[1]) - 1]
      if (!a) throw new Error(`${ref}: only ${this.picks.length} atom${this.picks.length === 1 ? ' is' : 's are'} picked (click atoms in the viewer; \`look\` lists them)`)
      return a
    }
    const n = /^(?:(\d+)\.)?(\d+)$/.exec(ref)
    if (n) {
      if (!n[1] && this.models.length > 1) throw new Error(`${ref}: with ${this.models.length} models on screen say which, as model.atom (1.${n[2]} or 2.${n[2]})`)
      const m = this.models[Number(n[1] ?? 1) - 1]
      const a = m?.atoms[Number(n[2]) - 1]
      if (!a) throw new Error(`${ref}: no such atom (${m ? `model ${n[1] ?? 1} has ${m.atoms.length}` : `there is no model ${n[1]}`})`)
      return a
    }
    const hits = this.select(ref)
    if (hits.length !== 1) throw new Error(`“${ref}” matches ${hits.length} atoms; a measurement needs exactly one (add "and atom CA", or use an atom number from \`look\`)`)
    return hits[0]
  }

  /** 1, 2… as the scene counts its models (3Dmol's own ids need not be). */
  private modelNo(a: Atom): number {
    return this.models.findIndex((m) => m.id === a.model) + 1
  }

  private idOf(a: Atom): string {
    return this.models.length > 1 ? `${this.modelNo(a)}.${a.index + 1}` : String(a.index + 1)
  }

  private info(a: Atom): AtomInfo {
    const q = a.properties?.partialCharge
    const af = this.models.find((m) => m.id === a.model)?.s.source === 'alphafold'
    const r3 = (n: number) => Math.round(n * 1000) / 1000
    return {
      id: this.idOf(a),
      elem: a.elem,
      element: ELEMENTS[a.elem] ?? a.elem,
      name: a.atom && a.atom !== a.elem ? a.atom : undefined,
      resn: a.resn || undefined,
      resi: a.resn ? a.resi : undefined,
      chain: a.chain || undefined,
      charge: typeof q === 'number' ? r3(q) : undefined,
      b: !af && a.b ? a.b : undefined,
      plddt: af ? a.b : undefined,
      model: this.modelNo(a),
      x: r3(a.x),
      y: r3(a.y),
      z: r3(a.z)
    }
  }

  private residuesOf(atoms: Atom[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const a of atoms) {
      if (!a.resn) continue
      const k = resKey(a)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(`${a.resn}${a.resi ?? ''}${a.chain ? `:${a.chain}` : ''}`)
    }
    return out
  }

  private modelInfo(m: Loaded): MolModelInfo {
    const res = new Set(m.atoms.filter(isProteinAtom).map(resKey))
    return {
      n: this.models.indexOf(m) + 1,
      target: m.s.target,
      name: m.s.name,
      formula: m.s.formula,
      source: m.s.source,
      kind: m.kind,
      atoms: m.atoms.length,
      residues: res.size,
      chains: [...new Set(m.atoms.filter(isProteinAtom).map((a) => a.chain ?? ''))].filter(Boolean),
      chargeMethod: m.s.charges ? m.s.chargeMethod : m.kind === 'protein' ? 'Amber-style per-residue partial charges (3Dmol’s table)' : undefined,
      plddt: m.s.source === 'alphafold'
    }
  }

  private measureInfo(m: { kind: MolMeasure['kind']; atoms: Atom[]; value: number }): MolMeasure {
    return { kind: m.kind, atoms: m.atoms.map((a) => this.info(a)), value: Math.round(m.value * 100) / 100, unit: m.kind === 'distance' ? 'Å' : '°' }
  }

  /** What every op answers with: enough to know the command landed. */
  private brief(): Record<string, unknown> {
    return { tile: this.tile, scene: this.models.map((m) => m.s.name), style: this.style, color: this.color, surface: this.surface, labels: this.labels }
  }

  /** `look`: the whole scene in words. */
  private describe(): Record<string, unknown> {
    const small = this.models.filter((m) => m.kind === 'small' && m.atoms.length <= 40)
    return {
      models: this.models.map((m) => this.modelInfo(m)),
      style: this.style,
      color: this.color,
      surface: this.surface,
      labels: this.labels,
      spin: this.spinning,
      selection: this.selExpr ? { expr: this.selExpr, atoms: this.select(this.selExpr).length, residues: this.residuesOf(this.select(this.selExpr)).slice(0, 60) } : null,
      picked: this.picks.map((a, i) => ({ ref: `p${i + 1}`, ...this.info(a) })),
      pickedNote: this.picks.length ? 'what the user clicked, oldest first; p1…p4 work in `measure` and `picked` in any selection' : 'the user has not clicked an atom',
      measurements: this.measures.map((m) => this.measureInfo(m)),
      callouts: this.callouts,
      hbonds: this.hbondCount,
      contacts: this.contactCount,
      compare: this.compared,
      // A small molecule's atoms in full, so the session can name any of them without a second call.
      atoms: small.length ? small.flatMap((m) => m.atoms.map((a) => this.info(a))) : undefined,
      onScreen: this.state.holder ?? 'nowhere (the tile is scrolled away or off)'
    }
  }

  private snapshot(): MolState {
    const picked = new Set(this.picks.map(resKey))
    const sel = new Set(this.selected.map(resKey))
    const sequence: SeqResidue[] = this.seq.map((r) => ({ ...r, picked: picked.has(r.key), selected: sel.has(r.key) }))
    return {
      ready: !!this.viewer,
      busy: this.busy,
      error: this.error,
      tile: this.tile,
      holder: [...this.mounts].sort((a, b) => b.rank - a.rank)[0]?.name ?? null,
      models: this.models.map((m) => this.modelInfo(m)),
      style: this.style,
      color: this.color,
      surface: this.surface,
      labels: this.labels,
      spin: this.spinning,
      selection: this.selExpr ? { expr: this.selExpr, atoms: this.selected.length } : null,
      picks: this.picks.map((a) => this.info(a)),
      measures: this.measures.map((m) => this.measureInfo(m)),
      callouts: this.callouts,
      hbonds: this.hbondCount,
      contacts: this.contactCount,
      compare: this.compared,
      sequence,
      hover: this.hover
    }
  }

  private trySelect(expr: string): Atom[] {
    try {
      return this.select(expr)
    } catch {
      return []
    }
  }

  // -- colour --

  /** One colour function for the atoms, the cartoon, the surface AND the sequence strip; null = the element's own. */
  private colorOf(a: Atom): string | null {
    switch (this.color) {
      case 'charge': {
        const q = a.properties?.partialCharge
        return typeof q === 'number' ? chargeColor(q) : '#f2f2f2'
      }
      case 'hydrophobicity':
        return a.resn && a.resn in HYDROPATHY ? hydroColor(HYDROPATHY[a.resn]) : null
      case 'residue':
        return (a.resn && RESIDUE_CLASS[a.resn]) || null
      case 'chain': {
        if (!isProteinAtom(a)) return null
        const chains = [...new Set(this.allAtoms().filter(isProteinAtom).map((x) => `${x.model}:${x.chain ?? ''}`))]
        return CHAIN_COLORS[Math.max(0, chains.indexOf(`${a.model}:${a.chain ?? ''}`)) % CHAIN_COLORS.length]
      }
      case 'secondary':
        return isProteinAtom(a) ? (SS_COLORS[a.ss ?? 'c'] ?? SS_COLORS.c) : null
      case 'plddt':
        return this.models.find((m) => m.id === a.model)?.s.source === 'alphafold' ? plddtColor(a.b ?? 0) : null
      case 'bfactor': {
        const [lo, hi] = this.bRange
        return hi > lo ? mix('#2b5fd9', '#d9362b', ((a.b ?? lo) - lo) / (hi - lo)) : null
      }
      case 'model':
        return MODEL_COLORS[Math.max(0, this.models.findIndex((m) => m.id === a.model)) % MODEL_COLORS.length]
      default:
        return null
    }
  }

  // -- painting --

  private async redraw(): Promise<void> {
    const vw = this.viewer
    if (!vw) return
    const ink = css('--ink', '#222222')
    const panel = css('--panel', '#ffffff')
    const accent = css('--accent', '#d97a2b')
    const muted = css('--muted', '#888888')
    vw.setBackgroundColor(panel)
    vw.removeAllShapes()
    vw.removeAllLabels()
    vw.removeAllSurfaces()
    this.hoverLabel = null
    this.hbondCount = null
    this.contactCount = null
    this.contactResidues = []

    // Chain lookups are per atom otherwise: colour once per redraw.
    const cache = new Map<Atom, string | null>()
    const chainIndex = this.color === 'chain' ? [...new Set(this.allAtoms().filter(isProteinAtom).map((x) => `${x.model}:${x.chain ?? ''}`))] : []
    const colorOf = (a: Atom): string | null => {
      if (cache.has(a)) return cache.get(a)!
      const c = this.color === 'chain' ? (isProteinAtom(a) ? CHAIN_COLORS[Math.max(0, chainIndex.indexOf(`${a.model}:${a.chain ?? ''}`)) % CHAIN_COLORS.length] : null) : this.colorOf(a)
      cache.set(a, c)
      return c
    }
    const tint = (extra: Record<string, unknown> = {}) => (this.color === 'element' ? extra : { ...extra, colorfunc: (a: Atom) => colorOf(a) ?? elementFallback(a) })
    const elementFallback = (a: Atom) => (a.elem === 'C' ? muted : a.elem === 'O' ? '#d9362b' : a.elem === 'N' ? '#2b5fd9' : a.elem === 'S' ? '#d8c23a' : a.elem === 'H' ? '#e8e8e8' : muted)

    const atomStyle = (s: MolStyle): Record<string, unknown> =>
      s === 'stick' ? { stick: tint({ radius: 0.16 }) } : s === 'sphere' ? { sphere: tint() } : s === 'line' ? { line: tint({ linewidth: 2 }) } : { stick: tint({ radius: 0.13 }), sphere: tint({ scale: 0.27 }) }

    vw.setStyle({}, {})
    for (const m of this.models) {
      if (this.style === 'cartoon' && m.kind === 'protein') {
        vw.setStyle({ model: m.id }, { cartoon: this.color === 'element' ? { color: muted } : { colorfunc: (a: Atom) => colorOf(a) ?? muted } })
        // What is not chain stays visible as atoms: a ligand, an ion. Waters would only be noise.
        const het = m.atoms.filter((a) => a.hetflag && !isWater(a))
        if (het.length) vw.setStyle(this.spec(het), { stick: { radius: 0.16 }, sphere: { scale: 0.27 } })
      } else {
        const st = atomStyle(this.style === 'cartoon' ? 'ball-stick' : this.style)
        const atoms = m.kind === 'protein' ? m.atoms.filter((a) => !isWater(a)) : m.atoms
        vw.setStyle(this.spec(atoms), st)
      }
    }

    // The selection: its atoms as sticks over whatever the base is, and a halo on each while they are few.
    const selected = this.selExpr ? this.trySelect(this.selExpr) : []
    this.selected = selected
    this.seq = []
    for (const m of this.models) {
      if (m.kind !== 'protein') continue
      const seen = new Set<string>()
      for (const a of m.atoms) {
        if (!isProteinAtom(a) || a.atom !== 'CA') continue
        const key = resKey(a)
        if (seen.has(key)) continue
        seen.add(key)
        this.seq.push({ key, model: this.models.indexOf(m) + 1, chain: a.chain ?? '', resi: a.resi ?? 0, resn: a.resn!, one: ONE[a.resn!] ?? 'X', color: colorOf(a) })
      }
    }
    if (selected.length) {
      vw.addStyle(this.spec(selected), { stick: tint({ radius: 0.2 }) })
      if (selected.length <= 40) for (const a of selected) vw.addSphere({ center: { x: a.x, y: a.y, z: a.z }, radius: a.elem === 'H' ? 0.45 : 0.7, color: accent, opacity: 0.35 })
    }
    for (const a of this.picks) vw.addSphere({ center: { x: a.x, y: a.y, z: a.z }, radius: a.elem === 'H' ? 0.5 : 0.8, color: accent, opacity: 0.5 })

    const labelStyle = { fontColor: ink, backgroundColor: panel, backgroundOpacity: 0.78, borderColor: muted, borderThickness: 0.5, fontSize: 12, inFront: true, showBackground: true }
    const at = (a: Atom) => ({ position: { x: a.x, y: a.y, z: a.z } })

    if (this.labels === 'atoms' || this.labels === 'charges') {
      for (const a of this.allAtoms()) {
        const q = a.properties?.partialCharge
        const text = this.labels === 'atoms' ? `${a.atom && a.atom !== a.elem ? a.atom : a.elem}${this.idOf(a)}` : typeof q === 'number' ? (Math.abs(q) < 0.005 ? '0' : `${q > 0 ? 'δ+' : 'δ−'} ${Math.abs(q).toFixed(2)}`) : null
        if (text) vw.addLabel(text, { ...labelStyle, ...at(a), fontSize: 11, backgroundOpacity: 0.6 })
      }
    } else if (this.labels === 'residues') {
      const cas = this.allAtoms().filter((a) => isProteinAtom(a) && a.atom === 'CA')
      const step = Math.max(1, Math.ceil(cas.length / 80))
      cas.forEach((a, i) => {
        if (i % step === 0 || selected.includes(a)) vw.addLabel(`${ONE[a.resn!] ?? a.resn}${a.resi}`, { ...labelStyle, ...at(a), fontSize: 10, backgroundOpacity: 0.55 })
      })
    }

    for (const c of this.callouts) {
      const atoms = this.trySelect(c.expr)
      if (!atoms.length) continue
      const n = atoms.length
      const p = atoms.reduce((s, a) => ({ x: s.x + a.x / n, y: s.y + a.y / n, z: s.z + a.z / n }), { x: 0, y: 0, z: 0 })
      vw.addLabel(c.text, { ...labelStyle, position: p, fontSize: 13, backgroundColor: accent, fontColor: panel, backgroundOpacity: 0.92, borderThickness: 0 })
    }

    const dash = (a: Atom, b: Atom, color: string, radius = 0.06) =>
      vw.addCylinder({ start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z }, radius, color, dashed: true, dashLength: 0.22, gapLength: 0.16, fromCap: 1, toCap: 1 })
    const mid = (as: Atom[]) => ({ x: as.reduce((s, a) => s + a.x, 0) / as.length, y: as.reduce((s, a) => s + a.y, 0) / as.length, z: as.reduce((s, a) => s + a.z, 0) / as.length })

    for (const m of this.measures) {
      for (let i = 0; i + 1 < m.atoms.length; i++) dash(m.atoms[i], m.atoms[i + 1], ink, 0.05)
      const where = m.kind === 'angle' ? m.atoms[1] : null
      vw.addLabel(`${m.value.toFixed(m.kind === 'distance' ? 2 : 1)}${m.kind === 'distance' ? ' Å' : '°'}`, { ...labelStyle, position: where ? { x: where.x, y: where.y, z: where.z } : mid(m.kind === 'dihedral' ? m.atoms.slice(1, 3) : m.atoms), fontSize: 12 })
    }

    if (this.hilite) {
      const scope = this.hilite.expr ? new Set(this.trySelect(this.hilite.expr)) : null
      if (this.hilite.hbonds) {
        const bonds = this.hbonds(scope)
        this.hbondCount = bonds.length
        for (const [a, b] of bonds.slice(0, 500)) dash(a, b, accent)
        // Few enough to read: say how long each is.
        if (bonds.length <= 6) for (const [a, b] of bonds) vw.addLabel(`${dist(a, b).toFixed(2)} Å`, { ...labelStyle, position: mid([a, b]), fontSize: 11 })
      }
      if (this.hilite.contacts != null) {
        const pairs = this.contacts(this.hilite.contacts, scope)
        this.contactCount = pairs.length
        this.contactResidues = this.residuesOf(pairs.flatMap(([, b]) => [b]))
        for (const [a, b] of pairs.slice(0, 300)) dash(a, b, muted, 0.035)
      }
      if (scope && scope.size && !this.selExpr) vw.addStyle(this.spec([...scope]), { stick: tint({ radius: 0.2 }) })
    }

    if (this.surface !== 'none' && this.models.length) {
      const type = this.surface === 'sas' ? this.lib!.SurfaceType.SAS : this.lib!.SurfaceType.VDW
      const byCharge = this.surface === 'electrostatic'
      const colorfunc = byCharge
        ? (a: Atom) => {
            const q = a.properties?.partialCharge
            return typeof q === 'number' ? chargeColor(q) : '#f2f2f2'
          }
        : (a: Atom) => colorOf(a) ?? elementFallback(a)
      const atoms = this.allAtoms().filter((a) => !isWater(a) || this.models.every((m) => m.kind === 'small'))
      try {
        await vw.addSurface(type, { opacity: this.style === 'cartoon' ? 0.7 : 0.82, colorfunc }, this.spec(atoms), this.spec(atoms))
      } catch (e) {
        throw new Error(`the surface could not be built (${e instanceof Error ? e.message : String(e)})`)
      }
    }

    // Clicks and hovers are set per atom, so again after every load.
    vw.setClickable({}, true, (a) => {
      this.togglePick(a)
      void this.redraw().then(() => this.emit())
    })
    const protein = this.models.some((m) => m.kind === 'protein')
    vw.setHoverable(
      {},
      true,
      (a) => this.setHover(protein && isProteinAtom(a) ? resKey(a) : null, a),
      () => this.setHover(null)
    )
    vw.render()
  }

  private togglePick(a: Atom): void {
    if (this.picks.includes(a)) this.picks = this.picks.filter((p) => p !== a)
    else this.picks = [...this.picks, a].slice(-4)
  }

  /** Strip ↔ 3D: the hovered residue gets a name tag in the viewer and a lit letter in the strip. */
  setHover(key: string | null, atom?: Atom): void {
    if (key === this.hover && !atom) return
    const vw = this.viewer
    if (!vw) return
    if (this.hoverLabel) vw.removeLabel(this.hoverLabel)
    this.hoverLabel = null
    this.hover = key
    const a = atom ?? (key ? this.allAtoms().find((x) => resKey(x) === key && x.atom === 'CA') : undefined)
    if (a) {
      const text = a.resn ? `${a.resn} ${a.resi ?? ''}${a.chain ? ` · ${a.chain}` : ''}${atom && a.atom ? ` · ${a.atom}` : ''}` : `${ELEMENTS[a.elem] ?? a.elem} ${this.idOf(a)}`
      this.hoverLabel = vw.addLabel(text, { position: { x: a.x, y: a.y, z: a.z }, fontColor: css('--panel', '#fff'), backgroundColor: css('--ink', '#222'), backgroundOpacity: 0.85, fontSize: 11, inFront: true })
    }
    vw.render()
    this.emit()
  }

  /** The Cα of a residue of the strip, as `measure` / `pick` take it. */
  residueAtom(key: string): string | null {
    const a = this.allAtoms().find((x) => resKey(x) === key && x.atom === 'CA')
    return a ? `${this.modelNo(a)}.${a.index + 1}` : null
  }

  zoomResidue(key: string): void {
    const atoms = this.allAtoms().filter((x) => resKey(x) === key)
    if (atoms.length) this.viewer?.zoomTo(this.spec(atoms), 500)
  }

  private hbonds(scope: Set<Atom> | null): [Atom, Atom][] {
    const out: [Atom, Atom][] = []
    const polar = (a: Atom) => a.elem === 'N' || a.elem === 'O' || a.elem === 'F'
    const all = this.allAtoms()
    const acceptors = all.filter(polar)
    if (acceptors.length > 6000) throw new Error('too many atoms to search for hydrogen bonds: narrow it with --select')
    const inScope = (a: Atom, b: Atom) => !scope || scope.has(a) || scope.has(b)
    for (const m of this.models) {
      const hs = m.atoms.filter((h) => h.elem === 'H' && h.bonds.some((i) => polar(m.atoms[i])))
      if (hs.length) {
        for (const h of hs) {
          const d = m.atoms[h.bonds.find((i) => polar(m.atoms[i]))!]
          for (const acc of acceptors) {
            if (acc === d || (acc.model === d.model && d.bonds.includes(acc.index))) continue
            if (!inScope(d, acc)) continue
            const r = dist(h, acc)
            if (r <= 2.5 && angle(d, h, acc) >= 120) out.push([h, acc])
          }
        }
      } else {
        // No hydrogens in the file: judge by the heavy atoms alone.
        const mine = m.atoms.filter(polar)
        for (const d of mine)
          for (const acc of acceptors) {
            if (acc.model === d.model && acc.index <= d.index) continue
            if (d.elem === 'N' && acc.elem === 'N') continue
            if (acc.model === d.model && (d.bonds.includes(acc.index) || (d.chain === acc.chain && Math.abs((d.resi ?? 0) - (acc.resi ?? 0)) < 2 && isProteinAtom(d) && isProteinAtom(acc)))) continue
            if (acc.model === d.model && resKey(d) === resKey(acc)) continue
            if (!inScope(d, acc)) continue
            if (dist(d, acc) <= 3.5) out.push([d, acc])
          }
      }
    }
    return out
  }

  /** Heavy-atom pairs within `cutoff`: the selection against the rest; with no selection, one chain (or model) against another. */
  private contacts(cutoff: number, scope: Set<Atom> | null): [Atom, Atom][] {
    const heavy = this.allAtoms().filter((a) => a.elem !== 'H' && !isWater(a))
    const group = (a: Atom) => `${a.model}:${a.chain ?? ''}`
    if (!scope && new Set(heavy.map(group)).size < 2) throw new Error('--contacts needs two sides: add --select <expr> (its atoms against everything else), or load something with more than one chain')
    const from = scope ? heavy.filter((a) => scope.has(a)) : heavy
    if (from.length * heavy.length > 40_000_000) throw new Error('too many atoms for a contact search: narrow it with --select')
    const out: [Atom, Atom][] = []
    for (const a of from)
      for (const b of heavy) {
        if (scope ? scope.has(b) : group(a) >= group(b)) continue
        if (a.model === b.model && (resKey(a) === resKey(b) || a.bonds.includes(b.index))) continue
        if (Math.abs(a.x - b.x) > cutoff || Math.abs(a.y - b.y) > cutoff) continue
        if (dist(a, b) <= cutoff) out.push([a, b])
      }
    return out
  }
}

const sceneKey = (tile: number) => `mol:scene:${tile}`

const viewers = new Map<number, MolViewer>()
const watchers = new Set<() => void>()
const changed = () => watchers.forEach((w) => w())

/** Molecule tile `tile`'s viewer, made on first use (and its last scene brought back). */
export function mol(tile = 1): MolViewer {
  let v = viewers.get(tile)
  if (!v) {
    v = new MolViewer(tile)
    viewers.set(tile, v)
    v.subscribe(changed)
    void v.restore()
    changed()
  }
  return v
}

/** The tiles that exist now (`molTiles`): a viewer whose tile was closed is disposed, its WebGL context with it. */
export function syncMolTiles(tiles: number[]): void {
  for (const [n, v] of viewers) {
    if (tiles.includes(n)) continue
    viewers.delete(n)
    v.dispose()
  }
  changed()
}

let installed = false
/**
 * Answer the door from boot (App, when the tiles are on), before any view mounts: `mol:req` from
 * main carries the tile it is for (main picks it: `--tile`, `--new`, else the last one the door
 * used). `tiles` is the registry's own: every tile and what it shows.
 */
export function installMol(): void {
  if (installed) return
  installed = true
  window.deck.onMol(({ id, body }) => {
    const run =
      body.op === 'tiles'
        ? Promise.resolve({ tiles: ((body.tiles as number[] | undefined) ?? []).map((n) => ({ tile: n, scene: mol(n).state.models.map((m) => m.name), empty: mol(n).isEmpty(), onScreen: mol(n).state.holder })) })
        : mol(Number(body.tile) || 1).drive(body)
    void run.then(
      (r) => window.deck.molReply(id, { ok: true, ...r }),
      (e: unknown) => window.deck.molReply(id, { ok: false, error: e instanceof Error ? e.message : String(e) })
    )
  })
}

/** Theme change: every viewer's background and labels are the theme's. */
export function rethemeMol(): void {
  for (const v of viewers.values()) v.retheme()
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => window.setTimeout(rethemeMol, 50))

/** One tile's viewer status, live. */
export function useMol(tile = 1): MolState {
  const [s, setS] = useState<MolState>(() => mol(tile).state)
  useEffect(() => {
    setS(mol(tile).state)
    return mol(tile).subscribe(setS)
  }, [tile])
  return s
}

/** What each of these tiles shows, live: the pane's rail. */
export function useMolScenes(tiles: number[]): { tile: number; label: string }[] {
  const [, bump] = useState(0)
  useEffect(() => {
    const w = () => bump((n) => n + 1)
    watchers.add(w)
    return () => void watchers.delete(w)
  }, [])
  return tiles.map((tile) => ({ tile, label: viewers.get(tile)?.state.models.map((m) => m.formula ?? m.name).join(' + ') || 'empty' }))
}

// The pane in the center column: the same window event the Studio and the Game Boy use, plus which tile's viewer it takes.
const EVENT = 'deck:mol'
export interface MolWant {
  want: boolean | 'toggle'
  tile?: number
}
export function openMol(tile?: number): void {
  window.dispatchEvent(new CustomEvent<MolWant>(EVENT, { detail: { want: true, tile } }))
}
export function closeMol(): void {
  window.dispatchEvent(new CustomEvent<MolWant>(EVENT, { detail: { want: false } }))
}
export function onMolPane(cb: (want: MolWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<MolWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
