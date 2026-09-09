import { useRef } from 'react'

const HOME = 'https://www.youtube.com/'
// Lofi Girl's "beats to relax/study to" 24/7 stream: what the tile opens on.
const LOFI = 'https://www.youtube.com/watch?v=jfKfPfyJRdk'

/**
 * YouTube in an Electron <webview> (its own persistent partition, so logins and history
 * stick between launches). Plain video playback needs no DRM, unlike Spotify's web player.
 */
export function YouTubeTile() {
  const ref = useRef<DeckWebview>(null)

  return (
    <div className="tile tile-plugin youtube">
      <header className="pane-head">
        <span className="name">youtube</span>
        <span className="spacer" />
        <button className="ghost" title="Back" onClick={() => ref.current?.canGoBack() && ref.current.goBack()}>
          ‹
        </button>
        <button className="ghost" title="Lofi Girl stream" onClick={() => void ref.current?.loadURL(LOFI)}>
          lofi
        </button>
        <button className="ghost" title="YouTube home" onClick={() => void ref.current?.loadURL(HOME)}>
          home
        </button>
      </header>
      <webview ref={ref} className="youtube-view" src={LOFI} partition="persist:youtube" />
    </div>
  )
}
