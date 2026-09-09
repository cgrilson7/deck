// Persisted user settings: userData/config.json, merged over DEFAULT_SETTINGS. Main owns the
// truth; the renderer reads it at boot, patches it from the settings panel, and every
// change is broadcast back so both sides (and the app menu) stay in sync.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type DeckSettings } from '@shared/types'
import { THEMES } from '@shared/themes'

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
    gridColumns: clampInt(raw.gridColumns, 1, 3, d.gridColumns),
    focusWidth: oneOf(raw.focusWidth, ['third', 'twoFifths', 'half'] as const, d.focusWidth),
    attentionFirst: bool(raw.attentionFirst, d.attentionFirst),
    confirmKill: bool(raw.confirmKill, d.confirmKill),
    defaultCwd,
    worktreeByDefault: bool(raw.worktreeByDefault, d.worktreeByDefault),
    fontFamily,
    focusFontSize: clampInt(raw.focusFontSize, 9, 24, d.focusFontSize),
    tileFontSize: clampInt(raw.tileFontSize, 6, 14, d.tileFontSize),
    cursorBlink: bool(raw.cursorBlink, d.cursorBlink),
    cursorStyle: oneOf(raw.cursorStyle, ['bar', 'block', 'underline'] as const, d.cursorStyle),
    scrollback: clampInt(raw.scrollback, 0, 100_000, d.scrollback),
    showWiki: bool(raw.showWiki, d.showWiki),
    showYouTube: bool(raw.showYouTube, d.showYouTube),
    wikiCycleSeconds: clampInt(raw.wikiCycleSeconds, 5, 600, d.wikiCycleSeconds),
    showTranslate: bool(raw.showTranslate, d.showTranslate),
    translateApiKey: typeof raw.translateApiKey === 'string' ? raw.translateApiKey.trim() : d.translateApiKey,
    showVocab: bool(raw.showVocab, d.showVocab),
    vocabCycleSeconds: clampInt(raw.vocabCycleSeconds, 5, 600, d.vocabCycleSeconds),
    languagelogDb: typeof raw.languagelogDb === 'string' ? raw.languagelogDb.trim() : d.languagelogDb,
    foxBark: bool(raw.foxBark, d.foxBark)
  }
}
