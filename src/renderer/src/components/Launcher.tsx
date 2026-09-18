import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, FolderPlus, Image as ImageIcon, Monitor, Moon, Play, Plus, RotateCcw, Sparkles, Sun } from 'lucide-react'
import type { DeckSettings, DeckState, NewSessionRequest, StudioInfo, StudioModel, StudioRatio, StudioSize } from '@shared/types'
import { STUDIO_RATIOS, STUDIO_SIZES } from '@shared/types'
import { MODELS, modelLabel } from '@shared/models'
import { THEMES, type Appearance } from '@shared/themes'
import { plain } from '../lib/errors'
import { shortPath } from '../lib/format'
import { openStudio, useStudioJobs } from '../lib/studio'
import { patchSettings, systemDark } from '../lib/theme'
import { Fox } from './Fox'
import { ModelPick, PLUGINS, PermissionPick, useModelPick } from './PlusTile'
import { LS, lsRead, lsWrite, StudioImage } from './StudioTile'

/**
 * The empty focus pane, built out: what VS Code's welcome page is to an empty window. Nothing is
 * in focus, so the center column has the room, and everything the `+` picker, the Session menu
 * and the View menu offer is here as a form: a session (a folder or a NEW PROJECT in a fresh
 * folder off ~, the model, the permission mode, a worktree, a name, a first prompt), the parked
 * sessions to resume, the Studio's composer, the mini apps, and every deck setting that fits.
 * Settings patch straight through `patchSettings`; the session form starts through
 * `DeckApi.newSession`, so a refusal (the cap, a missing folder) lands on the form, not in the
 * top bar. Once a session takes the focus the launcher is gone: nothing here needs to persist,
 * except the Studio draft, which shares the pane's localStorage keys.
 */
export function Launcher({ state, settings }: { state: DeckState; settings: DeckSettings }) {
  const open = state.open.filter((s) => !s.pack).length
  const canAdd = open < state.cap
  return (
    <section className="focus focus-empty launcher">
      <div className="launcher-scroll">
        <header className="launcher-hero">
          <Fox anim="idle" scale={3} />
          <div className="launcher-hero-text">
            <h1>deck</h1>
            <p>
              {open === 0 ? 'Nothing open.' : `${open} of ${state.cap} slots open, none in focus.`} Start a session, pick a parked one back up, or set the deck up.
              {state.profile !== 'deck' && <span className="badge">{state.profile}</span>}
            </p>
            <div className="launcher-quick">
              <button className="lbtn" disabled={!canAdd} onClick={() => window.deck.command({ type: 'new' })} title="A session in the default folder, no questions">
                <Plus size={13} /> New session <kbd>⌘N</kbd>
              </button>
              <button className="lbtn" disabled={!canAdd} onClick={() => window.deck.command({ type: 'chooseFolder' })} title="Pick any folder and start there">
                <FolderOpen size={13} /> Folder… <kbd>⌘O</kbd>
              </button>
              <button className="lbtn" onClick={openStudio} title="The Studio, full size in this column">
                <Sparkles size={13} /> Studio <kbd>⌘⇧I</kbd>
              </button>
            </div>
          </div>
        </header>
        <div className="launcher-cards">
          <StartCard state={state} settings={settings} canAdd={canAdd} />
          {state.parked.length > 0 && <ParkedCard state={state} canAdd={canAdd} />}
          <StudioCard settings={settings} />
          <AppsCard settings={settings} />
          <DeckCard settings={settings} />
          <TerminalCard settings={settings} />
          <KeysCard settings={settings} />
          <ShortcutsCard />
        </div>
      </div>
    </section>
  )
}

function Card({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: React.ReactNode }) {
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

function StartCard({ state, settings, canAdd }: { state: DeckState; settings: DeckSettings; canAdd: boolean }) {
  const [kind, setKind] = useState<'folder' | 'project'>('folder')
  const [where, setWhere] = useState<string>(() => state.recent[0] ?? settings.defaultCwd)
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
    const out = [...state.recent]
    if (settings.defaultCwd && !out.includes(settings.defaultCwd)) out.push(settings.defaultCwd)
    return out
  }, [state.recent, settings.defaultCwd])
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
                  <small>{d === settings.defaultCwd ? 'default' : 'recent'}</small>
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

function ParkedCard({ state, canAdd }: { state: DeckState; canAdd: boolean }) {
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
            <button className="lbtn" disabled={!canAdd} onClick={() => window.deck.command({ type: 'resume', id: p.id })}>
              <RotateCcw size={12} /> resume
            </button>
            <button className="ghost danger" title="Forget it (leaves tmux alone)" onClick={() => window.deck.command({ type: 'forget', id: p.id })}>
              forget
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---- the Studio's composer, in short ---------------------------------------------

function StudioCard({ settings }: { settings: DeckSettings }) {
  const jobs = useStudioJobs()
  const [prompt, setPrompt] = useState(() => lsRead(LS.prompt))
  const [model, setModel] = useState(() => lsRead(LS.model))
  const [ratio, setRatio] = useState<StudioRatio>(() => (lsRead(LS.ratio, '1:1') || '1:1') as StudioRatio)
  const [size, setSize] = useState<StudioSize>(() => (lsRead(LS.size, '1K') || '1K') as StudioSize)
  const [info, setInfo] = useState<StudioInfo | null>(null)
  const [models, setModels] = useState<StudioModel[] | null>(null)
  const [err, setErr] = useState('')

  // The same draft as the pane's, so what is typed here is there when the Studio opens.
  useEffect(() => lsWrite(LS.prompt, prompt), [prompt])
  useEffect(() => lsWrite(LS.model, model), [model])
  useEffect(() => lsWrite(LS.ratio, ratio), [ratio])
  useEffect(() => lsWrite(LS.size, size), [size])

  useEffect(() => {
    let live = true
    void window.deck
      .studioInfo()
      .then((i) => live && setInfo(i))
      .catch(() => {})
    void window.deck
      .studioModels()
      .then((m) => live && setModels(m))
      .catch(() => live && setModels([]))
    return () => {
      live = false
    }
  }, [settings.geminiApiKey, settings.studioModel])

  const newest = jobs.find((j) => j.status === 'done' && j.image)
  const cooking = jobs.filter((j) => j.status === 'running').length

  /** Start it and open the Studio, which follows the newest job while it cooks. */
  const go = () => {
    const p = prompt.trim()
    if (!p || !info?.ready) return
    setErr('')
    window.deck.studioGenerate({ prompt: p, model: model || undefined, ratio, size, from: 'tile' }).catch((e) => setErr(plain(e)))
    openStudio()
  }

  return (
    <Card title="Studio" note={cooking ? `${cooking} cooking` : newest ? 'the newest image' : undefined} wide>
      <div className="lstudio">
        <button className="lstudio-shot" onClick={openStudio} title="Open the Studio (⌘⇧I)">
          {newest?.image ? <StudioImage path={newest.image} className="lstudio-img" /> : <ImageIcon size={28} />}
        </button>
        <div className="lstudio-form">
          <textarea
            className="lin ltext"
            value={prompt}
            rows={3}
            spellCheck={false}
            placeholder="Describe an image… (⌘⏎ generates and opens the Studio)"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.metaKey) {
                e.preventDefault()
                go()
              }
            }}
          />
          <div className="lrow">
            {models && models.length === 0 ? (
              <input className="lin lin-mono lgrow" value={model} placeholder="model id (empty = the setting)" onChange={(e) => setModel(e.target.value)} />
            ) : (
              <select className="lin lgrow" value={model} title="Which Gemini image model" onChange={(e) => setModel(e.target.value)}>
                <option value="">{info?.model ? `default (${info.model})` : 'default (setting)'}</option>
                {(models ?? []).map((m) => (
                  <option key={m.id} value={m.id} title={m.description}>
                    {m.name}
                  </option>
                ))}
                {model && !(models ?? []).some((m) => m.id === model) && <option value={model}>{model}</option>}
              </select>
            )}
            <select className="lin" value={ratio} title="Aspect ratio" onChange={(e) => setRatio(e.target.value as StudioRatio)}>
              {STUDIO_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select className="lin" value={size} title="Output size — 4K is slow and costs the most" onChange={(e) => setSize(e.target.value as StudioSize)}>
              {STUDIO_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="lrow lactions">
            <button className="lbtn lgo" disabled={!info?.ready || !prompt.trim()} onClick={go}>
              <Sparkles size={13} /> Generate
            </button>
            <button className="lbtn" onClick={openStudio}>
              Open Studio <kbd>⌘⇧I</kbd>
            </button>
            {info && !info.ready && <span className="lerr">no key: set the Gemini key below, or export GEMINI_API_KEY in your login shell</span>}
            {err && <span className="lerr">{err}</span>}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ---- mini apps ------------------------------------------------------------------

function AppsCard({ settings }: { settings: DeckSettings }) {
  return (
    <Card title="Mini apps" note="grid tiles beside the sessions">
      <div className="llist">
        {PLUGINS.map((p) => {
          const on = Boolean(settings[p.setting])
          return (
            <label key={p.key} className={`lcheck ${on ? 'on' : ''}`}>
              <input type="checkbox" checked={on} onChange={(e) => patchSettings({ [p.setting]: e.target.checked } as Partial<DeckSettings>)} />
              <span>
                <b>{p.label}</b>
                <small>{p.hint}</small>
              </span>
            </label>
          )
        })}
      </div>
      <div className="lset">
        <span className="lset-label">Music face</span>
        <div className="segmented">
          <button className={`seg ${settings.music === 'spotify' ? 'on' : ''}`} onClick={() => patchSettings({ music: 'spotify' })} title="Spotify.app over AppleScript: costs the deck no bandwidth">
            Spotify
          </button>
          <button className={`seg ${settings.music === 'youtube' ? 'on' : ''}`} onClick={() => patchSettings({ music: 'youtube' })} title="The lofi stream; never plays until asked">
            Lofi stream
          </button>
        </div>
        <span className="lset-label">Layout</span>
        <div className="lrow">
          <button className="lbtn" disabled={!settings.gridLayout.some(Boolean)} onClick={() => patchSettings({ gridLayout: [] })} title="Unpin every tile; they flow into the free cells again">
            Reset layout
          </button>
          <span className="lmuted">{settings.gridLayout.filter(Boolean).length || 'no'} pinned</span>
        </div>
      </div>
    </Card>
  )
}

// ---- deck settings --------------------------------------------------------------

function Check({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`lcheck ${value ? 'on' : ''}`} title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

/** A text setting that commits on blur or ⏎, so main is not patched on every keystroke. */
function TextSetting({ value, onCommit, type = 'text', placeholder, mono, title }: { value: string; onCommit: (v: string) => void; type?: 'text' | 'password'; placeholder?: string; mono?: boolean; title?: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      className={`lin lgrow ${mono ? 'lin-mono' : ''}`}
      type={type}
      value={draft}
      placeholder={placeholder}
      title={title}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

function NumberSetting({ value, min, max, onChange, title }: { value: number; min: number; max: number; onChange: (v: number) => void; title?: string }) {
  return (
    <input
      className="lin"
      type="number"
      value={value}
      min={min}
      max={max}
      title={title}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))))
      }}
    />
  )
}

function DeckCard({ settings: s }: { settings: DeckSettings }) {
  const appearance = (label: string, value: Appearance, Icon: typeof Sun) => (
    <button className={`seg ${s.appearance === value ? 'on' : ''}`} onClick={() => patchSettings({ appearance: value })} title={value === 'system' ? `Follow macOS (${systemDark() ? 'dark' : 'light'} now)` : label}>
      <Icon size={13} />
      {label}
    </button>
  )
  const width = (label: string, value: DeckSettings['focusWidth'], hint: string) => (
    <button className={`seg ${s.focusWidth === value ? 'on' : ''}`} onClick={() => patchSettings({ focusWidth: value })} title={hint}>
      {label}
    </button>
  )
  const inCatalog = MODELS.some((m) => m.id === s.defaultModel)
  return (
    <Card title="Deck" note="the window and its defaults">
      <div className="lset">
        <span className="lset-label">Theme</span>
        <div className="lrow">
          <select className="lin lgrow" value={s.theme} onChange={(e) => patchSettings({ theme: e.target.value })}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <span className="lset-label">Appearance</span>
        <div className="segmented">
          {appearance('Light', 'light', Sun)}
          {appearance('Dark', 'dark', Moon)}
          {appearance('System', 'system', Monitor)}
        </div>
        <span className="lset-label">Center width</span>
        <div className="segmented">
          {width('⅓', 'third', 'The focus pane takes a third of the width')}
          {width('⅖', 'twoFifths', 'Two fifths')}
          {width('½', 'half', 'Half')}
        </div>
        <span className="lset-label">Grid</span>
        <div className="lrow">
          <select className="lin" value={s.gridColumns} title="Tile columns each side of the center" onChange={(e) => patchSettings({ gridColumns: Number(e.target.value) })}>
            {[1, 2].map((n) => (
              <option key={n} value={n}>
                {n} column{n === 1 ? '' : 's'} a side
              </option>
            ))}
          </select>
          <select className="lin" value={s.gridRows} title="Tile rows" onChange={(e) => patchSettings({ gridRows: Number(e.target.value) })}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} rows
              </option>
            ))}
          </select>
        </div>
        <span className="lset-label">Default folder</span>
        <div className="lrow">
          <TextSetting value={s.defaultCwd} mono placeholder="~" title="Where ⌘N starts when nothing is focused" onCommit={(v) => patchSettings({ defaultCwd: v })} />
          <button
            className="lbtn"
            title="Pick it"
            onClick={async () => {
              const d = await window.deck.chooseDefaultCwd()
              if (d) patchSettings({ defaultCwd: d })
            }}
          >
            <FolderOpen size={13} />
          </button>
        </div>
        <span className="lset-label">Default model</span>
        <div className="lrow">
          <select className="lin lgrow" value={s.defaultModel} title="What ⌘N hands to --model, and where the chooser starts" onChange={(e) => patchSettings({ defaultModel: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id} title={m.hint}>
                {m.label}
              </option>
            ))}
            {!inCatalog && s.defaultModel && <option value={s.defaultModel}>{s.defaultModel}</option>}
          </select>
        </div>
      </div>
      <div className="llist">
        <Check label="Worktree by default" hint="New sessions get --worktree unless told otherwise" value={s.worktreeByDefault} onChange={(v) => patchSettings({ worktreeByDefault: v })} />
        <Check label="Sessions needing you first" hint="A session waiting on you jumps to the front of the grid" value={s.attentionFirst} onChange={(v) => patchSettings({ attentionFirst: v })} />
        <Check label="Ask before killing a session" value={s.confirmKill} onChange={(v) => patchSettings({ confirmKill: v })} />
        <Check label="Compact mode" hint="Tighter chrome, smaller heads, the first two mini apps hidden (⌘⇧M)" value={s.compact} onChange={(v) => patchSettings({ compact: v })} />
        <Check label="Fox barks" hint="Foxtrot's silent comic bursts when a session needs you or finishes a turn" value={s.foxBark} onChange={(v) => patchSettings({ foxBark: v })} />
        <Check label="Phone" hint="Serve the phone page on the tailnet (the phone button in the top bar pairs one)" value={s.remote} onChange={(v) => patchSettings({ remote: v })} />
      </div>
    </Card>
  )
}

function TerminalCard({ settings: s }: { settings: DeckSettings }) {
  const cursor = (label: string, value: DeckSettings['cursorStyle']) => (
    <button className={`seg ${s.cursorStyle === value ? 'on' : ''}`} onClick={() => patchSettings({ cursorStyle: value })}>
      {label}
    </button>
  )
  return (
    <Card title="Terminal" note="the focus pane's xterm">
      <div className="lset">
        <span className="lset-label">Font</span>
        <div className="lrow">
          <TextSetting value={s.fontFamily} mono title="A monospace family installed on this Mac" onCommit={(v) => patchSettings({ fontFamily: v })} />
        </div>
        <span className="lset-label">Size</span>
        <div className="lrow">
          <NumberSetting value={s.focusFontSize} min={9} max={24} title="Focus pane" onChange={(v) => patchSettings({ focusFontSize: v })} />
          <span className="lmuted">focus</span>
          <NumberSetting value={s.tileFontSize} min={6} max={14} title="Tiles" onChange={(v) => patchSettings({ tileFontSize: v })} />
          <span className="lmuted">tiles</span>
        </div>
        <span className="lset-label">Cursor</span>
        <div className="segmented">
          {cursor('bar', 'bar')}
          {cursor('block', 'block')}
          {cursor('underline', 'underline')}
        </div>
        <span className="lset-label">Scrollback</span>
        <div className="lrow">
          <NumberSetting value={s.scrollback} min={0} max={100_000} title="Lines kept above the screen" onChange={(v) => patchSettings({ scrollback: v })} />
          <span className="lmuted">lines</span>
        </div>
      </div>
      <div className="llist">
        <Check label="Cursor blinks" value={s.cursorBlink} onChange={(v) => patchSettings({ cursorBlink: v })} />
      </div>
    </Card>
  )
}

function KeysCard({ settings: s }: { settings: DeckSettings }) {
  return (
    <Card title="Keys & services" note="config.json; env fallbacks in the login shell">
      <div className="lset">
        <span className="lset-label">Gemini</span>
        <div className="lrow">
          <TextSetting type="password" value={s.geminiApiKey} placeholder="$GEMINI_API_KEY" title="The Studio's key (aistudio.google.com → Get API key)" onCommit={(v) => patchSettings({ geminiApiKey: v })} />
        </div>
        <span className="lset-label">Studio model</span>
        <div className="lrow">
          <TextSetting value={s.studioModel} mono placeholder="gemini-3.1-flash-image" title="The Gemini image model a request that names none generates with" onCommit={(v) => patchSettings({ studioModel: v })} />
        </div>
        <span className="lset-label">Translation</span>
        <div className="lrow">
          <TextSetting type="password" value={s.translateApiKey} placeholder="$GOOGLE_CLOUD_API_KEY" title="Google Cloud Translation v2: the translator and the vocabulary counterpart" onCommit={(v) => patchSettings({ translateApiKey: v })} />
        </div>
        <span className="lset-label">Spotify app</span>
        <div className="lrow">
          <TextSetting value={s.spotifyClientId} mono placeholder="client id (32 hex)" title="A Spotify app's client id (developer.spotify.com) for connecting an account; the redirect must be registered there" onCommit={(v) => patchSettings({ spotifyClientId: v })} />
        </div>
        <span className="lset-label">languagelog</span>
        <div className="lrow">
          <TextSetting value={s.languagelogDb} mono placeholder="~/languagelog/….db" title="languagelog's SQLite file; its short translations join the vocabulary supply" onCommit={(v) => patchSettings({ languagelogDb: v })} />
        </div>
        <span className="lset-label">Word every</span>
        <div className="lrow">
          <NumberSetting value={s.vocabCycleSeconds} min={5} max={600} title="Seconds each vocabulary word stays" onChange={(v) => patchSettings({ vocabCycleSeconds: v })} />
          <span className="lmuted">seconds</span>
        </div>
      </div>
    </Card>
  )
}

// ---- shortcuts --------------------------------------------------------------------

const KEYS: [string, string][] = [
  ['⌘N', 'new session'],
  ['⌘⇧N', 'new session in a worktree'],
  ['⌘O', 'new session in a folder…'],
  ['⌘1–9 · ⌘0', 'focus slot 1–9 · 10'],
  ['⌘↩', 'jump to the session that needs you'],
  ['⌘] · ⌘[', 'next · previous session'],
  ['⌘W', 'park the focused session'],
  ['⌘⇧I', 'the Studio'],
  ['⌘J', "Foxtrot's log"],
  ['⌘,', 'theme'],
  ['⌘⇧L', 'light / dark'],
  ['⌘⇧M', 'compact mode'],
  ['⌘R', 'refresh the UI (sessions keep running)']
]

function ShortcutsCard() {
  return (
    <Card title="Shortcuts" note="also in the menu bar">
      <div className="lkeys">
        {KEYS.map(([k, what]) => (
          <div key={k}>
            <span>{what}</span>
            <kbd>{k}</kbd>
          </div>
        ))}
      </div>
    </Card>
  )
}
