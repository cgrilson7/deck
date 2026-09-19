import { useEffect, useRef, useState } from 'react'
import { Atom as AtomIcon, Maximize2, Plus } from 'lucide-react'
import { MOL_TILES_MAX, nextMolTile, type MolLibraryItem } from '@shared/types'
import { mol, openMol, useMol, type AtomInfo } from '../lib/mol'
import { patchSettings, useSettings } from '../lib/theme'
import { Fox } from './Fox'

/** The built-in library, for the chips of an empty viewer (the tile's and the pane's). */
export function useMolLibrary(): MolLibraryItem[] {
  const [lib, setLib] = useState<MolLibraryItem[]>([])
  useEffect(() => {
    let alive = true
    void window.deck
      .molLibrary()
      .then((l) => alive && setLib(l))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return lib
}

/** One picked atom in words: what it is, where it sits, what it carries. */
export function pickText(a: AtomInfo): string {
  const parts = [`${a.element}${a.name ? ` (${a.name})` : ''} #${a.id}`]
  if (a.resn) parts.push(`${a.resn} ${a.resi ?? ''}${a.chain ? ` · chain ${a.chain}` : ''}`.trim())
  if (a.charge != null) parts.push(`charge ${a.charge > 0 ? '+' : a.charge < 0 ? '−' : ''}${Math.abs(a.charge).toFixed(2)}`)
  if (a.plddt != null) parts.push(`pLDDT ${a.plddt.toFixed(0)}`)
  else if (a.b != null) parts.push(`B ${a.b.toFixed(1)}`)
  return parts.join(' · ')
}

/** Where tile `tile`'s viewer goes while this view is up (lib/mol moves its host here; the pane outranks the tile). */
export function MolStage({ tile, name, rank }: { tile: number; name: string; rank: number }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => (box.current ? mol(tile).mount(box.current, name, rank) : undefined), [tile, name, rank])
  return <div ref={box} className="mol-stage" />
}

/**
 * The molecule viewer as a grid cell: the scene (drag rotates, scroll zooms, a click picks an
 * atom and says what it is), a line to type a PDB id or a molecule's name into, and the
 * built-in library as chips while it is empty. It and the PANE opened from it show the same
 * viewer (lib/mol), so while the pane has it the tile only says so. THERE CAN BE SEVERAL
 * (`molTiles`), a viewer and a scene each, numbered in the head once there are: the head's +
 * opens another beside this one, and a session opens its own with `$DECK_MOL show … --new`.
 */
export function MolTile({ tile }: { tile: number }) {
  const st = useMol(tile)
  const { molTiles } = useSettings()
  const next = nextMolTile(molTiles)
  const library = useMolLibrary()
  const [text, setText] = useState('')
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const elsewhere = st.holder !== 'tile' && st.holder !== null
  const empty = st.models.length === 0
  const last = st.picks[st.picks.length - 1]

  return (
    <div className="tile tile-plugin mol" onClick={stop}>
      <header className="pane-head">
        <AtomIcon size={13} className="mol-glyph" />
        <span className="name" title={`Molecule tile ${tile}: a session reaches it with --tile ${tile}`}>
          Molecule{molTiles.length > 1 ? ` ${tile}` : ''}
        </span>
        {st.models.map((m) => (
          <span key={m.n} className="badge" title={`${m.target} · ${m.atoms} atoms · from ${m.source}`}>
            {m.name}
            {m.formula ? ` ${m.formula}` : ''}
          </span>
        ))}
        {st.busy && <span className="badge mol-busy">working…</span>}
        <span className="spacer" />
        <button className="ghost" disabled={next === null} title={next === null ? `${MOL_TILES_MAX} Molecule tiles is the most (a WebGL context each)` : 'Another Molecule tile, with a scene of its own'} onClick={() => next !== null && patchSettings({ molTiles: [...molTiles, next] })}>
          <Plus size={12} />
        </button>
        <button className="ghost" title="This viewer, full size in the center column, with its controls (⌘⇧A)" onClick={() => openMol(tile)}>
          <Maximize2 size={12} />
        </button>
      </header>
      <div className="mol-face">
        <MolStage tile={tile} name="tile" rank={0} />
        {elsewhere ? (
          <div className="plugin-empty mol-over">
            <Fox anim="idle" scale={2} />
            <span>showing in the center column</span>
          </div>
        ) : (
          empty && (
            <div className="plugin-empty mol-over">
              {st.busy ? <Fox anim="run" scale={2} /> : null}
              <span>{st.busy ? 'fetching…' : 'Pick a molecule, or type one below'}</span>
              {!st.busy && (
                <div className="mol-chips">
                  {library.map((l) => (
                    <button key={l.key} className="pill" title={l.name} onClick={() => void mol(tile).show(l.key)}>
                      {l.formula}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        {!elsewhere && last && <div className="mol-readout">{pickText(last)}</div>}
        {st.error && <div className="mol-error">{st.error}</div>}
      </div>
      <form
        className="mol-input"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (!t) return
          setText('')
          void mol(tile).show(t)
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="water · 1UBQ · AF-P0CG48 · caffeine · smiles:CCO" spellCheck={false} onKeyDown={stop} />
      </form>
    </div>
  )
}
