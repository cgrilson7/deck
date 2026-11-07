import { useEffect, useRef } from 'react'
import { Circle, Maximize2, Tv } from 'lucide-react'
import { ps2, usePs2 } from '../lib/ps2'
import { openPs2 } from '../lib/ps2events'
import { Fox } from './Fox'
import { FoxtrotPlays, stageRect } from './FoxtrotPlays'
import { CellTools } from '../lib/celltools'

/**
 * PCSX2 as a grid cell, dressed as "FOXTROT PLAYS …" (the 9:16 stage, scaled to the cell: make the cell
 * taller with ↕ to see it large). Its picture is PCSX2's window, live; the pad lights with the real
 * controller. Click it and the pane takes the center column to play; ● lays the recorder over it.
 */
export function Ps2Tile() {
  const v = usePs2()
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => (canvas.current ? ps2().attach(canvas.current) : undefined), [])

  const st = v.status
  const say = !st ? 'looking for PCSX2…' : !st.installed ? 'PCSX2 is not in /Applications' : !st.running ? 'Open to start a disc' : !st.window ? 'PCSX2 has no game window open' : v.error ? v.error : 'connecting…'
  const record = (e: React.MouseEvent) => {
    e.stopPropagation()
    const r = stageRect(stage.current)
    if (r) window.deck.ps2Record(r)
  }

  return (
    <div className="tile tile-plugin pokemon ps2" onClick={(e) => e.stopPropagation()}>
      <header className="pane-head">
        <Tv size={13} className="pokemon-glyph" />
        <span className="name">PS2</span>
        {st?.game && <span className="badge">{st.game}</span>}
        <span className="spacer" />
        <button className="ghost" title="Record this 9:16 frame (the screen recorder, laid over it)" onClick={record}>
          <Circle size={11} className="fp-rec-dot" />
        </button>
        <button className="ghost" title="Play, full size in the center column" onClick={openPs2}>
          <Maximize2 size={12} />
        </button>
        <CellTools />
      </header>
      <div className="ps2-face fp-host" onClick={openPs2} title="Play">
        <FoxtrotPlays
          game={st?.game ?? null}
          canvasRef={canvas}
          live={v.live}
          stageRef={stage}
          empty={
            <>
              <Fox anim={st?.running && !v.error ? 'run' : 'idle'} scale={8} />
              <span>{say}</span>
            </>
          }
        />
      </div>
    </div>
  )
}
