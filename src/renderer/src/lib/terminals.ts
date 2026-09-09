// One persistent xterm per session. Terminals are created lazily, live outside React,
// and get MOVED between the focus pane and grid tiles (never recreated), so a swap
// costs one appendChild + one fit and the pty just gets a resize.

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { CAP } from '@shared/types'

export type Mode = 'focus' | 'tile'

export const FONT_SIZE: Record<Mode, number> = { focus: 13, tile: 9 }
export const FONT_FAMILY = "'SF Mono', Menlo, Monaco, 'Courier New', monospace"

// Cream light theme to match Claude Code's light TUI. Change here only.
export const THEME = {
  background: '#f7f3ea',
  foreground: '#2b2a26',
  cursor: '#c8552d',
  cursorAccent: '#f7f3ea',
  selectionBackground: '#d8cfb8',
  selectionForeground: '#2b2a26',
  black: '#2b2a26',
  red: '#c8552d',
  green: '#4f7d3a',
  yellow: '#b5831c',
  blue: '#3a6ea8',
  magenta: '#8d5a9e',
  cyan: '#2f7f87',
  white: '#d9d2c2',
  brightBlack: '#7a766c',
  brightRed: '#e0623a',
  brightGreen: '#5f9648',
  brightYellow: '#cf9a2a',
  brightBlue: '#4a83c4',
  brightMagenta: '#a56cb8',
  brightCyan: '#3a9aa3',
  brightWhite: '#faf7f0'
}

interface Entry {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  webgl: WebglAddon | null
  mode: Mode | null
  host: HTMLElement | null
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
  return l === 'n' || l === 'w' || l === 'o' || l === 'q'
}

export function ensureTerminal(id: string): Entry {
  const existing = entries.get(id)
  if (existing) return existing

  const el = document.createElement('div')
  el.className = 'deck-term'
  stagingEl().appendChild(el)

  const term = new Terminal({
    fontSize: FONT_SIZE.tile,
    fontFamily: FONT_FAMILY,
    theme: THEME,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
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

  const entry: Entry = { term, fit, el, webgl: null, mode: null, host: null }
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
  e.term.options.fontSize = FONT_SIZE[mode]
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
