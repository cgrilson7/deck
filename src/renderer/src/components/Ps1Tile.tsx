import { useEffect, useRef } from 'react'
import { Disc3, Maximize2 } from 'lucide-react'
import { ps1, usePs1 } from '../lib/ps1'
import { openPs1 } from '../lib/ps1events'
import { Fox } from './Fox'
import { CellTools } from '../lib/celltools'

/**
 * The PS1 as a grid cell: the screen, live, silent — an attract screen, the Pokemon tile's way. Click
 * it and the PANE takes the center column with the pad, the saves and the disc list. There is ONE
 * canvas (lib/ps1): while the pane has it, the tile says so instead of showing a second screen.
 */
export function Ps1Tile() {
  const st = usePs1()
  const face = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const m = ps1()
    m.autoload()
    return face.current ? m.attach(face.current, 'tile') : undefined
  }, [])

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const showing = st.running && st.view === 'tile'

  return (
    <div className="tile tile-plugin pokemon ps1" onClick={stop}>
      <header className="pane-head">
        <Disc3 size={13} className="pokemon-glyph" />
        <span className="name">PS1</span>
        {st.disc && (
          <span className="badge" title={st.disc.path}>
            {st.disc.name}
          </span>
        )}
        {st.paused && <span className="badge">paused</span>}
        <span className="spacer" />
        <button className="ghost" title="Play, full size in the center column" onClick={openPs1}>
          <Maximize2 size={12} />
        </button>
        <CellTools />
      </header>
      {/* The console as the tile: a TV above, the grey top of the PS1 below it (the lid, POWER with its lamp, RESET, OPEN). */}
      <div className="pokemon-face ps1-face" onClick={openPs1} title="Play">
        <div className="ps1-tv">
          <div ref={face} className="ps1-host" style={{ display: showing ? undefined : 'none' }} />
          {!showing && (
            <div className="plugin-empty">
              <Fox anim={st.loading ? 'run' : st.running ? 'look' : 'idle'} scale={2} />
              <span>{st.loading ?? (st.running ? 'playing in the center column' : st.error ? st.error : 'Open to pick a disc')}</span>
            </div>
          )}
        </div>
        <div className="ps1-top small">
          <span className={`ps1-lid ${st.running ? 'spin' : ''}`} />
          <span className="ps1-keys">
            <span className="ps1-key">
              <i className={`ps1-led ${st.running ? 'on' : ''}`} />
            </span>
            <span className="ps1-key" />
            <span className="ps1-open" />
          </span>
        </div>
      </div>
    </div>
  )
}
