// Settings → the live theme. The variant's chrome colors become CSS variables on <html>, its
// palette goes to every xterm. `system` follows prefers-color-scheme, which Electron ties to
// nativeTheme (main sets themeSource from the same setting), so the two never disagree.

import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type DeckSettings } from '@shared/types'
import { resolveVariant, type ThemeVariant } from '@shared/themes'
import { applyTerminalSettings } from './terminals'

const mq = window.matchMedia('(prefers-color-scheme: dark)')

export function systemDark(): boolean {
  return mq.matches
}

export function liveVariant(s: DeckSettings): ThemeVariant {
  return resolveVariant(s.theme, s.appearance, mq.matches)
}

/** Is the app showing a dark variant right now? */
export function isDark(s: DeckSettings): boolean {
  return s.appearance === 'dark' || (s.appearance === 'system' && mq.matches)
}

const CSS_VARS: (keyof Omit<ThemeVariant, 'term'>)[] = ['bg', 'panel', 'ink', 'muted', 'line', 'accent', 'busy', 'idle', 'blocked', 'starting', 'dead']

export function applyTheme(s: DeckSettings): void {
  const v = liveVariant(s)
  const root = document.documentElement
  for (const k of CSS_VARS) root.style.setProperty(`--${k}`, v[k])
  root.dataset.theme = s.theme
  root.dataset.dark = String(isDark(s))
  root.classList.toggle('compact', s.compact)
  applyTerminalSettings(s, v.term)
}

let current: DeckSettings = DEFAULT_SETTINGS
const listeners = new Set<(s: DeckSettings) => void>()

function set(s: DeckSettings): void {
  current = s
  applyTheme(s)
  for (const l of listeners) l(s)
}

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
