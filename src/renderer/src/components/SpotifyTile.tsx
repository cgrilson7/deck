import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpotifyAccount, SpotifyItem, SpotifyLibrary, SpotifyState } from '@shared/types'
import { plain } from '../lib/errors'
import { useSettings } from '../lib/theme'

const SEARCH_DEBOUNCE_MS = 350
const GLYPH: Record<SpotifyItem['kind'], string> = { track: '♪', playlist: '▤', album: '◎', artist: '☻', show: '◉', episode: '◉' }

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Now playing in Spotify.app (artwork, track, artist, a progress bar, ⇄ ⏮ ⏯ ⏭), and a row of
 * chips that start something in Spotify.app: with an account connected, what you played lately,
 * then your playlists, then the `spotifyPlaylists` setting; without one, just the setting. A
 * connected account also gets a search line above the chips, whose hits take the row over
 * (Esc or an empty line brings the library back). Main polls the app over AppleScript while
 * this face is showing; the bar ticks locally between polls.
 */
export function SpotifyTile({ onSwap }: { onSwap: () => void }) {
  const settings = useSettings()
  const [st, setSt] = useState<SpotifyState | null>(null)
  const [pos, setPos] = useState(0)
  const [items, setItems] = useState<SpotifyItem[]>([])
  const [account, setAccount] = useState<SpotifyAccount | null>(null)
  const [library, setLibrary] = useState<SpotifyLibrary | null>(null)
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SpotifyItem[] | null>(null)
  const [picked, setPicked] = useState('')
  const [connecting, setConnecting] = useState(false)
  const chipsRef = useRef<HTMLDivElement>(null)

  useEffect(() => window.deck.onSpotify(setSt), [])
  useEffect(() => window.deck.onSpotifyAccount(setAccount), [])

  // The setting's chips: re-resolved when the setting changes (names are cached in main).
  const key = settings.spotifyPlaylists.join('\n')
  useEffect(() => {
    let live = true
    void window.deck.spotifyItems().then((xs) => live && setItems(xs))
    return () => {
      live = false
    }
  }, [key])

  // The account's chips, whenever the account is there (main caches; a play invalidates).
  const connected = !!account?.connected
  const loadLibrary = useCallback(() => {
    if (!connected) {
      setLibrary(null)
      return
    }
    window.deck
      .spotifyLibrary()
      .then((l) => {
        setLibrary(l)
        setNote('')
      })
      .catch((e) => setNote(plain(e)))
  }, [connected])
  useEffect(loadLibrary, [loadLibrary])

  useEffect(() => {
    if (!st) return
    setPos(st.position)
    if (st.state !== 'playing') return
    const t0 = performance.now()
    const t = window.setInterval(() => setPos(Math.min(st.duration, st.position + (performance.now() - t0) / 1000)), 250)
    return () => window.clearInterval(t)
  }, [st])

  // Search: a pause or ⏎ asks main; the hits replace the chips until the line is emptied.
  useEffect(() => {
    if (!connected || !query.trim()) {
      setHits(null)
      return
    }
    const t = window.setTimeout(() => {
      window.deck
        .spotifySearch(query)
        .then(setHits)
        .catch((e) => setNote(plain(e)))
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [query, connected])

  const cmd = (c: Parameters<typeof window.deck.spotify>[0]) => window.deck.spotify(c)
  const play = (uri: string) => {
    setPicked(uri)
    window.deck.spotifyPlay(uri)
    // Recent moves: re-read the library after Spotify has had a moment to register the play.
    window.setTimeout(loadLibrary, 4000)
  }
  const connect = () => {
    setConnecting(true)
    setNote('finish in the browser…')
    window.deck
      .spotifyConnect()
      .then(() => setNote(''))
      .catch((e) => setNote(plain(e)))
      .finally(() => setConnecting(false))
  }

  // One row of chips, scrolled sideways by the wheel; a chip for the library, or the hits.
  const chipList: SpotifyItem[] = (() => {
    if (hits) return hits
    const seen = new Set<string>()
    const out: SpotifyItem[] = []
    for (const it of [...(library?.recent ?? []), ...(library?.playlists ?? []), ...items]) {
      if (seen.has(it.uri)) continue
      seen.add(it.uri)
      out.push(it)
    }
    return out
  })()

  const chips = (
    <div className="spotify-chips" ref={chipsRef} onWheel={(e) => chipsRef.current && (chipsRef.current.scrollLeft += e.deltaY + e.deltaX)}>
      {account && !account.connected && (
        <button
          className="spotify-chip connect"
          disabled={!account.clientId || connecting}
          onClick={connect}
          title={account.clientId ? `Connect your Spotify account (the app's redirect URI must be ${account.redirectUri})` : 'set spotifyClientId in config.json to connect an account'}
        >
          {connecting ? 'connecting…' : 'connect account'}
        </button>
      )}
      {hits && hits.length === 0 && <span className="spotify-hint">no hits</span>}
      {chipList.map((it) => (
        <button key={it.uri} className={`spotify-chip${picked === it.uri ? ' on' : ''}`} onClick={() => play(it.uri)} title={`${it.kind}: ${it.name}${it.by ? ` · ${it.by}` : ''}`}>
          {hits && <i className="spotify-glyph">{GLYPH[it.kind]}</i>}
          {it.name}
        </button>
      ))}
    </div>
  )

  const search = connected && (
    <input
      className="spotify-search"
      value={query}
      placeholder={`search Spotify${account?.user ? ` · ${account.user}` : ''}`}
      spellCheck={false}
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setQuery('')
          e.currentTarget.blur()
        }
        if (e.key === 'Enter' && hits && hits[0]) play(hits[0].uri)
      }}
    />
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
          <span className="spotify-hint">{note || (st && st.running ? 'Spotify: nothing playing' : 'Spotify is not running')}</span>
          {!(st && st.running) && (
            <button className="ghost" onClick={() => cmd('open')}>
              open Spotify
            </button>
          )}
        </div>
        {search}
        {chips}
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
            {note || st.artist}
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
      {search}
      {chips}
      {swap}
    </div>
  )
}
