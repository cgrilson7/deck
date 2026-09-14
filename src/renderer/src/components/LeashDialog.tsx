import { useEffect, useRef, useState } from 'react'
import { Fox } from './Fox'
import type { LeashAsk } from '../lib/leash'

/**
 * The one place a reason is typed: cancelling a pack member asks why (the alpha is told, and
 * acts on it: a tweaked relaunch, a fold into another track, or a drop), pausing asks for an
 * optional note. A modal over the window, like the picker; ⏎ sends, Esc closes.
 */
export function LeashDialog({ ask, onClose }: { ask: LeashAsk; onClose: () => void }) {
  const { target, action } = ask
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    box.current?.focus()
  }, [])

  const cancel = action === 'cancel'
  const canSend = !busy && (!cancel || text.trim().length > 0)
  const send = () => {
    if (!canSend) return
    setBusy(true)
    const cmd = cancel ? ({ type: 'leashCancel', id: target.id, reason: text.trim() } as const) : ({ type: 'leashPause', id: target.id, note: text.trim() || undefined } as const)
    void window.deck.command(cmd).finally(onClose)
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
      <div className="picker leash" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown} role="dialog" aria-label={cancel ? 'Cancel this agent' : 'Pause this agent'}>
        <header className="picker-head">
          <Fox anim={cancel ? 'alert' : 'sleep'} scale={1} coat="gold" />
          <span className="picker-title">
            {cancel ? 'Cancel' : 'Pause'} {target.kind === 'beta' ? 'beta' : 'agent'} “{target.name}”
          </span>
          <span className="picker-note">{target.detail}</span>
        </header>
        <p className="leash-why">
          {cancel
            ? target.kind === 'beta'
              ? 'The beta is killed and the alpha is told why, so it can fix the brief and spawn it again, fold the track into another beta, or drop it.'
              : 'Its tool calls are refused with your reason, so it stops and returns early; the alpha is told why, so it can fix the brief and relaunch it, fold the track into another agent, or drop it.'
            : target.kind === 'beta'
              ? 'Its next tool call waits until you resume it. A note is typed into the alpha; leave it empty to pause quietly.'
              : 'Its next tool call waits in the deck until you resume it. A note is typed into the alpha; leave it empty to pause quietly.'}
        </p>
        <textarea
          ref={box}
          className="leash-text"
          rows={3}
          value={text}
          spellCheck
          placeholder={cancel ? 'Why? (the alpha acts on this)' : 'A note for the alpha (optional)'}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="leash-actions">
          <span className="picker-note">⏎ to send · ⇧⏎ newline · Esc closes</span>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            keep going
          </button>
          <button className={`leash-go ${cancel ? 'danger' : ''}`} disabled={!canSend} onClick={send}>
            {cancel ? 'cancel it and tell the alpha' : 'pause'}
          </button>
        </div>
      </div>
    </div>
  )
}
