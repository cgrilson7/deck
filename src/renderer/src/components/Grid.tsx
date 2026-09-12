import type { DeckSettings, DeckState, SessionView } from '@shared/types'
import { GitTile } from './GitTile'
import { PlusTile } from './PlusTile'
import { Tile } from './Tile'
import { TranslateTile } from './TranslateTile'
import { VocabTile } from './VocabTile'
import { WikiTile } from './WikiTile'
import { YouTubeTile } from './YouTubeTile'

/**
 * The right-hand column: a grid of cap-1 session cells, then a row of plugins (Wikipedia,
 * YouTube) the same height as one grid row. Sessions needing you come first, then slot
 * order. The first empty cell is the +, unless every slot is open. The changes, vocabulary and
 * translator tiles take the last cells (in that order) and main's cap is one lower per tile
 * shown, so the counts still agree.
 */
export function Grid({ sessions, state, settings }: { sessions: SessionView[]; state: DeckState; settings: DeckSettings }) {
  // Six cells either way: main lowers its cap by one per plugin tile holding a cell.
  const sessionCells = state.cap - 1
  const cells = sessionCells + Number(settings.showGit) + Number(settings.showVocab) + Number(settings.showTranslate)
  const focused = state.open.find((s) => s.slot === state.focusSlot) ?? null
  const cols = Math.max(1, Math.min(cells, settings.gridColumns))
  const rows = Math.ceil(cells / cols)
  const canAdd = state.open.length < state.cap
  const plugins = !settings.compact && (settings.showWiki || settings.showYouTube)

  const items: React.ReactNode[] = sessions.map((s) => <Tile key={s.id} session={s} />)
  if (canAdd && items.length < sessionCells) items.push(<PlusTile key="plus" state={state} />)
  while (items.length < sessionCells) items.push(<div key={`blank-${items.length}`} className="tile tile-blank" />)
  if (settings.showGit) items.push(<GitTile key="git" session={focused} />)
  if (settings.showVocab) items.push(<VocabTile key="vocab" />)
  if (settings.showTranslate) items.push(<TranslateTile key="translate" />)

  return (
    <section className="grid-col">
      <div className="grid" style={{ ['--cols' as string]: cols, ['--rows' as string]: rows }}>
        {items}
      </div>
      {plugins && (
        <div className="plugins">
          {settings.showWiki && <WikiTile />}
          {settings.showYouTube && <YouTubeTile />}
        </div>
      )}
    </section>
  )
}
