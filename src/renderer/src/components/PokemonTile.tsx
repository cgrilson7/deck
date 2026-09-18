import { useEffect, useRef } from 'react'
import { Gamepad2, Maximize2 } from 'lucide-react'
import { gameboy, useGameBoy } from '../lib/gameboy'
import { openPokemon } from '../lib/pokemon'
import { Fox } from './Fox'

/**
 * The Game Boy as a grid cell: the screen, live, silent — an attract screen. It has no
 * controls of its own; click anywhere on it and the PANE takes the center column with the
 * keys, the saves and the ROM list. The tile and the pane show the SAME machine (lib/gameboy),
 * so the game neither restarts nor pauses when the pane opens or closes.
 */
export function PokemonTile() {
  const st = useGameBoy()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    gameboy().autoload()
    return canvas.current ? gameboy().attach(canvas.current) : undefined
  }, [])

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div className="tile tile-plugin pokemon" onClick={stop}>
      <header className="pane-head">
        <Gamepad2 size={13} className="pokemon-glyph" />
        <span className="name">Pokemon</span>
        {st.rom && (
          <span className="badge" title={st.rom.path}>
            {st.rom.file.replace(/\.gbc?$/i, '')}
          </span>
        )}
        {st.paused && <span className="badge">paused</span>}
        <span className="spacer" />
        <button className="ghost" title="Play, full size in the center column (⌘⇧G)" onClick={openPokemon}>
          <Maximize2 size={12} />
        </button>
      </header>
      <div className="pokemon-face" onClick={openPokemon} title="Play (⌘⇧G)">
        <canvas ref={canvas} className="pokemon-canvas" style={{ display: st.rom ? undefined : 'none' }} />
        {!st.rom && (
          <div className="plugin-empty">
            <Fox anim={st.loading ? 'run' : 'idle'} scale={2} />
            <span>{st.loading ? 'loading the cartridge…' : st.error ? st.error : 'Open to pick a ROM'}</span>
          </div>
        )}
      </div>
    </div>
  )
}
