// The Broadcast tile's data: one MLB game from ESPN's public summary feed (no key), fetched in main
// like the weather (the renderer's CSP allows no outbound requests) and boiled down to a
// `Gamecast` — the summary itself is ~1 MB, most of it plays the tile never draws. Cached a few
// seconds so the tile and the phone polling together cost one request. The feed is undocumented;
// if it moves, MLB's statsapi.mlb.com live feed carries the same facts.

import type { GamePitch, GamePlay, GameTeam, Gamecast, PitchKind } from '@shared/types'

const TTL_MS = 5_000
const TIMEOUT_MS = 12_000
const PLAYS_MAX = 12
// Akamai in front of ESPN 403s both Electron's default user agent AND a borrowed Chrome one (a
// "Chrome" that does not look like Chrome underneath reads as a bot). An honest app name passes.
// Checked in Electron's own runtime (ELECTRON_RUN_AS_NODE), not curl, which Akamai treats differently.
const UA = 'deck/1.0 (+https://github.com/colin/deck)'

interface Logo {
  href?: string
  rel?: string[]
}
interface Competitor {
  homeAway?: string
  score?: string
  hits?: number
  errors?: number
  linescores?: { displayValue?: string }[]
  record?: { displayValue?: string }[]
  team?: { abbreviation?: string; displayName?: string; color?: string; alternateColor?: string; logo?: string; logos?: Logo[] }
}
interface Play {
  summaryType?: string
  type?: { type?: string; text?: string }
  text?: string
  scoringPlay?: boolean
  period?: { type?: string; number?: number }
  atBatId?: string
  atBatPitchNumber?: number
  pitchType?: { abbreviation?: string }
  pitchVelocity?: number
  pitchCoordinate?: { x?: number; y?: number }
  onFirst?: unknown
  onSecond?: unknown
  onThird?: unknown
}
interface Athlete {
  athlete?: { id?: string; shortName?: string; displayName?: string }
}
interface Summary {
  header?: { competitions?: { status?: { type?: { state?: string; shortDetail?: string } }; competitors?: Competitor[] }[] }
  situation?: { balls?: number; strikes?: number; outs?: number; pitcher?: { playerId?: number }; batter?: { playerId?: number } }
  plays?: Play[]
  winprobability?: { homeWinPercentage?: number }[]
  boxscore?: { players?: { statistics?: { athletes?: Athlete[] }[] }[] }
  rosters?: { roster?: Athlete[] }[]
}

let cached: { id: string; at: number; game: Gamecast } | null = null

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function team(c: Competitor | undefined): GameTeam {
  const t = c?.team ?? {}
  const logo = (rel: string): string => t.logos?.find((l) => l.rel?.join() === `full,${rel}`)?.href ?? t.logo ?? ''
  return {
    abbr: t.abbreviation ?? '?',
    name: t.displayName ?? '',
    record: c?.record?.[0]?.displayValue ?? '',
    score: num(c?.score),
    hits: num(c?.hits),
    errors: num(c?.errors),
    innings: (c?.linescores ?? []).map((l) => l.displayValue ?? ''),
    color: t.color ?? '',
    altColor: t.alternateColor ?? '',
    logo: logo('default'),
    logoDark: logo('dark')
  }
}

function pitchKind(p: Play): PitchKind {
  const t = p.type?.type ?? ''
  if (t.startsWith('ball')) return 'ball'
  if (t.startsWith('strike') || t.startsWith('foul')) return 'strike'
  return 'inplay'
}

/** Player id → "C. Schlittler". The boxscore as well as the rosters: rosters miss a player who came in during the game. */
function names(d: Summary): Map<string, string> {
  const m = new Map<string, string>()
  const add = (e: Athlete): void => {
    const a = e.athlete
    if (a?.id) m.set(String(a.id), a.shortName || a.displayName || '')
  }
  for (const r of d.rosters ?? []) (r.roster ?? []).forEach(add)
  for (const t of d.boxscore?.players ?? []) for (const s of t.statistics ?? []) (s.athletes ?? []).forEach(add)
  return m
}

export function toGamecast(id: string, d: Summary): Gamecast {
  const comp = d.header?.competitions?.[0]
  const status = comp?.status?.type
  const state = status?.state === 'in' || status?.state === 'post' ? status.state : 'pre'
  const cs = comp?.competitors ?? []
  const plays = d.plays ?? []
  const last = plays[plays.length - 1] ?? {}
  const sit = d.situation ?? {}
  const who = names(d)
  const atBat: GamePitch[] = last.atBatId
    ? plays
        .filter((p) => p.atBatId === last.atBatId && p.summaryType === 'P')
        .map((p, i) => ({
          n: p.atBatPitchNumber ?? i + 1,
          kind: pitchKind(p),
          text: p.type?.text ?? '',
          type: p.pitchType?.abbreviation ?? '',
          mph: num(p.pitchVelocity),
          x: num(p.pitchCoordinate?.x),
          y: num(p.pitchCoordinate?.y)
        }))
    : []
  const results: GamePlay[] = plays
    .filter((p) => p.type?.type === 'play-result' && p.text)
    .slice(-PLAYS_MAX)
    .reverse()
    .map((p) => ({ half: p.period?.type === 'Top' ? 'top' : 'bottom', inning: p.period?.number ?? 0, text: p.text!, scoring: p.scoringPlay === true }))
  const wp = d.winprobability?.[d.winprobability.length - 1]?.homeWinPercentage
  return {
    id,
    state,
    detail: status?.shortDetail ?? '',
    away: team(cs.find((c) => c.homeAway === 'away')),
    home: team(cs.find((c) => c.homeAway === 'home')),
    balls: sit.balls ?? 0,
    strikes: sit.strikes ?? 0,
    outs: sit.outs ?? 0,
    // Runners ride on the last play, not the situation.
    bases: [!!last.onFirst, !!last.onSecond, !!last.onThird],
    pitcher: who.get(String(sit.pitcher?.playerId ?? '')) ?? '',
    batter: who.get(String(sit.batter?.playerId ?? '')) ?? '',
    atBat,
    homeWin: typeof wp === 'number' ? Math.round(wp * 1000) / 10 : null,
    plays: results,
    at: Date.now()
  }
}

/** The game with this ESPN event id. Throws when ESPN cannot be reached or does not know the id. */
export async function gamecast(id: string): Promise<Gamecast> {
  if (cached && cached.id === id && Date.now() - cached.at < TTL_MS) return cached.game
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${encodeURIComponent(id)}`
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`broadcast: HTTP ${res.status}`)
  const game = toGamecast(id, (await res.json()) as Summary)
  cached = { id, at: Date.now(), game }
  return game
}
