import type { DeckSettings, DeckState, SessionView } from '@shared/types'
import { modelLabel, permissionLabel, PERMISSION_MODES } from '@shared/models'
import { FoxStatus } from './FoxStatus'
import { TermHost } from './TermHost'
import { Launcher } from './Launcher'
import { shortPath } from '../lib/format'
import { useDropTarget } from './useDropTarget'
import { LeashButtons } from './LeashButtons'
import { leashOfBeta } from '../lib/leash'

export function FocusPane({ session, state, settings, alpha }: { session: SessionView | null; state: DeckState; settings: DeckSettings; /** For a beta: its alpha, so the head can say whose it is. */ alpha?: SessionView | null }) {
  // Nothing in focus: the launcher takes the column (Launcher.tsx), a form for everything the + picker and the menus offer.
  if (!session) return <Launcher state={state} settings={settings} />

  const s = session
  const beta = !!s.pack
  const drop = useDropTarget(s.id)
  return (
    <section className={`focus status-${s.status} ${s.attention ? 'attention' : ''} ${drop.over ? 'drop-over' : ''} ${beta ? 'focus-beta' : ''}`} {...drop.handlers}>
      <header className="pane-head">
        <span className={`slot ${beta ? 'slot-beta' : ''}`}>{beta ? 'β' : s.slot}</span>
        <FoxStatus id={s.id} status={s.status} attention={s.attention} coat={beta ? 'gold' : undefined} />
        <span className="name" title={s.name}>
          {s.name}
        </span>
        {beta && (
          <button className="badge badge-pack" title={alpha ? `Beta of slot ${alpha.slot} “${alpha.name}” — click to focus the alpha` : 'A wolfpack beta'} onClick={() => alpha && void window.deck.command({ type: 'focus', slot: alpha.slot! })}>
            pack of {alpha ? alpha.slot : '?'}
          </button>
        )}
        {s.worktree && <span className="badge">worktree</span>}
        {s.model && (
          <span className="badge" title={`--model ${s.model}`}>
            {modelLabel(s.model)}
          </span>
        )}
        {s.permissionMode && (
          <span className={`badge ${PERMISSION_MODES.find((m) => m.id === s.permissionMode)?.risky ? 'badge-risky' : ''}`} title={`--permission-mode ${s.permissionMode}`}>
            {permissionLabel(s.permissionMode)}
          </span>
        )}
        {s.paused && <span className="badge badge-state is-paused">paused</span>}
        <span className="cwd" title={s.cwd}>
          {shortPath(s.cwd)}
        </span>
        <span className="spacer" />
        {beta && <LeashButtons target={leashOfBeta(s)} paused={s.paused} />}
        <button className="ghost" title="Close tile, keep the session (⌘W)" onClick={() => window.deck.command({ type: 'detach', slot: s.slot! })}>
          park
        </button>
        <button
          className="ghost danger"
          title="Kill the tmux session and forget it"
          onClick={() => {
            if (confirm(`Kill "${s.name}"? The Claude conversation stays on disk, but deck forgets it.`)) void window.deck.command({ type: 'kill', id: s.id })
          }}
        >
          kill
        </button>
      </header>
      <TermHost id={s.id} cwd={s.cwd} mode="focus" autoFocus />
    </section>
  )
}
