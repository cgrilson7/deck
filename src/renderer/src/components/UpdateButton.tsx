import { useEffect, useState } from 'react'
import { Download, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { DeckUpdate } from '@shared/types'

/**
 * The top bar's "install update", beside refresh UI: shown only when the repo the app was
 * built from has changed since (main/updates.ts). A click builds (`npm run dist`), swaps the new
 * app in and relaunches; sessions live in tmux and carry on.
 */
export function UpdateButton() {
  const [u, setU] = useState<DeckUpdate>({ state: 'none' })
  useEffect(() => {
    let live = true
    void window.deck.update().then((x) => live && setU(x))
    const off = window.deck.onUpdate(setU)
    return () => {
      live = false
      off()
    }
  }, [])
  if (u.state === 'none') return null
  const busy = u.state === 'building' || u.state === 'installing'
  const built = u.builtAt ? new Date(u.builtAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  const title =
    u.state === 'available'
      ? `${u.repo ?? 'The repo'} has changes this app does not${built ? ` (built ${built})` : ''}. Builds it (npm run dist), installs the new app and relaunches; sessions keep running.`
      : u.state === 'building'
        ? 'Building the new deck (npm run dist)… The window relaunches when it is done.'
        : u.state === 'installing'
          ? 'Installing and relaunching…'
          : `The update failed — click to try again.\n\n${u.error ?? ''}`
  return (
    <button
      className={`bar-btn update-btn is-${u.state}`}
      disabled={busy}
      onClick={() => void window.deck.command({ type: 'installUpdate' })}
      title={title}
    >
      {busy ? <LoaderCircle size={13} className="spin" /> : u.state === 'error' ? <TriangleAlert size={13} /> : <Download size={13} />}
      <span>{u.state === 'building' ? 'building…' : u.state === 'installing' ? 'installing…' : u.state === 'error' ? 'update failed' : 'install update'}</span>
    </button>
  )
}
