// One persistent xterm per session. Terminals are created lazily, live outside React,
// and get MOVED between the focus pane and grid tiles (never recreated), so a swap
// costs one appendChild + one fit and the pty just gets a resize.

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { CAP, DEFAULT_SETTINGS, type DeckSettings } from '@shared/types'
import { themeById, type TermPalette } from '@shared/themes'
import { watchClaudeBanner } from './fox'

export type Mode = 'focus' | 'tile'

/** Live terminal preferences: settings + the current theme's palette. Applied to every xterm. */
const prefs = {
  fontSize: { focus: DEFAULT_SETTINGS.focusFontSize, tile: DEFAULT_SETTINGS.tileFontSize } as Record<Mode, number>,
  fontFamily: DEFAULT_SETTINGS.fontFamily,
  cursorBlink: DEFAULT_SETTINGS.cursorBlink,
  cursorStyle: DEFAULT_SETTINGS.cursorStyle,
  scrollback: DEFAULT_SETTINGS.scrollback,
  // Palette background MUST equal --panel (themes.ts guarantees it) or tiles show a seam.
  theme: themeById(DEFAULT_SETTINGS.theme).light.term as TermPalette
}

/** Push settings + palette into the prefs and every live terminal (fonts refit afterwards). */
export function applyTerminalSettings(s: DeckSettings, palette: TermPalette): void {
  prefs.fontSize = { focus: s.focusFontSize, tile: s.tileFontSize }
  prefs.fontFamily = s.fontFamily
  prefs.cursorBlink = s.cursorBlink
  prefs.cursorStyle = s.cursorStyle
  prefs.scrollback = s.scrollback
  prefs.theme = palette
  for (const [id, e] of entries) {
    e.term.options.theme = palette
    e.term.options.fontFamily = s.fontFamily
    e.term.options.cursorBlink = s.cursorBlink
    e.term.options.cursorStyle = s.cursorStyle
    e.term.options.scrollback = s.scrollback
    if (e.mode) e.term.options.fontSize = prefs.fontSize[e.mode]
    refit(id)
  }
}

interface Entry {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  webgl: WebglAddon | null
  mode: Mode | null
  host: HTMLElement | null
  fox: { dispose(): void } // Foxtrot over the Claude Code banner (lib/fox.ts)
}

const entries = new Map<string, Entry>()
const pending = new Map<string, string[]>()
const PENDING_CAP = 512 // chunks buffered for a terminal that has not mounted yet
let staging: HTMLDivElement | null = null

function stagingEl(): HTMLDivElement {
  if (!staging) {
    staging = document.createElement('div')
    staging.className = 'deck-staging'
    document.body.appendChild(staging)
  }
  return staging
}

/** Cmd combos owned by the app menu; xterm must let them through. */
function isDeckShortcut(ev: KeyboardEvent): boolean {
  const k = ev.key
  if (/^[1-9]$/.test(k) && Number(k) <= CAP) return true
  if (k === '[' || k === ']' || k === 'Enter') return true
  const l = k.toLowerCase()
  return l === 'n' || l === 'w' || l === 'o' || l === 'q' || l === 'r' || l === 'l' || l === 'm' || k === ','
}

export function ensureTerminal(id: string): Entry {
  const existing = entries.get(id)
  if (existing) return existing

  const el = document.createElement('div')
  el.className = 'deck-term'
  stagingEl().appendChild(el)

  const term = new Terminal({
    fontSize: prefs.fontSize.tile,
    fontFamily: prefs.fontFamily,
    theme: prefs.theme,
    cursorBlink: prefs.cursorBlink,
    cursorStyle: prefs.cursorStyle,
    scrollback: prefs.scrollback,
    allowProposedApi: true,
    macOptionIsMeta: false,
    allowTransparency: false
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(el)

  term.onData((d) => window.deck.ptyInput(id, d))
  term.onBinary((d) => window.deck.ptyInput(id, d))
  term.onResize(({ cols, rows }) => window.deck.ptyResize(id, cols, rows))
  term.onTitleChange((t) => window.deck.setTitle(id, t))
  term.onBell(() => window.deck.bell(id))
  term.attachCustomKeyEventHandler((ev) => !(ev.metaKey && isDeckShortcut(ev)))

  const entry: Entry = { term, fit, el, webgl: null, mode: null, host: null, fox: watchClaudeBanner(term) }
  entries.set(id, entry)

  const buf = pending.get(id)
  if (buf) {
    for (const d of buf) term.write(d)
    pending.delete(id)
  }
  return entry
}

export function writeData(id: string, data: string): void {
  const e = entries.get(id)
  if (e) {
    e.term.write(data)
    return
  }
  const buf = pending.get(id) ?? []
  buf.push(data)
  if (buf.length > PENDING_CAP) buf.splice(0, buf.length - PENDING_CAP)
  pending.set(id, buf)
}

/** Put the session's terminal into `host` in the given mode and fit it. Idempotent. */
export function mount(id: string, host: HTMLElement, mode: Mode): void {
  const e = ensureTerminal(id)
  if (e.el.parentElement !== host) host.appendChild(e.el)
  e.host = host
  if (e.mode !== mode) applyMode(e, mode)
  refit(id)
}

function applyMode(e: Entry, mode: Mode): void {
  e.mode = mode
  e.term.options.fontSize = prefs.fontSize[mode]
  if (mode === 'focus') {
    if (!e.webgl) {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          e.webgl = null
        })
        e.term.loadAddon(webgl)
        e.webgl = webgl
      } catch {
        e.webgl = null // DOM renderer fallback is automatic
      }
    }
  } else if (e.webgl) {
    // Grid tiles use the DOM renderer: Chrome caps live WebGL contexts (~16).
    e.webgl.dispose()
    e.webgl = null
  }
}

export function refit(id: string): void {
  const e = entries.get(id)
  if (!e || !e.host) return
  requestAnimationFrame(() => {
    if (!e.host) return
    try {
      e.fit.fit()
    } catch {
      /* not measurable yet */
    }
  })
}

export function focusTerminal(id: string): void {
  entries.get(id)?.term.focus()
}

/** Feed text to the session as if pasted (bracketed-paste aware, so Claude sees it as one insert). */
export function pasteText(id: string, text: string): void {
  const e = entries.get(id)
  if (e) e.term.paste(text)
  else window.deck.ptyInput(id, text)
}

/** Detach from a host (the element parks in staging until it is mounted again). */
export function unmount(id: string, host: HTMLElement): void {
  const e = entries.get(id)
  if (!e || e.host !== host) return
  stagingEl().appendChild(e.el)
  e.host = null
}

export function dispose(id: string): void {
  const e = entries.get(id)
  if (e) {
    e.fox.dispose()
    e.webgl?.dispose()
    e.term.dispose()
    e.el.remove()
    entries.delete(id)
  }
  pending.delete(id)
}

export function liveIds(): string[] {
  return [...entries.keys()]
}
