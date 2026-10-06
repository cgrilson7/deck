// THE SPEND TILE's main side: what Claude Code work costs, EVERY project's, read off the CLI's own
// transcripts — `<CLAUDE_CONFIG_DIR|~/.claude>/projects/<folder>/<session>.jsonl` and each session's
// subagents (`<session>/subagents/**`, a Workflow's agents included) — so a session started in a
// terminal or VS Code counts as much as one of the deck's. Nothing is asked of a session.
//
// A line with `message.usage` is one API response, counted once by `message.id` (a streamed reply
// is written several times, and a forked / resumed session copies old ones); priced at API LIST
// prices by plugin/scripts/lib/spend.mjs, the module the ledger CLI uses, so the tile and a ledger
// line agree. A response's PROJECT is its session's launch folder (the main transcript's first
// `cwd`; a subagent takes its parent's), a `--worktree` folded into its repo.
//
// The first scan reads a week of transcripts (≈370 MB, ≈1 s of parsing) in 4 MB chunks that yield
// to the event loop; after that each file is read from where it was left, so a refresh costs only
// what was written since. Events older than a week are dropped. A project's own LEDGER
// (`docs/costs/ledger.jsonl`, the fridge's format) is read for its newest lines: the labels.

import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import type { SpendLedgerEntry, SpendProject, SpendReport, SpendSlice, SpendWindow, SpendWindowId } from '@shared/types'
import { costOf, LEDGER_PATH, modelName, projectOf } from '../../plugin/scripts/lib/spend.mjs'

const WEEK = 7 * 24 * 3600_000
const WINDOWS: { id: SpendWindowId; ms: number; binMs: number }[] = [
  { id: '1h', ms: 3600_000, binMs: 5 * 60_000 },
  { id: '8h', ms: 8 * 3600_000, binMs: 30 * 60_000 },
  { id: '24h', ms: 24 * 3600_000, binMs: 3600_000 },
  { id: '7d', ms: WEEK, binMs: 6 * 3600_000 }
]
/** A report is rebuilt from the files at most this often; callers in between get the last one. */
const FRESH_MS = 5000
const CHUNK = 4 << 20
/** The ledger lines a project's report carries. */
const LEDGER_KEEP = 8

interface Ev {
  t: number
  project: string
  model: string
  cost: number
  input: number
  write: number
  read: number
  output: number
  unpriced: boolean
}

interface Tail {
  offset: number
  carry: Buffer
  /** The session this file belongs to (a subagent's is its parent's). */
  session: string
  main: boolean
  project: string | null
}

const CWD = /"cwd":"((?:[^"\\]|\\.)*)"/

export class SpendWatcher {
  private readonly tails = new Map<string, Tail>()
  private readonly sessionProject = new Map<string, string>()
  private events: Ev[] = []
  private readonly seen = new Map<string, number>()
  private readonly ledgers = new Map<string, { mtime: number; entries: SpendLedgerEntry[] | null }>()
  private running: Promise<void> | null = null
  private readAt = 0
  private ready = false
  private last: SpendReport | null = null

  private readonly projectsDir: string

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir
  }

  /** The report, refreshed first if the last read is older than `FRESH_MS`. */
  async report(): Promise<SpendReport> {
    if (Date.now() - this.readAt > FRESH_MS || !this.last) {
      this.running ??= this.refresh().finally(() => (this.running = null))
      await this.running
    }
    return this.last!
  }

  private async refresh(): Promise<void> {
    const now = Date.now()
    let names: string[] = []
    try {
      names = (await readdir(this.projectsDir, { recursive: true })).filter((n) => n.endsWith('.jsonl'))
    } catch {
      /* no projects folder yet */
    }
    // Main transcripts first, so every subagent finds its parent's project.
    const files = names.map((n) => ({ n, parts: n.split(sep) })).sort((a, b) => a.parts.length - b.parts.length)
    for (const { n, parts } of files) {
      if (parts.length < 2) continue
      const file = join(this.projectsDir, n)
      let st
      try {
        st = await stat(file)
      } catch {
        continue
      }
      let tail = this.tails.get(file)
      if (!tail) {
        if (st.mtimeMs < now - WEEK) continue
        const main = parts.length === 2
        tail = { offset: 0, carry: Buffer.alloc(0), session: main ? parts[1].slice(0, -'.jsonl'.length) : parts[1], main, project: null }
        this.tails.set(file, tail)
      }
      if (st.size < tail.offset) {
        // Rewritten: read it again (the ids already seen keep it from counting twice).
        tail.offset = 0
        tail.carry = Buffer.alloc(0)
      }
      if (st.size > tail.offset) await this.read(file, tail, st.size, now)
    }
    const cut = now - WEEK
    this.events = this.events.filter((e) => e.t >= cut)
    for (const [id, t] of this.seen) if (t < cut) this.seen.delete(id)
    this.ready = true
    this.readAt = Date.now()
    this.last = await this.build(this.readAt)
  }

  private async read(file: string, tail: Tail, size: number, now: number): Promise<void> {
    let fh
    try {
      fh = await open(file, 'r')
    } catch {
      return
    }
    try {
      while (tail.offset < size) {
        const buf = Buffer.alloc(Math.min(CHUNK, size - tail.offset))
        const { bytesRead } = await fh.read(buf, 0, buf.length, tail.offset)
        if (!bytesRead) break
        tail.offset += bytesRead
        const data = tail.carry.length ? Buffer.concat([tail.carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
        const end = data.lastIndexOf(0x0a)
        if (end < 0) {
          tail.carry = Buffer.from(data)
          continue
        }
        tail.carry = Buffer.from(data.subarray(end + 1))
        for (const line of data.toString('utf8', 0, end).split('\n')) this.line(line, tail, now)
        await new Promise((r) => setImmediate(r))
      }
    } finally {
      await fh.close()
    }
  }

  private line(line: string, tail: Tail, now: number): void {
    if (!line) return
    if (tail.project === null) {
      const inherited = tail.main ? undefined : this.sessionProject.get(tail.session)
      if (inherited !== undefined) tail.project = inherited
      else {
        const m = CWD.exec(line)
        if (m) {
          try {
            tail.project = projectOf(JSON.parse(`"${m[1]}"`))
          } catch {
            tail.project = ''
          }
          if (tail.main) this.sessionProject.set(tail.session, tail.project)
        }
      }
    }
    if (!line.includes('"usage"')) return
    let d: { timestamp?: string; message?: { id?: string; model?: string; usage?: Parameters<typeof costOf>[1] } }
    try {
      d = JSON.parse(line)
    } catch {
      return
    }
    const m = d.message
    if (!m?.usage || !m.id || m.model === '<synthetic>' || this.seen.has(m.id)) return
    const t = Date.parse(d.timestamp ?? '')
    if (!(t >= now - WEEK)) return
    this.seen.set(m.id, t)
    const c = costOf(m.model, m.usage)
    this.events.push({ t, project: tail.project ?? '', model: modelName(m.model), cost: c.cost, input: c.input, write: c.write5m + c.write1h, read: c.read, output: c.output, unpriced: c.unpriced })
  }

  private async build(now: number): Promise<SpendReport> {
    const windows: SpendWindow[] = WINDOWS.map(({ id, ms, binMs }) => {
      const start = now - ms
      const n = Math.round(ms / binMs)
      const w: SpendWindow = { id, ms, binMs, start, cost: 0, calls: 0, tokens: { input: 0, write: 0, read: 0, output: 0 }, byProject: {}, byModel: {}, bins: Array.from({ length: n }, () => ({})) }
      for (const e of this.events) {
        if (e.t < start) continue
        w.cost += e.cost
        w.calls++
        w.tokens.input += e.input
        w.tokens.write += e.write
        w.tokens.read += e.read
        w.tokens.output += e.output
        const s: SpendSlice = (w.byProject[e.project] ??= { cost: 0, calls: 0, tokens: 0 })
        s.cost += e.cost
        s.calls++
        s.tokens += e.input + e.write + e.read + e.output
        w.byModel[e.model] = (w.byModel[e.model] ?? 0) + e.cost
        const bin = w.bins[Math.min(n - 1, Math.floor((e.t - start) / binMs))]
        bin[e.project] = (bin[e.project] ?? 0) + e.cost
      }
      return w
    })
    const week = windows[windows.length - 1]
    const keys = Object.keys(week.byProject).sort((a, b) => week.byProject[b].cost - week.byProject[a].cost)
    const home = homedir()
    const projects: SpendProject[] = []
    for (const key of keys) projects.push({ key, name: !key ? '(unknown)' : key === home ? '~' : basename(key) || key, ledger: key ? await this.ledger(key) : null })
    return { at: now, ready: this.ready, projects, windows, unpriced: this.events.filter((e) => e.unpriced).length }
  }

  /** A project's ledger, newest lines first (read again only when the file changed), or null when it keeps none. */
  private async ledger(root: string): Promise<SpendLedgerEntry[] | null> {
    const file = join(root, LEDGER_PATH)
    let mtime: number
    try {
      mtime = (await stat(file)).mtimeMs
    } catch {
      this.ledgers.delete(root)
      return null
    }
    const kept = this.ledgers.get(root)
    if (kept && kept.mtime === mtime) return kept.entries
    let entries: SpendLedgerEntry[] = []
    try {
      const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
      for (const l of lines.slice(-LEDGER_KEEP * 3).reverse()) {
        if (entries.length >= LEDGER_KEEP) break
        try {
          const e = JSON.parse(l)
          entries.push({
            at: Date.parse(e.at) || 0,
            tag: typeof e.tag === 'string' ? e.tag : typeof e.game === 'string' ? e.game : null,
            kind: typeof e.kind === 'string' ? e.kind : null,
            summary: typeof e.summary === 'string' ? e.summary : null,
            cost: Number(e.cost) || 0,
            activeMin: Number(e.active_min) || 0
          })
        } catch {
          /* a torn line */
        }
      }
    } catch {
      entries = []
    }
    this.ledgers.set(root, { mtime, entries })
    return entries
  }
}
