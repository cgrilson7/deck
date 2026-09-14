import { Pause, Play, X } from 'lucide-react'
import { askLeash, resumeLeash, type LeashTarget } from '../lib/leash'

/**
 * The leash as two buttons for a pane head: ⏸ / ▶ and ✕. They sit on every pack member's tile
 * (a subagent's, a beta's), on the agent pane and on a beta's focus pane. Clicks stop here so the
 * tile beneath does not take focus or open. `paused` draws ▶ instead of ⏸; `done` hides both and,
 * with `onDismiss`, shows a ✕ that only puts the tile away.
 */
export function LeashButtons({ target, paused, done, onDismiss, wide }: { target: LeashTarget; paused: boolean; done?: boolean; onDismiss?: () => void; /** Words beside the glyphs (the pane). */ wide?: boolean }) {
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
      <button className="ghost danger leash-btn" title="Cancel it with a reason; the alpha is told and adjusts" onMouseDown={stop} onClick={(e) => (stop(e), askLeash({ target, action: 'cancel' }))}>
        <X size={12} />
        {wide && <span>cancel</span>}
      </button>
    </>
  )
}
