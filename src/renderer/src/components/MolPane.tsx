import { useEffect, useRef, useState } from 'react'
import { Atom as AtomIcon, Crosshair, RotateCw, Ruler, Trash2, X } from 'lucide-react'
import { mol, MOL_COLORS, MOL_LABELS, MOL_STYLES, MOL_SURFACES, openMol, useMol, useMolScenes, type MolColor, type SeqResidue } from '../lib/mol'
import { useSettings } from '../lib/theme'
import { MolStage, pickText, useMolLibrary } from './MolTile'
import { Fox } from './Fox'

/** The colour schemes that only mean something on a protein; a small molecule's row leaves them out. */
const PROTEIN_ONLY: MolColor[] = ['hydrophobicity', 'residue', 'chain', 'secondary', 'plddt', 'bfactor']

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || !!el.closest('.xterm'))
}

/**
 * The molecule viewer full size in the CENTER column, in the focus pane's place, the way the
 * Studio and the Game Boy take it. The same scene as the tile it was opened from (that tile's
 * viewer moves here; with several Molecule tiles a RAIL of chips, or ← → outside a field,
 * steps between them), plus what a tile has no room for: style / colour / surface / label rows, the picked
 * atoms and what to measure between them, the measurements, and — for a protein — the
 * SEQUENCE STRIP: the chain as one-letter residues in the active colours, two-way linked
 * with the 3D view, which is the "a 1D string becomes a 3D shape" picture.
 */
export function MolPane({ tile, onClose }: { tile: number; onClose: () => void }) {
  const st = useMol(tile)
  const { molTiles } = useSettings()
  const rail = useMolScenes(molTiles)
  const library = useMolLibrary()
  const [text, setText] = useState('')
  const [sel, setSel] = useState('')
  const pane = useRef<HTMLElement>(null)
  const m = mol(tile)

  useEffect(() => {
    pane.current?.focus()
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      if (e.key === 'Escape') onClose()
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.altKey && molTiles.length > 1) {
        const i = molTiles.indexOf(tile) + (e.key === 'ArrowLeft' ? -1 : 1)
        openMol(molTiles[(i + molTiles.length) % molTiles.length])
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onClose, tile, molTiles])

  const empty = st.models.length === 0
  const protein = st.models.some((x) => x.kind === 'protein')
  const colors = MOL_COLORS.filter((c) => (protein || !PROTEIN_ONLY.includes(c)) && (c !== 'model' || st.models.length > 1) && (c !== 'plddt' || st.models.some((x) => x.plddt)))
  const n = st.picks.length
  const measureWord = n === 2 ? 'distance' : n === 3 ? 'angle' : n === 4 ? 'dihedral' : null

  return (
    <section ref={pane} className="focus mol-pane" tabIndex={-1}>
      <header className="pane-head">
        <AtomIcon size={14} className="mol-glyph" />
        <span className="name">Molecule{molTiles.length > 1 ? ` ${tile}` : ''}</span>
        {st.models.map((x) => (
          <span key={x.n} className="badge" title={`${x.target} · from ${x.source}${x.chargeMethod ? ` · ${x.chargeMethod}` : ''}`}>
            {st.models.length > 1 ? `${x.n} · ` : ''}
            {x.name}
            {x.formula ? ` ${x.formula}` : ''} · {x.kind === 'protein' ? `${x.residues} residues` : `${x.atoms} atoms`}
          </span>
        ))}
        {st.compare && (
          <span className="badge mol-note" title={`${st.compare.pairs} pairs superposed; the ${st.compare.core} within 3 Å fit to ${st.compare.coreRmsd} Å`}>
            RMSD {st.compare.rmsd} Å
          </span>
        )}
        {st.busy && <span className="badge mol-busy">working…</span>}
        <span className="spacer" />
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      {rail.length > 1 && (
        <div className="mol-rail">
          {rail.map((r) => (
            <button key={r.tile} className={`pill ${r.tile === tile ? 'on' : ''}`} title={`Molecule tile ${r.tile} (← → steps between them)`} onClick={() => openMol(r.tile)}>
              <span className="mol-ref">{r.tile}</span> {r.label}
            </button>
          ))}
        </div>
      )}

      <div className="mol-face mol-face-pane">
        <MolStage tile={tile} name="pane" rank={1} />
        {empty && (
          <div className="plugin-empty mol-over">
            <Fox anim={st.busy ? 'run' : 'idle'} scale={3} />
            <span>{st.busy ? 'fetching…' : 'Pick a molecule, type one below, or let a session drive: /deck:mol'}</span>
            {!st.busy && (
              <div className="mol-chips">
                {library.map((l) => (
                  <button key={l.key} className="pill" title={`${l.formula} · ${l.atoms} atoms`} onClick={() => void m.show(l.key)}>
                    {l.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {st.error && <div className="mol-error">{st.error}</div>}
      </div>

      {protein && <SequenceStrip tile={tile} residues={st.sequence} hover={st.hover} />}

      <div className="mol-bar">
        {!empty && (
          <>
            <Row label="style">
              {MOL_STYLES.filter((s) => s !== 'surface' && (s !== 'cartoon' || protein)).map((s) => (
                <button key={s} className={`pill ${st.style === s ? 'on' : ''}`} onClick={() => m.act({ op: 'style', style: s })}>
                  {s}
                </button>
              ))}
            </Row>
            <Row label="colour">
              {colors.map((c) => (
                <button key={c} className={`pill ${st.color === c ? 'on' : ''}`} onClick={() => m.act({ op: 'style', color: c })} title={COLOR_HINT[c]}>
                  {c === 'plddt' ? 'pLDDT' : c === 'bfactor' ? 'B-factor' : c}
                </button>
              ))}
            </Row>
            <Row label="surface">
              {MOL_SURFACES.map((s) => (
                <button key={s} className={`pill ${st.surface === s ? 'on' : ''}`} onClick={() => m.act({ op: 'style', surface: s })} title={SURFACE_HINT[s]}>
                  {s === 'vdw' ? 'van der Waals' : s === 'sas' ? 'solvent-accessible' : s === 'electrostatic' ? 'by charge' : s}
                </button>
              ))}
              <span className="mol-sep" />
              <span className="mol-label">labels</span>
              {MOL_LABELS.map((l) => (
                <button key={l} className={`pill ${st.labels === l ? 'on' : ''}`} onClick={() => m.act({ op: 'style', labels: l })}>
                  {l}
                </button>
              ))}
            </Row>
            <Row label="view">
              <button className={`pill ${st.spin ? 'on' : ''}`} onClick={() => m.act({ op: 'view', spin: !st.spin })}>
                <RotateCw size={12} /> spin
              </button>
              <button className="pill" onClick={() => m.act({ op: 'view', reset: true })}>
                <Crosshair size={12} /> reset
              </button>
              <button className={`pill ${st.hbonds != null ? 'on' : ''}`} onClick={() => m.act(st.hbonds != null ? { op: 'highlight', off: true } : { op: 'highlight', hbonds: true })} title="Dash every hydrogen bond the geometry suggests">
                H-bonds{st.hbonds != null ? ` · ${st.hbonds}` : ''}
              </button>
              <form
                className="mol-inline"
                onSubmit={(e) => {
                  e.preventDefault()
                  m.act({ op: 'select', expr: sel.trim() })
                }}
              >
                <input value={sel} onChange={(e) => setSel(e.target.value)} placeholder="select: resi 48 · elem O · resn HIS and chain A" spellCheck={false} />
              </form>
              {st.selection && (
                <button
                  className="pill on"
                  title="Clear the selection"
                  onClick={() => {
                    setSel('')
                    m.act({ op: 'select', expr: '' })
                  }}
                >
                  {st.selection.atoms} atoms <X size={11} />
                </button>
              )}
              <span className="spacer" />
              <button className="pill" onClick={() => m.act({ op: 'clear' })} title="Empty the scene">
                <Trash2 size={12} /> clear
              </button>
            </Row>
          </>
        )}

        {(n > 0 || st.measures.length > 0) && (
          <div className="mol-lists">
            {n > 0 && (
              <div className="mol-list">
                <div className="mol-list-head">
                  <span className="mol-label">picked</span>
                  {measureWord && (
                    <button className="pill" onClick={() => m.act({ op: 'measure', atoms: st.picks.map((_, i) => `p${i + 1}`) })} title={`The ${measureWord} between the picked atoms, in the order picked`}>
                      <Ruler size={12} /> measure {measureWord}
                    </button>
                  )}
                  <button className="ghost" onClick={() => m.act({ op: 'unpick' })}>
                    clear
                  </button>
                </div>
                {st.picks.map((a, i) => (
                  <div key={a.id} className="mol-line">
                    <span className="mol-ref">p{i + 1}</span> {pickText(a)}
                  </div>
                ))}
              </div>
            )}
            {st.measures.length > 0 && (
              <div className="mol-list">
                <div className="mol-list-head">
                  <span className="mol-label">measurements</span>
                  <button className="ghost" onClick={() => m.act({ op: 'measure', clear: true })}>
                    clear
                  </button>
                </div>
                {st.measures.map((x, i) => (
                  <div key={i} className="mol-line">
                    <span className="mol-ref">
                      {x.value.toFixed(x.kind === 'distance' ? 2 : 1)}
                      {x.unit === 'Å' ? ' Å' : '°'}
                    </span>{' '}
                    {x.kind} · {x.atoms.map((a) => `${a.name ?? a.elem}${a.resn ? `(${a.resn}${a.resi ?? ''})` : ''}#${a.id}`).join(' – ')}
                    <button className="ghost mol-x" title="Remove" onClick={() => m.act({ op: 'unmeasure', index: i })}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <form
          className="mol-input"
          onSubmit={(e) => {
            e.preventDefault()
            const t = text.trim()
            if (!t) return
            setText('')
            void m.show(t)
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="show: water · 1UBQ · AF-P0CG48 · caffeine · smiles:CCO · ~/path/to/file.pdb" spellCheck={false} />
        </form>
      </div>
    </section>
  )
}

const COLOR_HINT: Record<string, string> = {
  element: 'Each atom its element’s colour: oxygen red, nitrogen blue, hydrogen white',
  charge: 'Partial charge: red where electrons pile up (δ−), blue where they are pulled away (δ+)',
  hydrophobicity: 'Kyte–Doolittle: orange residues avoid water, blue ones seek it',
  residue: 'Side-chain chemistry: oily, aromatic, polar, + charged, − charged, and Gly / Pro / Cys on their own',
  chain: 'One colour per chain',
  secondary: 'Helix red, sheet yellow, the rest grey',
  plddt: 'AlphaFold’s confidence per residue: deep blue = sure, orange = a guess',
  bfactor: 'How much each atom moved in the crystal: blue still, red restless',
  model: 'One colour per loaded structure'
}
const SURFACE_HINT: Record<string, string> = {
  none: 'No surface',
  vdw: 'The atoms’ own spheres, fused',
  sas: 'Where the centre of a water molecule could roll',
  electrostatic: 'The van der Waals surface, coloured by partial charge (not a computed potential)'
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mol-row">
      <span className="mol-label">{label}</span>
      {children}
    </div>
  )
}

/** The chain as letters. Hover a letter = its residue named in 3D; click = pick its Cα (and the other way round); double-click zooms to it. */
function SequenceStrip({ tile, residues, hover }: { tile: number; residues: SeqResidue[]; hover: string | null }) {
  const box = useRef<HTMLDivElement>(null)
  // A residue hovered in 3D is brought into view here.
  useEffect(() => {
    if (!hover || !box.current || box.current.matches(':hover')) return
    box.current.querySelector(`[data-k="${CSS.escape(hover)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [hover])
  const m = mol(tile)
  let last = ''
  return (
    <div ref={box} className="mol-seq" onMouseLeave={() => m.setHover(null)}>
      {residues.map((r) => {
        const chain = `${r.model}:${r.chain}`
        const lead = chain !== last
        last = chain
        return (
          <span key={r.key} className="mol-seq-cell">
            {lead && <span className="mol-seq-chain">{r.chain || `model ${r.model}`}</span>}
            <span
              data-k={r.key}
              className={`mol-res ${hover === r.key ? 'hover' : ''} ${r.picked ? 'picked' : ''} ${r.selected ? 'selected' : ''} ${r.resi % 10 === 0 ? 'tick' : ''}`}
              style={r.color ? { background: r.color, color: '#1a1917' } : undefined}
              data-n={r.resi % 10 === 0 ? r.resi : undefined}
              title={`${r.resn} ${r.resi}${r.chain ? ` · chain ${r.chain}` : ''}`}
              onMouseEnter={() => m.setHover(r.key)}
              onClick={() => {
                const a = m.residueAtom(r.key)
                if (a) m.act({ op: 'pick', atom: a })
              }}
              onDoubleClick={() => m.zoomResidue(r.key)}
            >
              {r.one}
            </span>
          </span>
        )
      })}
    </div>
  )
}
