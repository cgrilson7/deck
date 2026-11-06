// THE REMINDERS TILE's data, pure: what main stores, what the tile draws, what a session's CLI gets
// back. A PROJECT is an absolute folder (a repo's root; a worktree counts as its repo).

export const REMINDER_PRIORITIES = ['high', 'normal', 'low'] as const
export type ReminderPriority = (typeof REMINDER_PRIORITIES)[number]

export interface Reminder {
  id: string
  project: string
  text: string
  /** Notes on this one reminder. */
  detail: string
  priority: ReminderPriority
  /** YYYY-MM-DD, or null. */
  due: string | null
  createdAt: number
  /** 'you', or the session that wrote it. */
  by: string
  /** Set = completed. It stays, struck through, until the local day ends; its log entry stays for good. */
  doneAt: number | null
}

export interface ReminderNote {
  id: string
  project: string
  text: string
  at: number
  by: string
}

/** One line of a project's running log: a completed reminder, or something written straight to it. */
export interface ReminderLogEntry {
  id: string
  project: string
  text: string
  at: number
  by: string
  /** The reminder it came from: how un-completing one takes its line back out. */
  reminderId: string | null
}

export interface RemindersState {
  reminders: Reminder[]
  notes: ReminderNote[]
  log: ReminderLogEntry[]
}

/** The tile's and the door's one verb. `project` / `cwd` name a folder; main resolves it to its project. */
export type RemindersOp =
  | { op: 'add'; text: string; project?: string; cwd?: string; priority?: string; due?: string | null; detail?: string }
  | { op: 'set'; id: string; text?: string; project?: string; priority?: string; due?: string | null; detail?: string }
  | { op: 'done' | 'undo' | 'rm'; id: string }
  | { op: 'note' | 'log'; text: string; project?: string; cwd?: string }
  | { op: 'list' | 'notes' | 'history'; project?: string; cwd?: string; all?: boolean; done?: boolean; limit?: number }
  | { op: 'resolve'; path: string }

export const REMINDER_TEXT_MAX = 2000
export const REMINDER_NOTE_MAX = 20000

const RANK: Record<ReminderPriority, number> = { high: 0, normal: 1, low: 2 }

/** Local calendar day as YYYY-MM-DD. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dueKey = (r: Reminder): string => r.due ?? '9999-99-99'
const doneFirst = (a: Reminder, b: Reminder): number => Number(a.doneAt !== null) - Number(b.doneAt !== null)

/** Open before completed, then most important, then soonest due, then oldest. */
export function byPriority(a: Reminder, b: Reminder): number {
  return doneFirst(a, b) || RANK[a.priority] - RANK[b.priority] || dueKey(a).localeCompare(dueKey(b)) || a.createdAt - b.createdAt
}

/** Open before completed, then soonest due (undated last), then most important. */
export function byDue(a: Reminder, b: Reminder): number {
  return doneFirst(a, b) || dueKey(a).localeCompare(dueKey(b)) || RANK[a.priority] - RANK[b.priority] || a.createdAt - b.createdAt
}

export function byNewest(a: Reminder, b: Reminder): number {
  return doneFirst(a, b) || b.createdAt - a.createdAt
}
