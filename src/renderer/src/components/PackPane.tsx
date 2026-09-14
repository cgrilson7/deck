import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Fox } from './Fox'
import { packNeedy, packPose, packSize, packTiles, packWorking, type Pack } from './PackTile'

/**
 * A wolfpack "tapped into": the pane over the grid (where the file preview and Foxtrot's log
 * go, one at a time) with every beta as a full tile — its conversation, a prompt bar, a click
 * to focus it in the terminal. The head can park the pack (the conversations keep) or dismiss
 * it (the betas are killed). Esc closes, unless the keystroke came from a terminal.
 */
export function PackPane({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const { alpha, betas } = pack
  const n = packSize(pack)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest('.xterm')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const needs = packNeedy(pack)
  const working = packWorking(pack)
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3
  return (
    <section className="doc pack-pane" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="doc-scrim" onClick={onClose} />
      <div className="doc-panel">
        <header className="doc-head">
          <Fox anim={packPose(pack)} scale={1} coat="gold" />
          <span className="doc-name">wolfpack of slot {alpha.slot}</span>
          <span className="doc-where" title={alpha.name}>
            {alpha.name}
          </span>
          <span className="doc-meta">
            {pack.agents.length} subagent{pack.agents.length === 1 ? '' : 's'} · {betas.length} beta session{betas.length === 1 ? '' : 's'} · {working} working · {needs} need{needs === 1 ? 's' : ''} you
          </span>
          <span className="spacer" />
          <button className="doc-btn wide" title="Focus the alpha in the terminal" onClick={() => void window.deck.command({ type: 'focus', slot: alpha.slot! })}>
            alpha
          </button>
          {betas.length > 0 && (
            <>
              <button className="doc-btn wide" title="Park every beta session: the tiles go, the conversations stay resumable from the + chooser" onClick={() => void window.deck.command({ type: 'dismissPack', alpha: alpha.id, park: true })}>
                park betas
              </button>
              <button
                className="doc-btn wide danger"
                title="Kill every beta session and forget them (subagents are the alpha's own and are not touched)"
                onClick={() => {
                  if (confirm(`Dismiss the beta sessions of slot ${alpha.slot}? ${betas.length} will be killed.`)) void window.deck.command({ type: 'dismissPack', alpha: alpha.id })
                }}
              >
                dismiss betas
              </button>
            </>
          )}
          <button className="doc-btn" title="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <div className="pack-grid" style={{ ['--pc' as string]: cols }}>
          {packTiles(pack)}
        </div>
      </div>
    </section>
  )
}
