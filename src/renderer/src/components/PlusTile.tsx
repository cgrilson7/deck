import { useEffect, useState } from 'react'
import type { DeckState } from '@shared/types'
import { MODELS, cleanModel } from '@shared/models'
import { shortPath } from '../lib/format'
import { useSettings } from '../lib/theme'

/**
 * The +: click opens the chooser (where to start: the focused session's folder, recent folders,
 * a folder picker; a worktree toggle; a model; parked sessions to resume). ⌘N in the menu bar
 * is the no-questions path (focused folder, default settings).
 */
export function PlusTile({ state }: { state: DeckState }) {
  const [menu, setMenu] = useState(false)

  return (
    <div className={`tile tile-plus ${menu ? 'menu-open' : ''}`}>
      <button className="plus" title="New session… (⌘N starts one here without asking)" onClick={() => setMenu(true)}>
        +
      </button>
      {menu && <PlusMenu state={state} onClose={() => setMenu(false)} />}
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

function PlusMenu({ state, onClose }: { state: DeckState; onClose: () => void }) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="menu" onClick={(e) => e.stopPropagation()}>
      <div className="menu-section">
        <div className="menu-title">Start in</div>
        {cwd && (
          <button onClick={(e) => start(e, cwd)} title={cwd}>
            <span className="cwd">{shortPath(cwd)}</span>
            <span className="menu-hint">focused</span>
          </button>
        )}
        {recent.map((dir) => (
          <button key={dir} onClick={(e) => start(e, dir)} title={dir}>
            <span className="cwd">{shortPath(dir)}</span>
            <span className="menu-hint">recent</span>
          </button>
        ))}
        {!cwd && recent.length === 0 && (
          <button onClick={(e) => start(e)} title="The default folder from Settings, else your home">
            <span className="cwd">Default folder</span>
          </button>
        )}
        <button onClick={() => run({ type: 'chooseFolder', worktree, model: model.value })}>Choose folder…</button>
        <label className="menu-check" title="Claude creates a git worktree under .claude/worktrees/ and works there (⌥-click any folder to flip this once)">
          <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
          in a new git worktree
        </label>
        <ModelPick pick={model} />
      </div>
      <div className="menu-section">
        <div className="menu-title">Parked{state.parked.length ? ` (${state.parked.length})` : ''}</div>
        {state.parked.length === 0 && <div className="menu-empty">Nothing parked. ⌘W parks the focused session.</div>}
        {state.parked.map((p) => (
          <div key={p.id} className="menu-row">
            <button className="menu-resume" onClick={() => run({ type: 'resume', id: p.id })} title={p.tmuxAlive ? 'Still running in tmux; reattach' : 'Resume with claude --resume'}>
              <span className={`dot ${p.tmuxAlive ? 'dot-idle' : 'dot-unknown'}`} />
              <span className="name">{p.name}</span>
              <span className="cwd">{shortPath(p.cwd)}</span>
            </button>
            <button className="menu-x" title="Forget (leaves tmux alone)" onClick={() => run({ type: 'forget', id: p.id })}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="menu-section">
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
