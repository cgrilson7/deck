/** An error's own message, without Electron's "Error invoking remote method 'x': Error:" wrapper. */
export function plain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}
