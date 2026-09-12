const HOME_RE = /^\/Users\/[^/]+/

/** ~-shorten a path and keep the last two segments readable. */
export function shortPath(p: string): string {
  const tilde = p.replace(HOME_RE, '~')
  const parts = tilde.split('/').filter(Boolean)
  if (parts.length <= 3) return tilde
  return `${parts[0]}/…/${parts.slice(-2).join('/')}`
}

/** How long ago, as short as it gets: "now", "4m", "3h", "2d". */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** Wall-clock time of day, local: "14:05". */
export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}
