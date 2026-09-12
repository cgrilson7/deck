import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatBlock, SessionStatus, Transcript } from '@shared/types'
import { Fox } from './Fox'
import { FileRef, linkifyPaths } from '../lib/filerefs'
import { renderMarkdown } from '../lib/markdown'

/**
 * A grid tile's body: the conversation, tailed from Claude Code's transcript by main
 * (`transcript.ts`), instead of the CLI's screen. Your prompts, Claude's prose as markdown,
 * one line per tool call. Pinned to the end while you leave it there; scroll up and it stays
 * put until you come back down. The bar at the bottom is the TilePrompt; the padding is its room.
 * Every path in it is clickable and opens the preview pane over the grid; `cwd` is the session's
 * folder, which is what a relative one is resolved against.
 */
export function ChatView({ id, cwd, status, attention, onNeeds }: { id: string; cwd: string; status: SessionStatus; attention: boolean; /** Given, the "needs you" note is a button that calls it (the phone opens the screen); else it says to click the tile. */ onNeeds?: () => void }) {
  const [t, setT] = useState<Transcript | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    let live = true
    void window.deck.getTranscript(id).then((x) => live && x && setT(x))
    const off = window.deck.onTranscript((x) => {
      if (x.id === id) setT(x)
    })
    return () => {
      live = false
      off()
    }
  }, [id])

  useLayoutEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [t, status])

  const onScroll = () => {
    const el = box.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const blocks = t?.blocks ?? []
  const busy = status === 'busy' || status === 'starting'

  if (blocks.length === 0) {
    return (
      <div className="chat chat-empty">
        <Fox anim={busy ? 'look' : 'idle'} scale={3} />
        <p>{t?.found ? 'Nothing to show yet.' : 'A fresh session. Ask it something below.'}</p>
      </div>
    )
  }

  return (
    <div className="chat" ref={box} onScroll={onScroll}>
      {blocks.map((b, i) => (
        <Block key={`${b.ts}-${i}`} b={b} cwd={cwd} last={i === blocks.length - 1} />
      ))}
      {busy && (
        <div className="chat-busy" aria-label="Claude is working">
          <span />
          <span />
          <span />
        </div>
      )}
      {(attention || status === 'blocked') &&
        !busy &&
        (onNeeds ? (
          <button type="button" className="chat-attn is-btn" onClick={onNeeds}>
            Needs you in the terminal. Tap to see the screen.
          </button>
        ) : (
          <div className="chat-attn">Needs you in the terminal. Click to open.</div>
        ))}
    </div>
  )
}

function Block({ b, cwd, last }: { b: ChatBlock; cwd: string; last: boolean }) {
  if (b.kind === 'user') {
    // Your own prompts name files too — a dropped file pastes its path right into one.
    return (
      <div className="chat-user" title={new Date(b.ts).toLocaleTimeString()}>
        {linkifyPaths(b.text, cwd)}
      </div>
    )
  }
  if (b.kind === 'tool') {
    return (
      <div className={`chat-tool ${b.done ? (b.error ? 'is-error' : 'is-done') : 'is-running'}`} title={b.path || b.name}>
        <span className="chat-tool-mark">{b.done ? (b.error ? '✗' : '✓') : '·'}</span>
        <span className="chat-tool-name">{b.name}</span>
        {b.label && (
          <span className="chat-tool-label">
            {/* Read / Edit / Write name a file: the label opens it. */}
            {b.path ? <FileRef path={b.path} cwd={cwd} label={b.label} /> : b.label}
          </span>
        )}
      </div>
    )
  }
  return <div className={`chat-text ${last ? 'is-last' : ''}`}>{renderMarkdown(b.text, cwd)}</div>
}
