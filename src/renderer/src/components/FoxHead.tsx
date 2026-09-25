import { useEffect, useRef, useState } from 'react'
import type { DeckState } from '@shared/types'
import { Fox, type FoxAnim } from './Fox'
import { BarkBursts } from './FoxStatus'
import { BARK_MS } from '../lib/bark'
import { playBark } from '../lib/barks'
import { usePostureAlarm } from '../lib/posture'
import { useSettings } from '../lib/theme'

/** What he barks at a slouch. */
const POSTURE_WORDS = ['SIT UP!', 'ARF!', 'YIP!'] as const

/**
 * Foxtrot, the head of the deck, at the left of the top bar: the fox, large. He is the
 * sessions' foxes summed up: he trots while any session works, sleeps when every one of them
 * rests (or none is open), and otherwise stands looking back and forth. Sessions never make
 * him bark — what needs you is told by that session's own fox. YOUR POSTURE DOES: when the
 * Posture tile's alert fires (ten seconds of slouching) he hops and barks "SIT UP!" — out loud, a real fox (lib/barks.ts) — and stands
 * looking at you until you do. Clicking him opens his log (⌘J).
 */
export function FoxHead({ state, open, onToggle }: { state: DeckState; open: boolean; onToggle: () => void }) {
  const settings = useSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const { alarm, barks } = usePostureAlarm()
  const [run, setRun] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!barks) return
    if (settingsRef.current.foxBark) playBark()
    setRun(barks)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setRun(0), BARK_MS)
  }, [barks])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const resting = state.open.every((s) => s.status === 'idle' && !s.attention)
  const pose: FoxAnim = alarm ? 'look' : state.open.some((s) => s.status === 'busy') ? 'run' : resting ? 'sleep' : 'look'
  const barking = run > 0 && settings.foxBark
  return (
    <div className={`fox-head ${open ? 'is-open' : ''}`}>
      <button className={`fox-head-fox ${barking ? 'barking' : ''}`} onClick={onToggle} title={alarm ? 'Sit up straight! (Foxtrot\'s log, ⌘J)' : "Foxtrot's log (⌘J)"}>
        <Fox anim={pose} scale={settings.compact ? 2 : 4} />
        {barking && <BarkBursts run={run} words={POSTURE_WORDS} />}
      </button>
    </div>
  )
}
