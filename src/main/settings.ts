// Persisted user settings: userData/config.json, merged over DEFAULT_SETTINGS. Main owns the
// truth; the renderer reads it at boot, patches it from the settings panel, and every
// change is broadcast back so both sides (and the app menu) stay in sync.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type DeckSettings } from '@shared/types'
import { THEMES } from '@shared/themes'
import { cleanModel } from '@shared/models'

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

/** What a grid cell may be pinned to: a plugin, the + (older keys — a slot, a pack — are read and never matched). */
const LAYOUT_KEY = /^(slot:\d{1,2}|pack:[0-9a-f]{6}|wiki|music|studio|git|vocab|translate|plus)$/

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
    gridLayout: Array.isArray(raw.gridLayout) ? raw.gridLayout.slice(0, 64).map((k) => (typeof k === 'string' && LAYOUT_KEY.test(k) ? k : '')) : d.gridLayout,
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
    // `showYouTube` is what config.json said before the tile grew a Spotify face.
    showMusic: bool(raw.showMusic ?? (raw as { showYouTube?: unknown }).showYouTube, d.showMusic),
    music: oneOf(raw.music, ['spotify', 'youtube'] as const, d.music),
    spotifyPlaylists: Array.isArray(raw.spotifyPlaylists)
      ? raw.spotifyPlaylists.filter((u): u is string => typeof u === 'string' && u.trim() !== '').map((u) => u.trim()).slice(0, 24)
      : d.spotifyPlaylists,
    spotifyClientId: typeof raw.spotifyClientId === 'string' && /^[a-f0-9]{32}$/i.test(raw.spotifyClientId.trim()) ? raw.spotifyClientId.trim() : d.spotifyClientId,
    showTranslate: bool(raw.showTranslate, d.showTranslate),
    showStudio: bool(raw.showStudio, d.showStudio),
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
