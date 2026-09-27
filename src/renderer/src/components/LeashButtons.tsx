import { useEffect, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { askLeash, killLeash, resumeLeash, type LeashTarget } from '../lib/leash'

/**
 * The leash as two buttons for a pane head: ⏸ / ▶ and ✕. They sit on every pack member's tile
 * (a subagent's, a beta's), on the agent pane and on a beta's focus pane. Clicks stop here so the
 * tile beneath does not take focus or open. `paused` draws ▶ instead of ⏸; `done` hides both and,
 * with `onDismiss`, shows a ✕ that only puts the tile away.
 * The KILL is two clicks in place: ✕ arms it (it turns into a red "kill"), a second click kills;
 * it disarms itself after ARM_MS or when the pointer leaves it.
 */
/** How long an armed ✕ waits for its second click. */
const ARM_MS = 3000

export function LeashButtons({ target, paused, done, onDismiss, wide }: { target: LeashTarget; paused: boolean; done?: boolean; onDismiss?: () => void; /** Words beside the glyphs (the pane). */ wide?: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), ARM_MS)
    return () => clearTimeout(t)
  }, [armed])
  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  if (done) {
    if (!onDismiss) return null
    return (
      <button className="ghost leash-btn" title="Put this tile away" onMouseDown={stop} onClick={(e) => (stop(e), onDismiss())}>
        <X size={12} />
        {wide && <span>dismiss</span>}
      </button>
    )
  }
  return (
    <>
      {paused ? (
        <button className="ghost leash-btn is-on" title="Resume: let its next tool call through" onMouseDown={stop} onClick={(e) => (stop(e), resumeLeash(target.id))}>
          <Play size={12} />
          {wide && <span>resume</span>}
        </button>
      ) : (
        <button className="ghost leash-btn" title="Pause: its next tool call waits until you resume it" onMouseDown={stop} onClick={(e) => (stop(e), askLeash({ target, action: 'pause' }))}>
          <Pause size={12} />
          {wide && <span>pause</span>}
        </button>
      )}
      <button
        className={`ghost danger leash-btn ${armed ? 'is-armed' : ''}`}
        title={armed ? 'Click again to kill it (the alpha is told)' : 'Kill it (click twice)'}
        onMouseDown={stop}
        onMouseLeave={() => setArmed(false)}
        onClick={(e) => {
          stop(e)
          if (armed) killLeash(target.id)
          else setArmed(true)
        }}
      >
        <X size={12} />
        {(wide || armed) && <span>kill</span>}
      </button>
    </>
  )
}
