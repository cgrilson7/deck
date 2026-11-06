// One persistent xterm per session. Terminals are created lazily, live outside React,
// and get MOVED between the focus pane and grid tiles (never recreated), so a swap
// costs one appendChild + one fit and the pty just gets a resize.

import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { CAP, DEFAULT_SETTINGS, type DeckSettings } from '@shared/types'
import { themeById, type TermPalette } from '@shared/themes'
import { watchClaudeBanner } from './fox'
import { openDoc, pathRefs } from './paths'
import { setPaster } from './paste'
import { setTerminalApplier } from './theme'

export { pasteText } from './paste'

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
  el: HTMLDivElement
  webgl: WebglAddon | null
  mode: Mode | null
  host: HTMLElement | null
  fox: { dispose(): void } // Foxtrot over the Claude Code banner (lib/fox.ts)
  fitRaf: number // pending fit frame (0 = none), so re-entry coalesces instead of stacking fits
}

const entries = new Map<string, Entry>()
const pending = new Map<string, string[]>()
/** Each session's folder, so a relative path clicked in its terminal resolves like the CLI's would. */
const cwds = new Map<string, string>()
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
  // ⌘1–9 = slots 1–9, ⌘0 = slot 10 (menu.ts).
  if (/^[0-9]$/.test(k) && (k === '0' ? 10 : Number(k)) <= CAP) return true
  if (k === '[' || k === ']' || k === 'Enter') return true
  const l = k.toLowerCase()
  return l === 'n' || l === 'w' || l === 'o' || l === 'q' || l === 'r' || l === 'l' || l === 'm' || l === 'j' || ((l === 'i' || l === 'g' || l === 'a' || l === 'b' || l === 'e' || l === 'd' || l === 'p' || l === 'f') && ev.shiftKey) || k === ','
}

/** Tell the terminal which folder its session runs in (TermHost, from the session record). */
export function setTerminalCwd(id: string, cwd: string): void {
  if (cwd) cwds.set(id, cwd)
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
    // The glass theme's terminal background is clear. This cannot change after open(), so it is
    // always on; an opaque background draws the same with it (macOS has no subpixel text to lose).
    allowTransparency: true,
    // OSC 8 hyperlinks: Claude Code writes a markdown link as one (tmux passes them on, tmux.conf's
    // `hyperlinks` feature), so `[a-sheet.png](file:///private/tmp/…)` is a click however it wraps.
    linkHandler: {
      allowNonHttpProtocols: true,
      activate: (ev, uri) => {
        if (/^https?:\/\//i.test(uri)) return window.deck.openInBrowser(uri)
        if (/^file:/i.test(uri)) {
          const { path, line } = fileUri(uri)
          return openRef(path, cwds.get(id), line, ev)
        }
      }
    }
  })
  term.open(el)

  term.onData((d) => window.deck.ptyInput(id, d))
  term.onBinary((d) => window.deck.ptyInput(id, d))
  term.onResize(({ cols, rows }) => window.deck.ptyResize(id, cols, rows))
  term.onTitleChange((t) => window.deck.setTitle(id, t))
  term.onBell(() => window.deck.bell(id))
  term.attachCustomKeyEventHandler((ev) => !(ev.metaKey && isDeckShortcut(ev)))
  // Paths printed in the TUI are links: hover underlines one, a click opens it (`openRef`). A path
  // the TUI broke across lines is read whole (`logicalLine`), so a long scratchpad path still works.
  term.registerLinkProvider({
    provideLinks(y, cb) {
      const run = logicalLine(term, y)
      if (!run) return cb(undefined)
      const links = pathRefs(run.text)
        .filter((r) => run.at(r.start).y <= y && run.at(r.end - 1).y >= y)
        .map((r) => ({
          range: { start: run.at(r.start), end: run.at(r.end - 1) },
          text: r.raw,
          activate: (ev: MouseEvent) => openRef(r.path, cwds.get(id), r.line, ev)
        }))
      cb(links.length > 0 ? links : undefined)
    }
  })

  const entry: Entry = { term, el, webgl: null, mode: null, host: null, fox: watchClaudeBanner(term), fitRaf: 0 }
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
  e.mode = mode
  e.term.options.fontSize = prefs.fontSize[mode]
  // A GPU context is held only by the terminal in the focus pane. Grid tiles render the
  // conversation, not a terminal, so a session parked in staging must not keep one: cycling
  // focus across sessions would otherwise pile up contexts until Chrome drops one and blanks
  // the pane. Recreated on the next focus mount.
  if (mode === 'focus') ensureWebgl(e)
  else disposeWebgl(e)
  fitStable(id)
}

function ensureWebgl(e: Entry): void {
  if (e.webgl) return
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
      e.webgl = null
      // Fall back to the DOM renderer AND repaint from the buffer, else the pane stays blank
      // until something else redraws (the bug that used to need a UI refresh).
      try {
        e.term.refresh(0, e.term.rows - 1)
      } catch {
        /* terminal gone */
      }
    })
    e.term.loadAddon(webgl)
    e.webgl = webgl
  } catch {
    e.webgl = null // DOM renderer fallback is automatic
  }
}

function disposeWebgl(e: Entry): void {
  if (!e.webgl) return
  e.webgl.dispose()
  e.webgl = null
}

/** The cell size the renderer is drawing at: the same private numbers the fit addon reads. */
function cellSize(term: Terminal): { w: number; h: number } | null {
  type Core = { _renderService?: { dimensions?: { css: { cell: { width: number; height: number } } } } }
  const dims = (term as unknown as { _core?: Core })._core?._renderService?.dimensions
  if (!dims || !(dims.css.cell.width > 0) || !(dims.css.cell.height > 0)) return null
  return { w: dims.css.cell.width, h: dims.css.cell.height }
}

/**
 * Size the terminal to its box (one pass). Our own measure instead of the fit addon's, which
 * reserves 14px on the right for a scrollbar xterm 6 no longer needs the room for (its bar is
 * an overlay that fades in over the content). The height left below a whole number of rows
 * is moved ABOVE the first row as padding on the xterm element, so the last row, and Claude
 * Code's prompt bar with it, sits flush with the bottom of the pane, as VS Code's terminal
 * does. Returns the size it settled on, or null when nothing can be measured yet.
 */
function fitBox(e: Entry): string | null {
  const xt = e.term.element
  const cell = cellSize(e.term)
  if (!xt || !cell) return null
  xt.style.paddingTop = '0px' // measure the whole box, not the box less last time's leftover
  const w = e.el.clientWidth
  const h = e.el.clientHeight
  const cols = Math.max(2, Math.floor(w / cell.w))
  const rows = Math.max(1, Math.floor(h / cell.h))
  if (cols !== e.term.cols || rows !== e.term.rows) e.term.resize(cols, rows) // → pty via onResize
  xt.style.paddingTop = `${Math.max(0, Math.floor(h - rows * cell.h))}px`
  return `${cols}x${rows}`
}

/**
 * Fit the terminal to its host, then keep fitting on later frames until the proposed
 * dimensions stop changing (or `tries` run out). A single fit right after a mount often
 * measures the host mid-layout (font size just changed, flex not settled, element just
 * appended), which sizes the pane a row or column off and leaves the TUI looking shifted or
 * scrolled. Waiting for the size to settle fixes that. Zero-size frames (not yet laid out)
 * are skipped, not counted.
 */
export function fitStable(id: string, tries = 10): void {
  const e = entries.get(id)
  if (!e || !e.host) return
  if (e.fitRaf) cancelAnimationFrame(e.fitRaf)
  let last = ''
  const step = (n: number): void => {
    e.fitRaf = 0
    if (!e.host) return
    if (e.el.clientWidth < 2 || e.el.clientHeight < 2) {
      // Not laid out yet: wait for a real size without spending a try.
      if (n > 0) e.fitRaf = requestAnimationFrame(() => step(n))
      return
    }
    try {
      const key = fitBox(e)
      if (!key) {
        if (n > 0) e.fitRaf = requestAnimationFrame(() => step(n - 1))
        return
      }
      if (key !== last && n > 0) {
        last = key
        e.fitRaf = requestAnimationFrame(() => step(n - 1))
      }
    } catch {
      /* not measurable yet */
    }
  }
  e.fitRaf = requestAnimationFrame(() => step(tries))
}

/** Fit `id` to its current host. Kept for callers; delegates to the settling fit. */
export function refit(id: string): void {
  fitStable(id)
}

export function focusTerminal(id: string): void {
  entries.get(id)?.term.focus()
}

/** Feed text to the session as if pasted (bracketed-paste aware, so Claude sees it as one insert). */
// A session with a terminal pastes through xterm (bracketed, as the CLI expects); lib/paste.ts
// handles the rest. Theme changes arrive the same way (lib/theme.ts).
setPaster((id, text) => {
  const e = entries.get(id)
  if (!e) return false
  e.term.paste(text)
  return true
})
setTerminalApplier(applyTerminalSettings)

/** Detach from a host (the element parks in staging until it is mounted again). */
export function unmount(id: string, host: HTMLElement): void {
  const e = entries.get(id)
  if (!e || e.host !== host) return
  if (e.fitRaf) {
    cancelAnimationFrame(e.fitRaf)
    e.fitRaf = 0
  }
  disposeWebgl(e) // a parked terminal holds no GPU context
  stagingEl().appendChild(e.el)
  e.host = null
}

export function dispose(id: string): void {
  const e = entries.get(id)
  if (e) {
    if (e.fitRaf) cancelAnimationFrame(e.fitRaf)
    e.fox.dispose()
    e.webgl?.dispose()
    e.term.dispose()
    e.el.remove()
    entries.delete(id)
  }
  pending.delete(id)
  cwds.delete(id)
}

export function liveIds(): string[] {
  return [...entries.keys()]
}

// ---- terminal links ----------------------------------------------------------

/** HTML is the browser's to show; everything else the preview pane's, unless ⌘-clicked. */
function openRef(path: string, cwd: string | undefined, line: number | null, ev?: MouseEvent): void {
  if (ev?.metaKey || /\.x?html?$/i.test(path)) window.deck.openInBrowser(path, cwd)
  else openDoc(path, cwd, line)
}

/** A file:// URL → its path (decoded), and a `#L42` / `:42` line when it carries one. */
function fileUri(uri: string): { path: string; line: number | null } {
  let path = uri
  let line: number | null = null
  try {
    const u = new URL(uri)
    path = decodeURIComponent(u.pathname)
    const m = /^#L?(\d+)/.exec(u.hash)
    if (m) line = Number(m[1])
  } catch {
    path = uri.replace(/^file:\/\//i, '')
  }
  const m = /^(.*?):(\d+)$/.exec(path)
  if (m && line === null) return { path: m[1], line: Number(m[2]) }
  return { path, line }
}

const PATH_CHAR = /[A-Za-z0-9._~@+\-/]/
/** How many screen lines one path may be read across. */
const JOIN_MAX = 4

/**
 * Line `y` (1-based) with the lines it continues into and out of, as one string and a map back to
 * cells. Two lines join when xterm wrapped them (`isWrapped`), or when the TUI did: Claude Code
 * hard-breaks a word too long for the width, so the upper line runs to the right edge ending in a
 * path character and the lower one, past its indent, starts with one. A wrong join costs only a
 * "no such file" in the pane.
 */
function logicalLine(term: Terminal, y: number): { text: string; at(i: number): { x: number; y: number } } | null {
  const buf = term.buffer.active
  const read = (row: number) => buf.getLine(row - 1)
  if (!read(y)) return null
  const cols = term.cols
  const joins = (upper: number): boolean => {
    const a = read(upper)
    const b = read(upper + 1)
    if (!a || !b) return false
    if (b.isWrapped) return true
    const top = a.translateToString(true)
    if (top.length < cols - 2 || !PATH_CHAR.test(top[top.length - 1])) return false
    const tail = /[A-Za-z0-9._~@+\-/]+$/.exec(top)?.[0] ?? ''
    if (!tail.includes('/')) return false
    return PATH_CHAR.test(b.translateToString(true).trimStart()[0] ?? '')
  }
  let first = y
  while (y - first < JOIN_MAX - 1 && first > 1 && joins(first - 1)) first--
  let last = y
  while (last - first < JOIN_MAX - 1 && joins(last)) last++
  let text = ''
  const starts: { i: number; x0: number; y: number }[] = []
  for (let row = first; row <= last; row++) {
    const line = read(row)!
    // A row xterm wrapped into the next keeps its trailing cells: they are part of the text.
    let str = line.translateToString(!(row < last && read(row + 1)?.isWrapped))
    let x0 = 0
    if (row > first && !line.isWrapped) {
      // A TUI continuation: drop its indent, and the upper line's trailing blanks are already gone.
      const lead = str.length - str.trimStart().length
      str = str.slice(lead)
      x0 = lead
    }
    starts.push({ i: text.length, x0, y: row })
    text += str
  }
  return {
    text,
    at(i) {
      let s = starts[0]
      for (const st of starts) if (st.i <= i) s = st
      return { x: s.x0 + (i - s.i) + 1, y: s.y }
    }
  }
}
