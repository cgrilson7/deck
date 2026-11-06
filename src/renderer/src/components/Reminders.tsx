import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Flag, ListChecks, Maximize2, Trash2 } from 'lucide-react'
import type { SessionView } from '@shared/types'
import { byDue, byNewest, byPriority, dayOf, type Reminder, type ReminderLogEntry, type ReminderNote, type ReminderPriority, type RemindersOp } from '@shared/reminders'
import { CellTools } from '../lib/celltools'
import { tilde } from '../lib/files'
import { renderMarkdown } from '../lib/markdown'
import { openReminders, useReminders } from '../lib/reminders'

type Tab = 'todo' | 'notes' | 'log'
type Sort = 'project' | 'priority' | 'due' | 'newest'

const VIEW_KEY = 'deck.reminders.view'
const ALL = ''
const PICK = '\u0000pick'
/** Log and note rows drawn before "show more". */
const PAGE = 200

const PRIORITY_NEXT: Record<ReminderPriority, ReminderPriority> = { normal: 'high', high: 'low', low: 'normal' }

function loadView(): { tab: Tab; project: string; sort: Sort } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as { tab?: Tab; project?: string; sort?: Sort }
    return {
      tab: v.tab === 'notes' || v.tab === 'log' ? v.tab : 'todo',
      project: typeof v.project === 'string' ? v.project : ALL,
      sort: v.sort === 'priority' || v.sort === 'due' || v.sort === 'newest' ? v.sort : 'project'
    }
  } catch {
    return { tab: 'todo', project: ALL, sort: 'project' }
  }
}

const baseName = (p: string): string => p.split('/').filter(Boolean).pop() ?? '/'

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === dayOf(yesterday.getTime())) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(y === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}

/** A destructive button that asks by arming itself: first click turns it red, a second within 3s does it. */
function ArmedDelete({ onConfirm, title }: { onConfirm: () => void; title: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button className={`rm-del${armed ? ' is-armed' : ''}`} title={title} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'delete' : <Trash2 size={11} />}
    </button>
  )
}

function ByTag({ by }: { by: string }) {
  return by && by !== 'you' ? <span className="rm-by" title={`Written by session ${by}`}>{by}</span> : null
}

function DueTag({ due, today }: { due: string; today: string }) {
  const cls = due < today ? ' is-late' : due === today ? ' is-today' : ''
  return <span className={`rm-due${cls}`}>{due === today ? 'today' : dayLabel(due, today).replace('Yesterday', 'yesterday')}</span>
}

/** A text box that saves when it loses focus (or ⌘⏎), and goes back on Esc. */
function SavedText({ value, placeholder, rows, onSave, autoFocus }: { value: string; placeholder?: string; rows?: number; onSave: (v: string) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onSave(draft)
  }
  return (
    <textarea
      className="rm-field"
      value={draft}
      rows={rows ?? 2}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') setDraft(value)
        if (e.key === 'Enter' && e.metaKey) e.currentTarget.blur()
      }}
    />
  )
}

function ReminderRow({ r, today, showProject, act, projects, label }: { r: Reminder; today: string; showProject: boolean; act: (op: RemindersOp) => void; projects: string[]; label: (p: string) => string }) {
  const [open, setOpen] = useState(false)
  const done = r.doneAt !== null
  return (
    <div className={`rm-row rm-p-${r.priority}${done ? ' is-done' : ''}`}>
      <div className="rm-line">
        <button className="rm-check" role="checkbox" aria-checked={done} title={done ? 'Not done after all' : 'Mark complete (it leaves the list when the day ends, and goes in the log)'} onClick={() => act({ op: done ? 'undo' : 'done', id: r.id })}>
          {done && <Check size={10} strokeWidth={3} />}
        </button>
        <button className="rm-flag" title={`${r.priority} priority: click to change`} disabled={done} onClick={() => act({ op: 'set', id: r.id, priority: PRIORITY_NEXT[r.priority] })}>
          <Flag size={11} />
        </button>
        <button className="rm-text" title={open ? 'Fold' : 'Open: edit, notes, due date'} onClick={() => setOpen((v) => !v)}>
          {r.text}
          {r.detail && !open && <span className="rm-has-detail" title="Has notes"> ¶</span>}
        </button>
        {r.due && !done && <DueTag due={r.due} today={today} />}
        {showProject && <span className="rm-chip" title={tilde(r.project)}>{baseName(r.project)}</span>}
        <ByTag by={r.by} />
      </div>
      {open && (
        <div className="rm-edit">
          <SavedText value={r.text} onSave={(text) => text.trim() && act({ op: 'set', id: r.id, text })} />
          <SavedText value={r.detail} placeholder="Notes on this reminder…" rows={3} onSave={(detail) => act({ op: 'set', id: r.id, detail })} />
          <div className="rm-edit-row">
            <div className="rm-seg" role="group" aria-label="Priority">
              {(['high', 'normal', 'low'] as const).map((p) => (
                <button key={p} className={r.priority === p ? 'on' : ''} onClick={() => act({ op: 'set', id: r.id, priority: p })}>
                  {p}
                </button>
              ))}
            </div>
            <label className="rm-date">
              due
              <input type="date" value={r.due ?? ''} onChange={(e) => act({ op: 'set', id: r.id, due: e.target.value || null })} />
            </label>
            <select className="rm-select" value={r.project} title="Project" onChange={(e) => act({ op: 'set', id: r.id, project: e.target.value })}>
              {projects.map((p) => (
                <option key={p} value={p}>{label(p)}</option>
              ))}
            </select>
            <span className="spacer" />
            <ArmedDelete title={done ? 'Delete, and take its line out of the log' : 'Delete without completing'} onConfirm={() => act({ op: 'rm', id: r.id })} />
          </div>
        </div>
      )}
    </div>
  )
}

function NoteRow({ n, cwd, act }: { n: ReminderNote; cwd: string; act: (op: RemindersOp) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="rm-note">
      {editing ? (
        <NoteEditor n={n} act={act} onDone={() => setEditing(false)} />
      ) : (
        <div className="rm-note-body" title="Click to edit" onClick={(e) => (window.getSelection()?.isCollapsed !== false && !(e.target as HTMLElement).closest('a, button') ? setEditing(true) : undefined)}>
          {renderMarkdown(n.text, cwd)}
        </div>
      )}
      <div className="rm-meta">
        <span>{new Date(n.at).toLocaleDateString([], { month: 'short', day: 'numeric' })} {clock(n.at)}</span>
        <ByTag by={n.by} />
        <span className="spacer" />
        <ArmedDelete title="Delete this note" onConfirm={() => act({ op: 'rm', id: n.id })} />
      </div>
    </div>
  )
}

function NoteEditor({ n, act, onDone }: { n: ReminderNote; act: (op: RemindersOp) => void; onDone: () => void }) {
  return (
    <SavedTextClose
      value={n.text}
      onClose={(text) => {
        onDone()
        if (text !== n.text && text.trim()) act({ op: 'set', id: n.id, text })
      }}
    />
  )
}

function SavedTextClose({ value, onClose }: { value: string; onClose: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <textarea
      className="rm-field"
      autoFocus
      rows={Math.min(12, Math.max(3, value.split('\n').length + 1))}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onClose(draft)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose(value)
        if (e.key === 'Enter' && e.metaKey) e.currentTarget.blur()
      }}
    />
  )
}

function Group({ title, path, count, children }: { title: string; path?: string; count?: number; children: ReactNode }) {
  return (
    <section className="rm-group">
      <h4 title={path ? tilde(path) : undefined}>
        {title}
        {count !== undefined && <span className="rm-count">{count}</span>}
      </h4>
      {children}
    </section>
  )
}

function View({ session, pane, onClose }: { session: SessionView | null; pane: boolean; onClose?: () => void }) {
  const state = useReminders()
  const [view, setView] = useState(loadView)
  const { tab, project: filter, sort } = view
  const [here, setHere] = useState('')
  const [picked, setPicked] = useState('')
  const [draft, setDraft] = useState('')
  const [draftPriority, setDraftPriority] = useState<ReminderPriority>('normal')
  const [problem, setProblem] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [today, setToday] = useState(() => dayOf(Date.now()))
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = setInterval(() => setToday(dayOf(Date.now())), 60_000)
    return () => clearInterval(t)
  }, [])

  const patch = (p: Partial<typeof view>) => {
    setView((v) => {
      const next = { ...v, ...p }
      localStorage.setItem(VIEW_KEY, JSON.stringify(next))
      return next
    })
    setShown(PAGE)
  }

  // The focused session's folder is where a new item goes unless you say otherwise.
  const cwd = session?.cwd ?? ''
  useEffect(() => {
    let live = true
    if (!cwd) return setHere('')
    void window.deck.remindersDo({ op: 'resolve', path: cwd }).then(
      (r) => {
        if (live) setHere(typeof r.project === 'string' ? r.project : '')
      },
      () => {
        if (live) setHere('')
      }
    )
    return () => {
      live = false
    }
  }, [cwd])

  const act = (op: RemindersOp): void => {
    setProblem('')
    window.deck.remindersDo(op).catch((err: unknown) => setProblem(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(err)))
  }

  const projects = useMemo(() => {
    const set = new Set<string>()
    for (const x of [...(state?.reminders ?? []), ...(state?.notes ?? []), ...(state?.log ?? [])]) set.add(x.project)
    for (const p of [here, picked, filter]) if (p) set.add(p)
    return [...set].sort((a, b) => baseName(a).localeCompare(baseName(b)) || a.localeCompare(b))
  }, [state, here, picked, filter])

  // Two projects with one folder name are told apart by their paths.
  const label = useMemo(() => {
    const seen = new Map<string, number>()
    for (const p of projects) seen.set(baseName(p), (seen.get(baseName(p)) ?? 0) + 1)
    return (p: string) => ((seen.get(baseName(p)) ?? 0) > 1 ? tilde(p) : baseName(p))
  }, [projects])

  const target = filter || picked || here || projects[0] || ''
  const inProject = <T extends { project: string }>(xs: T[]): T[] => (filter ? xs.filter((x) => x.project === filter) : xs)
  const allReminders = inProject(state?.reminders ?? [])
  const openCount = allReminders.filter((r) => r.doneAt === null).length

  const chooseProject = async (): Promise<string> => {
    const dir = await window.deck.chooseDir('Which project?')
    if (!dir) return ''
    const r = await window.deck.remindersDo({ op: 'resolve', path: dir })
    const p = typeof r.project === 'string' ? r.project : ''
    setPicked(p)
    return p
  }

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text) return
    const project = target || (await chooseProject())
    if (!project) return
    setProblem('')
    try {
      if (tab === 'todo') await window.deck.remindersDo({ op: 'add', text, project, priority: draftPriority })
      else await window.deck.remindersDo({ op: tab === 'notes' ? 'note' : 'log', text, project })
      setDraft('')
      setDraftPriority('normal')
    } catch (err) {
      setProblem(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(err))
    }
  }

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
    if (e.key === 'Escape') setDraft('')
  }

  const emptyLine = (what: string) => <div className="rm-empty">{what}</div>

  let body: ReactNode
  if (!state) body = null
  else if (tab === 'todo') {
    const cmp = sort === 'due' ? byDue : sort === 'newest' ? byNewest : byPriority
    const rows = [...allReminders].sort(cmp)
    const row = (r: Reminder, showProject: boolean) => <ReminderRow key={r.id} r={r} today={today} showProject={showProject} act={act} projects={projects} label={label} />
    if (!rows.length) body = emptyLine('Nothing to do here.')
    else if (sort === 'project' && !filter) {
      body = projects
        .filter((p) => rows.some((r) => r.project === p))
        .map((p) => {
          const mine = rows.filter((r) => r.project === p)
          return (
            <Group key={p} title={label(p)} path={p} count={mine.filter((r) => r.doneAt === null).length}>
              {mine.map((r) => row(r, false))}
            </Group>
          )
        })
    } else body = rows.map((r) => row(r, !filter))
  } else if (tab === 'notes') {
    const rows = [...inProject(state.notes)].sort((a, b) => b.at - a.at)
    if (!rows.length) body = emptyLine('No notes yet.')
    else {
      const page = rows.slice(0, shown)
      body = projects
        .filter((p) => page.some((n) => n.project === p))
        .map((p) => (
          <Group key={p} title={label(p)} path={p}>
            {page.filter((n) => n.project === p).map((n) => <NoteRow key={n.id} n={n} cwd={p} act={act} />)}
          </Group>
        ))
    }
  } else {
    const rows = [...inProject(state.log)].sort((a, b) => b.at - a.at)
    if (!rows.length) body = emptyLine('Nothing logged yet. Completed reminders land here.')
    else {
      const page = rows.slice(0, shown)
      body = projects
        .filter((p) => page.some((l) => l.project === p))
        .map((p) => {
          const mine = page.filter((l) => l.project === p)
          const days = [...new Set(mine.map((l) => dayOf(l.at)))]
          return (
            <Group key={p} title={label(p)} path={p} count={rows.filter((l) => l.project === p).length}>
              {days.map((d) => (
                <div key={d} className="rm-day">
                  <div className="rm-day-label">{dayLabel(d, today)}</div>
                  {mine.filter((l) => dayOf(l.at) === d).map((l) => <LogRow key={l.id} l={l} act={act} />)}
                </div>
              ))}
            </Group>
          )
        })
    }
  }

  const total = tab === 'notes' ? inProject(state?.notes ?? []).length : tab === 'log' ? inProject(state?.log ?? []).length : 0

  const controls = (
    <>
      <div className="rm-tabs" role="tablist">
        {(['todo', 'notes', 'log'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => patch({ tab: t })}>
            {t === 'todo' ? `To do${openCount ? ` ${openCount}` : ''}` : t === 'notes' ? 'Notes' : 'Log'}
          </button>
        ))}
      </div>
      <span className="spacer" />
      <select className="rm-select" value={filter} title="Show one project" onChange={(e) => patch({ project: e.target.value })}>
        <option value={ALL}>All projects</option>
        {projects.map((p) => (
          <option key={p} value={p}>{label(p)}</option>
        ))}
      </select>
      {tab === 'todo' && (
        <select className="rm-select" value={sort} title="Sort" onChange={(e) => patch({ sort: e.target.value as Sort })}>
          <option value="project">By project</option>
          <option value="priority">By priority</option>
          <option value="due">By due date</option>
          <option value="newest">Newest</option>
        </select>
      )}
    </>
  )

  return (
    <>
      <header className={pane ? 'pane-head' : 'ft-head rm-head'}>
        <ListChecks size={pane ? 14 : 12} />
        {pane && <span className="name">Reminders</span>}
        {controls}
        {pane ? (
          <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
            close
          </button>
        ) : (
          <button className="ft-btn" title="Open large (⌘⇧R)" onClick={openReminders}>
            <Maximize2 size={11} />
          </button>
        )}
        <CellTools />
      </header>
      {problem && <div className="rm-problem">{problem}</div>}
      <div className="rm-list">
        {body}
        {tab !== 'todo' && total > shown && (
          <button className="ghost rm-more" onClick={() => setShown((n) => n + PAGE)}>
            show more
          </button>
        )}
      </div>
      <div className="rm-composer">
        {tab === 'todo' && (
          <button className={`rm-flag rm-p-${draftPriority}`} title={`New reminder: ${draftPriority} priority. Click to change`} onClick={() => setDraftPriority((p) => PRIORITY_NEXT[p])}>
            <Flag size={12} />
          </button>
        )}
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder={tab === 'todo' ? 'Remind me to…' : tab === 'notes' ? 'A note…' : 'Something you got done…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKey}
        />
        {!filter && (
          <select
            className="rm-select"
            value={target}
            title="Which project this goes in"
            onChange={(e) => {
              if (e.target.value === PICK) void chooseProject()
              else setPicked(e.target.value)
            }}
          >
            {!target && <option value="">project…</option>}
            {projects.map((p) => (
              <option key={p} value={p}>{label(p)}</option>
            ))}
            <option value={PICK}>Choose a folder…</option>
          </select>
        )}
      </div>
    </>
  )
}

function LogRow({ l, act }: { l: ReminderLogEntry; act: (op: RemindersOp) => void }) {
  return (
    <div className="rm-logline">
      <Check size={11} className="rm-logtick" />
      <span className="rm-logtext">{l.text}</span>
      <ByTag by={l.by} />
      <span className="rm-time">{clock(l.at)}</span>
      <ArmedDelete title="Take this line out of the log" onConfirm={() => act({ op: 'rm', id: l.id })} />
    </div>
  )
}

/** The Reminders tile: to do, notes and the running log, a plugin cell. */
export function RemindersTile({ session }: { session: SessionView | null }) {
  return (
    <div className="tile tile-plugin reminders" onClick={(e) => e.stopPropagation()}>
      <View session={session} pane={false} />
    </div>
  )
}

/** The same at reading size, in the center column. */
export function RemindersPane({ session, onClose }: { session: SessionView | null; onClose: () => void }) {
  const pane = useRef<HTMLElement>(null)
  useEffect(() => pane.current?.focus(), [])
  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !el?.closest('.xterm, input, textarea, select')) onClose()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onClose])
  return (
    <section ref={pane} className="focus reminders rm-pane" tabIndex={-1}>
      <View session={session} pane onClose={onClose} />
    </section>
  )
}
