// tmux's `capture-pane -e` output (the screen with its SGR sequences) as React elements for the
// phone's screen view: one div per row, a span per run of one style. Only SGR is understood
// (colors 16 / 256 / truecolor, bold, dim, italic, underline, reverse, strike); every other
// escape is dropped. The 16 named colors are CSS variables (`--ansi-N`, set from the theme's
// xterm palette in phone/main.tsx) so the screen wears the same palette as the desktop terminal.

import type { CSSProperties, ReactNode } from 'react'

interface Sgr {
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  reverse: boolean
  strike: boolean
}

const PLAIN: Sgr = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, reverse: false, strike: false }

function color256(n: number): string {
  if (n < 16) return `var(--ansi-${n})`
  if (n < 232) {
    const i = n - 16
    const step = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${step(Math.floor(i / 36))},${step(Math.floor(i / 6) % 6)},${step(i % 6)})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

function apply(s: Sgr, params: number[]): Sgr {
  const out = { ...s }
  for (let i = 0; i < params.length; i++) {
    const p = params[i]
    if (p === 0) Object.assign(out, PLAIN)
    else if (p === 1) out.bold = true
    else if (p === 2) out.dim = true
    else if (p === 3) out.italic = true
    else if (p === 4) out.underline = true
    else if (p === 7) out.reverse = true
    else if (p === 9) out.strike = true
    else if (p === 22) out.bold = out.dim = false
    else if (p === 23) out.italic = false
    else if (p === 24) out.underline = false
    else if (p === 27) out.reverse = false
    else if (p === 29) out.strike = false
    else if (p >= 30 && p <= 37) out.fg = `var(--ansi-${p - 30})`
    else if (p === 39) out.fg = null
    else if (p >= 40 && p <= 47) out.bg = `var(--ansi-${p - 40})`
    else if (p === 49) out.bg = null
    else if (p >= 90 && p <= 97) out.fg = `var(--ansi-${p - 90 + 8})`
    else if (p >= 100 && p <= 107) out.bg = `var(--ansi-${p - 100 + 8})`
    else if (p === 38 || p === 48) {
      const set = (c: string | null) => (p === 38 ? (out.fg = c) : (out.bg = c))
      if (params[i + 1] === 5) {
        set(color256(params[i + 2] ?? 0))
        i += 2
      } else if (params[i + 1] === 2) {
        set(`rgb(${params[i + 2] ?? 0},${params[i + 3] ?? 0},${params[i + 4] ?? 0})`)
        i += 4
      }
    }
  }
  return out
}

function styleOf(s: Sgr): CSSProperties | undefined {
  const st: CSSProperties = {}
  let fg = s.fg
  let bg = s.bg
  if (s.reverse) {
    fg = s.bg ?? 'var(--ansi-bg)'
    bg = s.fg ?? 'var(--ansi-fg)'
  }
  if (fg) st.color = fg
  if (bg) st.backgroundColor = bg
  if (s.bold) st.fontWeight = 700
  if (s.dim) st.opacity = 0.6
  if (s.italic) st.fontStyle = 'italic'
  const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ')
  if (deco) st.textDecoration = deco
  return Object.keys(st).length ? st : undefined
}

// ESC [ params m (SGR), or any other CSI / OSC / single-char escape, which is skipped.
const ESC = /\x1b(?:\[([\d;]*)m|\[[?>!]?[\d;]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g

/** One screen row → spans. */
function row(text: string, key: number): ReactNode {
  const spans: ReactNode[] = []
  let s = PLAIN
  let last = 0
  let n = 0
  const push = (t: string) => {
    if (!t) return
    spans.push(
      <span key={n++} style={styleOf(s)}>
        {t}
      </span>
    )
  }
  for (const m of text.matchAll(ESC)) {
    push(text.slice(last, m.index))
    last = m.index + m[0].length
    if (m[1] !== undefined) s = apply(s, m[1] === '' ? [0] : m[1].split(';').map(Number))
  }
  push(text.slice(last))
  return (
    <div key={key} className="ansi-row">
      {spans.length ? spans : ' '}
    </div>
  )
}

/** The whole screen: rows in order, exactly as tmux printed them. */
export function renderAnsi(text: string): ReactNode[] {
  return text.split('\n').map((line, i) => row(line, i))
}
