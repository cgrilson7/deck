const HOME_RE = /^\/Users\/[^/]+/

/** ~-shorten a path and keep the last two segments readable. */
export function shortPath(p: string): string {
  const tilde = p.replace(HOME_RE, '~')
  const parts = tilde.split('/').filter(Boolean)
  if (parts.length <= 3) return tilde
  return `${parts[0]}/…/${parts.slice(-2).join('/')}`
}
