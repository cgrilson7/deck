import { useEffect, useState } from 'react'
import type { DeckState } from '@shared/types'
import { shortPath } from '../lib/format'

/**
 * The +: click opens the chooser (where to start: the focused session's folder, recent folders,
 * a folder picker; a worktree toggle; parked sessions to resume). ⌘N in the menu bar is the
 * no-questions path (focused folder, default settings).
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

function PlusMenu({ state, onClose }: { state: DeckState; onClose: () => void }) {
  const cwd = state.open.find((s) => s.slot === state.focusSlot)?.cwd
  const [worktree, setWorktree] = useState(false)
  const recent = state.recent.filter((d) => d !== cwd)
  const run = (cmd: Parameters<typeof window.deck.command>[0]) => {
    onClose()
    void window.deck.command(cmd)
  }
  /** ⌥-click flips the worktree toggle for that one pick. */
  const start = (e: React.MouseEvent, dir?: string) => run({ type: 'new', cwd: dir, worktree: e.altKey ? !worktree : worktree })

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
        <button onClick={() => run({ type: 'chooseFolder', worktree })}>Choose folder…</button>
        <label className="menu-check" title="Claude creates a git worktree under .claude/worktrees/ and works there (⌥-click any folder to flip this once)">
          <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
          in a new git worktree
        </label>
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
