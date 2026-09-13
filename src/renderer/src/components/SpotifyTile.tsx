import { useEffect, useState } from 'react'
import type { SpotifyItem, SpotifyState } from '@shared/types'
import { useSettings } from '../lib/theme'

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Now playing in Spotify.app (artwork, track, artist, a progress bar, ⏮ ⏯ ⏭ and shuffle), and a
 * row of chips for the `spotifyPlaylists` setting that start one in Spotify.app. Main polls the
 * app over AppleScript while this face is showing; the bar ticks locally between polls.
 */
export function SpotifyTile({ onSwap }: { onSwap: () => void }) {
  const settings = useSettings()
  const [st, setSt] = useState<SpotifyState | null>(null)
  const [pos, setPos] = useState(0)
  const [items, setItems] = useState<SpotifyItem[]>([])
  const [picked, setPicked] = useState('')

  useEffect(() => window.deck.onSpotify(setSt), [])

  // The chips: re-resolved when the setting changes (names are cached in main).
  const key = settings.spotifyPlaylists.join('\n')
  useEffect(() => {
    let live = true
    void window.deck.spotifyItems().then((xs) => live && setItems(xs))
    return () => {
      live = false
    }
  }, [key])

  useEffect(() => {
    if (!st) return
    setPos(st.position)
    if (st.state !== 'playing') return
    const t0 = performance.now()
    const t = window.setInterval(() => setPos(Math.min(st.duration, st.position + (performance.now() - t0) / 1000)), 250)
    return () => window.clearInterval(t)
  }, [st])

  const cmd = (c: Parameters<typeof window.deck.spotify>[0]) => window.deck.spotify(c)
  const play = (uri: string) => {
    setPicked(uri)
    window.deck.spotifyPlay(uri)
  }

  const chips = items.length > 0 && (
    <div className="spotify-chips">
      {items.map((it) => (
        <button key={it.uri} className={`spotify-chip${picked === it.uri ? ' on' : ''}`} onClick={() => play(it.uri)} title={`${it.kind}: ${it.name}`}>
          {it.name}
        </button>
      ))}
    </div>
  )

  const swap = (
    <button className="music-swap" onClick={onSwap} title="Switch to the lofi stream (YouTube; nothing plays until you press ▶)">
      lofi ▸
    </button>
  )

  const hasTrack = st && st.running && st.track
  if (!hasTrack) {
    return (
      <div className="tile tile-plugin spotify">
        <div className="spotify-empty">
          <span className="spotify-hint">{st && st.running ? 'Spotify: nothing playing' : 'Spotify is not running'}</span>
          {chips}
          {!(st && st.running) && (
            <button className="ghost" onClick={() => cmd('open')}>
              open Spotify
            </button>
          )}
        </div>
        {swap}
      </div>
    )
  }

  const playing = st.state === 'playing'
  const pct = st.duration > 0 ? (pos / st.duration) * 100 : 0

  return (
    <div className="tile tile-plugin spotify">
      <div className="spotify-body">
        {st.artworkUrl ? <img className="spotify-art" src={st.artworkUrl} alt="" draggable={false} onClick={() => cmd('open')} /> : <div className="spotify-art" />}
        <div className="spotify-meta">
          <div className="spotify-title" title={st.track}>
            {st.track}
          </div>
          <div className="spotify-artist" title={st.album ? `${st.artist} · ${st.album}` : st.artist}>
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
              <button onClick={() => cmd('shuffle')} title={st.shuffling ? 'Shuffle on' : 'Shuffle off'} className={st.shuffling ? 'on' : ''}>
                {'⇄'}
              </button>
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
      {chips}
      {swap}
    </div>
  )
}
