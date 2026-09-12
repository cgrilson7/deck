import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { DeckState, FoxEntry, SessionView } from '@shared/types'
import { Fox } from './Fox'
import { FileRef } from '../lib/filerefs'
import { clock } from '../lib/format'

/**
 * Everything Foxtrot has seen (main/foxtrot.ts), newest first, a day at a time: the barks
 * that made the top bar and the running notes between them. Laid over the grid the same way
 * as the file preview (the `.doc` pane), so the terminal stays in view. A session chip
 * focuses that session while it is open; a path chip opens the file. "barks only" is kept
 * per machine. Esc closes, except from inside a terminal.
 */
export function FoxLog({ state, entries, onClose }: { state: DeckState; entries: FoxEntry[]; onClose: () => void }) {
  const [barksOnly, setBarksOnly] = useState(() => localStorage.getItem('deck:foxBarksOnly') === '1')

  useEffect(() => {
    localStorage.setItem('deck:foxBarksOnly', barksOnly ? '1' : '0')
  }, [barksOnly])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest('.xterm')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sessions = new Map<string, SessionView>([...state.parked, ...state.open].map((s) => [s.id, s]))
  const shown = entries.filter((e) => !barksOnly || e.level === 'bark').reverse()
  const days: { day: string; rows: FoxEntry[] }[] = []
  for (const e of shown) {
    const day = dayLabel(e.ts)
    if (days[days.length - 1]?.day !== day) days.push({ day, rows: [] })
    days[days.length - 1].rows.push(e)
  }

  return (
    <section className="doc foxlog" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="doc-scrim" onClick={onClose} />
      <div className="doc-panel">
        <header className="doc-head">
          <Fox anim="idle" scale={1} />
          <span className="doc-name">Foxtrot's log</span>
          <span className="doc-meta">
            {entries.filter((e) => e.level === 'bark').length} barks · {entries.length} entries
          </span>
          <span className="spacer" />
          <button className={`doc-btn wide ${barksOnly ? 'on' : ''}`} title="Only what he barked about" onClick={() => setBarksOnly((v) => !v)}>
            barks only
          </button>
          <button className="doc-btn" title="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <div className="doc-body">
          {shown.length === 0 && <div className="doc-note">{barksOnly ? 'No barks yet.' : 'Nothing seen yet. He starts watching a few seconds after launch.'}</div>}
          {days.map((d) => (
            <div key={d.day} className="foxlog-day">
              <h4>{d.day}</h4>
              {d.rows.map((e) => (
                <div key={e.id} className={`foxlog-row is-${e.level}`}>
                  <time>{clock(e.ts)}</time>
                  <span className="foxlog-mark" aria-label={e.level} />
                  <div className="foxlog-what">
                    <span>{e.text}</span>
                    {(e.sessions.length > 0 || e.paths?.length) && (
                      <span className="foxlog-chips">
                        {e.sessions.map((id) => (
                          <SessionChip key={id} s={sessions.get(id)} />
                        ))}
                        {e.paths?.map((p) => (
                          <FileRef key={p} path={p} code />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** A session an entry is about: focuses it while it is open; a parked or forgotten one is just a label. */
function SessionChip({ s }: { s: SessionView | undefined }) {
  if (!s) return null
  if (s.slot === null) return <span className="foxlog-chip is-parked">{s.name} (parked)</span>
  return (
    <button className="foxlog-chip" title={`Focus slot ${s.slot} (⌘${s.slot})`} onClick={() => void window.deck.command({ type: 'focus', slot: s.slot! })}>
      <b>{s.slot}</b> {s.name}
    </button>
  )
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}
