import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { PLUGIN_KEYS, pluginCells, type DeckSettings, type DeckState, type PluginKey } from '@shared/types'
import { MODELS, cleanModel } from '@shared/models'
import { shortPath } from '../lib/format'
import { patchSettings, useSettings } from '../lib/theme'

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
 * per choice: the mini apps (pinned to this cell), and below the cap a session (where to start:
 * the focused session's folder, recent folders, a folder picker; a worktree toggle; a model)
 * or a parked one to resume. Sessions are never pinned: they fill the grid in order, top left
 * down then top right down. ⌘N in the menu bar is the no-questions path.
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

/** The "Model" row of the + chooser: a select over the catalog, and a text field when "other…" is picked. */
function ModelPick({ pick }: { pick: ModelPickState }) {
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

function Picker({ state, cell, canAdd, onClose }: { state: DeckState; cell: number; canAdd: boolean; onClose: () => void }) {
  const cwd = state.open.find((s) => s.slot === state.focusSlot)?.cwd
  const settings = useSettings()
  const [worktree, setWorktree] = useState(false)
  const recent = state.recent.filter((d) => d !== cwd)
  const run = (cmd: Parameters<typeof window.deck.command>[0]) => {
    onClose()
    void window.deck.command(cmd)
  }
  const model = useModelPick(settings.defaultModel)
  /** ⌥-click flips the worktree toggle for that one pick. */
  const start = (e: React.MouseEvent, dir?: string) => run({ type: 'new', cwd: dir, worktree: e.altKey ? !worktree : worktree, model: model.value })
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
          <section className="picker-row">
            <h4>New session in</h4>
            <div className="pills">
              {cwd && (
                <button className="pill" onClick={(e) => start(e, cwd)} title={`${cwd} · ⌥-click flips the worktree toggle once`}>
                  {shortPath(cwd)}
                  <small>focused</small>
                </button>
              )}
              {recent.map((dir) => (
                <button key={dir} className="pill" onClick={(e) => start(e, dir)} title={`${dir} · ⌥-click flips the worktree toggle once`}>
                  {shortPath(dir)}
                  <small>recent</small>
                </button>
              ))}
              {!cwd && recent.length === 0 && (
                <button className="pill" onClick={(e) => start(e)} title="The default folder from Settings, else your home">
                  Default folder
                </button>
              )}
              <button className="pill" onClick={() => run({ type: 'chooseFolder', worktree, model: model.value })}>
                Choose folder…
              </button>
            </div>
            <div className="picker-opts">
              <label className={`pill pill-toggle ${worktree ? 'on' : ''}`} title="Claude creates a git worktree under .claude/worktrees/ and works there">
                <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
                in a new git worktree
              </label>
              <ModelPick pick={model} />
            </div>
          </section>
        )}
        {canAdd && state.parked.length > 0 && (
          <section className="picker-row">
            <h4>Parked ({state.parked.length})</h4>
            <div className="pills">
              {state.parked.map((p) => (
                <span key={p.id} className="pill pill-parked">
                  <button className="pill-main" onClick={() => run({ type: 'resume', id: p.id })} title={`${p.cwd} · ${p.tmuxAlive ? 'still running in tmux; reattach' : 'resume with claude --resume'}`}>
                    <span className={`dot ${p.tmuxAlive ? 'dot-idle' : 'dot-unknown'}`} />
                    {p.name}
                    <small>{shortPath(p.cwd)}</small>
                  </button>
                  <button className="pill-x" title="Forget (leaves tmux alone)" onClick={() => run({ type: 'forget', id: p.id })}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
