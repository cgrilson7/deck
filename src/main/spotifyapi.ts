// The connected account's side of the Spotify face: the user's playlists, what they played
// lately, and search — all read through the Web API with SpotifyAuth's token. Playback itself
// stays with Spotify.app over AppleScript (main/spotify.ts), which needs no Premium.

import type { SpotifyItem, SpotifyLibrary } from '@shared/types'
import type { SpotifyAuth } from './spotifyauth'

const API = 'https://api.spotify.com/v1'
const LIBRARY_TTL_MS = 5 * 60 * 1000
const RECENT_CONTEXTS = 8
const PLAYLIST_PAGES = 4

interface Page<T> {
  items: (T | null)[]
  next: string | null
}
interface PlaylistJson {
  uri: string
  name: string
  owner?: { display_name?: string }
}
interface AlbumJson {
  uri: string
  name: string
  artists?: { name: string }[]
}
interface ArtistJson {
  uri: string
  name: string
}
interface TrackJson {
  uri: string
  name: string
  artists?: { name: string }[]
}

const artists = (a?: { name: string }[]): string => (a ?? []).map((x) => x.name).join(', ')

export class SpotifyApi {
  private library: { at: number; value: Promise<SpotifyLibrary> } | null = null
  private readonly contextNames = new Map<string, Promise<SpotifyItem | null>>()

  constructor(private readonly auth: SpotifyAuth) {}

  /** Recent contexts, then every playlist in the library. Cached LIBRARY_TTL_MS; `fresh` skips the cache. */
  async libraryOf(fresh = false): Promise<SpotifyLibrary> {
    const now = Date.now()
    if (!fresh && this.library && now - this.library.at < LIBRARY_TTL_MS) return this.library.value
    const value = (async (): Promise<SpotifyLibrary> => {
      const [recent, playlists] = await Promise.all([this.recent(), this.playlists()])
      return { recent, playlists }
    })()
    this.library = { at: now, value }
    value.catch(() => (this.library = null))
    return value
  }

  /** Something was played: recent changes, so the next read is fresh. */
  invalidate(): void {
    this.library = null
  }

  forget(): void {
    this.library = null
    this.contextNames.clear()
  }

  async search(q: string): Promise<SpotifyItem[]> {
    const query = q.trim()
    if (!query) return []
    const params = new URLSearchParams({ q: query, type: 'track,playlist,album,artist', limit: '6' })
    const j = (await this.auth.api(`${API}/search?${params}`)) as {
      tracks?: Page<TrackJson>
      playlists?: Page<PlaylistJson>
      albums?: Page<AlbumJson>
      artists?: Page<ArtistJson>
    }
    const out: SpotifyItem[] = []
    for (const t of (j.tracks?.items ?? []).slice(0, 4)) if (t) out.push({ uri: t.uri, kind: 'track', name: t.name, by: artists(t.artists) })
    for (const p of (j.playlists?.items ?? []).slice(0, 4)) if (p) out.push({ uri: p.uri, kind: 'playlist', name: p.name, by: p.owner?.display_name })
    for (const a of (j.albums?.items ?? []).slice(0, 3)) if (a) out.push({ uri: a.uri, kind: 'album', name: a.name, by: artists(a.artists) })
    for (const a of (j.artists?.items ?? []).slice(0, 3)) if (a) out.push({ uri: a.uri, kind: 'artist', name: a.name })
    return out
  }

  private async playlists(): Promise<SpotifyItem[]> {
    const out: SpotifyItem[] = []
    let url: string | null = `${API}/me/playlists?limit=50`
    for (let i = 0; url && i < PLAYLIST_PAGES; i++) {
      const page = (await this.auth.api(url)) as Page<PlaylistJson>
      for (const p of page.items) if (p) out.push({ uri: p.uri, kind: 'playlist', name: p.name, by: p.owner?.display_name })
      url = page.next
    }
    return out
  }

  /** The distinct contexts (playlist / album / artist) of the last 50 plays, newest first, named. */
  private async recent(): Promise<SpotifyItem[]> {
    const j = (await this.auth.api(`${API}/me/player/recently-played?limit=50`)) as Page<{ context?: { uri: string } | null }>
    const uris: string[] = []
    for (const it of j.items) {
      const uri = it?.context?.uri
      if (uri && /^spotify:(playlist|album|artist):[A-Za-z0-9]+$/.test(uri) && !uris.includes(uri)) uris.push(uri)
      if (uris.length >= RECENT_CONTEXTS) break
    }
    const named = await Promise.all(uris.map((u) => this.contextItem(u)))
    return named.filter((x): x is SpotifyItem => x !== null)
  }

  private contextItem(uri: string): Promise<SpotifyItem | null> {
    let p = this.contextNames.get(uri)
    if (!p) {
      const [, kind, id] = uri.split(':') as [string, 'playlist' | 'album' | 'artist', string]
      p = (async (): Promise<SpotifyItem | null> => {
        if (kind === 'playlist') {
          const j = (await this.auth.api(`${API}/playlists/${id}?fields=name,owner.display_name`)) as PlaylistJson
          return { uri, kind, name: j.name, by: j.owner?.display_name }
        }
        if (kind === 'album') {
          const j = (await this.auth.api(`${API}/albums/${id}`)) as AlbumJson
          return { uri, kind, name: j.name, by: artists(j.artists) }
        }
        const j = (await this.auth.api(`${API}/artists/${id}`)) as ArtistJson
        return { uri, kind, name: j.name }
      })().catch(() => {
        this.contextNames.delete(uri)
        return null
      })
      this.contextNames.set(uri, p)
    }
    return p
  }
}
