// The music tile's Spotify face: Spotify.app driven over AppleScript. The web player is off
// the table (it needs Widevine, which Electron does not ship), and the desktop app is what
// Colin already has open, so playback costs the deck no bandwidth at all. Polled every
// POLL_MS while the tile is showing this face; only changes are broadcast.

import { execFile } from 'node:child_process'
import { shell } from 'electron'
import type { SpotifyCommand, SpotifyItem, SpotifyState } from '@shared/types'

const SEP = String.fromCharCode(31)
const POLL_MS = 2000

// `System Events` first so a mere status poll can never launch Spotify. (`st` is a term in
// Spotify's dictionary and cannot be a variable name inside its tell block; hence `ps`.)
const STATUS_SCRIPT = `
tell application "System Events" to set isRunning to (name of processes) contains "Spotify"
if not isRunning then return "off"
tell application "Spotify"
  set ps to player state as string
  set sep to character id 31
  set sh to shuffling as string
  try
    set t to current track
    return ps & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & (artwork url of t) & sep & (player position as string) & sep & (duration of t as string) & sep & (id of t) & sep & (sound volume as string) & sep & sh
  on error
    return ps & sep & sep & sep & sep & sep & "0" & sep & "0" & sep & sep & "0" & sep & sh
  end try
end tell`

const COMMANDS: Record<Exclude<SpotifyCommand, 'open'>, string> = {
  playpause: 'tell application "Spotify" to playpause',
  next: 'tell application "Spotify" to next track',
  previous: 'tell application "Spotify" to previous track',
  shuffle: 'tell application "Spotify" to set shuffling to not shuffling'
}

export const SPOTIFY_OFF: SpotifyState = {
  running: false,
  state: 'stopped',
  track: '',
  artist: '',
  album: '',
  artworkUrl: '',
  position: 0,
  duration: 0,
  trackId: '',
  volume: 0,
  shuffling: false
}

function osascript(script: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { env, timeout: 6000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
  })
}

/** AppleScript's `as string` of a real uses the user's locale (a comma decimal in some). */
const num = (s: string): number => Number(s.replace(',', '.')) || 0

function parse(out: string): SpotifyState {
  if (out === 'off') return SPOTIFY_OFF
  const f = out.split(SEP)
  const state = (f[0] === 'playing' || f[0] === 'paused' ? f[0] : 'stopped') as SpotifyState['state']
  if (f.length < 10) return { ...SPOTIFY_OFF, running: true, state }
  return {
    running: true,
    state,
    track: f[1],
    artist: f[2],
    album: f[3],
    artworkUrl: f[4].startsWith('https://i.scdn.co/') ? f[4] : '',
    position: num(f[5]),
    duration: num(f[6]) / 1000,
    trackId: f[7],
    volume: num(f[8]),
    shuffling: f[9] === 'true'
  }
}

/**
 * A `spotifyPlaylists` entry as a URI: `spotify:playlist:x` as is, an open.spotify.com link
 * (`/playlist/x`, `/intl-es/album/x?si=...`) converted. Null when it is neither.
 */
export function spotifyUri(entry: string): { uri: string; kind: SpotifyItem['kind']; id: string } | null {
  const kinds = ['playlist', 'album', 'artist', 'track', 'show', 'episode'] as const
  const m = /^spotify:(playlist|album|artist|track|show|episode):([A-Za-z0-9]+)$/.exec(entry)
  if (m) return { uri: entry, kind: m[1] as SpotifyItem['kind'], id: m[2] }
  try {
    const u = new URL(entry)
    if (u.hostname !== 'open.spotify.com') return null
    const parts = u.pathname.split('/').filter(Boolean)
    const i = parts.findIndex((p) => (kinds as readonly string[]).includes(p))
    if (i < 0 || !parts[i + 1] || !/^[A-Za-z0-9]+$/.test(parts[i + 1])) return null
    return { uri: `spotify:${parts[i]}:${parts[i + 1]}`, kind: parts[i] as SpotifyItem['kind'], id: parts[i + 1] }
  } catch {
    return null
  }
}

const names = new Map<string, Promise<string>>()

/** The name Spotify's public oEmbed endpoint gives a URI (no auth), cached for good; '' when it won't say. */
function oembedName(uri: string): Promise<string> {
  let p = names.get(uri)
  if (!p) {
    p = fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(uri)}`, { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ title?: string }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => (typeof j.title === 'string' ? j.title.trim() : ''))
      .catch(() => {
        names.delete(uri) // try again next time
        return ''
      })
    names.set(uri, p)
  }
  return p
}

/** The chips: every well-formed entry, named (the id when Spotify does not answer). */
export async function spotifyItems(entries: string[]): Promise<SpotifyItem[]> {
  const parsed = entries.map(spotifyUri).filter((x): x is NonNullable<typeof x> => x !== null)
  return Promise.all(parsed.map(async (p) => ({ uri: p.uri, kind: p.kind, name: (await oembedName(p.uri)) || `${p.kind} ${p.id.slice(0, 8)}` })))
}

export class Spotify {
  private timer: NodeJS.Timeout | null = null
  private inflight = false
  private last = ''
  public state: SpotifyState = SPOTIFY_OFF

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly onState: (s: SpotifyState) => void
  ) {}

  /** Poll while `on`; idle otherwise (the tile is on another face or hidden). */
  setActive(on: boolean): void {
    if (on === (this.timer !== null)) return
    if (on) {
      this.timer = setInterval(() => void this.poll(), POLL_MS)
      void this.poll()
    } else {
      clearInterval(this.timer!)
      this.timer = null
    }
  }

  stop(): void {
    this.setActive(false)
  }

  async poll(): Promise<void> {
    if (this.inflight) return
    this.inflight = true
    try {
      const out = await osascript(STATUS_SCRIPT, this.env)
      if (out !== this.last) {
        this.last = out
        this.state = parse(out)
        this.onState(this.state)
      }
    } catch {
      /* Spotify mid-launch or AppleScript hiccup: keep the last state */
    } finally {
      this.inflight = false
    }
  }

  async command(cmd: SpotifyCommand): Promise<void> {
    if (cmd === 'open') {
      await shell.openExternal('spotify:')
      return
    }
    const script = COMMANDS[cmd]
    if (!script) return
    try {
      await osascript(script, this.env)
    } catch {
      /* not running */
    }
    await this.poll()
  }

  /** `play track` takes a context URI too; Spotify.app launches if it has to (this is user-asked). */
  async play(entry: string): Promise<void> {
    const p = spotifyUri(entry)
    if (!p) return
    try {
      await osascript(`tell application "Spotify"\n  activate\n  play track "${p.uri}"\nend tell`, this.env)
    } catch {
      /* Spotify still launching: the next poll shows what happened */
    }
    await this.poll()
  }
}
