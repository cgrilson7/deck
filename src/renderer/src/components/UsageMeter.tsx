import { useEffect, useState } from 'react'
import type { UsageWindow } from '@shared/types'
import { left, useUsage, usageLevel } from '../lib/usage'

/**
 * Usage in the top bar: the account's 5-hour and weekly windows as Claude Code reports them
 * (main/usage.ts) — a bar, the percentage USED and the time LEFT until it starts over — and the
 * focused session's context window. The CLI's own numbers, never an estimate: a window nobody
 * has reported (no subscription, or no deck session has answered since it began) is a dash.
 * Amber from 70%, red from 90%, and the level is in the tooltip's words too, not only the colour.
 */
export function UsageMeter({ focusId }: { focusId: string | null }) {
  const u = useUsage()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const ctx = focusId ? u.context[focusId] : undefined
  return (
    <div className="usage" title="Usage, as Claude Code reports it to each session's status line">
      <Window label="5h" name="5-hour window" w={u.fiveHour} now={now} />
      <Window label="7d" name="weekly window" w={u.sevenDay} now={now} />
      {ctx !== undefined && (
        <span className={`usage-ctx is-${usageLevel(ctx)}`} title={`The focused session's context window: ${ctx}% used${usageLevel(ctx) === 'ok' ? '' : ' — /compact or a new session soon'}`}>
          ctx <b>{ctx}%</b>
        </span>
      )}
    </div>
  )
}

function Window({ label, name, w, now }: { label: string; name: string; w: UsageWindow | null; now: number }) {
  const live = w && w.resetsAt > now ? w : null
  if (!live)
    return (
      <span className="usage-win is-unknown" title={`The ${name}: nothing reported yet (a session says after its first reply; subscribers only)`}>
        <span className="usage-label">{label}</span>
        <span className="usage-bar" />
        <span className="usage-pct">—</span>
      </span>
    )
  const level = usageLevel(live.pct)
  const when = new Date(live.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  return (
    <span className={`usage-win is-${level}`} title={`The ${name}: ${Math.round(live.pct)}% used${level === 'hot' ? ' — nearly out' : level === 'warn' ? ' — running high' : ''}; starts over in ${left(live.resetsAt, now)} (${when})`}>
      <span className="usage-label">{label}</span>
      <span className="usage-bar">
        <i style={{ width: `${Math.min(100, live.pct)}%` }} />
      </span>
      <span className="usage-pct">{Math.round(live.pct)}%</span>
      <span className="usage-left">{left(live.resetsAt, now)}</span>
    </span>
  )
}
