// Tails each open session's transcript so a grid tile can show the conversation itself
// (prose as markdown, one line per tool call) instead of the CLI's screen.
//
// Claude Code appends one JSON line per event to
//   <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<encoded cwd>/<sessionId>.jsonl
// The session id is the UUID we hand `--session-id`, so the file is found by name across
// every project folder (the cwd encoding is the CLI's business, and worktrees move it).
// The file appears at the first prompt, so a watcher keeps looking until it does.

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ChatBlock, Transcript } from '@shared/types'

/** Blocks kept per session: a tile shows the tail, and the renderer only ever scrolls to the end. */
export const TRANSCRIPT_KEEP = 80
const POLL_MS = 400
const CHUNK = 1 << 16

interface Tail {
  id: string
  sessionId: string
  path: string | null
  offset: number
  rest: string
  transcript: Transcript
  dirty: boolean
}

export class TranscriptWatcher {
  private tails = new Map<string, Tail>()
  private timer: NodeJS.Timeout | null = null
  private readonly projectsDir: string
  private readonly emit: (t: Transcript) => void

  constructor(projectsDir: string, emit: (t: Transcript) => void) {
    this.projectsDir = projectsDir
    this.emit = emit
  }

  /** Keep exactly these sessions (deck id → claude session id) under watch. */
  sync(open: { id: string; claudeSessionId: string }[]): void {
    const keep = new Set(open.map((s) => s.id))
    for (const id of this.tails.keys()) if (!keep.has(id)) this.tails.delete(id)
    for (const s of open) {
      if (this.tails.has(s.id)) continue
      this.tails.set(s.id, {
        id: s.id,
        sessionId: s.claudeSessionId,
        path: null,
        offset: 0,
        rest: '',
        transcript: { id: s.id, blocks: [], title: null, found: false },
        dirty: false
      })
    }
    if (this.tails.size > 0 && !this.timer) this.timer = setInterval(() => this.poll(), POLL_MS)
    if (this.tails.size === 0 && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.poll()
  }

  get(id: string): Transcript | null {
    return this.tails.get(id)?.transcript ?? null
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tails.clear()
  }

  private poll(): void {
    for (const t of this.tails.values()) {
      try {
        this.read(t)
      } catch (err) {
        console.warn('[deck] transcript read failed:', err)
      }
      if (t.dirty) {
        t.dirty = false
        this.emit(t.transcript)
      }
    }
  }

  private read(t: Tail): void {
    if (!t.path) {
      t.path = this.locate(t.sessionId)
      if (!t.path) return
      t.transcript.found = true
      t.dirty = true
    }
    const size = statSync(t.path).size
    if (size < t.offset) {
      // Rewritten (a resume rewrites nothing, but be safe): start over.
      t.offset = 0
      t.rest = ''
      t.transcript.blocks = []
    }
    if (size === t.offset) return
    const fd = openSync(t.path, 'r')
    try {
      const buf = Buffer.alloc(CHUNK)
      while (t.offset < size) {
        const n = readSync(fd, buf, 0, CHUNK, t.offset)
        if (n <= 0) break
        t.offset += n
        t.rest += buf.toString('utf8', 0, n)
        const lines = t.rest.split('\n')
        t.rest = lines.pop() ?? ''
        for (const line of lines) if (applyLine(t.transcript, line)) t.dirty = true
      }
    } finally {
      closeSync(fd)
    }
    if (t.transcript.blocks.length > TRANSCRIPT_KEEP) {
      t.transcript.blocks.splice(0, t.transcript.blocks.length - TRANSCRIPT_KEEP)
      t.dirty = true
    }
  }

  private locate(sessionId: string): string | null {
    let dirs: string[]
    try {
      dirs = readdirSync(this.projectsDir)
    } catch {
      return null
    }
    for (const d of dirs) {
      const p = join(this.projectsDir, d, `${sessionId}.jsonl`)
      if (existsSync(p)) return p
    }
    return null
  }
}

// ---- parsing ---------------------------------------------------------------

type Json = Record<string, unknown>

/** Fold one transcript line into `t`. Returns true when something a tile shows changed. */
export function applyLine(t: Transcript, line: string): boolean {
  if (!line.trim()) return false
  let o: Json
  try {
    o = JSON.parse(line) as Json
  } catch {
    return false
  }
  if (o.type === 'ai-title' && typeof o.aiTitle === 'string') {
    t.title = o.aiTitle
    return true
  }
  if (o.isSidechain || o.isMeta) return false
  const msg = o.message as Json | undefined
  if (!msg) return false
  const ts = Date.parse(String(o.timestamp ?? '')) || Date.now()

  if (o.type === 'user') {
    if (typeof msg.content === 'string') return pushUser(t, msg.content, ts)
    if (!Array.isArray(msg.content)) return false
    let changed = false
    const texts: string[] = []
    for (const c of msg.content as Json[]) {
      if (c.type === 'text' && typeof c.text === 'string') texts.push(c.text)
      else if (c.type === 'tool_result') {
        const b = t.blocks.find((x) => x.kind === 'tool' && x.id === c.tool_use_id)
        if (b && b.kind === 'tool') {
          b.done = true
          b.error = !!c.is_error
          changed = true
        }
      }
    }
    if (texts.length) changed = pushUser(t, texts.join('\n'), ts) || changed
    return changed
  }

  if (o.type === 'assistant') {
    if (!Array.isArray(msg.content)) return false
    let changed = false
    for (const c of msg.content as Json[]) {
      if (c.type === 'text' && typeof c.text === 'string') {
        if (!c.text.trim()) continue
        const last = t.blocks[t.blocks.length - 1]
        // Streamed prose arrives block by block; run adjacent pieces together.
        if (last && last.kind === 'text' && ts - last.ts < 120_000) last.text = `${last.text}\n\n${c.text}`
        else t.blocks.push({ kind: 'text', text: c.text, ts })
        changed = true
      } else if (c.type === 'tool_use') {
        t.blocks.push({ kind: 'tool', id: String(c.id ?? ''), name: String(c.name ?? 'tool'), label: toolLabel(String(c.name ?? ''), (c.input as Json) ?? {}), ts, done: false, error: false })
        changed = true
      }
    }
    return changed
  }
  return false
}

/** What you typed, minus the CLI's own wrapping (slash commands, injected reminders). */
function pushUser(t: Transcript, raw: string, ts: number): boolean {
  let text = raw.trim()
  if (!text) return false
  if (/^<(command-name|local-command|system-reminder|command-message)/.test(text)) {
    const cmd = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]
    if (!cmd) return false
    text = `${cmd.trim()} ${(args ?? '').trim()}`.trim()
  }
  if (/^<[a-z-]+>[\s\S]*<\/[a-z-]+>$/.test(text) && !/\n/.test(text.slice(0, 60))) {
    // A tag-wrapped payload (a pasted attachment, an injected note): keep what is inside.
    text = text.replace(/<\/?[a-z-]+>/g, '').trim()
    if (!text) return false
  }
  t.blocks.push({ kind: 'user', text, ts })
  return true
}

/** One short line per tool call: the thing it touched, not its full input. */
export function toolLabel(name: string, input: Json): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const first = (x: string) => x.split('\n')[0].trim()
  switch (name) {
    case 'Bash':
      return first(s('description') || s('command'))
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return basename(s('file_path') || s('notebook_path'))
    case 'Grep':
      return s('pattern')
    case 'Glob':
      return s('pattern')
    case 'Agent':
    case 'Task':
      return s('description')
    case 'WebFetch':
    case 'WebSearch':
      return s('url') || s('query')
    case 'Skill':
      return s('skill')
    case 'TodoWrite':
      return 'todo list'
    case 'AskUserQuestion':
      return 'a question for you'
    default: {
      const v = Object.values(input).find((x) => typeof x === 'string') as string | undefined
      return v ? first(v).slice(0, 80) : ''
    }
  }
}
