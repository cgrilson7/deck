// The Sleepgod tile's main side: asks the sleepgod server on this Mac (~/sleepgod, a login item) for
// its summary. It goes through main because the renderer's CSP allows no connections outside the app.

import type { SleepgodSummary } from '../shared/types'

export const SLEEPGOD_URL = 'http://127.0.0.1:8484'

/** Null when the server isn't answering; the tile says so rather than showing old numbers. */
export async function sleepgodSummary(): Promise<SleepgodSummary | null> {
  try {
    const res = await fetch(`${SLEEPGOD_URL}/api/summary`, { signal: AbortSignal.timeout(4000) })
    return res.ok ? ((await res.json()) as SleepgodSummary) : null
  } catch {
    return null
  }
}

/** Starts a sync on the server. Null when it started; otherwise why it couldn't (the live view has the ring, say). */
export async function sleepgodSync(): Promise<string | null> {
  try {
    const res = await fetch(`${SLEEPGOD_URL}/api/sync/start`, { method: 'POST', signal: AbortSignal.timeout(4000) })
    if (res.ok) return null
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    return body?.detail ?? `The server answered ${res.status}.`
  } catch {
    return "The sleepgod server isn't answering on this Mac."
  }
}
