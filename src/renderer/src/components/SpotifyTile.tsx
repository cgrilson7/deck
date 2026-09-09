import { useEffect, useState } from 'react'
import type { SpotifyState } from '@shared/types'

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Now playing in Spotify.app, with transport controls. Lives in the plugin row. */
export function SpotifyTile() {
  const [st, setSt] = useState<SpotifyState | null>(null)
  const [pos, setPos] = useState(0)

  useEffect(() => window.deck.onSpotify(setSt), [])

  // The poll is 1 Hz; tick the bar locally between polls so it moves smoothly.
  useEffect(() => {
    if (!st) return
    setPos(st.position)
    if (st.state !== 'playing') return
    const t0 = performance.now()
    const t = window.setInterval(() => setPos(Math.min(st.duration, st.position + (performance.now() - t0) / 1000)), 250)
    return () => window.clearInterval(t)
  }, [st])

  const cmd = (c: Parameters<typeof window.deck.spotify>[0]) => window.deck.spotify(c)

  if (!st || !st.running || !st.track) {
    return (
      <div className="tile tile-plugin spotify">
        <header className="pane-head">
          <span className="name">spotify</span>
        </header>
        <div className="plugin-empty">
          <span>{st && st.running ? 'Nothing playing' : 'Spotify is not running'}</span>
          <button className="ghost" onClick={() => cmd('open')}>
            open Spotify
          </button>
        </div>
      </div>
    )
  }

  const playing = st.state === 'playing'
  const pct = st.duration > 0 ? (pos / st.duration) * 100 : 0

  return (
    <div className="tile tile-plugin spotify">
      <header className="pane-head">
        <span className="name">spotify</span>
        <span className="cwd" title={st.album}>
          {st.album}
        </span>
      </header>
      <div className="spotify-body">
        {st.artworkUrl ? <img className="spotify-art" src={st.artworkUrl} alt="" draggable={false} onClick={() => cmd('open')} /> : <div className="spotify-art" />}
        <div className="spotify-meta">
          <div className="spotify-title" title={st.track}>
            {st.track}
          </div>
          <div className="spotify-artist" title={st.artist}>
            {st.artist}
          </div>
          <div className="spotify-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="spotify-row">
            <span className="spotify-time">
              {clock(pos)} / {clock(st.duration)}
            </span>
            <span className="spacer" />
            <div className="spotify-ctl">
              <button onClick={() => cmd('previous')} title="Previous">
                {'⏮︎'}
              </button>
              <button className="spotify-play" onClick={() => cmd('playpause')} title={playing ? 'Pause' : 'Play'}>
                {playing ? '⏸︎' : '▶︎'}
              </button>
              <button onClick={() => cmd('next')} title="Next">
                {'⏭︎'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
