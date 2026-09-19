import { Globe, Maximize2 } from 'lucide-react'
import type { WebApp } from '@shared/types'
import { openWebApp, shortUrl, useWebSnap } from '../lib/webapps'
import { Fox } from './Fox'

/**
 * A web app as a grid cell: its name and the last snapshot of its page. The page itself lives
 * in ONE webview, in the center column (WebLayer) — a second one here would be a second copy
 * of the app — so the tile is a door: click it and the app takes the center, as it was left.
 */
export function WebTile({ app }: { app: WebApp }) {
  const snap = useWebSnap(app.id)
  const open = () => openWebApp(app.id)
  return (
    <div className="tile tile-plugin webapp" onClick={(e) => e.stopPropagation()}>
      <header className="pane-head">
        <Globe size={13} className="webapp-glyph" />
        <span className="name">{app.name}</span>
        <span className="badge" title={app.url}>
          {shortUrl(app.url)}
        </span>
        <span className="spacer" />
        <button className="ghost" title={`Open ${app.name} in the center column`} onClick={open}>
          <Maximize2 size={12} />
        </button>
      </header>
      <div className="webapp-face" onClick={open} title={`Open ${app.name}`}>
        {snap ? (
          <img className="webapp-snap" src={snap} alt="" draggable={false} />
        ) : (
          <div className="plugin-empty">
            <Fox anim="idle" scale={2} />
            <span>Open {app.name}</span>
          </div>
        )}
      </div>
    </div>
  )
}
