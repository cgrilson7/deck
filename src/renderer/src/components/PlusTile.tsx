import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Atom, BookOpen, Gamepad2, GitBranch, Globe, GraduationCap, Languages, Layers, Music, PersonStanding, Plus, Sparkles, Trash2, Wallpaper, X, type LucideIcon } from 'lucide-react'
import { PLUGIN_KEYS, WEB_APPS_MAX, cleanWebUrl, nextLessonTile, nextMolTile, pluginCells, webAppId, webKey, type DeckSettings, type DeckState, type PluginKey, type WebApp } from '@shared/types'
import type { GridSide } from '@shared/gridorder'
import { patchSettings, useSettings } from '../lib/theme'
import { writeSnap } from '../lib/webapps'
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
    key: 'vocab',
    label: 'Vocabulary',
    hint: 'A Spanish word every 30 seconds, with flash cards and a review list of what you saved',
    icon: Layers,
    hue: 'orange',
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
  /** A mini app here: turned on if it was off, and moved to the foot of this column either way. */
  const place = (p: (typeof PLUGINS)[number]) => {
    onClose()
    onPlace(p.key)
  }

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
              <h4>Mini app</h4>
              <div className="picker-grid">
                {PLUGINS.filter((p) => PLUGIN_KEYS.includes(p.key)).map((p) => {
                  const Icon = p.icon
                  const again = (p.key === 'mol' && nextMolTile(settings.molTiles) !== null) || (p.key === 'lesson' && nextLessonTile(settings.lessonTiles) !== null)
                  return (
                    <button key={p.key} className={`picker-card hue-${p.hue} ${shown.has(p.key) ? 'on' : ''}`} onClick={() => place(p)}>
                      <span className="picker-card-icon">
                        <Icon size={28} strokeWidth={1.75} />
                      </span>
                      <span className="picker-card-text">
                        <span className="picker-card-head">
                          <b>{p.label}</b>
                          {shown.has(p.key) && <small>{again ? 'another here' : 'move here'}</small>}
                        </span>
                        <span className="picker-card-desc">{p.hint}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
            <section className="picker-row">
              <h4>Web app</h4>
              <div className="picker-grid">
                {settings.webApps.map((a) =>
                  removing === a.id ? (
                    <div key={a.id} className="picker-card hue-red picker-confirm" role="alertdialog" aria-label={`Remove ${a.name}?`}>
                      <span className="picker-card-icon">
                        <Trash2 size={24} strokeWidth={1.75} />
                      </span>
                      <span className="picker-card-text">
                        <span className="picker-card-head">
                          <b>Remove {a.name}?</b>
                        </span>
                        <span className="picker-card-desc">Its tile goes from the deck. Its sign-in stays, so adding it again finds you signed in.</span>
                        <span className="picker-confirm-row">
                          <button className="pill picker-danger" autoFocus onClick={() => removeWeb(a.id)}>
                            remove
                          </button>
                          <button className="pill" onClick={() => setRemoving(null)}>
                            cancel
                          </button>
                        </span>
                      </span>
                    </div>
                  ) : (
                    <div key={a.id} className="picker-card-wrap">
                      <button
                        className={`picker-card hue-web ${a.show ? 'on' : ''}`}
                        title={a.url}
                        onClick={() => {
                          onClose()
                          onPlace(webKey(a.id) as Placed)
                        }}
                      >
                        <span className="picker-card-icon">
                          <Globe size={28} strokeWidth={1.75} />
                        </span>
                        <span className="picker-card-text">
                          <span className="picker-card-head">
                            <b>{a.name}</b>
                            {a.show && <small>move here</small>}
                          </span>
                          <span className="picker-card-desc">{a.url.replace(/^https?:\/\/(www\.)?/, '')} — opens in the center column and stays signed in</span>
                        </span>
                      </button>
                      <button className="picker-card-remove" title={`Remove ${a.name}…`} aria-label={`Remove ${a.name}`} onClick={() => setRemoving(a.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                )}
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
