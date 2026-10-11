import { useEffect, useRef } from 'react'
import { Globe, Maximize2 } from 'lucide-react'
import type { WebApp } from '@shared/types'
import { dockFace, openWebApp, shortUrl, useWebSnap } from '../lib/webapps'
import { Fox } from './Fox'
import { CellTools } from '../lib/celltools'

/**
 * A web app as a grid cell: its name and the live page. The page itself lives in ONE webview
 * (WebLayer) — a second one here would be a second copy of the app — which is DOCKED over this
 * tile's face while the center shows something else (the face registers itself for that), so
 * the tile runs the page; ⤢ moves it to the center. The last snapshot sits under it while it loads.
 */
export function WebTile({ app }: { app: WebApp }) {
  const snap = useWebSnap(app.id)
  const open = () => openWebApp(app.id)
  const face = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dockFace(app.id, face.current)
    return () => dockFace(app.id, null)
  }, [app.id])
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
      <CellTools />
      </header>
      <div ref={face} className="webapp-face" onClick={open} title={`Open ${app.name}`}>
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
