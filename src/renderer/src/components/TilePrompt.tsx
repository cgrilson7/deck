import { useState } from 'react'
import { pasteText } from '../lib/paste'

/**
 * The prompt bar along the bottom of a grid tile: type, ⏎, and the text is pasted into that
 * session and submitted, without swapping it into focus. ⇧⏎ = newline. Esc empties it (and
 * drops focus if already empty). An always-visible rounded outline, nothing else; the terminal
 * above it is padded so its last rows end just over the bar (`.termhost-tile`).
 */
export function TilePrompt({ id }: { id: string }) {
  const [text, setText] = useState('')

  const send = () => {
    const t = text.trim()
    if (!t) return
    pasteText(id, t)
    // Bracketed paste lands first; a beat later ⏎ submits it.
    setTimeout(() => window.deck.ptyInput(id, '\r'), 40)
    setText('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (text) setText('')
      else e.currentTarget.blur()
    }
  }

  // Clicks in the box must not reach the tile (which would swap it into focus).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div className={`tile-prompt ${text ? 'has-text' : ''}`} onClick={stop} onMouseDown={stop} onDoubleClick={stop}>
      <textarea
        rows={1}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Prompt this session"
      />
      <button type="button" className="tile-prompt-send" onClick={send} disabled={!text.trim()} title="Send (⏎)">
        ↵
      </button>
    </div>
  )
}
