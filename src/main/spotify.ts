// The Spotify tile's data source: Spotify.app driven over AppleScript. The web player is
// off the table (it needs Widevine, which Electron does not ship), and the desktop app is
// what Colin already has open. Polled once a second; only changes are broadcast.

import { execFile } from 'node:child_process'
import { shell } from 'electron'
import type { SpotifyCommand, SpotifyState } from '@shared/types'

const SEP = String.fromCharCode(31)
const POLL_MS = 1000

// `System Events` first so a mere status poll can never launch Spotify.
const STATUS_SCRIPT = `
tell application "System Events" to set isRunning to (name of processes) contains "Spotify"
if not isRunning then return "off"
tell application "Spotify"
  set st to player state as string
  set sep to character id 31
  try
    set t to current track
    return st & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & (artwork url of t) & sep & (player position as string) & sep & (duration of t as string) & sep & (id of t) & sep & (sound volume as string)
  on error
    return st
  end try
end tell`

const COMMANDS: Record<Exclude<SpotifyCommand, 'open'>, string> = {
  playpause: 'tell application "Spotify" to playpause',
  next: 'tell application "Spotify" to next track',
  previous: 'tell application "Spotify" to previous track'
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
  volume: 0
}

function osascript(script: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { env, timeout: 4000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
  })
}

function parse(out: string): SpotifyState {
  if (out === 'off') return SPOTIFY_OFF
  const f = out.split(SEP)
  const state = (f[0] === 'playing' || f[0] === 'paused' ? f[0] : 'stopped') as SpotifyState['state']
  if (f.length < 9) return { ...SPOTIFY_OFF, running: true, state }
  return {
    running: true,
    state,
    track: f[1],
    artist: f[2],
    album: f[3],
    artworkUrl: f[4],
    position: Number(f[5]) || 0,
    duration: (Number(f[6]) || 0) / 1000,
    trackId: f[7],
    volume: Number(f[8]) || 0
  }
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

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.poll(), POLL_MS)
    void this.poll()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
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
    try {
      await osascript(COMMANDS[cmd], this.env)
    } catch {
      /* not running */
    }
    await this.poll()
  }
}
