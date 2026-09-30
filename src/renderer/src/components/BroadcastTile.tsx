import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Headphones, Maximize2, Moon, Radio, Sun } from 'lucide-react'
import { GLASS_ID, glassVariant, resolveVariant } from '@shared/themes'
import type { DeckSettings, GamePitch, GameTeam, Gamecast } from '@shared/types'
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
/** The strike zone in ESPN's pitchCoordinate space, calibrated from the 9/29 ALWC game's called pitches. Approximate. */
const ZONE = { x1: 83, x2: 150, y1: 142, y2: 196 }
const PITCH_VAR = { ball: 'var(--green)', strike: 'var(--red)', inplay: 'var(--blue)' } as const

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
function useGamecast(event: string): { game: Gamecast | null; error: string } {
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
  }, [event])
  return { game, error }
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

function Zone({ pitches }: { pitches: GamePitch[] }) {
  return (
    <svg className="bc-zone" viewBox="40 95 150 150" aria-label="Strike zone (approximate)">
      <rect x={ZONE.x1} y={ZONE.y1} width={ZONE.x2 - ZONE.x1} height={ZONE.y2 - ZONE.y1} />
      {pitches
        .filter((p) => p.x !== null && p.y !== null)
        .map((p) => (
          <g key={p.n}>
            <circle cx={p.x!} cy={p.y!} r={8} style={{ fill: PITCH_VAR[p.kind] }} />
            <text x={p.x!} y={p.y!}>
              {p.n}
            </text>
          </g>
        ))}
    </svg>
  )
}

/** The tile's and the pane's shared frame: the look, the team colours, the game (one poll each; main caches). */
function useBroadcast() {
  const s = useSettings()
  const { game, error } = useGamecast(s.broadcastEvent)
  const look = useMemo(() => lookVars(s), [s])
  const dark = s.broadcastLook === 'dark' || isDark(s)
  // Team colours: the primary on a light face, the alternate on a dark one (navy vanishes on dark).
  const teams = game
    ? ({
        '--bc-away': `#${(dark ? game.away.altColor : game.away.color) || '888888'}`,
        '--bc-home': `#${(dark ? game.home.altColor : game.home.color) || '888888'}`
      } as CSSProperties)
    : undefined
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
function GameView({ game, dark }: { game: Gamecast; dark: boolean }) {
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
                <span className="bc-lbl">P</span> {game.pitcher || '—'}
              </div>
              <div>
                <span className="bc-lbl">AB</span> {game.batter || '—'}
              </div>
            </div>
          </div>
        )}

        {live && game.atBat.length > 0 && (
          <div className="bc-atbat">
            <Zone pitches={game.atBat} />
            <ul className="bc-pitches">
              {[...game.atBat].reverse().map((p) => (
                <li key={p.n}>
                  <i style={{ background: PITCH_VAR[p.kind] }}>{p.n}</i>
                  <span>
                    {p.text}
                    {p.type && ` · ${p.type}`}
                  </span>
                  <span className="bc-mph">{p.mph ? `${p.mph} mph` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {game.homeWin !== null && game.state !== 'post' && (
          <div className="bc-wp" title="Win probability (ESPN)">
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
 * The Broadcast tile: one MLB game, live (main/broadcast.ts fetches ESPN's public feed). Click it
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
      {game ? <GameView game={game} dark={dark} /> : <Waiting error={error} />}
    </section>
  )
}
