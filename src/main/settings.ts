// Persisted user settings: userData/config.json, merged over DEFAULT_SETTINGS. Main owns the
// truth; the renderer reads it at boot, patches it from the settings panel, and every
// change is broadcast back so both sides (and the app menu) stay in sync.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, LESSON_TILES_MAX, MOL_TILES_MAX, WEATHER_PLACES_MAX, WEB_APPS_MAX, cleanWebUrl, isWebAppId, type DeckSettings, type WeatherPlace, type WebApp } from '@shared/types'
import { THEMES } from '@shared/themes'
import { cleanModel } from '@shared/models'
import { GRID_ORDER_MAX, isGridKey } from '@shared/gridorder'

export class SettingsStore {
  private current: DeckSettings
  private readonly path: string
  private listeners = new Set<(s: DeckSettings) => void>()

  constructor(userData: string) {
    this.path = join(userData, 'config.json')
    this.current = sanitize(this.read())
  }

  get(): DeckSettings {
    return this.current
  }

  update(patch: Partial<DeckSettings>): DeckSettings {
    this.current = sanitize({ ...this.current, ...patch })
    this.write()
    for (const l of this.listeners) l(this.current)
    return this.current
  }

  onChange(cb: (s: DeckSettings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private read(): Partial<DeckSettings> {
    if (!existsSync(this.path)) return {}
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Partial<DeckSettings>
    } catch {
      return {}
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.current, null, 2) + '\n')
    } catch {
      /* read-only userData: settings just don't stick */
    }
  }
}

/** One side column of `gridOrder`: tile keys only (`isGridKey` is built from PLUGIN_KEYS, so a new mini app is never dropped), each once. */
function orderSide(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter(isGridKey))].slice(0, GRID_ORDER_MAX) : []
}

/** The Molecule tiles (and the Lesson tiles): distinct numbers 1–99, at most `max`, never none. */
function molTiles(raw: unknown, max = MOL_TILES_MAX): number[] {
  const ns = Array.isArray(raw) ? [...new Set(raw.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 99))].slice(0, max) : []
  return ns.length ? ns : [1]
}

/** The web apps: a slug, a name and an http(s) URL each, ids distinct. An empty list is kept (none registered). */
function webApps(raw: unknown, dflt: WebApp[]): WebApp[] {
  if (!Array.isArray(raw)) return dflt
  const out: WebApp[] = []
  for (const a of raw as Partial<WebApp>[]) {
    const url = cleanWebUrl(a?.url)
    if (!a || !isWebAppId(a.id) || !url || out.some((o) => o.id === a.id)) continue
    out.push({ id: a.id, name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 40) : new URL(url).hostname, url, show: a.show !== false })
  }
  return out.slice(0, WEB_APPS_MAX)
}

/** The weather places: a name and real coordinates each, at most WEATHER_PLACES_MAX. An empty list is kept (no weather). */
function weatherPlaces(raw: unknown, dflt: WeatherPlace[]): WeatherPlace[] {
  if (!Array.isArray(raw)) return dflt
  const out: WeatherPlace[] = []
  for (const p of raw as Partial<WeatherPlace>[]) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) continue
    if (typeof p.lat !== 'number' || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90) continue
    if (typeof p.lon !== 'number' || !Number.isFinite(p.lon) || Math.abs(p.lon) > 180) continue
    out.push({ name: p.name.trim().slice(0, 60), region: typeof p.region === 'string' ? p.region.trim().slice(0, 60) : '', lat: p.lat, lon: p.lon })
  }
  return out.slice(0, WEATHER_PLACES_MAX)
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt
  return Math.min(hi, Math.max(lo, n))
}
const oneOf = <T extends string>(v: unknown, opts: readonly T[], dflt: T): T => (opts.includes(v as T) ? (v as T) : dflt)
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt)

/** Fill gaps with defaults and keep hand-edited files from producing nonsense. */
export function sanitize(raw: Partial<DeckSettings>): DeckSettings {
  const d = DEFAULT_SETTINGS
  const fontFamily = typeof raw.fontFamily === 'string' && raw.fontFamily.trim() ? raw.fontFamily.trim() : d.fontFamily
  const defaultCwd = typeof raw.defaultCwd === 'string' && raw.defaultCwd.trim() ? raw.defaultCwd.trim() : homedir()
  return {
    theme: oneOf(
      raw.theme,
      THEMES.map((t) => t.id),
      d.theme
    ),
    appearance: oneOf(raw.appearance, ['system', 'light', 'dark'] as const, d.appearance),
    compact: bool(raw.compact, d.compact),
    // A file from before the two-sided grid had `gridColumns` meaning the whole grid's; start it over.
    gridColumns: raw.gridRows === undefined ? d.gridColumns : clampInt(raw.gridColumns, 1, 2, d.gridColumns),
    gridRows: clampInt(raw.gridRows, 2, 6, d.gridRows),
    gridOrder: { left: orderSide(raw.gridOrder?.left), right: orderSide(raw.gridOrder?.right) },
    focusWidth: oneOf(raw.focusWidth, ['third', 'twoFifths', 'half'] as const, d.focusWidth),
    attentionFirst: bool(raw.attentionFirst, d.attentionFirst),
    confirmKill: bool(raw.confirmKill, d.confirmKill),
    defaultCwd,
    worktreeByDefault: bool(raw.worktreeByDefault, d.worktreeByDefault),
    defaultModel: cleanModel(raw.defaultModel),
    fontFamily,
    focusFontSize: clampInt(raw.focusFontSize, 9, 24, d.focusFontSize),
    tileFontSize: clampInt(raw.tileFontSize, 6, 14, d.tileFontSize),
    cursorBlink: bool(raw.cursorBlink, d.cursorBlink),
    cursorStyle: oneOf(raw.cursorStyle, ['bar', 'block', 'underline'] as const, d.cursorStyle),
    scrollback: clampInt(raw.scrollback, 0, 100_000, d.scrollback),
    showWiki: bool(raw.showWiki, d.showWiki),
    weatherPlaces: weatherPlaces(raw.weatherPlaces, d.weatherPlaces),
    weatherUnit: oneOf(raw.weatherUnit, ['F', 'C'] as const, d.weatherUnit),
    // `showYouTube` is what config.json said before the tile grew a Spotify face.
    showMusic: bool(raw.showMusic ?? (raw as { showYouTube?: unknown }).showYouTube, d.showMusic),
    music: oneOf(raw.music, ['spotify', 'youtube'] as const, d.music),
    spotifyPlaylists: Array.isArray(raw.spotifyPlaylists)
      ? raw.spotifyPlaylists.filter((u): u is string => typeof u === 'string' && u.trim() !== '').map((u) => u.trim()).slice(0, 24)
      : d.spotifyPlaylists,
    spotifyClientId: typeof raw.spotifyClientId === 'string' && /^[a-f0-9]{32}$/i.test(raw.spotifyClientId.trim()) ? raw.spotifyClientId.trim() : d.spotifyClientId,
    showTranslate: bool(raw.showTranslate, d.showTranslate),
    showStudio: bool(raw.showStudio, d.showStudio),
    showMol: bool(raw.showMol, d.showMol),
    molTiles: molTiles(raw.molTiles),
    showLesson: bool(raw.showLesson, d.showLesson),
    lessonTiles: molTiles(raw.lessonTiles, LESSON_TILES_MAX),
    webApps: webApps(raw.webApps, d.webApps),
    showPokemon: bool(raw.showPokemon, d.showPokemon),
    pokemonRomDir: typeof raw.pokemonRomDir === 'string' && raw.pokemonRomDir.trim() ? raw.pokemonRomDir.trim() : d.pokemonRomDir,
    geminiApiKey: typeof raw.geminiApiKey === 'string' ? raw.geminiApiKey.trim() : d.geminiApiKey,
    studioModel: typeof raw.studioModel === 'string' && /^[\w.-]*$/.test(raw.studioModel.trim()) ? raw.studioModel.trim() : d.studioModel,
    translateApiKey: typeof raw.translateApiKey === 'string' ? raw.translateApiKey.trim() : d.translateApiKey,
    showVocab: bool(raw.showVocab, d.showVocab),
    vocabCycleSeconds: clampInt(raw.vocabCycleSeconds, 5, 600, d.vocabCycleSeconds),
    showGit: bool(raw.showGit, d.showGit),
    languagelogDb: typeof raw.languagelogDb === 'string' ? raw.languagelogDb.trim() : d.languagelogDb,
    foxBark: bool(raw.foxBark, d.foxBark),
    remote: bool(raw.remote, d.remote)
  }
}
