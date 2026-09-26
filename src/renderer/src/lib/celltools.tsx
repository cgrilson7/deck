// A grid cell's own controls — the grip (⠿) that drags it and a mini app's × — drawn INSIDE the
// tile's head, as the rightmost buttons of its row, never floating over them. `GridCell` puts
// them in this context; a tile with a head ends the head with `<CellTools />`; a tile without
// one (Wikipedia, Music, the vocabulary and translator boxes) gets them floating top right
// instead (`.cell-float`, hidden by CSS as soon as a `.cell-tools` is in the cell).

import { createContext, useContext, type ReactNode } from 'react'

export const CellToolsContext = createContext<ReactNode>(null)

/** The cell's grip and ×, inline. Renders nothing outside a grid cell (a pane, the phone). */
export function CellTools() {
  const tools = useContext(CellToolsContext)
  return tools ? <span className="cell-tools">{tools}</span> : null
}
