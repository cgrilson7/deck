import { useRef } from 'react'

const HOME = 'https://www.youtube.com/'

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
        <button className="ghost" title="YouTube home" onClick={() => void ref.current?.loadURL(HOME)}>
          home
        </button>
      </header>
      <webview ref={ref} className="youtube-view" src={HOME} partition="persist:youtube" />
    </div>
  )
}
