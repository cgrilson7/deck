// The Broadcast tile's data: one MLB game from MLB's own public Stats API (statsapi.mlb.com, no
// key; the feed Gameday runs on), fetched in main like the weather (the renderer's CSP allows no
// outbound requests) and boiled down to a `Gamecast`. Three requests, each cut down with the API's
// `fields=` filter (it keeps any key of those names at any depth):
//   - the live feed, every poll (≈180 KB filtered, 580 KB whole): score, count, runners, the at-bat
//     pitch by pitch with Statcast's plate location, the play-by-play;
//   - win probability (≈4 KB filtered, 800 KB whole), fetched again only when an at-bat finishes;
//   - the schedule entry, once per game: the series ("AL Wild Card Series", game 1 of 3), since
//     in the postseason the feed's team record is the series record;
//   - Baseball Savant's game feed (baseballsavant.mlb.com/gf, ≈1.8 MB, no filter), every 30 s at
//     most: what the Stats API lacks — xBA and barrels on batted balls, bat speed on swings —
//     joined to our pitches by play id. A miss costs only those three numbers.
// Cached a few seconds so the tile, the pane and the phone polling together cost one request.

import type { GameBall, GamePitch, GamePlay, GameTeam, Gamecast, PitchKind, PitchShape } from '@shared/types'

const API = 'https://statsapi.mlb.com/api'
const SAVANT = 'https://baseballsavant.mlb.com/gf'
const TTL_MS = 5_000
const SAVANT_TTL_MS = 30_000
const TIMEOUT_MS = 12_000
const PLAYS_MAX = 12
// An honest app name. (ESPN's Akamai 403s Electron's default and a borrowed Chrome one; MLB takes
// anything today, but the same honest name keeps us from finding out the hard way.)
const UA = 'deck/1.0 (+https://github.com/colin/deck)'

const LIVE_FIELDS = [
  'gameData', 'game', 'type', 'datetime', 'dateTime', 'status', 'abstractGameState', 'detailedState',
  'teams', 'away', 'home', 'id', 'abbreviation', 'teamName', 'record', 'wins', 'losses',
  'players', 'fullName', 'boxscoreName', 'batSide', 'pitchHand', 'code', 'strikeZoneTop', 'strikeZoneBottom',
  'liveData', 'linescore', 'currentInningOrdinal', 'inningState', 'balls', 'strikes', 'outs',
  'runs', 'hits', 'errors', 'innings', 'num', 'offense', 'first', 'second', 'third',
  'plays', 'currentPlay', 'allPlays', 'matchup', 'batter', 'pitcher', 'playEvents', 'isPitch', 'pitchNumber',
  'details', 'description', 'isBall', 'isStrike', 'isInPlay', 'pitchData', 'startSpeed', 'coordinates', 'pX', 'pZ',
  'result', 'about', 'halfInning', 'inning', 'isComplete', 'isScoringPlay', 'atBatIndex',
  // Statcast: spin and movement per pitch, and the batted ball (`coordinates` brings pfxX / pfxZ along)
  'playId', 'event', 'breaks', 'spinRate', 'breakVerticalInduced', 'extension',
  'hitData', 'launchSpeed', 'launchAngle', 'totalDistance', 'trajectory', 'coordX', 'coordY'
].join(',')

/**
 * Team colours (primary, secondary), hex without '#', by MLB team id: the Stats API has none. The
 * renderer picks the one that reads on its face (the darker on light, the lighter on dark).
 */
const TEAM_COLORS: Record<number, [string, string]> = {
  108: ['BA0021', '003263'], 109: ['A71930', 'E3D4AD'], 110: ['DF4601', '000000'], 111: ['0C2340', 'BD3039'],
  112: ['0E3386', 'CC3433'], 113: ['C6011F', '000000'], 114: ['00385D', 'E50022'], 115: ['333366', 'C4CED4'],
  116: ['0C2340', 'FA4616'], 117: ['002D62', 'EB6E1F'], 118: ['004687', 'BD9B60'], 119: ['005A9C', 'EF3E42'],
  120: ['AB0003', '14225A'], 121: ['002D72', 'FF5910'], 133: ['003831', 'EFB21E'], 134: ['27251F', 'FDB827'],
  135: ['2F241D', 'FFC425'], 136: ['0C2C56', '005C5C'], 137: ['FD5A1E', '27251F'], 138: ['C41E3A', '0C2340'],
  139: ['092C5C', '8FBCE6'], 140: ['003278', 'C0111F'], 141: ['134A8E', 'E8291C'], 142: ['002B5C', 'D31145'],
  143: ['E81828', '002D72'], 144: ['CE1141', '13274F'], 145: ['27251F', 'C4CED4'], 146: ['00A3E0', 'EF3340'],
  147: ['0C2340', 'C4CED3'], 158: ['12284B', 'FFC52F']
}

interface Player {
  id?: number
  fullName?: string
  boxscoreName?: string
  batSide?: { code?: string }
  pitchHand?: { code?: string }
  strikeZoneTop?: number
  strikeZoneBottom?: number
}
interface TeamInfo {
  id?: number
  abbreviation?: string
  teamName?: string
  record?: { wins?: number; losses?: number }
}
interface LineSide {
  runs?: number
  hits?: number
  errors?: number
}
interface PlayEvent {
  isPitch?: boolean
  pitchNumber?: number
  playId?: string
  details?: { description?: string; isBall?: boolean; isStrike?: boolean; isInPlay?: boolean; type?: { code?: string; description?: string } }
  pitchData?: {
    startSpeed?: number
    extension?: number
    strikeZoneTop?: number
    strikeZoneBottom?: number
    coordinates?: { pX?: number; pZ?: number; pfxX?: number }
    breaks?: { spinRate?: number; breakVerticalInduced?: number }
  }
  hitData?: { launchSpeed?: number; launchAngle?: number; totalDistance?: number; trajectory?: string; coordinates?: { coordX?: number; coordY?: number } }
}
interface Play {
  result?: { description?: string; event?: string }
  about?: { halfInning?: string; inning?: number; isComplete?: boolean; isScoringPlay?: boolean; atBatIndex?: number }
  matchup?: { batter?: { id?: number }; pitcher?: { id?: number }; batSide?: { code?: string }; pitchHand?: { code?: string } }
  playEvents?: PlayEvent[]
}
interface Live {
  gameData?: {
    game?: { type?: string }
    datetime?: { dateTime?: string }
    status?: { abstractGameState?: string; detailedState?: string }
    teams?: { away?: TeamInfo; home?: TeamInfo }
    players?: Record<string, Player>
  }
  liveData?: {
    linescore?: {
      currentInningOrdinal?: string
      inningState?: string
      balls?: number
      strikes?: number
      outs?: number
      teams?: { away?: LineSide; home?: LineSide }
      innings?: { num?: number; away?: { runs?: number }; home?: { runs?: number } }[]
      offense?: { first?: unknown; second?: unknown; third?: unknown }
    }
    plays?: { currentPlay?: Play; allPlays?: Play[] }
  }
}
interface Series {
  description: string
  game: number | null
  of: number | null
}

/** Savant's numbers for one pitch, by play id. */
interface SavantRow {
  xba: string | null
  barrel: boolean
  batSpeed: number | null
}
interface SavantEvent {
  play_id?: string
  xba?: string
  is_barrel?: number
  batSpeed?: number
}

let cached: { pk: number; at: number; game: Gamecast } | null = null
let savantCache: { pk: number; at: number; rows: Map<string, SavantRow> } | null = null
let wpCache: { pk: number; plays: number; value: number | null } | null = null
let seriesCache: { pk: number; series: Series | null } | null = null

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`broadcast: HTTP ${res.status}`)
  return (await res.json()) as T
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** "C. Schlittler": the initial off the full name, the box score's own spelling of the last. */
function shortName(p: Player | undefined): string {
  if (!p) return ''
  const box = p.boxscoreName ?? p.fullName?.split(' ').slice(1).join(' ') ?? ''
  // "Abreu, W" is how the box score tells two Abreus apart: the same facts, our order.
  const [last, initial] = box.split(/,\s*/)
  const first = initial || p.fullName?.[0]
  return first ? `${first}. ${last}` : last
}

function team(t: TeamInfo | undefined, line: LineSide | undefined, innings: string[], postseason: boolean): GameTeam {
  const id = t?.id ?? 0
  const [color, altColor] = TEAM_COLORS[id] ?? ['777777', 'AAAAAA']
  const w = t?.record?.wins ?? 0
  const l = t?.record?.losses ?? 0
  return {
    abbr: t?.abbreviation ?? '?',
    name: t?.teamName ?? '',
    // In the postseason the feed's record is the series', which the head already says.
    record: postseason || w + l === 0 ? '' : `${w}-${l}`,
    score: num(line?.runs),
    hits: num(line?.hits),
    errors: num(line?.errors),
    innings,
    color,
    altColor,
    logo: id ? `https://www.mlbstatic.com/team-logos/team-cap-on-light/${id}.svg` : '',
    logoDark: id ? `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${id}.svg` : ''
  }
}

/** One pitch, Statcast and all; Savant's three numbers joined on by play id when it has them. */
function pitchOf(e: PlayEvent, i: number, savant: Map<string, SavantRow>): GamePitch {
  const pd = e.pitchData
  const hd = e.hitData
  const sv = e.playId ? savant.get(e.playId) : undefined
  return {
    n: e.pitchNumber ?? i + 1,
    kind: pitchKind(e),
    text: e.details?.description ?? '',
    type: e.details?.type?.code ?? '',
    name: e.details?.type?.description ?? '',
    mph: num(pd?.startSpeed),
    x: num(pd?.coordinates?.pX),
    z: num(pd?.coordinates?.pZ),
    spin: num(pd?.breaks?.spinRate),
    ivb: num(pd?.breaks?.breakVerticalInduced),
    hb: num(pd?.coordinates?.pfxX),
    ext: num(pd?.extension),
    ev: num(hd?.launchSpeed),
    la: num(hd?.launchAngle),
    dist: num(hd?.totalDistance),
    xba: sv?.xba ?? null,
    barrel: sv?.barrel ?? false,
    batSpeed: sv?.batSpeed ?? null
  }
}

function pitchKind(e: PlayEvent): PitchKind {
  if (e.details?.isInPlay) return 'inplay'
  if (e.details?.isBall) return 'ball'
  return 'strike'
}

export function toGamecast(pk: number, d: Live, homeWin: number | null, series: Series | null, savant: Map<string, SavantRow> = new Map()): Gamecast {
  const gd = d.gameData ?? {}
  const ls = d.liveData?.linescore ?? {}
  const abstract = gd.status?.abstractGameState
  const state = abstract === 'Live' ? 'in' : abstract === 'Final' ? 'post' : 'pre'
  const postseason = !!gd.game?.type && !['R', 'S', 'E', 'A'].includes(gd.game.type)
  const players = gd.players ?? {}
  const who = (id: number | undefined): Player | undefined => (id ? players[`ID${id}`] : undefined)

  const innings = (ls.innings ?? []).map((i) => ({ away: i.away?.runs, home: i.home?.runs }))
  const col = (side: 'away' | 'home'): string[] => innings.map((i) => (typeof i[side] === 'number' ? String(i[side]) : ''))

  const cp = d.liveData?.plays?.currentPlay ?? {}
  const batter = who(cp.matchup?.batter?.id)
  const pitcher = who(cp.matchup?.pitcher?.id)
  const pitchesOf = (p: Play): PlayEvent[] => (p.playEvents ?? []).filter((e) => e.isPitch)
  // A new at-bat has no pitches for a while (a pitching change, a mound visit): until its first,
  // the zone keeps the at-bat before it, marked as such, rather than going blank.
  let shown: Play = cp
  // Between half-innings the "current" play is the one just FINISHED: the last at-bat, not this one.
  let previous: string | null = cp.about?.isComplete ? (cp.result?.description ?? '') : null
  if (!pitchesOf(cp).length) {
    const all = d.liveData?.plays?.allPlays ?? []
    const prev = [...all].reverse().find((p) => p.about?.isComplete && pitchesOf(p).length)
    if (prev) {
      shown = prev
      previous = prev.result?.description ?? ''
    }
  }
  const pitches = pitchesOf(shown)
  const lastPitch = pitchesOf(cp).at(-1)?.pitchData
  const atBat: GamePitch[] = pitches.map((e, i) => pitchOf(e, i, savant))
  const shownPitch = pitches.at(-1)?.pitchData
  const allPlays = d.liveData?.plays?.allPlays ?? []

  // The pitcher on the mound, every pitch he has thrown tonight: the movement chart's dots.
  const pitcherId = cp.matchup?.pitcher?.id
  const arsenal: PitchShape[] = []
  for (const p of allPlays) {
    if (!pitcherId || p.matchup?.pitcher?.id !== pitcherId) continue
    for (const e of pitchesOf(p)) {
      const hb = num(e.pitchData?.coordinates?.pfxX)
      const ivb = num(e.pitchData?.breaks?.breakVerticalInduced)
      if (hb === null || ivb === null) continue
      arsenal.push({ type: e.details?.type?.code ?? '', name: e.details?.type?.description ?? '', hb, ivb, mph: num(e.pitchData?.startSpeed) })
    }
  }

  // Every ball put in play tonight, both sides: the spray chart and the hardest-hit cards.
  const batted: GameBall[] = []
  for (const p of allPlays) {
    const e = pitchesOf(p).find((x) => x.hitData?.coordinates?.coordX !== undefined)
    if (!e?.hitData) continue
    const sv = e.playId ? savant.get(e.playId) : undefined
    batted.push({
      side: p.about?.halfInning === 'top' ? 'away' : 'home',
      inning: p.about?.inning ?? 0,
      batter: shortName(who(p.matchup?.batter?.id)),
      event: p.result?.event ?? '',
      text: p.result?.description ?? '',
      ev: num(e.hitData.launchSpeed),
      la: num(e.hitData.launchAngle),
      dist: num(e.hitData.totalDistance),
      trajectory: e.hitData.trajectory ?? '',
      x: num(e.hitData.coordinates?.coordX),
      y: num(e.hitData.coordinates?.coordY),
      xba: sv?.xba ?? null,
      barrel: sv?.barrel ?? false,
      batSpeed: sv?.batSpeed ?? null
    })
  }

  const plays: GamePlay[] = allPlays
    .filter((p) => p.about?.isComplete && p.result?.description)
    .slice(-PLAYS_MAX)
    .reverse()
    .map((p) => ({ half: p.about?.halfInning === 'top' ? 'top' : 'bottom', inning: p.about?.inning ?? 0, text: p.result!.description!, scoring: p.about?.isScoringPlay === true }))

  let detail = gd.status?.detailedState ?? ''
  if (state === 'in') detail = `${ls.inningState === 'Middle' ? 'Mid' : (ls.inningState ?? '')} ${ls.currentInningOrdinal ?? ''}`.trim()
  else if (state === 'pre' && gd.datetime?.dateTime && detail !== 'Postponed')
    detail = new Date(gd.datetime.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const off = ls.offense ?? {}
  return {
    id: pk,
    state,
    detail,
    series: series ? `${series.description}${series.game ? ` · Game ${series.game}` : ''}` : '',
    away: team(gd.teams?.away, ls.teams?.away, col('away'), postseason),
    home: team(gd.teams?.home, ls.teams?.home, col('home'), postseason),
    balls: Math.min(ls.balls ?? 0, 3),
    strikes: Math.min(ls.strikes ?? 0, 2),
    outs: Math.min(ls.outs ?? 0, 3),
    bases: [!!off.first, !!off.second, !!off.third],
    pitcher: shortName(pitcher),
    batter: shortName(batter),
    batSide: cp.matchup?.batSide?.code === 'L' ? 'L' : 'R',
    pitchHand: cp.matchup?.pitchHand?.code === 'L' ? 'L' : 'R',
    // The zone of whoever's pitches are drawn: off a pitch when there is one, else the batter's player record.
    szTop: num((previous !== null ? shownPitch : lastPitch)?.strikeZoneTop) ?? num(batter?.strikeZoneTop) ?? 3.4,
    szBot: num((previous !== null ? shownPitch : lastPitch)?.strikeZoneBottom) ?? num(batter?.strikeZoneBottom) ?? 1.6,
    atBat,
    previous,
    arsenal,
    batted,
    homeWin,
    plays,
    at: Date.now()
  }
}

/** The home side's chance now, 0–100. Only asked again once another at-bat has finished. */
async function winProbability(pk: number, completed: number): Promise<number | null> {
  if (wpCache && wpCache.pk === pk && wpCache.plays === completed) return wpCache.value
  let value: number | null = null
  try {
    const rows = await get<{ homeTeamWinProbability?: number }[]>(`/v1/game/${pk}/winProbability?fields=homeTeamWinProbability`)
    const last = rows[rows.length - 1]?.homeTeamWinProbability
    value = typeof last === 'number' ? Math.round(last * 10) / 10 : null
  } catch {
    value = wpCache?.pk === pk ? wpCache.value : null // a miss keeps the last reading rather than blanking the bar
  }
  wpCache = { pk, plays: completed, value }
  return value
}

/** "AL Wild Card Series", game 1 of 3: once per game (null for a regular-season game, or a miss). */
async function seriesOf(pk: number): Promise<Series | null> {
  if (seriesCache && seriesCache.pk === pk) return seriesCache.series
  let series: Series | null = null
  try {
    const s = await get<{ dates?: { games?: { gameType?: string; seriesDescription?: string; seriesGameNumber?: number; gamesInSeries?: number }[] }[] }>(
      `/v1/schedule?gamePk=${pk}&fields=dates,games,gameType,seriesDescription,seriesGameNumber,gamesInSeries`
    )
    const g = s.dates?.[0]?.games?.[0]
    if (g && g.gameType !== 'R' && g.seriesDescription) series = { description: g.seriesDescription, game: g.seriesGameNumber ?? null, of: g.gamesInSeries ?? null }
  } catch {
    return null // not cached: asked again next poll
  }
  seriesCache = { pk, series }
  return series
}

let savantBusy = false

/**
 * Savant's xBA, barrel and bat speed by play id. It has no `fields=` filter and runs ≈1.8 MB, so it
 * never holds up a poll: this hands back what it has NOW and, at most every 30 s, fetches in the
 * background for the polls after. A miss keeps the last rows (or none), never fails the game.
 */
function savantRows(pk: number): Map<string, SavantRow> {
  const have = savantCache?.pk === pk ? savantCache.rows : new Map<string, SavantRow>()
  if (!savantBusy && !(savantCache && savantCache.pk === pk && Date.now() - savantCache.at < SAVANT_TTL_MS)) void refreshSavant(pk, have)
  return have
}

async function refreshSavant(pk: number, keep: Map<string, SavantRow>): Promise<void> {
  savantBusy = true
  try {
    const res = await fetch(`${SAVANT}?game_pk=${pk}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`savant: HTTP ${res.status}`)
    const body = (await res.json()) as { team_home?: SavantEvent[]; team_away?: SavantEvent[] }
    const rows = new Map<string, SavantRow>()
    for (const e of [...(body.team_home ?? []), ...(body.team_away ?? [])]) {
      if (!e.play_id) continue
      rows.set(e.play_id, { xba: e.xba || null, barrel: e.is_barrel === 1, batSpeed: num(e.batSpeed) })
    }
    savantCache = { pk, at: Date.now(), rows }
  } catch {
    savantCache = { pk, at: Date.now(), rows: keep } // try again in 30 s, not on every poll
  } finally {
    savantBusy = false
  }
}

/** The game with this MLB game id (gamePk). Throws when MLB cannot be reached or does not know the id. */
export async function gamecast(pk: number): Promise<Gamecast> {
  if (cached && cached.pk === pk && Date.now() - cached.at < TTL_MS) return cached.game
  const savant = savantRows(pk)
  const [live, series] = await Promise.all([get<Live>(`/v1.1/game/${pk}/feed/live?fields=${LIVE_FIELDS}`), seriesOf(pk)])
  const completed = (live.liveData?.plays?.allPlays ?? []).filter((p) => p.about?.isComplete).length
  const pre = live.gameData?.status?.abstractGameState === 'Preview'
  const homeWin = pre ? null : await winProbability(pk, completed)
  const game = toGamecast(pk, live, homeWin, series, savant)
  cached = { pk, at: Date.now(), game }
  return game
}
