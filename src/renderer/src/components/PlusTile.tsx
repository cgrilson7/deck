import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Atom, ListChecks, CircleDollarSign, HeartPulse, PawPrint, BookOpen, FilePen, FolderTree, Gamepad2, GitBranch, HardDrive, Globe, GraduationCap, Languages, Layers, Music, PersonStanding, Plus, Radio, ArrowDown, ArrowUp, Sparkles, Trash2, Wallpaper, X, type LucideIcon } from 'lucide-react'
import { PLUGIN_KEYS, WEB_APPS_MAX, cleanWebUrl, lessonKey, molKey, nextLessonTile, nextMolTile, pluginCells, webAppId, webKey, type DeckSettings, type DeckState, type PluginKey, type WebApp } from '@shared/types'
import type { GridSide } from '@shared/gridorder'
import { patchSettings, useSettings } from '../lib/theme'
import { writeSnap } from '../lib/webapps'
import { forgetApp, goToTile, useAppUse } from '../lib/appuse'
import { ParkedCard, StartCard } from './SessionForm'

/** What the picker hands the grid: a mini app's key, or a web app's grid key (`web:<id>`). */
export type Placed = PluginKey | `web:${string}`

/** The mini apps an empty cell can hold, with the setting that shows each. */
export const PLUGINS: {
  key: PluginKey
  label: string
  /** One or two short lines: what the tile is, for the picker's card and the tile's tooltip. */
  hint: string
  icon: LucideIcon
  /** The card's colour in the picker (`.hue-<name>` in styles.css, off the theme's terminal palette), so the grid reads at a glance. */
  hue: string
  setting: keyof DeckSettings
}[] = [
  {
    key: 'wiki',
    label: 'Wikipedia',
    hint: 'The picture of the day, a clock with the weather, and a search box for English Wikipedia',
    icon: Wallpaper,
    hue: 'blue',
    setting: 'showWiki'
  },
  {
    key: 'music',
    label: 'Music',
    hint: 'What Spotify.app is playing, with your playlists as chips — or the lofi stream',
    icon: Music,
    hue: 'magenta',
    setting: 'showMusic'
  },
  {
    key: 'studio',
    label: 'Studio',
    hint: 'Gemini image generation: a prompt, reference images and the gallery; opens full size',
    icon: Sparkles,
    hue: 'yellow',
    setting: 'showStudio'
  },
  {
    key: 'pokemon',
    label: 'Pokemon',
    hint: 'A Game Boy Color in a tile; click it to play in the center column',
    icon: Gamepad2,
    hue: 'red',
    setting: 'showPokemon'
  },
  {
    key: 'git',
    label: 'Changes',
    hint: "The focused session's working tree: changed files, line counts, and each file's diff",
    icon: GitBranch,
    hue: 'green',
    setting: 'showGit'
  },
  {
    key: 'files',
    label: 'Files',
    hint: 'A plain directory tree of the whole disk: unfold folders in place, click a file to read it in the center',
    icon: FolderTree,
    hue: 'stone',
    setting: 'showFiles'
  },
  {
    key: 'editor',
    label: 'Editor',
    hint: 'A plain text editor for the file picked in the Files tree (an .env, a config): edit, ⌘S saves',
    icon: FilePen,
    hue: 'stone',
    setting: 'showEditor'
  },
  {
    key: 'vocab',
    label: 'Vocabulary',
    hint: 'A Spanish word every 30 seconds, with flash cards and a review list of what you saved',
    icon: Layers,
    hue: 'rose',
    setting: 'showVocab'
  },
  {
    key: 'translate',
    label: 'Translator',
    hint: 'Type English or Spanish and get the other; each translation goes to your vocabulary',
    icon: Languages,
    hue: 'cyan',
    setting: 'showTranslate'
  },
  {
    key: 'quixote',
    label: 'Reader',
    hint: 'La Odisea or Don Quijote in Spanish: select to translate, save words as flash cards',
    icon: BookOpen,
    hue: 'violet',
    setting: 'showQuixote'
  },
  {
    key: 'mol',
    label: 'Molecule',
    hint: 'A 3D viewer for molecules and proteins, which a session can drive while it teaches',
    icon: Atom,
    hue: 'teal',
    setting: 'showMol'
  },
  {
    key: 'lesson',
    label: 'Lesson',
    hint: 'A lesson file as cards — sources, figures, molecule buttons, questions you answer here',
    icon: GraduationCap,
    hue: 'lime',
    setting: 'showLesson'
  },
  {
    key: 'posture',
    label: 'Posture',
    hint: 'Your camera watches how you sit: a good-posture streak, and a bark after ten seconds of slouching',
    icon: PersonStanding,
    hue: 'sky',
    setting: 'showPosture'
  },
  {
    key: 'foxtrot',
    label: 'Foxtrot',
    hint: 'Foxtrot in a field: he runs while a session works, rests when none does, and leaps and barks when you slouch',
    icon: PawPrint,
    hue: 'orange',
    setting: 'showFoxtrot'
  },
  {
    key: 'space',
    label: 'Space',
    hint: 'Your disk: free space, and what ~/space found to delete, archive to iCloud or keep. Nothing moves until you say so',
    icon: HardDrive,
    hue: 'stone',
    setting: 'showSpace'
  },
  {
    key: 'broadcast',
    label: 'Broadcast',
    hint: 'A live MLB gamecast: score, count, bases, every pitch and the play-by-play, with ESPN Radio a click away',
    icon: Radio,
    hue: 'navy',
    setting: 'showBroadcast'
  },
  {
    key: 'spend',
    label: 'Spend',
    hint: 'What Claude Code has cost in the last hour, 8 hours, day and week, by project, at API list prices, with each project\'s ledger',
    icon: CircleDollarSign,
    hue: 'lime',
    setting: 'showSpend'
  },
  {
    key: 'sleepgod',
    label: 'Sleepgod',
    hint: "Your ring's heart rate, steps, skin temperature and last night's sleep, from the sleepgod server on this Mac",
    icon: HeartPulse,
    hue: 'rose',
    setting: 'showSleepgod'
  },
  {
    key: 'reminders',
    label: 'Reminders',
    hint: 'To do, notes and a running log of what got done, by project. Any Claude session can write to it',
    icon: ListChecks,
    hue: 'amber',
    setting: 'showReminders'
  }
]

/**
 * The + at the foot of each grid column: click opens the PICKER, a modal over the window, and
 * what it offers is the column's job. RIGHT (entertainment): a row of pills for the mini apps
 * (turned on if off, and moved to the foot of the column) and the web apps. LEFT (work), below
 * the cap: THE LAUNCHER'S SESSION FORM (`StartCard`: the focused session's folder first, recents,
 * a folder dialog or a new project, worktree / model / permission mode, a name, a first prompt)
 * and its parked sessions (`ParkedCard`). ⌘N in the menu bar is the no-questions path.
 */
export function PlusTile({ side, state, onPlace, canAdd }: { side: GridSide; state: DeckState; /** A mini app picked: the grid puts it at the foot of this +'s column (`add` = a web app registered just now). */ onPlace: (key: Placed, add?: WebApp) => void; /** False at the session cap: the left + has only a note to show. */ canAdd: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="tile tile-plus">
      <button className="plus" title={side === 'right' ? 'A mini app or a web app here…' : canAdd ? 'New session here… (⌘N starts one without asking)' : 'Every session slot is open'} onClick={() => setOpen(true)}>
        +
      </button>
      {open && createPortal(<Picker side={side} state={state} onPlace={onPlace} canAdd={canAdd} onClose={() => setOpen(false)} />, document.body)}
    </div>
  )
}

function Picker({ side, state, onPlace, canAdd, onClose }: { side: GridSide; state: DeckState; onPlace: (key: Placed, add?: WebApp) => void; canAdd: boolean; onClose: () => void }) {
  const cwd = state.open.find((s) => s.slot === state.focusSlot)?.cwd
  const settings = useSettings()
  const shown = new Set(pluginCells(settings))
  const use = useAppUse()
  /** A mini app or web app here: turned on if it was off, and moved to the foot of this column either way. */
  const place = (key: Placed) => {
    onClose()
    onPlace(key)
  }
  /** Close and bring that tile into view in the grid. */
  const goTo = (key: string) => {
    onClose()
    requestAnimationFrame(() => goToTile(key))
  }

  // ONE LIST of every mini app and web app, sorted by a header (last used, newest first, by default).
  const [sort, setSort] = useState<Sort>({ by: 'used', desc: true })
  const rows: Row[] = [
    ...PLUGINS.filter((p) => PLUGIN_KEYS.includes(p.key)).map((p) => ({
      key: p.key as Placed,
      label: p.label,
      hint: p.hint,
      icon: p.icon,
      hue: p.hue,
      open: shown.has(p.key),
      tile: p.key === 'mol' ? molKey(settings.molTiles[0] ?? 1) : p.key === 'lesson' ? lessonKey(settings.lessonTiles[0] ?? 1) : p.key,
      again: (p.key === 'mol' && nextMolTile(settings.molTiles) !== null) || (p.key === 'lesson' && nextLessonTile(settings.lessonTiles) !== null),
      created: use[p.key]?.created ?? 0,
      used: use[p.key]?.used ?? 0
    })),
    ...settings.webApps.map((a) => ({
      key: webKey(a.id) as Placed,
      id: a.id,
      label: a.name,
      hint: `${a.url.replace(/^https?:\/\/(www\.)?/, '')} — opens in the center column and stays signed in`,
      icon: Globe,
      hue: 'web',
      open: a.show,
      tile: webKey(a.id),
      again: false,
      created: use[webKey(a.id)]?.created ?? 0,
      used: use[webKey(a.id)]?.used ?? 0
    }))
  ].sort((a, b) => {
    const d = sort.by === 'name' ? a.label.localeCompare(b.label) : a[sort.by] - b[sort.by]
    return (sort.desc ? -d : d) || a.label.localeCompare(b.label)
  })

  // A web app: any site, by a name and a URL. Registered and placed in one step.
  const [webName, setWebName] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const url = cleanWebUrl(webUrl)
  const full = settings.webApps.length >= WEB_APPS_MAX
  const addWeb = () => {
    if (!url || full) return
    const name = webName.trim() || new URL(url).hostname.replace(/^www\./, '')
    const id = webAppId(name, settings.webApps.map((a) => a.id))
    onClose()
    onPlace(`web:${id}`, { id, name: name.slice(0, 40), url, show: true })
  }

  // Removing a web app asks first, on its own card: the id being asked about.
  const [removing, setRemoving] = useState<string | null>(null)
  const removeWeb = (id: string) => {
    setRemoving(null)
    forgetApp(webKey(id))
    writeSnap(id, '')
    patchSettings({ webApps: settings.webApps.filter((a) => a.id !== id) })
  }

  useEffect(() => {
    // Esc backs out of a removal first, then closes.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (removing ? setRemoving(null) : onClose())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, removing])

  return (
    <div className="picker-scrim" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className={`picker ${side === 'right' ? 'picker-wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Fill this cell">
        <header className="picker-head">
          <span className="picker-title">{side === 'right' ? 'A mini app here' : 'A session here'}</span>
          {side === 'left' && !canAdd && <span className="picker-note">every session slot is open</span>}
          <span className="spacer" />
          <button className="doc-btn" title="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        {side === 'right' && (
          <>
            <section className="picker-row">
              <div className="app-list" role="table" aria-label="Mini apps and web apps">
                <div className="app-row app-row-head" role="row">
                  <span />
                  <SortHead label="App" by="name" sort={sort} setSort={setSort} />
                  <SortHead label="Created" by="created" sort={sort} setSort={setSort} />
                  <SortHead label="Last used" by="used" sort={sort} setSort={setSort} />
                  <span className="app-col-state">In the grid</span>
                </div>
                {rows.map((r) =>
                  removing === r.id ? (
                    <div key={r.key} className="app-row app-row-confirm" role="alertdialog" aria-label={`Remove ${r.label}?`}>
                      <span className="app-icon hue-red">
                        <Trash2 size={16} strokeWidth={1.75} />
                      </span>
                      <span className="app-name">
                        <b>Remove {r.label}?</b>
                        <small>Its tile goes from the workshop. Its sign-in stays, so adding it again finds you signed in.</small>
                      </span>
                      <span className="app-actions">
                        <button className="pill picker-danger" autoFocus onClick={() => removeWeb(r.id!)}>
                          remove
                        </button>
                        <button className="pill" onClick={() => setRemoving(null)}>
                          cancel
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div key={r.key} className={`app-row ${r.open ? 'on' : ''}`} role="row">
                      <span className={`app-icon hue-${r.hue}`}>
                        <r.icon size={16} strokeWidth={1.75} />
                      </span>
                      <span className="app-name" title={r.hint}>
                        <b>{r.label}</b>
                        <small>{r.hint}</small>
                      </span>
                      <span className="app-date" title={r.created ? new Date(r.created).toLocaleString() : 'Never in the grid'}>
                        {r.created ? when(r.created) : '—'}
                      </span>
                      <span className="app-date" title={r.used ? new Date(r.used).toLocaleString() : 'Never used'}>
                        {r.used ? when(r.used) : 'never'}
                      </span>
                      <span className="app-actions">
                        {r.open ? (
                          <>
                            <span className="app-open" title="This tile is in the grid">
                              <span className="app-dot" /> open
                            </span>
                            <button className="pill" title="Scroll the grid to this tile" onClick={() => goTo(r.tile)}>
                              go to
                            </button>
                            <button className="pill" title={r.again ? 'Another tile of it, at the foot of this column' : 'Move it to the foot of this column'} onClick={() => place(r.key)}>
                              {r.again ? 'another' : 'move here'}
                            </button>
                          </>
                        ) : (
                          <button className="pill" title="Add it at the foot of this column" onClick={() => place(r.key)}>
                            add here
                          </button>
                        )}
                        {r.id !== undefined && (
                          <button className="app-remove" title={`Remove ${r.label}…`} aria-label={`Remove ${r.label}`} onClick={() => setRemoving(r.id!)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </span>
                    </div>
                  )
                )}
              </div>
            </section>
            <section className="picker-row">
              <h4>Add a web app</h4>
              <div className="picker-grid">
                <form
                  className="picker-card hue-web web-add"
                  onSubmit={(e) => {
                    e.preventDefault()
                    addWeb()
                  }}
                >
                  <span className="picker-card-head">
                    <span className="picker-card-icon small">
                      <Plus size={18} />
                    </span>
                    <b>Any site</b>
                  </span>
                  <input value={webName} onChange={(e) => setWebName(e.target.value)} placeholder="name (optional)" maxLength={40} spellCheck={false} />
                  <span className="web-add-row">
                    <input className="web-add-url" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="maptap.gg" spellCheck={false} />
                    <button className="pill" type="submit" disabled={!url || full} title={full ? `${WEB_APPS_MAX} web apps at most` : 'A tile for this site; it opens in the center column and stays signed in'}>
                      add
                    </button>
                  </span>
                </form>
              </div>
            </section>
          </>
        )}
        {side === 'left' && canAdd && (
          <div className="launcher launcher-cards picker-cards">
            <StartCard state={state} settings={settings} canAdd={canAdd} focused={cwd} onStarted={onClose} />
            {state.parked.length > 0 && <ParkedCard state={state} canAdd={canAdd} onDone={onClose} />}
          </div>
        )}
      </div>
    </div>
  )
}

type Sort = { by: 'name' | 'created' | 'used'; desc: boolean }

interface Row {
  key: Placed
  /** A web app's id (it can be removed). */
  id?: string
  label: string
  hint: string
  icon: LucideIcon
  hue: string
  /** In the grid now. */
  open: boolean
  /** The grid key "go to" scrolls to (the first Molecule / Lesson tile). */
  tile: string
  /** Placing it again makes another tile (Molecule, Lesson). */
  again: boolean
  created: number
  used: number
}

/** A column head that sorts the list: a click picks it (dates newest first, names A–Z), again flips it. */
function SortHead({ label, by, sort, setSort }: { label: string; by: Sort['by']; sort: Sort; setSort: (s: Sort) => void }) {
  const on = sort.by === by
  return (
    <button className={`app-sort ${on ? 'on' : ''}`} onClick={() => setSort(on ? { by, desc: !sort.desc } : { by, desc: by !== 'name' })}>
      {label}
      {on && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </button>
  )
}

/** A date for the list: the time today, the weekday this week, else the day (and year when not this one). */
function when(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (now.getTime() - ms < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}
