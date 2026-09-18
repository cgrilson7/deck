import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, FolderPlus, Play, RotateCcw } from 'lucide-react'
import type { DeckSettings, DeckState, NewSessionRequest } from '@shared/types'
import { MODELS, PERMISSION_MODES, cleanModel, modelLabel } from '@shared/models'
import { plain } from '../lib/errors'
import { shortPath } from '../lib/format'

/**
 * The session form, shared by the launcher (the empty focus pane) and the `+` picker of an
 * empty grid cell: `StartCard` (a folder or a new project, worktree / model / permission
 * mode, a name, a first prompt; starts through `DeckApi.newSession`, so a refusal lands on
 * the form), `ParkedCard` (resume / forget), and the model + permission rows they are built
 * from. The launcher's `.l*` styles draw both; the picker wraps them in `.launcher` too.
 */

export const OTHER_MODEL = '\u0000other'

/**
 * The model row's state: the catalog pick, or "other…" with an id typed by hand. The last
 * pick is kept in localStorage; a fresh deck starts on the `defaultModel` setting.
 */
export function useModelPick(dflt: string) {
  const [pick, setPick] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('deck:newModel')
      if (saved !== null) return saved
    } catch {
      /* private mode / blocked storage: fall through */
    }
    return MODELS.some((m) => m.id === dflt) ? dflt : dflt ? OTHER_MODEL : ''
  })
  const [other, setOther] = useState<string>(() => {
    try {
      return localStorage.getItem('deck:newModelOther') ?? (MODELS.some((m) => m.id === dflt) ? '' : dflt)
    } catch {
      return ''
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('deck:newModel', pick)
      localStorage.setItem('deck:newModelOther', other)
    } catch {
      /* not worth a word */
    }
  }, [pick, other])
  const value = pick === OTHER_MODEL ? cleanModel(other) : pick
  return { pick, setPick, other, setOther, value }
}

type ModelPickState = ReturnType<typeof useModelPick>

/** The "Model" row of the + chooser (and the launcher): a select over the catalog, and a text field when "other…" is picked. */
export function ModelPick({ pick }: { pick: ModelPickState }) {
  const hint = MODELS.find((m) => m.id === pick.pick)?.hint ?? 'An alias or a full model id, as `claude --model` takes it'
  return (
    <div className="menu-model" title={hint} onClick={(e) => e.stopPropagation()}>
      <span className="menu-model-label">Model</span>
      <select className="menu-select" value={pick.pick} onChange={(e) => pick.setPick(e.target.value)}>
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value={OTHER_MODEL}>other…</option>
      </select>
      {pick.pick === OTHER_MODEL && (
        <input
          className="menu-input"
          value={pick.other}
          placeholder="claude-opus-4-6"
          spellCheck={false}
          autoFocus
          onChange={(e) => pick.setOther(e.target.value)}
          onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
        />
      )}
    </div>
  )
}

/** The "Permissions" row: `--permission-mode` from the catalog; the modes that switch asking off wear a warning tint. */
export function PermissionPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const cur = PERMISSION_MODES.find((m) => m.id === value)
  return (
    <div className={`menu-model ${cur?.risky ? 'is-risky' : ''}`} title={cur?.hint ?? "The CLI's --permission-mode"} onClick={(e) => e.stopPropagation()}>
      <span className="menu-model-label">Permissions</span>
      <select className="menu-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {PERMISSION_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  )
}


// ---- the cards ------------------------------------------------------------------

export function Card({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`lcard ${wide ? 'lcard-wide' : ''}`}>
      <h3>
        {title}
        {note && <small>{note}</small>}
      </h3>
      {children}
    </section>
  )
}

/** The folder above `p` (an absolute path); '/' at the top. */
const parentOf = (p: string): string => p.replace(/\/[^/]+\/?$/, '') || '/'
/** A folder name typed for a new project: no separators, no `..`, trimmed. */
const cleanName = (v: string): string => v.trim().replace(/[\\/]+/g, '-')
const joinPath = (parent: string, name: string): string => `${parent.replace(/\/+$/, '')}/${name}`

// ---- start a session -------------------------------------------------------

/**
 * Start a session. `focused` (the picker: the focused session's folder) leads the folder pills
 * and is the default; `onStarted` fires once the session is up (the picker closes on it).
 */
export function StartCard({ state, settings, canAdd, focused, onStarted }: { state: DeckState; settings: DeckSettings; canAdd: boolean; focused?: string; onStarted?: () => void }) {
  const [kind, setKind] = useState<'folder' | 'project'>('folder')
  const [where, setWhere] = useState<string>(() => focused ?? state.recent[0] ?? settings.defaultCwd)
  const [projName, setProjName] = useState('')
  const [parent, setParent] = useState('~')
  const [gitInit, setGitInit] = useState(true)
  const [worktree, setWorktree] = useState(settings.worktreeByDefault)
  const model = useModelPick(settings.defaultModel)
  const [perm, setPerm] = useState('')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const folders = useMemo(() => {
    const out = focused ? [focused, ...state.recent.filter((d) => d !== focused)] : [...state.recent]
    if (settings.defaultCwd && !out.includes(settings.defaultCwd)) out.push(settings.defaultCwd)
    return out
  }, [state.recent, settings.defaultCwd, focused])
  // Where a fresh project may go: home, the folders the recent ones sit in, the default folder, and whatever was picked.
  const parents = useMemo(() => {
    const set = new Set<string>(['~'])
    for (const d of state.recent) set.add(parentOf(d))
    if (settings.defaultCwd) set.add(settings.defaultCwd)
    if (parent) set.add(parent)
    return Array.from(set)
  }, [state.recent, settings.defaultCwd, parent])
  const target = cleanName(projName) ? joinPath(parent, cleanName(projName)) : ''

  const pickFolder = async () => {
    const d = await window.deck.chooseDir('New session in folder')
    if (d) setWhere(d)
  }
  const pickParent = async () => {
    const d = await window.deck.chooseDir('Where the new project goes')
    if (d) setParent(d)
  }

  const start = async () => {
    if (!canAdd || busy) return
    const req: NewSessionRequest = {
      worktree: kind === 'project' ? false : worktree,
      model: model.value,
      permissionMode: perm || undefined,
      name: name.trim() || undefined,
      prompt: prompt.trim() || undefined
    }
    if (kind === 'project') {
      if (!target) {
        setErr('Give the project a folder name.')
        return
      }
      req.cwd = target
      req.create = true
      req.gitInit = gitInit
    } else {
      req.cwd = where.trim() || undefined
    }
    setBusy(true)
    setErr('')
    try {
      await window.deck.newSession(req)
      onStarted?.()
    } catch (e) {
      setErr(plain(e))
    } finally {
      setBusy(false)
    }
  }
  const enterStarts = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void start()
    }
  }

  return (
    <Card title="Start a session" note={canAdd ? undefined : `every one of the ${state.cap} slots is open`} wide>
      <div
        className="lform"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) {
            e.preventDefault()
            void start()
          }
        }}
      >
        <div className="segmented lseg">
          <button className={`seg ${kind === 'folder' ? 'on' : ''}`} onClick={() => setKind('folder')} title="A folder that exists: a recent one, the default, or any you pick">
            <FolderOpen size={13} /> In a folder
          </button>
          <button className={`seg ${kind === 'project' ? 'on' : ''}`} onClick={() => setKind('project')} title="A fresh folder, made for it (and git init'd) when you start">
            <FolderPlus size={13} /> New project
          </button>
        </div>

        {kind === 'folder' ? (
          <div className="lfield">
            <label>Where</label>
            <div className="pills lpills">
              {folders.map((d) => (
                <button key={d} className={`pill ${where === d ? 'on' : ''}`} onClick={() => setWhere(d)} title={d}>
                  {shortPath(d)}
                  <small>{d === focused ? 'focused' : d === settings.defaultCwd ? 'default' : 'recent'}</small>
                </button>
              ))}
              <button className="pill" onClick={() => void pickFolder()} title="A folder dialog">
                Choose folder…
              </button>
            </div>
            <input className="lin lin-mono" value={where} spellCheck={false} placeholder="~/…" title="Or type a path; ~ is your home" onChange={(e) => setWhere(e.target.value)} onKeyDown={enterStarts} />
          </div>
        ) : (
          <div className="lfield">
            <label>New project</label>
            <div className="lrow">
              <select className="lin" value={parent} title="The folder the project goes in" onChange={(e) => setParent(e.target.value)}>
                {parents.map((p) => (
                  <option key={p} value={p}>
                    {p === '~' ? '~' : shortPath(p)}
                  </option>
                ))}
              </select>
              <button className="lbtn" onClick={() => void pickParent()} title="Another folder to put it in">
                <FolderOpen size={13} />
              </button>
              <span className="lsep">/</span>
              <input className="lin lin-mono lgrow" value={projName} spellCheck={false} placeholder="project-name" autoFocus onChange={(e) => setProjName(e.target.value)} onKeyDown={enterStarts} />
            </div>
            <div className="lrow">
              <label className={`pill pill-toggle ${gitInit ? 'on' : ''}`} title="git init the fresh folder (skipped when it is already inside a repository)">
                <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} />
                git init
              </label>
              <span className="lpath">{target ? `makes ${shortPath(target)} and starts Claude in it` : 'a fresh folder, made when you start'}</span>
            </div>
          </div>
        )}

        <div className="lfield">
          <label>How</label>
          <div className="picker-opts">
            <label className={`pill pill-toggle ${worktree && kind !== 'project' ? 'on' : ''} ${kind === 'project' ? 'off' : ''}`} title={kind === 'project' ? 'A fresh repository has no commit to branch from yet' : 'Claude creates a git worktree under .claude/worktrees/ and works there'}>
              <input type="checkbox" checked={worktree && kind !== 'project'} disabled={kind === 'project'} onChange={(e) => setWorktree(e.target.checked)} />
              in a new git worktree
            </label>
            <ModelPick pick={model} />
            <PermissionPick value={perm} onChange={setPerm} />
          </div>
        </div>

        <div className="lfield">
          <input className="lin" value={name} placeholder="Name (optional): what the tile and the fleet call it" title="The CLI's --name" onChange={(e) => setName(e.target.value)} onKeyDown={enterStarts} />
        </div>
        <div className="lfield">
          <textarea className="lin ltext" value={prompt} rows={3} spellCheck={false} placeholder="First prompt (optional): handed to Claude as it starts. ⌘⏎ starts the session." onChange={(e) => setPrompt(e.target.value)} />
        </div>

        <div className="lrow lactions">
          <button className="lbtn lgo" disabled={!canAdd || busy} onClick={() => void start()}>
            <Play size={13} /> {kind === 'project' ? 'Create & start' : 'Start session'} <kbd>⌘⏎</kbd>
          </button>
          {err && <span className="lerr">{err}</span>}
        </div>
      </div>
    </Card>
  )
}

// ---- parked sessions ---------------------------------------------------------

/** The parked sessions: resume (`onDone` after; the picker closes on it) or forget. */
export function ParkedCard({ state, canAdd, onDone }: { state: DeckState; canAdd: boolean; onDone?: () => void }) {
  const run = (cmd: Parameters<typeof window.deck.command>[0]) => {
    onDone?.()
    void window.deck.command(cmd)
  }
  return (
    <Card title="Parked" note={`${state.parked.length} to pick back up`} wide={state.parked.length > 3}>
      <div className="llist">
        {state.parked.map((p) => (
          <div key={p.id} className="lrow lparked">
            <span className={`dot ${p.tmuxAlive ? 'dot-idle' : 'dot-unknown'}`} title={p.tmuxAlive ? 'Still running in tmux; resume reattaches' : 'Resumes with claude --resume'} />
            <span className="lname" title={p.name}>
              {p.name}
            </span>
            <span className="lpath" title={p.cwd}>
              {shortPath(p.cwd)}
            </span>
            {p.worktree && <span className="badge">worktree</span>}
            {p.model && <span className="badge">{modelLabel(p.model)}</span>}
            <span className="spacer" />
            <button className="lbtn" disabled={!canAdd} onClick={() => run({ type: 'resume', id: p.id })}>
              <RotateCcw size={12} /> resume
            </button>
            <button className="ghost danger" title="Forget it (leaves tmux alone)" onClick={() => run({ type: 'forget', id: p.id })}>
              forget
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}

