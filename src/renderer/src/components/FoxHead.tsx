import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { DeckState, FoxEntry } from '@shared/types'
import { Fox, type FoxAnim } from './Fox'
import { BARK_EVERY_MS, BARK_LIFE_MS, BARK_MS, BARK_SCATTER, BARK_WORDS } from '../lib/bark'
import { ago } from '../lib/format'
import { useSettings } from '../lib/theme'

/** How many barks the top bar keeps in view. */
const SHOWN = 3
/** After a bark he stays sat up this long. */
const ALERT_MS = 60_000
/** Barks older than this are drawn faded: still there, no longer news. */
const STALE_MS = 30 * 60_000

/**
 * Foxtrot, the head of the deck, at the left of the top bar: the fox, large, and a speech
 * bubble with his last three barks, newest on top (main/foxtrot.ts decides what is worth a
 * bark). His pose is the whole deck's: sat up alert when something is blocked or he just
 * barked, looking around while any session works, asleep when nothing is open, else the
 * tail wags. A bark that arrives while you are here makes him bark (unless Fox Barks is
 * off); ones loaded at boot never do. Clicking him or the bubble opens the whole log (⌘J).
 */
export function FoxHead({ state, entries, live, open, onToggle }: { state: DeckState; entries: FoxEntry[]; live: FoxEntry | null; open: boolean; onToggle: () => void }) {
  const settings = useSettings()
  const [now, setNow] = useState(Date.now())
  const [run, setRun] = useState(0)
  const [alertUntil, setAlertUntil] = useState(0)
  const runs = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  // The "4m" labels age on their own.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!live || live.level !== 'bark') return
    setNow(Date.now())
    setAlertUntil(Date.now() + ALERT_MS)
    const t = window.setTimeout(() => setAlertUntil(0), ALERT_MS)
    setRun(++runs.current)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setRun(0), BARK_MS)
    return () => window.clearTimeout(t)
  }, [live])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const barks = entries.filter((e) => e.level === 'bark').slice(-SHOWN).reverse()
  const blocked = state.open.some((s) => s.status === 'blocked')
  const pose: FoxAnim =
    blocked || alertUntil > now ? 'alert' : state.open.some((s) => s.status === 'busy') ? 'look' : state.open.length === 0 ? 'sleep' : 'idle'
  const barking = run > 0 && settings.foxBark
  const scale = settings.compact ? 2 : 4

  return (
    <div className={`fox-head ${open ? 'is-open' : ''}`}>
      <button className={`fox-head-fox ${barking ? 'barking' : ''}`} onClick={onToggle} title="Foxtrot's log (⌘J)">
        <Fox anim={pose} scale={scale} />
        {barking &&
          BARK_WORDS.map((word, i) => {
            const s = BARK_SCATTER[i % BARK_SCATTER.length]
            const style = {
              '--rot': `${s.rot}deg`,
              '--dx': `${s.dx * 1.6}px`,
              '--dy': `${s.dy * 1.6}px`,
              animationDelay: `${i * BARK_EVERY_MS}ms`,
              animationDuration: `${BARK_LIFE_MS}ms`
            } as CSSProperties
            return (
              <span key={`${run}-${i}`} className="bark" style={style} aria-hidden="true">
                {word}
              </span>
            )
          })}
      </button>
      <button className="fox-speech" onClick={onToggle} title="Everything he has seen (⌘J)">
        {barks.length === 0 && <span className="fox-say is-quiet">Nothing to bark about yet.</span>}
        {barks.map((b) => (
          <span key={b.id} className={`fox-say ${now - b.ts > STALE_MS ? 'is-stale' : ''}`}>
            <time dateTime={new Date(b.ts).toISOString()}>{ago(b.ts, now)}</time>
            <span className="fox-say-text">{b.text}</span>
          </span>
        ))}
      </button>
    </div>
  )
}
