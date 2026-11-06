// The Reminders tile's main side: reminders, notes and the running log, one JSON file in userData
// (written atomically on every change), and the one `handle()` the tile and the door both call
// (`POST /reminders`, plugin/scripts/reminders.mjs). A completed reminder leaves the list once its
// local day has ended (`sweep`); its log line stays for good.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { projectOf } from '../../plugin/scripts/lib/spend.mjs'
import { byPriority, dayOf, REMINDER_NOTE_MAX, REMINDER_PRIORITIES, REMINDER_TEXT_MAX, type Reminder, type ReminderLogEntry, type ReminderNote, type ReminderPriority, type RemindersState } from '../shared/reminders'

type Body = Record<string, unknown>

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isPriority = (v: unknown): v is ReminderPriority => REMINDER_PRIORITIES.includes(v as ReminderPriority)

function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const t = new Date(y, m - 1, d)
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d
}

function clean(raw: unknown): RemindersState {
  const o = (raw ?? {}) as Body
  const list = (v: unknown): Body[] => (Array.isArray(v) ? v.filter((x): x is Body => !!x && typeof x === 'object') : [])
  const reminders: Reminder[] = []
  for (const r of list(o.reminders)) {
    if (!str(r.id) || !str(r.project) || !str(r.text)) continue
    reminders.push({ id: str(r.id), project: str(r.project), text: str(r.text), detail: str(r.detail), priority: isPriority(r.priority) ? r.priority : 'normal', due: isDay(r.due) ? r.due : null, createdAt: num(r.createdAt) ?? 0, by: str(r.by, 'you'), doneAt: num(r.doneAt) })
  }
  const notes: ReminderNote[] = []
  for (const n of list(o.notes)) {
    if (str(n.id) && str(n.project) && str(n.text)) notes.push({ id: str(n.id), project: str(n.project), text: str(n.text), at: num(n.at) ?? 0, by: str(n.by, 'you') })
  }
  const log: ReminderLogEntry[] = []
  for (const l of list(o.log)) {
    if (str(l.id) && str(l.project) && str(l.text)) log.push({ id: str(l.id), project: str(l.project), text: str(l.text), at: num(l.at) ?? 0, by: str(l.by, 'you'), reminderId: str(l.reminderId) || null })
  }
  return { reminders, notes, log }
}

export class RemindersStore {
  private state: RemindersState = { reminders: [], notes: [], log: [] }
  private readonly path: string

  constructor(
    userData: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly changed: (state: RemindersState) => void,
    private readonly now: () => number = Date.now
  ) {
    this.path = join(userData, 'reminders.json')
    if (existsSync(this.path)) {
      try {
        this.state = clean(JSON.parse(readFileSync(this.path, 'utf8')))
      } catch (err) {
        // Never start over on top of a file we could not read: it may be all the log there is.
        const aside = `${this.path}.unreadable-${this.now()}`
        renameSync(this.path, aside)
        console.warn(`[deck] reminders.json could not be read (${String(err)}); kept as ${aside}`)
      }
    }
    this.sweep()
  }

  get(): RemindersState {
    this.sweep()
    return this.state
  }

  /** Takes completed reminders from before today off the list. Main calls it every minute; true = something left. */
  sweep(): boolean {
    const today = dayOf(this.now())
    const left = this.state.reminders.filter((r) => r.doneAt === null || dayOf(r.doneAt) >= today)
    if (left.length === this.state.reminders.length) return false
    this.state = { ...this.state, reminders: left }
    this.commit()
    return true
  }

  private commit(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 1), { mode: 0o600 })
    renameSync(tmp, this.path)
    this.changed(this.state)
  }

  /** A folder → its project: the repo's root (a worktree's repo), else the folder itself. It must exist. */
  private async project(path: string): Promise<string> {
    const p = path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
    if (!isAbsolute(p)) throw new Error(`a project is an absolute folder, not “${path}”`)
    const abs = resolve(p)
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      /* said below */
    }
    if (!isDir) throw new Error(`no such folder: ${abs}`)
    const top = await new Promise<string>((done) => {
      execFile('git', ['-C', abs, 'rev-parse', '--show-toplevel'], { env: this.env, timeout: 3000 }, (err, out) => done(err ? '' : out.trim()))
    })
    return projectOf(top || abs)
  }

  private async projectFrom(b: Body): Promise<string> {
    const p = str(b.project) || str(b.cwd)
    if (!p) throw new Error('which project? pass a folder')
    return this.project(p)
  }

  private text(b: Body, max: number): string {
    const t = str(b.text).trim()
    if (!t) throw new Error('nothing to write: the text is empty')
    if (t.length > max) throw new Error(`too long: ${t.length} characters, ${max} at most`)
    return t
  }

  private id(prefix: string): string {
    return `${prefix}_${randomBytes(3).toString('hex')}`
  }

  private fields(b: Body): Partial<Pick<Reminder, 'priority' | 'due' | 'detail'>> {
    const out: Partial<Pick<Reminder, 'priority' | 'due' | 'detail'>> = {}
    if (b.priority !== undefined) {
      if (!isPriority(b.priority)) throw new Error(`priority is ${REMINDER_PRIORITIES.join(' | ')}, not “${String(b.priority)}”`)
      out.priority = b.priority
    }
    if (b.due !== undefined) {
      if (b.due !== null && !isDay(b.due)) throw new Error(`due is a real date as YYYY-MM-DD, not “${String(b.due)}”`)
      out.due = b.due
    }
    if (b.detail !== undefined) {
      const d = str(b.detail)
      if (d.length > REMINDER_NOTE_MAX) throw new Error(`detail is too long: ${REMINDER_NOTE_MAX} characters at most`)
      out.detail = d
    }
    return out
  }

  private reminder(id: unknown): Reminder {
    const r = this.state.reminders.find((x) => x.id === id)
    if (!r) throw new Error(`no reminder “${String(id)}” (a completed one leaves the list when its day ends)`)
    return r
  }

  /** The tile and the door both land here. `by` is the CALLER'S identity, never taken from the body. */
  async handle(body: unknown, by: string): Promise<Record<string, unknown>> {
    const b = (body ?? {}) as Body
    this.sweep()
    const s = this.state
    switch (b.op) {
      case 'resolve':
        return { ok: true, project: await this.project(str(b.path)) }
      case 'add': {
        const text = this.text(b, REMINDER_TEXT_MAX)
        const r: Reminder = { id: this.id('r'), project: await this.projectFrom(b), text, detail: '', priority: 'normal', due: null, createdAt: this.now(), by, doneAt: null, ...this.fields(b) }
        this.state = { ...this.state, reminders: [...this.state.reminders, r] }
        this.commit()
        return { ok: true, reminder: r }
      }
      case 'set': {
        const note = this.state.notes.find((n) => n.id === b.id)
        if (note) {
          const n = { ...note, text: this.text(b, REMINDER_NOTE_MAX) }
          this.state = { ...this.state, notes: this.state.notes.map((x) => (x.id === n.id ? n : x)) }
          this.commit()
          return { ok: true, note: n }
        }
        const r = this.reminder(b.id)
        const text = b.text !== undefined ? this.text(b, REMINDER_TEXT_MAX) : r.text
        const project = b.project !== undefined ? await this.project(str(b.project)) : r.project
        const next: Reminder = { ...this.reminder(b.id), ...this.fields(b), text, project }
        this.state = {
          ...this.state,
          reminders: this.state.reminders.map((x) => (x.id === next.id ? next : x)),
          // A completed reminder's log line says what the reminder says.
          log: this.state.log.map((l) => (l.reminderId === next.id ? { ...l, text, project } : l))
        }
        this.commit()
        return { ok: true, reminder: next }
      }
      case 'done': {
        const r = this.reminder(b.id)
        if (r.doneAt !== null) return { ok: true, reminder: r }
        const at = this.now()
        const next = { ...r, doneAt: at }
        const line: ReminderLogEntry = { id: this.id('l'), project: r.project, text: r.text, at, by, reminderId: r.id }
        this.state = { ...s, reminders: s.reminders.map((x) => (x.id === r.id ? next : x)), log: [...s.log, line] }
        this.commit()
        return { ok: true, reminder: next, logged: line }
      }
      case 'undo': {
        const r = this.reminder(b.id)
        if (r.doneAt === null) return { ok: true, reminder: r }
        const next = { ...r, doneAt: null }
        this.state = { ...s, reminders: s.reminders.map((x) => (x.id === r.id ? next : x)), log: s.log.filter((l) => l.reminderId !== r.id) }
        this.commit()
        return { ok: true, reminder: next }
      }
      case 'note': {
        const text = this.text(b, REMINDER_NOTE_MAX)
        const n: ReminderNote = { id: this.id('n'), project: await this.projectFrom(b), text, at: this.now(), by }
        this.state = { ...this.state, notes: [...this.state.notes, n] }
        this.commit()
        return { ok: true, note: n }
      }
      case 'log': {
        const text = this.text(b, REMINDER_TEXT_MAX)
        const l: ReminderLogEntry = { id: this.id('l'), project: await this.projectFrom(b), text, at: this.now(), by, reminderId: null }
        this.state = { ...this.state, log: [...this.state.log, l] }
        this.commit()
        return { ok: true, logged: l }
      }
      case 'rm':
        return this.remove(str(b.id))
      case 'list':
      case 'notes':
      case 'history': {
        const project = b.all === true ? null : await this.projectFrom(b)
        const mine = <T extends { project: string }>(xs: T[]): T[] => (project === null ? xs : xs.filter((x) => x.project === project))
        if (b.op === 'list') {
          const rows = mine(s.reminders).filter((r) => b.done === true || r.doneAt === null).sort(byPriority)
          return { ok: true, project, reminders: rows }
        }
        const newest = <T extends { at: number }>(xs: T[]): T[] => [...xs].sort((x, y) => y.at - x.at)
        const limit = Math.min(Math.max(num(b.limit) ?? 50, 1), 1000)
        if (b.op === 'notes') return { ok: true, project, notes: newest(mine(s.notes)).slice(0, limit) }
        return { ok: true, project, log: newest(mine(s.log)).slice(0, limit) }
      }
      default:
        throw new Error(`unknown op “${String(b.op)}”`)
    }
  }

  /** Removes a reminder (with its log line, if it was completed today), a note or a log line, by id. */
  private remove(id: string): Record<string, unknown> {
    const s = this.state
    if (s.reminders.some((r) => r.id === id)) {
      this.state = { ...s, reminders: s.reminders.filter((r) => r.id !== id), log: s.log.filter((l) => l.reminderId !== id) }
    } else if (s.notes.some((n) => n.id === id)) {
      this.state = { ...s, notes: s.notes.filter((n) => n.id !== id) }
    } else if (s.log.some((l) => l.id === id)) {
      this.state = { ...s, log: s.log.filter((l) => l.id !== id) }
    } else throw new Error(`nothing has the id “${id}”`)
    this.commit()
    return { ok: true, removed: id }
  }
}
