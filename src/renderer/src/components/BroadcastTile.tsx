import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Headphones, Maximize2, Moon, Radio, Sun } from 'lucide-react'
import { GLASS_ID, glassVariant, resolveVariant } from '@shared/themes'
import type { DeckSettings, GameBall, GamePitch, GameTeam, Gamecast, PitchShape } from '@shared/types'
import { isDark, patchSettings, useSettings } from '../lib/theme'
import { glassTint } from '../lib/glass'
import { CellTools } from '../lib/celltools'
import { Fox } from './Fox'
import { openBroadcast } from '../lib/broadcast'

const RADIO_URL = 'https://www.espn.com/radio/play/_/s/mlb2'
/** How often the tile asks main (which caches 5 s): live, before the first pitch, and after an error. */
const POLL_LIVE = 10_000
const POLL_IDLE = 60_000
const POLL_RETRY = 20_000
/** Half the plate's width in feet (17 in), the zone's sides; its top and bottom are the batter's own (Gamecast.szTop / szBot). */
const HALF_PLATE = 17 / 24
/** A baseball's radius in feet (2.9 in across): the pane's dots are to scale. The tile's zone is 84 px, where that is 3 px, so its dots are drawn larger to be read. */
const BALL_R = 1.45 / 12
const TILE_BALL_R = 0.2
/**
 * The zone view's window, in feet from the catcher's view: x across the plate (+ toward first
 * base), z up from the ground. The tile's is the zone alone; the pane's (`SCENE`) takes in the
 * batter in his box and the pitcher on the mound behind.
 */
const VIEW = { x1: -1.8, x2: 1.8, z1: 0.35, z2: 4.3 }
const SCENE = { x1: -3.6, x2: 3.6, z1: 0, z2: 7.4 }
const PITCH_VAR = { ball: 'var(--green)', strike: 'var(--red)', inplay: 'var(--blue)' } as const
/**
 * A colour per pitch type, Savant's families in the theme's palette: fastballs warm (four-seam red,
 * sinker orange, cutter rose), sliders yellow, sweepers lime, curves blue / violet, changeups
 * green, splitters cyan. Anything else (knuckleball, eephus, a pitch-out) is muted.
 */
const TYPE_VAR: Record<string, string> = {
  FF: 'var(--red)',
  FA: 'var(--red)',
  SI: 'color-mix(in oklab, var(--red), var(--yellow))',
  FT: 'color-mix(in oklab, var(--red), var(--yellow))',
  FC: 'color-mix(in oklab, var(--red), var(--magenta))',
  SL: 'var(--yellow)',
  ST: 'color-mix(in oklab, var(--yellow), var(--green))',
  SV: 'color-mix(in oklab, var(--blue), var(--magenta))',
  CU: 'var(--blue)',
  KC: 'color-mix(in oklab, var(--blue), var(--cyan))',
  CS: 'var(--blue)',
  CH: 'var(--green)',
  FS: 'var(--cyan)',
  FO: 'var(--cyan)',
  SC: 'var(--magenta)'
}
const typeVar = (t: string): string => TYPE_VAR[t] ?? 'var(--muted)'
const HITS = new Set(['Single', 'Double', 'Triple', 'Home Run'])
const f1 = (n: number | null, unit = ''): string => (n === null ? '' : `${Math.round(n * 10) / 10}${unit}`)

/** Every Statcast number a pitch has, for its tooltip: "97.9 mph Four-Seam Fastball · 2,293 rpm · IVB 11.4 in · HB −7.5 in". */
function pitchLine(p: GamePitch): string {
  const parts = [`${p.mph ? `${p.mph} mph ` : ''}${p.name || p.type}`]
  if (p.spin !== null) parts.push(`${p.spin.toLocaleString()} rpm`)
  if (p.ivb !== null) parts.push(`IVB ${f1(p.ivb, ' in')}`)
  if (p.hb !== null) parts.push(`HB ${f1(p.hb, ' in')}`)
  if (p.ext !== null) parts.push(`ext ${f1(p.ext, ' ft')}`)
  if (p.batSpeed !== null) parts.push(`bat ${f1(p.batSpeed, ' mph')}`)
  const ball = ballLine(p)
  const tail = ball ? `\n${ball}${p.barrel ? ' · barrel' : ''}` : ''
  return parts.join(' · ') + tail
}
/** The batted ball, when there was one: "110.3 mph · 18° · 351 ft · xBA .730". A barrel is a badge beside it, not a word in it. */
function ballLine(b: { ev: number | null; la: number | null; dist: number | null; xba: string | null }): string {
  if (b.ev === null) return ''
  return [f1(b.ev, ' mph'), b.la !== null ? `${b.la}°` : '', b.dist !== null ? `${b.dist} ft` : '', b.xba ? `xBA ${b.xba}` : '']
    .filter(Boolean)
    .join(' · ')
}

/**
 * The tile's own palette. `dark` (the default) wears the theme's DARK variant even while the deck
 * is light, so the gamecast stays a dark scoreboard in any theme; `theme` inherits the deck's
 * variables. Nothing is overridden when the deck is already dark: the two are the same then.
 */
function lookVars(s: DeckSettings): CSSProperties | undefined {
  if (s.broadcastLook !== 'dark' || isDark(s)) return undefined
  const v = s.theme === GLASS_ID ? glassVariant(true, glassTint()) : resolveVariant(s.theme, 'dark', true)
  return {
    '--bg': v.bg,
    '--panel': v.panel,
    '--surface': v.panel,
    '--fill': v.panel,
    '--overlay': v.panel,
    '--ink': v.ink,
    '--muted': v.muted,
    '--line': v.line,
    '--accent': v.accent,
    '--green': v.term.green,
    '--red': v.term.red,
    '--blue': v.term.blue,
    '--yellow': v.term.yellow,
    background: v.panel,
    color: v.ink
  } as CSSProperties
}

/** Poll the game while the tile is showing: every 10 s live, every minute before it, not at all once it is final. */
function useGamecast(pk: number): { game: Gamecast | null; error: string } {
  const [game, setGame] = useState<Gamecast | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setGame(null)
    const tick = async (): Promise<void> => {
      let next = POLL_RETRY
      try {
        const g = await window.deck.broadcast()
        if (!alive) return
        setGame(g)
        setError('')
        if (g.state === 'post') return
        next = g.state === 'in' ? POLL_LIVE : POLL_IDLE
      } catch (e) {
        if (!alive) return
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
      }
      timer = setTimeout(tick, next)
    }
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [pk])
  return { game, error }
}

/** 0 (black) to 1 (white): relative luminance of a hex colour, near enough to pick between two. */
function luma(hex: string): number {
  const n = parseInt(hex, 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}
/** A team's colour that reads on this face: of its two, the lighter on dark, the darker on light (navy vanishes on dark). */
function teamColor(t: GameTeam, dark: boolean): string {
  const [a, b] = [t.color, t.altColor]
  return (luma(a) > luma(b)) === dark ? a : b
}
/** How far apart two hex colours are, 0–1 (plain RGB distance: enough to catch navy against navy). */
function apart(x: string, y: string): number {
  const c = (h: string): number[] => [16, 8, 0].map((s) => (parseInt(h, 16) >> s) & 255)
  const [p, q] = [c(x), c(y)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 441.7
}
/**
 * Both sides' colours for this face. Two teams can pick the same one (Red Sox and Yankees are both
 * navy on a light face), and then the bar and the spray chart cannot tell them apart: the away side
 * takes its other colour.
 */
function teamColors(game: Gamecast, dark: boolean): { away: string; home: string } {
  const home = teamColor(game.home, dark)
  let away = teamColor(game.away, dark)
  if (apart(away, home) < 0.15) away = away === game.away.color ? game.away.altColor : game.away.color
  return { away: `#${away}`, home: `#${home}` }
}

function Side({ t, home, dark }: { t: GameTeam; home?: boolean; dark: boolean }) {
  const logo = dark ? t.logoDark || t.logo : t.logo
  return (
    <div className={`bc-team${home ? ' is-home' : ''}`}>
      {logo && <img src={logo} alt="" draggable={false} />}
      <div>
        <div className="bc-abbr">{t.abbr}</div>
        <div className="bc-rec">{t.record}</div>
      </div>
    </div>
  )
}

function Dots({ n, of, cls }: { n: number; of: number; cls: string }) {
  return (
    <>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={`${cls}${i < n ? ' on' : ''}`} />
      ))}
    </>
  )
}

/**
 * A batter in his stance, in FEET, drawn for a right-handed hitter (the third-base box, the
 * catcher's left) with z UP; `Scene` mirrors it for a lefty and scales it to his zone. Stylized on
 * purpose: our own shapes, not MLB's art.
 */
function BatterFigure() {
  return (
    <g className="bc-figure">
      <circle cx={-2.25} cy={5.55} r={0.36} />
      <path d="M -2.62 5.12 L -2.0 5.2 L -1.93 3.3 L -2.55 3.25 Z" />
      <path className="bc-limb" d="M -2.45 3.3 L -2.7 1.8 L -2.82 0.12 M -2.05 3.3 L -1.72 1.8 L -1.58 0.12" />
      <path className="bc-limb bc-arm" d="M -2.25 5.0 L -2.62 5.28 M -2.02 4.95 L -2.58 5.22" />
      <path className="bc-bat" d="M -2.64 5.26 L -3.02 7.15" />
    </g>
  )
}
/** The pitcher on the mound, drawn for a righty facing the plate (his throwing arm on the catcher's left), z UP; mirrored for a lefty. */
function PitcherFigure() {
  return (
    <g className="bc-figure">
      <circle cx={0} cy={5.62} r={0.4} />
      <path d="M -0.42 5.15 L 0.42 5.15 L 0.36 3.25 L -0.36 3.25 Z" />
      <path className="bc-limb" d="M -0.22 3.3 L -0.55 1.7 L -0.7 0.1 M 0.22 3.3 L 0.62 1.8 L 0.9 0.2" />
      <path className="bc-limb bc-arm" d="M -0.35 5.0 L -0.95 5.55 L -1.1 6.3 M 0.35 5.0 L 0.85 4.55 L 1.0 4.2" />
    </g>
  )
}

/**
 * The strike zone as the catcher sees it, to scale in feet (Statcast's plate location): the plate's
 * width, the batter's own top and bottom, every pitch of the at-bat where it crossed, ball-sized.
 * With `figures` (the pane) the window widens to take in the batter, in the right box and scaled
 * to his zone, and the pitcher small on the mound behind, throwing with the right arm.
 */
function Zone({ game, figures = false }: { game: Gamecast; figures?: boolean }) {
  const v = figures ? SCENE : VIEW
  // SVG's y runs down; the ground is at z = 0 (off the top of the window: v.z2).
  const y = (z: number): number => v.z2 - z
  // A 6-foot hitter's zone tops out near 3.35 ft; taller or shorter scales the figure.
  const tall = Math.min(1.15, Math.max(0.85, game.szTop / 3.35))
  const lefty = game.batSide === 'L'
  const southpaw = game.pitchHand === 'L'
  return (
    <svg className={`bc-zone${figures ? ' is-scene' : ''}`} viewBox={`${v.x1} 0 ${v.x2 - v.x1} ${v.z2 - v.z1}`} aria-label="Strike zone">
      {figures && (
        <>
          {/* The pitcher: 60 feet away, so small, his feet on the mound just above the zone. */}
          <g transform={`translate(0 ${y(4.35)}) scale(${southpaw ? -0.36 : 0.36} -0.36)`}>
            <PitcherFigure />
          </g>
          <g transform={`translate(0 ${y(0)}) scale(${lefty ? -tall : tall} ${-tall})`}>
            <BatterFigure />
          </g>
        </>
      )}
      <rect className="bc-sz" x={-HALF_PLATE} y={y(game.szTop)} width={HALF_PLATE * 2} height={game.szTop - game.szBot} />
      {/* The zone in thirds, faint, the way the broadcasts draw it. */}
      {[1, 2].map((i) => (
        <g key={i} className="bc-sz-grid">
          <line x1={-HALF_PLATE + (i * HALF_PLATE * 2) / 3} x2={-HALF_PLATE + (i * HALF_PLATE * 2) / 3} y1={y(game.szTop)} y2={y(game.szBot)} />
          <line x1={-HALF_PLATE} x2={HALF_PLATE} y1={y(game.szTop - (i * (game.szTop - game.szBot)) / 3)} y2={y(game.szTop - (i * (game.szTop - game.szBot)) / 3)} />
        </g>
      ))}
      <path className="bc-plate" d={`M ${-HALF_PLATE} ${y(figures ? 0.12 : 0.45)} h ${HALF_PLATE * 2} l -0.12 0.1 h ${-(HALF_PLATE * 2 - 0.24)} z`} />
      {game.atBat
        .filter((p) => p.x !== null && p.z !== null)
        .map((p) => (
          <g key={p.n}>
            <title>{`${p.n}. ${p.text} — ${pitchLine(p)}`}</title>
            <circle cx={p.x!} cy={y(p.z!)} r={figures ? BALL_R : TILE_BALL_R} style={{ fill: PITCH_VAR[p.kind] }} />
            <text x={p.x!} y={y(p.z!)} fontSize={figures ? 0.15 : 0.26}>
              {p.n}
            </text>
          </g>
        ))}
    </svg>
  )
}

/** The pane's big readout of the last pitch, beside the scene: speed, what it was, and its Statcast numbers. */
function LastPitch({ p }: { p: GamePitch | undefined }) {
  if (!p) return null
  return (
    <div className="bc-lastpitch">
      <div className="bc-lp-mph">
        {f1(p.mph)}
        <span>mph</span>
      </div>
      <div className="bc-lp-name" style={{ color: typeVar(p.type) }}>
        {p.name || p.type}
      </div>
      <div className="bc-lp-result">{p.text}</div>
      <dl className="bc-lp-stats">
        {p.spin !== null && (
          <>
            <dt>Spin</dt>
            <dd>{p.spin.toLocaleString()} rpm</dd>
          </>
        )}
        {p.ivb !== null && (
          <>
            <dt title="Induced vertical break">IVB</dt>
            <dd>{f1(p.ivb, ' in')}</dd>
          </>
        )}
        {p.hb !== null && (
          <>
            <dt title="Horizontal movement, catcher's view">HB</dt>
            <dd>{f1(p.hb, ' in')}</dd>
          </>
        )}
        {p.ext !== null && (
          <>
            <dt>Ext</dt>
            <dd>{f1(p.ext, ' ft')}</dd>
          </>
        )}
        {p.batSpeed !== null && (
          <>
            <dt>Bat</dt>
            <dd>{f1(p.batSpeed, ' mph')}</dd>
          </>
        )}
      </dl>
      {p.ev !== null && (
        <div className="bc-ball">
          {ballLine(p)}
          {p.barrel && <span className="bc-barrel">BARREL</span>}
        </div>
      )}
    </div>
  )
}

/** The pane's at-bat: every pitch with its Statcast numbers, newest first; the ball in play gets its own row under it. */
function PitchTable({ pitches }: { pitches: GamePitch[] }) {
  return (
    <table className="bc-ptable">
      <thead>
        <tr>
          <th />
          <th>Pitch</th>
          <th>mph</th>
          <th>rpm</th>
          <th title="Induced vertical break, inches">IVB</th>
          <th title="Horizontal movement, inches, catcher's view (+ toward first base)">HB</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {[...pitches].reverse().map((p) => (
          <tr key={p.n} title={pitchLine(p)}>
            <td>
              <i style={{ background: PITCH_VAR[p.kind] }}>{p.n}</i>
            </td>
            <td>
              <span className="bc-type" style={{ color: typeVar(p.type) }} title={p.name}>
                {p.type}
              </span>
            </td>
            <td>{f1(p.mph)}</td>
            <td>{p.spin?.toLocaleString() ?? ''}</td>
            <td>{f1(p.ivb)}</td>
            <td>{f1(p.hb)}</td>
            <td className="bc-result">
              {p.text}
              {p.ev !== null && (
                <div className="bc-ball">
                  {ballLine(p)}
                  {p.barrel && <span className="bc-barrel">BARREL</span>}
                </div>
              )}
              {p.batSpeed !== null && p.ev === null && <div className="bc-ball">bat {f1(p.batSpeed, ' mph')}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Pitch movement, the Savant plot: the pitcher on the mound, every pitch tonight by its horizontal
 * movement (catcher's view) and induced vertical break, in inches, a colour per type; the pitch
 * just thrown ringed. The legend counts each type and its average speed.
 */
function Movement({ pitches, pitcher, last }: { pitches: PitchShape[]; pitcher: string; last: GamePitch | undefined }) {
  const R = 24
  const types = useMemo(() => {
    const m = new Map<string, { name: string; n: number; mph: number; seen: number }>()
    for (const p of pitches) {
      const t = m.get(p.type) ?? { name: p.name, n: 0, mph: 0, seen: 0 }
      t.n++
      if (p.mph !== null) {
        t.mph += p.mph
        t.seen++
      }
      m.set(p.type, t)
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [pitches])
  if (!pitches.length)
    return (
      <section className="bc-card">
        <div className="bc-card-head">
          Movement <span className="bc-lbl">no tracked pitches yet from {pitcher || 'the pitcher'}</span>
        </div>
      </section>
    )
  return (
    <section className="bc-card">
      <div className="bc-card-head">
        Movement · {pitcher || 'the pitcher'} tonight <span className="bc-lbl">catcher's view, inches</span>
      </div>
      <div className="bc-move">
        <svg viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`} aria-label="Pitch movement">
          {[-12, 12].map((g) => (
            <g key={g} className="bc-grid">
              <line x1={g} x2={g} y1={-R} y2={R} />
              <line y1={g} y2={g} x1={-R} x2={R} />
            </g>
          ))}
          <line className="bc-axis" x1={0} x2={0} y1={-R} y2={R} />
          <line className="bc-axis" y1={0} y2={0} x1={-R} x2={R} />
          {pitches.map((p, i) => (
            <circle key={i} cx={p.hb} cy={-p.ivb} r={0.9} style={{ fill: typeVar(p.type) }} opacity={0.7} />
          ))}
          {last && last.hb !== null && last.ivb !== null && <circle className="bc-last" cx={last.hb} cy={-last.ivb} r={1.8} />}
        </svg>
        <ul className="bc-legend">
          {types.map(([code, t]) => (
            <li key={code}>
              <i style={{ background: typeVar(code) }} />
              <span>{t.name || code}</span>
              <span className="bc-mph">
                {t.n} · {t.seen ? (t.mph / t.seen).toFixed(1) : '–'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Gameday's hit coordinates: home plate, and feet per unit (checked against the feed's own distances). */
const HOME = { x: 125.42, y: 198.27 }
const FT = 2.33

/**
 * Where every ball in play went, both teams, on a field to scale: hits filled, outs hollow, in
 * the batting team's colour; the hardest-hit three as cards under it (Savant's xBA and barrel).
 */
function Spray({ balls, away, home }: { balls: GameBall[]; away: string; home: string }) {
  if (!balls.length) return null
  const u = (ft: number): number => ft / FT
  const pole = u(330) / Math.SQRT2
  const cf = HOME.y - u(405)
  const top = [...balls].sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0)).slice(0, 3)
  const base = u(90) / Math.SQRT2
  return (
    <section className="bc-card">
      <div className="bc-card-head">
        Balls in play <span className="bc-lbl">{balls.length} tonight · filled = hit</span>
      </div>
      <div className="bc-spray">
        <svg viewBox={`${HOME.x - u(360)} ${cf - 8} ${u(720)} ${HOME.y - cf + 14}`} aria-label="Spray chart">
          <path
            className="bc-field"
            d={`M ${HOME.x} ${HOME.y} L ${HOME.x - pole} ${HOME.y - pole} Q ${HOME.x} ${2 * cf - (HOME.y - pole)} ${HOME.x + pole} ${HOME.y - pole} Z`}
          />
          <path className="bc-infield" d={`M ${HOME.x} ${HOME.y} l ${base} ${-base} l ${-base} ${-base} l ${-base} ${base} Z`} />
          {balls
            .filter((b) => b.x !== null && b.y !== null)
            .map((b, i) => {
              const hit = HITS.has(b.event)
              const c = b.side === 'away' ? 'var(--bc-away)' : 'var(--bc-home)'
              return (
                <circle key={i} cx={b.x!} cy={b.y!} r={3.2} className={hit ? 'is-hit' : ''} style={{ fill: hit ? c : 'transparent', stroke: c }}>
                  <title>{`${b.batter}: ${b.event}${b.ev !== null ? ` — ${ballLine(b)}` : ''}`}</title>
                </circle>
              )
            })}
        </svg>
        <ul className="bc-balls">
          {top.map((b, i) => (
            <li key={i}>
              <span className="bc-team-dot" style={{ background: b.side === 'away' ? 'var(--bc-away)' : 'var(--bc-home)' }} title={b.side === 'away' ? away : home} />
              <div>
                <div>
                  <b>{b.batter}</b> · {b.event} <span className="bc-lbl">{b.inning ? `${b.side === 'away' ? '▲' : '▼'}${b.inning}` : ''}</span>
                </div>
                <div className="bc-ball">
                  {ballLine(b)}
                  {b.barrel && <span className="bc-barrel">BARREL</span>}
                  {b.batSpeed !== null && ` · bat ${f1(b.batSpeed, ' mph')}`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** The tile's and the pane's shared frame: the look, the team colours, the game (one poll each; main caches). */
function useBroadcast() {
  const s = useSettings()
  const { game, error } = useGamecast(s.broadcastGame)
  const look = useMemo(() => lookVars(s), [s])
  const dark = s.broadcastLook === 'dark' || isDark(s)
  const colors = game ? teamColors(game, dark) : null
  const teams = colors ? ({ '--bc-away': colors.away, '--bc-home': colors.home } as CSSProperties) : undefined
  return { s, game, error, dark, style: { ...look, ...teams } as CSSProperties }
}

/** The head's buttons both faces share: ESPN Radio in the browser, and the look. */
function HeadButtons({ s }: { s: DeckSettings }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <>
      <button
        className="ghost"
        title="Listen on ESPN Radio (opens in the browser)"
        onClick={(e) => {
          stop(e)
          window.deck.openExternal(RADIO_URL)
        }}
      >
        <Headphones size={12} />
      </button>
      <button
        className="ghost"
        title={s.broadcastLook === 'dark' ? 'Dark, whatever the theme shows. Click to follow the theme' : 'Following the theme. Click for dark'}
        onClick={(e) => {
          stop(e)
          patchSettings({ broadcastLook: s.broadcastLook === 'dark' ? 'theme' : 'dark' })
        }}
      >
        {s.broadcastLook === 'dark' ? <Moon size={12} /> : <Sun size={12} />}
      </button>
    </>
  )
}

function Waiting({ error }: { error: string }) {
  return (
    <div className="plugin-empty">
      <Fox anim={error ? 'idle' : 'run'} scale={2} />
      <span>{error ? `No game feed: ${error}` : 'Finding the game…'}</span>
    </div>
  )
}

/**
 * The game, drawn once for both faces: `.bc-now` (score, count, bases, the at-bat, win
 * probability) and `.bc-story` (line score, play-by-play). The tile stacks them and scrolls; the
 * pane sets them side by side at reading size.
 */
function GameView({ game, dark, full = false }: { game: Gamecast; dark: boolean; full?: boolean }) {
  const live = game.state === 'in'
  const innings = Math.max(9, game.away.innings.length, game.home.innings.length)
  return (
    <div className="bc-body">
      <div className="bc-now">
        <div className="bc-score">
          <Side t={game.away} dark={dark} />
          <div className="bc-mid">
            <span className="bc-runs">{game.away.score ?? '–'}</span>
            <span className="bc-detail">{game.state === 'post' ? 'Final' : game.detail}</span>
            <span className="bc-runs">{game.home.score ?? '–'}</span>
          </div>
          <Side t={game.home} home dark={dark} />
        </div>

        {live && (
          <div className="bc-state">
            <div className="bc-count">
              <div>
                B <Dots n={game.balls} of={3} cls="b" />
              </div>
              <div>
                S <Dots n={game.strikes} of={2} cls="s" />
              </div>
              <div>
                O <Dots n={game.outs} of={2} cls="o" />
              </div>
            </div>
            <svg className="bc-bases" viewBox="0 0 70 50" aria-label="Bases">
              <rect className={game.bases[1] ? 'on' : ''} x="28" y="3" width="14" height="14" transform="rotate(45 35 10)" />
              <rect className={game.bases[2] ? 'on' : ''} x="9" y="22" width="14" height="14" transform="rotate(45 16 29)" />
              <rect className={game.bases[0] ? 'on' : ''} x="47" y="22" width="14" height="14" transform="rotate(45 54 29)" />
            </svg>
            <div className="bc-who">
              <div>
                <span className="bc-lbl">P</span> {game.pitcher || '—'} <span className="bc-lbl">{game.pitchHand}HP</span>
              </div>
              <div>
                <span className="bc-lbl">AB</span> {game.batter || '—'} <span className="bc-lbl">bats {game.batSide}</span>
              </div>
            </div>
          </div>
        )}

        {live && (
          <div className={`bc-atbat${game.previous !== null ? ' is-previous' : ''}${full ? ' is-full' : ''}`}>
            <Zone game={game} figures={full} />
            <div className="bc-ab-side">
              <div className="bc-ab-label" title={game.previous ?? undefined}>
                {game.previous !== null ? `Last at-bat: ${game.previous}` : game.atBat.length ? 'This at-bat' : `${game.batter || 'The batter'} up, no pitches yet`}
              </div>
              {full ? (
                <LastPitch p={game.atBat.at(-1)} />
              ) : (
                <ul className="bc-pitches">
                  {[...game.atBat].reverse().map((p) => (
                    <li key={p.n} title={pitchLine(p)}>
                      <i style={{ background: PITCH_VAR[p.kind] }}>{p.n}</i>
                      <span>
                        {p.text}
                        {p.type && ` · ${p.type}`}
                      </span>
                      <span className="bc-mph">{p.mph ? `${p.mph} mph` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!full && game.atBat.some((p) => p.ev !== null) && (
                <div className="bc-ball">
                  {ballLine(game.atBat.find((p) => p.ev !== null)!)}
                  {game.atBat.some((p) => p.barrel) && <span className="bc-barrel">BARREL</span>}
                </div>
              )}
            </div>
            {full && game.atBat.length > 0 && <PitchTable pitches={game.atBat} />}
          </div>
        )}

        {game.homeWin !== null && game.state !== 'post' && (
          <div className="bc-wp" title="Win probability (MLB)">
            <div className="bc-wpbar">
              <i style={{ width: `${100 - game.homeWin}%`, background: 'var(--bc-away)' }} />
              <i style={{ width: `${game.homeWin}%`, background: 'var(--bc-home)' }} />
            </div>
            <div className="bc-wpl">
              <span>
                {game.away.abbr} {(100 - game.homeWin).toFixed(1)}%
              </span>
              <span>
                {game.home.abbr} {game.homeWin.toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="bc-story">
        {full && <Movement pitches={game.arsenal} pitcher={game.pitcher} last={game.previous === null ? game.atBat.at(-1) : undefined} />}
        {full && <Spray balls={game.batted} away={game.away.name} home={game.home.name} />}
        <table className="bc-line">
          <thead>
            <tr>
              <th />
              {Array.from({ length: innings }, (_, i) => (
                <th key={i}>{i + 1}</th>
              ))}
              <th>R</th>
              <th>H</th>
              <th>E</th>
            </tr>
          </thead>
          <tbody>
            {[game.away, game.home].map((t) => (
              <tr key={t.abbr}>
                <td>{t.abbr}</td>
                {Array.from({ length: innings }, (_, i) => (
                  <td key={i}>{t.innings[i] ?? ''}</td>
                ))}
                <td className="rhe">{t.score ?? 0}</td>
                <td className="rhe">{t.hits ?? 0}</td>
                <td className="rhe">{t.errors ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {game.plays.length > 0 && (
          <ul className="bc-plays">
            {game.plays.map((p, i) => (
              <li key={`${p.inning}${p.half}${i}`} className={p.scoring ? 'is-scoring' : ''}>
                <span className="bc-inn">
                  {p.half === 'top' ? '▲' : '▼'}
                  {p.inning}
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * The Broadcast tile: one MLB game, live (main/broadcast.ts fetches MLB's Stats API). Click it
 * and the pane takes the center column. The audio is ESPN Radio's own player, opened in the
 * browser: the stream is theirs to play, not the deck's.
 */
export function BroadcastTile() {
  const { s, game, error, dark, style } = useBroadcast()
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const live = game?.state === 'in'
  return (
    <div
      className={`tile tile-plugin broadcast${dark ? ' is-dark' : ''}`}
      style={style}
      onClick={(e) => {
        stop(e)
        openBroadcast()
      }}
      title="Open full size in the center column"
    >
      <header className="pane-head">
        <Radio size={13} className="bc-glyph" />
        <span className="name">Broadcast</span>
        {live && <span className="bc-live">LIVE</span>}
        {game && !live && <span className="badge">{game.detail}</span>}
        <span className="spacer" />
        <HeadButtons s={s} />
        <button className="ghost" title="Open full size in the center column" onClick={openBroadcast}>
          <Maximize2 size={12} />
        </button>
        <CellTools />
      </header>
      {game ? <GameView game={game} dark={dark} /> : <Waiting error={error} />}
    </div>
  )
}

/** The Broadcast game in the center column: the same view at reading size, the now beside the story. Esc closes. */
export function BroadcastPane({ onClose }: { onClose: () => void }) {
  const { s, game, error, dark, style } = useBroadcast()
  const pane = useRef<HTMLElement>(null)
  useEffect(() => pane.current?.focus(), [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !el?.closest('.xterm, input, textarea, select')) onClose()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onClose])
  const live = game?.state === 'in'
  return (
    <section ref={pane} className={`focus broadcast bc-pane${dark ? ' is-dark' : ''}`} style={style} tabIndex={-1}>
      <header className="pane-head">
        <Radio size={14} className="bc-glyph" />
        <span className="name">Broadcast</span>
        {game && (
          <span className="bc-title">
            {game.away.name} @ {game.home.name}
            {game.series && ` · ${game.series}`}
          </span>
        )}
        {live && <span className="bc-live">LIVE</span>}
        {game && !live && <span className="badge">{game.detail}</span>}
        <span className="spacer" />
        <HeadButtons s={s} />
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>
      {game ? <GameView game={game} dark={dark} full /> : <Waiting error={error} />}
    </section>
  )
}
