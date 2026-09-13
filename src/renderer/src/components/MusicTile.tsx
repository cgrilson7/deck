import type { MusicSource } from '@shared/types'
import { patchSettings } from '../lib/theme'
import { SpotifyTile } from './SpotifyTile'
import { YouTubeTile } from './YouTubeTile'

/**
 * The music cell of the plugin row: Spotify.app's now-playing by default, or the lofi YouTube
 * stream. The choice is the `music` setting (View ▸ Music, or the switch each face carries), so
 * only one face is mounted: on the Spotify face the stream's <webview> does not exist and
 * nothing is downloading. The stream face starts paused; it plays only when its ▶ is clicked.
 */
export function MusicTile({ source }: { source: MusicSource }) {
  const other = source === 'spotify' ? 'youtube' : 'spotify'
  const swap = () => patchSettings({ music: other })
  return source === 'youtube' ? <YouTubeTile onSwap={swap} /> : <SpotifyTile onSwap={swap} />
}
