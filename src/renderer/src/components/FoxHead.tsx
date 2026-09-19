import type { DeckState } from '@shared/types'
import { Fox, type FoxAnim } from './Fox'
import { useSettings } from '../lib/theme'

/**
 * Foxtrot, the head of the deck, at the left of the top bar: the fox, large, and nothing
 * else. He is the sessions' foxes summed up, never a voice of his own: he trots while any
 * session works, sleeps when every one of them rests (or none is open), and otherwise
 * stands looking back and forth. He does not bark and says nothing; what needs you is told
 * by that session's own fox. Clicking him opens his log (⌘J).
 */
export function FoxHead({ state, open, onToggle }: { state: DeckState; open: boolean; onToggle: () => void }) {
  const settings = useSettings()
  const resting = state.open.every((s) => s.status === 'idle' && !s.attention)
  const pose: FoxAnim = state.open.some((s) => s.status === 'busy') ? 'run' : resting ? 'sleep' : 'look'
  return (
    <div className={`fox-head ${open ? 'is-open' : ''}`}>
      <button className="fox-head-fox" onClick={onToggle} title="Foxtrot's log (⌘J)">
        <Fox anim={pose} scale={settings.compact ? 2 : 4} />
      </button>
    </div>
  )
}
