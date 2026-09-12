import type { DeckSettings } from '@shared/types'
import type { TermPalette } from '@shared/themes'
import { liveVariant } from '../lib/theme'

const NAMES: (keyof TermPalette)[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
]

/** The theme's xterm palette as `--ansi-N` variables, so the phone's screen view matches the desktop's terminal. */
export function applyAnsiPalette(s: DeckSettings): void {
  const t = liveVariant(s).term
  const root = document.documentElement.style
  NAMES.forEach((n, i) => root.setProperty(`--ansi-${i}`, t[n]))
  root.setProperty('--ansi-fg', t.foreground)
  root.setProperty('--ansi-bg', t.background)
}
