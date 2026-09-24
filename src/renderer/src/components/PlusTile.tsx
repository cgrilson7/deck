import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { PLUGIN_KEYS, WEB_APPS_MAX, cleanWebUrl, nextLessonTile, nextMolTile, pluginCells, webAppId, webKey, type DeckSettings, type DeckState, type PluginKey, type WebApp } from '@shared/types'
import type { GridSide } from '@shared/gridorder'
import { useSettings } from '../lib/theme'
import { ParkedCard, StartCard } from './SessionForm'

/** What the picker hands the grid: a mini app's key, or a web app's grid key (`web:<id>`). */
export type Placed = PluginKey | `web:${string}`

/** The mini apps an empty cell can hold, with the setting that shows each. */
export const PLUGINS: {
  key: PluginKey
  label: string
  hint: string
  setting: keyof DeckSettings
}[] = [
  {
    key: 'wiki',
    label: 'Wikipedia',
    hint: 'The picture of the day, a clock, and search',
    setting: 'showWiki'
  },
  {
    key: 'music',
    label: 'Music',
    hint: 'Spotify.app now playing, or the lofi stream',
    setting: 'showMusic'
  },
  {
    key: 'studio',
    label: 'Studio',
    hint: 'Gemini image generation: a prompt, references, a gallery; click for the full Studio',
    setting: 'showStudio'
  },
  {
    key: 'pokemon',
    label: 'Pokemon',
    hint: 'A Game Boy Color in a tile; click it to play in the center column',
    setting: 'showPokemon'
  },
  {
    key: 'git',
    label: 'Changes',
    hint: "The focused session's working tree and diffs",
    setting: 'showGit'
  },
  {
    key: 'vocab',
    label: 'Vocabulary',
    hint: 'A Spanish word a minute, flash cards, the review list',
    setting: 'showVocab'
  },
  {
    key: 'translate',
    label: 'Translator',
    hint: 'English ⇄ Spanish',
    setting: 'showTranslate'
  },
  {
    key: 'quixote',
    label: 'Reader',
    hint: 'Read La Odisea or Don Quijote in Spanish: select to translate, save words to the flash cards',
    setting: 'showQuixote'
  },
  {
    key: 'mol',
    label: 'Molecule',
    hint: 'A 3D molecule viewer: small molecules and proteins, which a session can drive (/deck:mol)',
    setting: 'showMol'
  },
  {
    key: 'lesson',
    label: 'Lesson',
    hint: 'A lesson from the focused folder as cards: sources, figures, molecule buttons, questions you answer here; a session drives it (/deck:lesson)',
    setting: 'showLesson'
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="picker-scrim" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Fill this cell">
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
              <div className="pills">
                {PLUGINS.filter((p) => PLUGIN_KEYS.includes(p.key)).map((p) => (
                  <button key={p.key} className="pill" onClick={() => place(p)} title={p.hint}>
                    {p.label}
                    {shown.has(p.key) && <small>{(p.key === 'mol' && nextMolTile(settings.molTiles) !== null) || (p.key === 'lesson' && nextLessonTile(settings.lessonTiles) !== null) ? 'another here' : 'move here'}</small>}
                  </button>
                ))}
              </div>
            </section>
            <section className="picker-row">
              <h4>Web app</h4>
              <div className="pills">
                {settings.webApps.map((a) => (
                  <button
                    key={a.id}
                    className="pill"
                    title={a.url}
                    onClick={() => {
                      onClose()
                      onPlace(webKey(a.id) as Placed)
                    }}
                  >
                    {a.name}
                    {a.show && <small>move here</small>}
                  </button>
                ))}
                <form
                  className="web-add"
                  onSubmit={(e) => {
                    e.preventDefault()
                    addWeb()
                  }}
                >
                  <input value={webName} onChange={(e) => setWebName(e.target.value)} placeholder="name" maxLength={40} spellCheck={false} />
                  <input className="web-add-url" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="maptap.gg" spellCheck={false} />
                  <button className="pill" type="submit" disabled={!url || full} title={full ? `${WEB_APPS_MAX} web apps at most` : 'A tile for this site; it opens in the center column and stays signed in'}>
                    add
                  </button>
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
