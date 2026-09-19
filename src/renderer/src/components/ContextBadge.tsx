import { useUsage, usageLevel } from '../lib/usage'

/** How full a session's context window is, in its pane head: nothing until its status line has said, quiet below 50%. */
export function ContextBadge({ id }: { id: string }) {
  const pct = useUsage().context[id]
  if (pct === undefined || pct < 50) return null
  return (
    <span className={`badge badge-ctx is-${usageLevel(pct)}`} title={`Context window: ${pct}% used`}>
      ctx {pct}%
    </span>
  )
}
