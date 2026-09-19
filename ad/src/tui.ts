// A stand-in for Claude Code's TUI, written as terminal bytes into the deck's real xterm: the
// banner (which the deck's own watchClaudeBanner then stands Foxtrot on), the conversation as the
// CLI lays it out (⏺ tool lines with ⎿ results, prose, > prompts) and the prompt box with its
// spinner. Append-only above a redrawn foot, so it scrolls like the real thing; a resize repaints.

import type { ChatBlock } from '@shared/types'

const ESC = '\x1b['
const R = `${ESC}0m`
const DIM = `${ESC}2m`
const BOLD = `${ESC}1m`
const ORANGE = `${ESC}38;2;215;119;87m`
const GREEN = `${ESC}32m`
const RED = `${ESC}31m`
const BLUE = `${ESC}34m`

const SPIN = ['·', '✢', '✳', '✶', '✻', '✽']
const VERBS = ['Wrangling', 'Pondering', 'Foxtrotting', 'Percolating', 'Herding']

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    out.push(line)
  }
  return out
}

/** The little markdown a terminal shows: **bold** and `code`. Applied after wrapping, so widths hold (the marks are dropped first). */
const plain = (s: string): string => s.replace(/\*\*/g, '').replace(/`/g, '')
function paint(line: string, src: string): string {
  let out = line
  for (const m of src.matchAll(/`([^`]+)`/g)) out = out.split(m[1]).join(`${BLUE}${m[1]}${R}`)
  for (const m of src.matchAll(/\*\*([^*]+)\*\*/g)) out = out.split(m[1]).join(`${BOLD}${m[1]}${R}`)
  return out
}

export class Tui {
  private cols = 0
  private rows = 0
  private log: ChatBlock[] = []
  private results = new Map<number, { text: string; error: boolean }>()
  private liveText: string | null = null
  private typed = ''
  private asking: { tool: string; command: string } | null = null
  private isBusy = false
  private busySince = 0
  private spin = 0
  private now = 0
  /** Lines of the redrawn foot (live prose + the box) now on screen, and which of them the cursor is on. */
  private foot = 0
  private footCursor = 0

  constructor(
    private cwd: string,
    private model: string,
    private out: (data: string) => void
  ) {}

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    this.repaint()
  }

  block(b: ChatBlock): void {
    this.log.push(b)
    if (!this.cols) return
    this.write(this.lines(b, this.log.length - 1))
  }

  result(text: string, error: boolean): void {
    const i = this.log.length - 1
    this.results.set(i, { text, error })
    if (!this.cols) return
    this.write([`  ${DIM}⎿ ${R} ${error ? RED : DIM}${text}${R}`])
  }

  live(text: string | null): void {
    this.liveText = text
    if (this.cols) this.write([])
  }

  prompt(text: string): void {
    this.typed = text
    if (this.cols) this.write([])
  }

  /** A permission prompt in place of the box (null = answered). */
  ask(what: { tool: string; command: string } | null): void {
    this.asking = what
    if (this.cols) this.write([])
  }

  busy(on: boolean): void {
    if (on && !this.isBusy) this.busySince = this.now
    this.isBusy = on
    if (this.cols) this.write([])
  }

  tick(now: number): void {
    this.now = now
    const step = Math.floor(now / 120)
    if (this.isBusy && step !== this.spin && this.cols) {
      this.spin = step
      this.write([])
    }
  }

  private prose(text: string): string[] {
    const w = Math.max(10, this.cols - 4)
    return wrap(plain(text), w).map((l, i) => `${i === 0 ? `${R}⏺ ` : '  '}${paint(l, text)}`)
  }

  private lines(b: ChatBlock, index: number): string[] {
    if (b.kind === 'user') return ['', ...wrap(b.text, Math.max(10, this.cols - 4)).map((l, i) => `${DIM}${i === 0 ? '> ' : '  '}${l}${R}`)]
    if (b.kind === 'text') return ['', ...this.prose(b.text)]
    const head = `${b.error ? RED : GREEN}⏺${R} ${BOLD}${b.name}${R}(${b.label.slice(0, Math.max(8, this.cols - b.name.length - 6))})`
    const r = this.results.get(index)
    return r ? ['', head, `  ${DIM}⎿ ${R} ${r.error ? RED : DIM}${r.text}${R}`] : ['', head]
  }

  private footLines(): { lines: string[]; cursorRow: number; cursorCol: number } {
    const rule = `${DIM}${'─'.repeat(Math.max(4, this.cols - 1))}${R}`
    const lines: string[] = []
    if (this.liveText !== null) lines.push('', ...this.prose(this.liveText))
    lines.push('')
    if (this.asking) {
      const w = Math.max(20, this.cols - 2)
      const row = (t: string, len: number): string => `${ORANGE}│${R} ${t}${' '.repeat(Math.max(0, w - 3 - len))}${ORANGE}│${R}`
      const opts = ['1. Yes', "2. Yes, and don't ask again this session", '3. No, and tell Claude what to do differently']
      lines.push(
        `${ORANGE}╭${'─'.repeat(w - 2)}╮${R}`,
        row(`${BOLD}${this.asking.tool} command${R}`, this.asking.tool.length + 8),
        row('', 0),
        row(`  ${this.asking.command}`, this.asking.command.length + 2),
        row('', 0),
        row('Do you want to proceed?', 23),
        ...opts.map((o, i) => row(i === 0 ? `${BLUE}❯ ${o}${R}` : `  ${o}`, o.length + 2)),
        `${ORANGE}╰${'─'.repeat(w - 2)}╯${R}`
      )
      return { lines, cursorRow: lines.length - 4, cursorCol: 12 }
    }
    if (this.isBusy) {
      const secs = Math.max(1, Math.round((this.now - this.busySince) / 1000))
      const verb = VERBS[Math.floor(this.busySince / 977) % VERBS.length]
      lines.push(`${ORANGE}${SPIN[this.spin % SPIN.length]} ${verb}…${R} ${DIM}(${secs}s · ↓ ${(secs * 0.4 + 0.8).toFixed(1)}k tokens · esc to interrupt)${R}`, '')
    }
    lines.push(rule)
    const cursorRow = lines.length
    lines.push(`> ${this.typed}`)
    lines.push(rule, `${DIM}  ? for shortcuts${R}`)
    return { lines, cursorRow, cursorCol: 3 + this.typed.length }
  }

  /** Rub out the foot, add `added` above where it was, draw the foot again, and park the cursor in the box. */
  private write(added: string[]): void {
    let s = `${ESC}?25l`
    if (this.foot) s += `${this.footCursor ? `${ESC}${this.footCursor}A` : ''}\r${ESC}J`
    const f = this.footLines()
    const all = [...added, ...f.lines]
    s += all.join('\r\n')
    const up = f.lines.length - 1 - f.cursorRow
    s += `${up ? `${ESC}${up}A` : ''}${ESC}${f.cursorCol}G${ESC}?25h`
    this.foot = f.lines.length
    this.footCursor = f.cursorRow
    this.out(s)
  }

  private repaint(): void {
    const banner = [
      ` ${ORANGE}▐▛███▜▌${R}   ${BOLD}Claude Code${R} ${DIM}v2.1.212${R}`,
      `${ORANGE}▝▜█████▛▘${R}  ${DIM}${this.model || 'fable'} · Claude Max${R}`,
      `${ORANGE}  ▘▘ ▝▝  ${R}  ${DIM}${this.cwd}${R}`
    ]
    this.out(`${ESC}2J${ESC}3J${ESC}H`)
    this.foot = 0
    const body: string[] = [...banner]
    this.log.forEach((b, i) => body.push(...this.lines(b, i)))
    // A short conversation is pushed to the bottom of a tall pane, where the prompt box is and the camera looks.
    const pad = this.rows - body.length - this.footLines().lines.length
    this.write([...Array<string>(Math.max(0, pad)).fill(''), ...body])
  }
}
