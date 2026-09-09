import type { CSSProperties } from 'react'
import type { SessionStatus } from '@shared/types'
import { Fox, type FoxAnim } from './Fox'
import { BARK_EVERY_MS, BARK_LIFE_MS, BARK_SCATTER, BARK_WORDS, useBark } from '../lib/bark'
import { useSettings } from '../lib/theme'

/** Foxtrot's pose per status. Needing you overrides all of them with `alert`. */
const POSE: Record<SessionStatus, FoxAnim> = {
  starting: 'look',
  busy: 'run',
  idle: 'sleep',
  blocked: 'alert',
  dead: 'down',
  unknown: 'look'
}

const LABEL: Record<SessionStatus, string> = {
  starting: 'starting',
  busy: 'working',
  idle: 'idle',
  blocked: 'needs input',
  dead: 'exited',
  unknown: 'unknown'
}

/**
 * The status indicator in every pane head: the fox, running while Claude works, asleep
 * while it waits, sitting up when it needs you, lying down when the pane died. Barks
 * (a hop and slay's three comic bursts, silent) on the transition into needing you and
 * when a turn finishes.
 */
export function FoxStatus({ id, status, attention }: { id: string; status: SessionStatus; attention: boolean }) {
  const settings = useSettings()
  const run = useBark(id, status, attention)
  const barking = run > 0 && settings.foxBark
  const needs = attention || status === 'blocked'
  const label = needs ? `needs you (${LABEL[status]})` : LABEL[status]
  return (
    <span className={`fox-status ${barking ? 'barking' : ''}`}>
      <Fox anim={needs ? 'alert' : POSE[status]} scale={1} title={label} />
      {barking &&
        BARK_WORDS.map((word, i) => {
          const s = BARK_SCATTER[i % BARK_SCATTER.length]
          const style = {
            '--rot': `${s.rot}deg`,
            '--dx': `${s.dx}px`,
            '--dy': `${s.dy}px`,
            animationDelay: `${i * BARK_EVERY_MS}ms`,
            animationDuration: `${BARK_LIFE_MS}ms`
          } as CSSProperties
          return (
            <span key={`${run}-${i}`} className="bark" style={style} aria-hidden="true">
              {word}
            </span>
          )
        })}
    </span>
  )
}
