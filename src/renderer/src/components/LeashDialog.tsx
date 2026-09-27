import { useEffect, useRef, useState } from 'react'
import { Fox } from './Fox'
import type { LeashAsk } from '../lib/leash'

/**
 * The leash's one dialog, for a PAUSE: an optional note typed into the alpha. (A kill asks
 * nothing: the ✕ does it at once.) A modal over the window, like the picker; ⏎ pauses, Esc closes.
 */
export function LeashDialog({ ask, onClose }: { ask: LeashAsk; onClose: () => void }) {
  const { target } = ask
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    box.current?.focus()
  }, [])

  const send = () => {
    if (busy) return
    setBusy(true)
    void window.deck.command({ type: 'leashPause', id: target.id, note: text.trim() || undefined }).finally(onClose)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="picker-scrim" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="picker leash" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown} role="dialog" aria-label="Pause this agent">
        <header className="picker-head">
          <Fox anim="sleep" scale={1} coat="gold" />
          <span className="picker-title">
            Pause {target.kind === 'beta' ? 'beta' : 'agent'} “{target.name}”
          </span>
          <span className="picker-note">{target.detail}</span>
        </header>
        <p className="leash-why">
          {target.kind === 'beta'
            ? 'Its next tool call waits until you resume it. A note is typed into the alpha; leave it empty to pause quietly.'
            : 'Its next tool call waits in the deck until you resume it. A note is typed into the alpha; leave it empty to pause quietly.'}
        </p>
        <textarea ref={box} className="leash-text" rows={3} value={text} spellCheck placeholder="A note for the alpha (optional)" onChange={(e) => setText(e.target.value)} />
        <div className="leash-actions">
          <span className="picker-note">⏎ to pause · ⇧⏎ newline · Esc closes</span>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            keep going
          </button>
          <button className="leash-go" disabled={busy} onClick={send}>
            pause
          </button>
        </div>
      </div>
    </div>
  )
}
