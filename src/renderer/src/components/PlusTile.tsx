import { useEffect, useRef, useState } from 'react'
import type { DeckState } from '@shared/types'
import { shortPath } from '../lib/format'

const LONG_PRESS_MS = 450

/**
 * The +: click = new session here; ⌥-click = new session in a worktree;
 * right-click or long-press = menu (folder picker + parked sessions to resume).
 */
export function PlusTile({ state }: { state: DeckState }) {
  const [menu, setMenu] = useState(false)
  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const cwd = state.open.find((s) => s.slot === state.focusSlot)?.cwd

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => cancel, [])

  return (
    <div className={`tile tile-plus ${menu ? 'menu-open' : ''}`}>
      <button
        className="plus"
        title={`New session${cwd ? ` in ${shortPath(cwd)}` : ''} (⌘N) · ⌥-click for a worktree · hold for more`}
        onPointerDown={() => {
          longPressed.current = false
          cancel()
          timer.current = window.setTimeout(() => {
            longPressed.current = true
            setMenu(true)
          }, LONG_PRESS_MS)
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu(true)
        }}
        onClick={(e) => {
          if (longPressed.current) return
          void window.deck.command({ type: 'new', worktree: e.altKey })
        }}
      >
        +
      </button>
      {menu && <PlusMenu state={state} onClose={() => setMenu(false)} />}
    </div>
  )
}

function PlusMenu({ state, onClose }: { state: DeckState; onClose: () => void }) {
  const cwd = state.open.find((s) => s.slot === state.focusSlot)?.cwd
  const run = (cmd: Parameters<typeof window.deck.command>[0]) => {
    onClose()
    void window.deck.command(cmd)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="menu" onClick={(e) => e.stopPropagation()}>
      <div className="menu-section">
        <button onClick={() => run({ type: 'new' })}>New session{cwd ? ` in ${shortPath(cwd)}` : ''}</button>
        <button onClick={() => run({ type: 'new', worktree: true })}>New session in a worktree</button>
        <button onClick={() => run({ type: 'chooseFolder' })}>New session in folder…</button>
      </div>
      {state.recent.length > 0 && (
        <div className="menu-section">
          <div className="menu-title">Recent folders</div>
          {state.recent.map((dir) => (
            <button key={dir} className="menu-recent" title={`${dir} · ⌥-click for a worktree`} onClick={(e) => run({ type: 'new', cwd: dir, worktree: e.altKey })}>
              <span className="cwd">{shortPath(dir)}</span>
            </button>
          ))}
        </div>
      )}
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
