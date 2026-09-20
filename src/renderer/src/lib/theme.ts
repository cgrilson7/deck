// Settings → the live theme. The variant's chrome colors become CSS variables on <html>, its
// palette goes to every xterm. `system` follows prefers-color-scheme, which Electron ties to
// nativeTheme (main sets themeSource from the same setting), so the two never disagree.

import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type DeckSettings } from '@shared/types'
import { GLASS_ID, glassVariant, resolveVariant, type TermPalette, type ThemeVariant } from '@shared/themes'
import { glassTint, setGlassListener, syncGlass } from './glass'

/**
 * Whoever owns the terminals (lib/terminals.ts) registers here to get every theme change with
 * its xterm palette. A registration, not an import, so the phone page (no xterm) can share
 * this module.
 */
type TermApplier = (s: DeckSettings, palette: TermPalette) => void
let termApplier: TermApplier | null = null
export function setTerminalApplier(fn: TermApplier): void {
  termApplier = fn
}

const mq = window.matchMedia('(prefers-color-scheme: dark)')

export function systemDark(): boolean {
  return mq.matches
}

/** Is the app showing a dark variant right now? */
export function isDark(s: DeckSettings): boolean {
  return s.appearance === 'dark' || (s.appearance === 'system' && mq.matches)
}

/** The glass theme's variant is made from the picture on the wall (lib/glass.ts), not read from the catalog. */
export function liveVariant(s: DeckSettings): ThemeVariant {
  if (s.theme === GLASS_ID) return glassVariant(isDark(s), glassTint())
  return resolveVariant(s.theme, s.appearance, mq.matches)
}

const CSS_VARS: (keyof Omit<ThemeVariant, 'term'>)[] = ['bg', 'panel', 'ink', 'muted', 'line', 'accent', 'busy', 'idle', 'blocked', 'starting', 'dead']

export function applyTheme(s: DeckSettings): void {
  syncGlass(s)
  const v = liveVariant(s)
  const root = document.documentElement
  for (const k of CSS_VARS) root.style.setProperty(`--${k}`, v[k])
  // Under glass the gutter is the picture, and --bg (every use of it is an inset or a hover) a shade of see-through ink.
  if (s.theme === GLASS_ID) root.style.setProperty('--bg', 'color-mix(in srgb, var(--ink) 9%, transparent)')
  // The diff colors in the changes tile are the terminal palette's green and red, so they sit with the theme.
  root.style.setProperty('--green', v.term.green)
  root.style.setProperty('--red', v.term.red)
  root.dataset.theme = s.theme
  root.dataset.dark = String(isDark(s))
  root.classList.toggle('compact', s.compact)
  // The tiles' tool lines and code blocks use the terminal font too.
  root.style.setProperty('--mono', s.fontFamily)
  termApplier?.(s, v.term)
}

let current: DeckSettings = DEFAULT_SETTINGS
const listeners = new Set<(s: DeckSettings) => void>()

function set(s: DeckSettings): void {
  current = s
  applyTheme(s)
  for (const l of listeners) l(s)
}

// A new picture on the wall = new colors: apply again, and tell whoever draws from the settings.
setGlassListener(() => {
  set({ ...current })
  window.dispatchEvent(new Event('deck:glass'))
})

/** Load settings and apply the theme once, before anything renders (no cream flash on a dark theme). */
export async function bootSettings(): Promise<DeckSettings> {
  try {
    set(await window.deck.getSettings())
  } catch {
    set(DEFAULT_SETTINGS)
  }
  window.deck.onSettings(set)
  mq.addEventListener('change', () => set(current))
  return current
}

export function useSettings(): DeckSettings {
  const [s, setS] = useState(current)
  useEffect(() => {
    listeners.add(setS)
    setS(current)
    return () => void listeners.delete(setS)
  }, [])
  return s
}

export function patchSettings(patch: Partial<DeckSettings>): void {
  void window.deck.setSettings(patch)
}
