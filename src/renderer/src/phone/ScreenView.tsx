import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Screen } from '@shared/types'
import { renderAnsi } from './ansi'

/** Any keystroke the phone sends poke the screen view to re-read a beat later, so a menu moves at once. */
export const POKE = 'deck:screen-poke'
const POLL_MS = 700
const POKE_MS = 120

/**
 * The session's terminal as the desktop sees it, read from tmux (`capture-pane -e`) every
 * POLL_MS while shown. Never attached, never resized: the screen is the desktop's size, and
 * the font is shrunk so every column fits the phone's width (down to a floor, then it
 * scrolls sideways). This is where permission prompts are answered, with the key strip.
 */
export function ScreenView({ id, active }: { id: string; active: boolean }) {
  const [scr, setScr] = useState<Screen | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(11)

  useEffect(() => {
    if (!active) return
    let live = true
    let timer = 0
    const read = async () => {
      window.clearTimeout(timer)
      try {
        const s = await window.deck.screen(id)
        if (live) setScr(s)
      } catch {
        /* socket down: the link banner says so */
      }
      if (live) timer = window.setTimeout(read, POLL_MS)
    }
    const poke = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(read, POKE_MS)
    }
    void read()
    window.addEventListener(POKE, poke)
    return () => {
      live = false
      window.clearTimeout(timer)
      window.removeEventListener(POKE, poke)
    }
  }, [id, active])

  // Fit the desktop's columns to the phone's width: a monospace cell is about 0.6em wide.
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !scr?.cols) return
    const fit = () => setFontSize(Math.max(6.5, Math.min(13, (el.clientWidth - 16) / (scr.cols * 0.6))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scr?.cols])

  return (
    <div className="ph-screen" ref={box}>
      {!scr ? (
        <p className="ph-screen-note">reading the screen…</p>
      ) : scr.gone ? (
        <p className="ph-screen-note">This session has no terminal right now.</p>
      ) : (
        <pre style={{ fontSize }}>{renderAnsi(scr.text)}</pre>
      )}
    </div>
  )
}

/** The keys a TUI wants that a phone keyboard has not got: arrows, ⏎, Esc, Tab, and the quick answers. */
const KEYS: { label: string; seq: string; title: string }[] = [
  { label: 'esc', seq: '\x1b', title: 'Escape' },
  { label: 'tab', seq: '\t', title: 'Tab' },
  { label: '⇧tab', seq: '\x1b[Z', title: 'Shift-Tab (cycle permission modes)' },
  { label: '↑', seq: '\x1b[A', title: 'Up' },
  { label: '↓', seq: '\x1b[B', title: 'Down' },
  { label: '←', seq: '\x1b[D', title: 'Left' },
  { label: '→', seq: '\x1b[C', title: 'Right' },
  { label: '⏎', seq: '\r', title: 'Enter' },
  { label: 'y', seq: 'y', title: 'y' },
  { label: 'n', seq: 'n', title: 'n' },
  { label: '1', seq: '1', title: '1' },
  { label: '2', seq: '2', title: '2' },
  { label: '3', seq: '3', title: '3' },
  { label: '␣', seq: ' ', title: 'Space' },
  { label: '⌫', seq: '\x7f', title: 'Backspace' },
  { label: '^C', seq: '\x03', title: 'Control-C' }
]

export function Keys({ id }: { id: string }) {
  const send = (seq: string) => {
    window.deck.ptyInput(id, seq)
    window.dispatchEvent(new CustomEvent(POKE))
  }
  return (
    <div className="ph-keys" role="toolbar" aria-label="Terminal keys">
      {KEYS.map((k) => (
        <button
          key={k.label}
          type="button"
          className="ph-key"
          title={k.title}
          // Keep the prompt's keyboard up: a tap here must not move focus.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => send(k.seq)}
        >
          {k.label}
        </button>
      ))}
    </div>
  )
}
