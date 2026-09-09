// Foxtrot, the Village fox from slay/ — "2D Pixel Art Fox Sprites" by Elthen
// (elthen.itch.io; the same sheet as slay's /dream-fox.png). A 14×7 grid of
// 32px frames; the art occupies the bottom of each frame (y 14–31, x 4–25), so
// `.fox` elements are sized to that ART box (22×18 units × --fox-scale), not the
// frame — see styles.css. Rows: 0 idle tail-wag (5), 1 look-around (14),
// 2 run (8), 3 leap (11), 4 alert tail-up (5), 5 sleep (6), 6 lie-down (7).
//
// Used sparingly: the empty focus pane (components/Fox.tsx), and in place of
// Claude Code's own mascot in its startup banner (watchClaudeBanner below).

import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm'
import sheet from '../assets/fox.png?inline' // data: URL — the renderer CSP allows img-src data:

/** Put the sheet where the `.fox` rule can see it. Call once before first paint. */
export function installFoxSheet(): void {
  document.documentElement.style.setProperty('--fox-sheet', `url("${sheet}")`)
}

// ── The banner ──────────────────────────────────────────────────────────────
// Claude Code opens every session with a 3-row pixel mascot at column 0:
//    ▐▛███▜▌   Claude Code v2.0.x          ▐▛███▛█   Claude Code v2.1.x
//   ▝▜█████▛▘  …                          ▝▜██████▀  …
//     ▘▘ ▝▝    ~/deck                       ▝▝ ▝▝    ~/deck
// Nothing about the CLI is wrapped, so the glyphs stay in the buffer; an xterm
// decoration (a marker-anchored DOM element that scrolls with its line and is
// dropped when the line leaves scrollback, or when the alternate screen is
// cleared) covers those cells in the panel color and draws the fox on top. Which fox depends on the session's status
// via the `.status-*` / `.attention` classes on the pane (styles.css).

const TOP = /^ ?▐▛█/
const MID = /^▝▜█/
const LOGO_ROWS = 3
const SCAN_COLS = 12

function logoWidth(rows: string[]): number {
  // The logo ends at the first two-space gap; the text starts after it.
  let w = 0
  for (const r of rows) {
    const gap = r.indexOf('  ', 1)
    w = Math.max(w, gap === -1 ? r.length : gap)
  }
  return Math.min(SCAN_COLS, w + 1) // one cell of gap so the fox has room
}

/** Watch a terminal for the Claude Code banner and keep a fox over each one. */
export function watchClaudeBanner(term: Terminal): IDisposable {
  const decos: IDecoration[] = []

  const dress = (el: HTMLElement) => {
    if (!el.dataset.fox) {
      el.dataset.fox = '1'
      el.classList.add('fox-cover')
      const fox = document.createElement('div')
      fox.className = 'fox fox-banner'
      el.appendChild(fox)
    }
    // xterm sets the element's height (3 cells) in px on every refresh; the
    // fox's 18-unit art box fills it, less a little headroom for the ears.
    const h = parseFloat(el.style.height)
    if (h > 0) el.style.setProperty('--fox-scale', (h / 18).toFixed(3))
  }

  const scan = () => {
    // Claude Code ≥ 2.1.2xx runs on the alternate screen (no scrollback, the
    // banner redrawn in place); older builds print into the normal buffer.
    // Either way the banner is whatever is in the viewport right now.
    const buf = term.buffer.active
    const top = buf.viewportY
    const found = new Map<number, number>() // absolute line → logo width in cells
    for (let r = 0; r < term.rows - 1; r++) {
      const l0 = buf.getLine(top + r)
      if (!l0) break
      const s0 = l0.translateToString(true, 0, SCAN_COLS)
      if (!TOP.test(s0)) continue
      const s1 = buf.getLine(top + r + 1)?.translateToString(true, 0, SCAN_COLS) ?? ''
      if (!MID.test(s1)) continue
      const s2 = buf.getLine(top + r + 2)?.translateToString(true, 0, SCAN_COLS) ?? ''
      found.set(top + r, logoWidth([s0, s1, s2]))
    }
    // Keep decorations still sitting on a banner; drop ones whose visible line
    // no longer is one (a redraw or reflow moved it); leave off-screen ones be.
    for (let i = decos.length - 1; i >= 0; i--) {
      const d = decos[i]
      const line = d.marker.line
      if (d.isDisposed || line < 0) {
        decos.splice(i, 1)
        continue
      }
      if (found.has(line)) found.delete(line)
      else if (line >= top && line < top + term.rows) {
        d.dispose()
        decos.splice(i, 1)
      }
    }
    for (const [line, width] of found) {
      const marker = term.registerMarker(line - (buf.baseY + buf.cursorY))
      if (!marker) continue
      const d = term.registerDecoration({ marker, x: 0, width, height: LOGO_ROWS, layer: 'top' })
      if (!d) {
        marker.dispose()
        continue
      }
      d.onRender(dress)
      decos.push(d)
    }
  }

  const sub = term.onRender(scan)
  return {
    dispose() {
      sub.dispose()
      for (const d of decos) d.dispose()
      decos.length = 0
    }
  }
}
