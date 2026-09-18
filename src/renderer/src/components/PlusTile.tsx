import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { PLUGIN_KEYS, pluginCells, type DeckSettings, type DeckState, type PluginKey } from '@shared/types'
import { patchSettings, useSettings } from '../lib/theme'
import { ParkedCard, StartCard } from './SessionForm'

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
  }
]

/** `gridLayout` with `key` pinned at `cell` and nowhere else. */
export function pinned(layout: string[], cell: number, key: string): string[] {
  const out = layout.map((k) => (k === key ? '' : k))
  while (out.length <= cell) out.push('')
  out[cell] = key
  return out
}

/**
 * The + in every empty cell: click opens the PICKER, a modal over the window — a row of pills
 * for the mini apps (pinned to this cell), and below the cap THE LAUNCHER'S SESSION FORM
 * (`StartCard`: the focused session's folder first, recents, a folder dialog or a new project,
 * worktree / model / permission mode, a name, a first prompt) and its parked sessions
 * (`ParkedCard`). Sessions are never pinned: they fill the grid in order, top left down then
 * top right down. ⌘N in the menu bar is the no-questions path.
 */
export function PlusTile({ state, cell, canAdd }: { state: DeckState; /** The grid cell this + sits in. */ cell: number; /** False at the session cap: only mini apps are offered. */ canAdd: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="tile tile-plus">
      <button className="plus" title={canAdd ? 'New session or mini app here… (⌘N starts a session without asking)' : 'A mini app here… (every session slot is open)'} onClick={() => setOpen(true)}>
        +
      </button>
      {open && createPortal(<Picker state={state} cell={cell} canAdd={canAdd} onClose={() => setOpen(false)} />, document.body)}
    </div>
  )
}

function Picker({ state, cell, canAdd, onClose }: { state: DeckState; cell: number; canAdd: boolean; onClose: () => void }) {
  const cwd = state.open.find((s) => s.slot === state.focusSlot)?.cwd
  const settings = useSettings()
  const shown = new Set(pluginCells(settings))
  /** A mini app here: turned on if it was off, and pinned to this cell either way. */
  const place = (p: (typeof PLUGINS)[number]) => {
    onClose()
    patchSettings({ [p.setting]: true, gridLayout: pinned(settings.gridLayout, cell, p.key) } as Partial<DeckSettings>)
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
          <span className="picker-title">{canAdd ? 'A session or a mini app here' : 'A mini app here'}</span>
          {!canAdd && <span className="picker-note">every session slot is open</span>}
          <span className="spacer" />
          <button className="doc-btn" title="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <section className="picker-row">
          <h4>Mini app</h4>
          <div className="pills">
            {PLUGINS.filter((p) => PLUGIN_KEYS.includes(p.key)).map((p) => (
              <button key={p.key} className="pill" onClick={() => place(p)} title={p.hint}>
                {p.label}
                {shown.has(p.key) && <small>move here</small>}
              </button>
            ))}
          </div>
        </section>
        {canAdd && (
          <div className="launcher launcher-cards picker-cards">
            <StartCard state={state} settings={settings} canAdd={canAdd} focused={cwd} onStarted={onClose} />
            {state.parked.length > 0 && <ParkedCard state={state} canAdd={canAdd} onDone={onClose} />}
          </div>
        )}
      </div>
    </div>
  )
}
