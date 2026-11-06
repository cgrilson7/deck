import { useEffect, useRef } from 'react'
import { Maximize2, Tv } from 'lucide-react'
import { ps2, usePs2 } from '../lib/ps2'
import { openPs2 } from '../lib/ps2events'
import { Fox } from './Fox'
import { CellTools } from '../lib/celltools'

/**
 * PCSX2 as a grid cell: its game window, live and silent-looking (PCSX2 plays its own sound), in a black
 * PS2's front — the green lamp lit while PCSX2 runs, the blue one while the picture is live. Click it and
 * the pane takes the center column to play.
 */
export function Ps2Tile() {
  const v = usePs2()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => (canvas.current ? ps2().attach(canvas.current) : undefined), [])

  const st = v.status
  const say = !st ? 'looking for PCSX2…' : !st.installed ? 'PCSX2 is not in /Applications' : !st.running ? 'Open to start a disc' : !st.window ? 'PCSX2 has no game window open' : v.error ? v.error : 'connecting…'

  return (
    <div className="tile tile-plugin pokemon ps2" onClick={(e) => e.stopPropagation()}>
      <header className="pane-head">
        <Tv size={13} className="pokemon-glyph" />
        <span className="name">PS2</span>
        {st?.window?.title && <span className="badge">{st.window.title}</span>}
        <span className="spacer" />
        <button className="ghost" title="Play, full size in the center column" onClick={openPs2}>
          <Maximize2 size={12} />
        </button>
        <CellTools />
      </header>
      <div className="pokemon-face ps2-face" onClick={openPs2} title="Play">
        <div className="ps1-tv">
          <canvas ref={canvas} className="ps2-canvas" style={{ display: v.live ? undefined : 'none' }} />
          {!v.live && (
            <div className="plugin-empty">
              <Fox anim={st?.running && !v.error ? 'run' : 'idle'} scale={2} />
              <span>{say}</span>
            </div>
          )}
        </div>
        <div className="ps2-front small">
          <i className={`ps2-lamp green ${st?.running ? 'on' : ''}`} />
          <i className={`ps2-lamp blue ${v.live ? 'on' : ''}`} />
        </div>
      </div>
    </div>
  )
}
