// The Space tile and pane: ~/space's disk pathways (lib/space.ts; main/space.ts). The TILE is
// the glance — free space, its trend, what waits on a decision. The PANE takes the center: every
// category with its pathway and standing approval, and its items, each decided here. Nothing is
// deleted or moved except by a click on that item (or that category's "all"), and anything
// that goes for good asks a second click first.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Cloud, HardDrive, Maximize2, RefreshCw, Trash2, Undo2, Check, FolderOpen } from 'lucide-react'
import type { SpaceCategory, SpaceItem, SpacePathway, SpaceStatus, TrashGame } from '@shared/types'
import { CellTools } from '../lib/celltools'
import { Fox } from './Fox'
import { ago, fmtBytes, openSpace, spaceAct, useSpace } from '../lib/space'

const PATHWAY_WORD: Record<SpacePathway, string> = {
  delete: 'delete',
  cloud: 'iCloud Drive',
  keep: 'keep',
  review: 'you decide each',
  manual: 'by hand, in the app'
}

function DiskBar({ st }: { st: SpaceStatus }) {
  if (!st.disk) return null
  const usedPct = (st.disk.used / st.disk.total) * 100
  const pendPct = Math.min(usedPct, (st.pending.bytes / st.disk.total) * 100)
  return (
    <div className={`space-bar ${usedPct > 90 ? 'full' : usedPct > 80 ? 'tight' : ''}`} title={`${fmtBytes(st.disk.used)} used · ${fmtBytes(st.pending.bytes)} of it waiting on a decision · ${fmtBytes(st.disk.free)} free`}>
      <span className="space-bar-used" style={{ width: `${usedPct - pendPct}%` }} />
      <span className="space-bar-pending" style={{ width: `${pendPct}%` }} />
    </div>
  )
}

function Spark({ st }: { st: SpaceStatus }) {
  const pts = st.recent ?? []
  if (pts.length < 2) return null
  const max = Math.max(...pts.map((p) => p.free))
  const min = Math.min(...pts.map((p) => p.free))
  const span = max - min || 1
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * 100},${28 - ((p.free - min) / span) * 26}`).join(' ')
  return (
    <svg className="space-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="free space over the last scans">
      <polyline points={d} />
    </svg>
  )
}

/** The victory lap lasts this long after an empty. */
const LAP_MS = 6000

function useLap(lapAt: number): boolean {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!lapAt || Date.now() - lapAt > LAP_MS) return
    const t = window.setTimeout(() => tick((n) => n + 1), LAP_MS - (Date.now() - lapAt) + 50)
    return () => window.clearTimeout(t)
  }, [lapAt])
  return !!lapAt && Date.now() - lapAt < LAP_MS
}

/** The Trash game on the tile: one line, and Foxtrot running a lap across it after an empty. */
function TrashRow({ g, lapAt }: { g: TrashGame | null; lapAt: number }) {
  const lap = useLap(lapAt)
  if (!g) return null
  if (g.unreadable) return <div className="trash-row"><Trash2 size={11} /> <small>the Trash is not readable</small></div>
  return (
    <div className={`trash-row ${lap ? 'lap' : ''}`} title={`Empty the Trash to score. ${g.rank}${g.next ? `: ${fmtBytes(g.next.bytesToGo)} to ${g.next.name}` : ''}`}>
      <Trash2 size={11} />
      {lap && g.emptied ? <b>emptied {fmtBytes(g.emptied.bytes)}!</b> : <b>{fmtBytes(g.now?.bytes ?? 0)}</b>}
      {!lap && <small>{g.now?.items ?? 0} items</small>}
      <span className="spacer" />
      <small className="trash-rank">{g.rank}</small>
      {g.streak > 0 && <small>· {g.streak}d clean</small>}
      {lap && (
        <span className="trash-lap">
          <Fox anim="run" scale={1} />
        </span>
      )}
    </div>
  )
}

/** The Trash game in the pane: the scoreboard, the rank's progress, the last empties, and a button to empty it. */
function TrashCard({ g, lapAt, busy }: { g: TrashGame | null; lapAt: number; busy: boolean }) {
  const lap = useLap(lapAt)
  if (!g) return null
  return (
    <section className={`space-cat trash-card ${lap ? 'lap' : ''}`}>
      <header className="space-cat-head">
        <Trash2 size={13} />
        <span className="space-cat-name">The Trash game</span>
        <span className="spacer" />
        {lap && <Fox anim="leap" scale={2} />}
      </header>
      {g.unreadable ? (
        <p className="space-why">The deck cannot read ~/.Trash ({g.unreadable}).</p>
      ) : (
        <>
          <div className="space-free">
            <b>{fmtBytes(g.now?.bytes ?? 0)}</b> in {g.now?.items ?? 0} items
            <span className="spacer" />
            <ArmButton disabled={busy || !g.now?.bytes} armed={<>sure? empty it</>} onFire={() => void spaceAct({ op: 'emptyTrash' }, 'emptying the Trash')} title="Finder's Empty Trash. Gone for good.">
              <Trash2 size={11} /> empty it
            </ArmButton>
          </div>
          <div className="trash-rankline">
            <span className="trash-rank">{g.rank}</span>
            {g.next && (
              <>
                <span className="trash-progress">
                  <span style={{ width: `${Math.min(100, g.next.progress * 100)}%` }} />
                </span>
                <small>{fmtBytes(g.next.bytesToGo)} to {g.next.name}</small>
              </>
            )}
          </div>
          <p className="space-why">
            Lifetime <b>{fmtBytes(g.totalBytes)}</b> over {g.empties} empt{g.empties === 1 ? 'y' : 'ies'}
            {g.biggestBytes > 0 && <> · biggest {fmtBytes(g.biggestBytes)}</>} · clean-day streak <b>{g.streak}</b> (a clean day stays under {g.cleanMB} MB)
          </p>
          {g.recent.length > 0 && (
            <ul className="space-top">
              {g.recent.map((e) => (
                <li key={e.ts}>
                  <span>{new Date(e.ts).toLocaleString()}</span>
                  <span className="spacer" />
                  <small>
                    {fmtBytes(e.bytes)} · {e.items} items
                  </small>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function statusWord(st: SpaceStatus | null): { word: string; cls: string } {
  if (!st) return { word: 'no scan', cls: '' }
  if (st.scanning) return { word: 'scanning', cls: 'busy' }
  if (st.needsAction) return { word: 'needs you', cls: 'needs' }
  return { word: 'ok', cls: 'ok' }
}

export function SpaceTile() {
  const { status: st, trash, lapAt } = useSpace()
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const w = statusWord(st)
  const top = st ? [...st.categories].filter((c) => c.pendingBytes > 0).sort((a, b) => b.pendingBytes - a.pendingBytes).slice(0, 4) : []
  return (
    <div className={`tile tile-plugin space-tile ${st?.needsAction ? 'space-needs' : ''}`} onClick={stop}>
      <header className="pane-head">
        <HardDrive size={13} className="space-glyph" />
        <span className="name">Space</span>
        <span className={`badge space-badge ${w.cls}`}>{w.word}</span>
        <span className="spacer" />
        <button className="ghost" title="Every category and item, in the center column (⌘⇧S)" onClick={openSpace}>
          <Maximize2 size={12} />
        </button>
        <CellTools />
      </header>
      <div className="space-face" onClick={openSpace} title="Review (⌘⇧S)">
        {!st ? (
          <p className="space-empty">
            No scan yet. Run <code>node ~/space/bin/space.mjs scan</code>.
          </p>
        ) : (
          <>
            <div className="space-free">
              <b>{st.disk ? fmtBytes(st.disk.free) : '?'}</b> free
              {st.disk && <small> of {fmtBytes(st.disk.total)}</small>}
              <span className="spacer" />
              <small>scanned {ago(st.lastScan)}</small>
            </div>
            <DiskBar st={st} />
            <Spark st={st} />
            <div className="space-pending">
              {st.pending.count ? (
                <>
                  <b>{fmtBytes(st.pending.bytes)}</b> in {st.pending.count} item{st.pending.count === 1 ? '' : 's'} waiting on you
                </>
              ) : (
                'nothing waiting'
              )}
            </div>
            <TrashRow g={trash} lapAt={lapAt} />
            <ul className="space-top">
              {top.map((c) => (
                <li key={c.id}>
                  <span>{c.label}</span>
                  <span className="spacer" />
                  <small>{fmtBytes(c.pendingBytes)}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

/** A button that asks twice: the first click arms it (red, "sure?"), the second fires; it disarms after 3s. */
function ArmButton({ children, armed, onFire, disabled, title }: { children: ReactNode; armed: ReactNode; onFire: () => void; disabled?: boolean; title?: string }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!on) return
    const t = window.setTimeout(() => setOn(false), 3000)
    return () => window.clearTimeout(t)
  }, [on])
  return (
    <button
      className={`pill space-act ${on ? 'armed' : ''}`}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        if (on) {
          setOn(false)
          onFire()
        } else setOn(true)
      }}
    >
      {on ? armed : children}
    </button>
  )
}

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const tildeOf = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

function ItemRow({ it, cat, busy }: { it: SpaceItem; cat: SpaceCategory; busy: boolean }) {
  const pathway = it.as ?? cat.pathway
  const act = (req: Parameters<typeof spaceAct>[0], label: string) => void spaceAct(req, label)
  const retry = it.status === 'failed' || it.status === 'waiting'
  const [open, setOpen] = useState(false)
  return (
    <li className={`space-item st-${it.status}`}>
      <div className="space-item-main">
        <button className="space-item-name" title={`${tildeOf(it.path)}: show in Finder`} onClick={() => window.deck.revealPath(it.files?.[0] ?? it.path)}>
          <FolderOpen size={11} /> {it.label ?? base(it.path)}
        </button>
        <span className="spacer" />
        <small className="space-size">{fmtBytes(it.bytes)}</small>
      </div>
      <div className="space-item-sub">
        <small>{tildeOf(it.path)}</small>
        <small> · touched {ago(it.touched)}</small>
        {it.files && (
          <button className="linkish" onClick={() => setOpen((v) => !v)}>
            {open ? 'hide files' : `${it.files.length} files`}
          </button>
        )}
      </div>
      {open && it.files && (
        <ul className="space-files">
          {it.files.map((f) => (
            <li key={f}>
              <button className="linkish" onClick={() => window.deck.revealPath(f)}>
                {base(f)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {it.note && <div className="space-note">{it.note}</div>}
      {it.result && it.status !== 'kept' && <div className={`space-result ${it.status}`}>{it.result}</div>}
      <div className="space-item-acts">
        {it.status === 'kept' ? (
          <button className="pill space-act" disabled={busy} onClick={() => act({ op: 'reopen', ids: [it.id] }, 'undo')}>
            <Undo2 size={11} /> ask again
          </button>
        ) : pathway === 'manual' ? (
          <button className="pill space-act" disabled={busy} onClick={() => act({ op: 'keep', ids: [it.id] }, 'handled')} title="You dealt with it (or chose not to). It comes back only if it doubles.">
            <Check size={11} /> handled
          </button>
        ) : (
          <>
            {(pathway === 'delete' || pathway === 'review') && (
              <ArmButton disabled={busy} armed={<>sure? delete</>} onFire={() => act({ op: 'approve', ids: [it.id], ...(pathway === 'review' || it.dirty ? { as: 'delete' as const } : {}) }, 'deleting')} title={it.dirty ? 'Has uncommitted changes: this removes them too' : undefined}>
                <Trash2 size={11} /> {retry && cat.pathway === 'delete' ? 'retry' : it.dirty ? 'delete anyway' : 'delete'}
              </ArmButton>
            )}
            {(pathway === 'cloud' || pathway === 'review') && (
              <button className="pill space-act" disabled={busy} onClick={() => act({ op: 'approve', ids: [it.id], ...(pathway === 'review' ? { as: 'cloud' as const } : {}) }, 'archiving')} title="Move to iCloud Drive › Space Archive; the local copy is dropped once it has uploaded">
                <Cloud size={11} /> {retry && cat.pathway === 'cloud' ? 'retry' : 'to iCloud'}
              </button>
            )}
            <button className="pill space-act" disabled={busy} onClick={() => act({ op: 'keep', ids: [it.id] }, 'keeping')} title="Keep it. Not asked again unless it doubles in size.">
              keep
            </button>
          </>
        )}
      </div>
    </li>
  )
}

const SHOW = 6

function CategoryCard({ cat, items, busy }: { cat: SpaceCategory; items: SpaceItem[]; busy: boolean }) {
  const [all, setAll] = useState(false)
  const [kept, setKept] = useState(false)
  const live = items.filter((i) => i.status !== 'kept')
  const keptItems = items.filter((i) => i.status === 'kept')
  const shown = all ? live : live.slice(0, SHOW)
  const bulk = live.filter((i) => (i.status === 'pending' || i.status === 'failed' || i.status === 'waiting') && !i.dirty)
  const bulkBytes = bulk.reduce((s, i) => s + i.bytes, 0)
  const autoable = cat.pathway === 'delete' || cat.pathway === 'cloud'
  return (
    <section className={`space-cat pw-${cat.pathway}`}>
      <header className="space-cat-head">
        <span className="space-cat-name">{cat.label}</span>
        <span className="spacer" />
        <small>{cat.pendingCount ? `${fmtBytes(cat.pendingBytes)} waiting` : cat.bytes ? fmtBytes(cat.bytes) : 'nothing now'}</small>
      </header>
      <p className="space-why">{cat.why}</p>
      <div className="space-policy">
        <label>
          pathway{' '}
          <select value={cat.pathway} disabled={busy} onChange={(e) => void spaceAct({ op: 'pathway', category: cat.id, pathway: e.target.value as SpacePathway }, 'policy')}>
            {(Object.keys(PATHWAY_WORD) as SpacePathway[]).map((p) => (
              <option key={p} value={p}>
                {PATHWAY_WORD[p]}
              </option>
            ))}
          </select>
        </label>
        {autoable && (
          <label className={`space-standing ${cat.standing ? 'on' : ''}`} title="Standing approval: the daily scan handles new items of this kind without asking you">
            <input type="checkbox" checked={cat.standing} disabled={busy} onChange={(e) => void spaceAct({ op: 'pathway', category: cat.id, standing: e.target.checked }, 'policy')} /> handle automatically from now on
          </label>
        )}
        <span className="spacer" />
        {autoable && bulk.length > 1 && (
          <ArmButton disabled={busy} armed={<>sure? {bulk.length} items</>} onFire={() => void spaceAct({ op: 'approve', ids: bulk.map((i) => i.id) }, cat.pathway === 'cloud' ? 'archiving' : 'deleting')}>
            {cat.pathway === 'cloud' ? <Cloud size={11} /> : <Trash2 size={11} />} {cat.pathway === 'cloud' ? 'archive' : 'delete'} all {bulk.length} · {fmtBytes(bulkBytes)}
          </ArmButton>
        )}
      </div>
      {live.length > 0 && (
        <ul className="space-items">
          {shown.map((it) => (
            <ItemRow key={it.id} it={it} cat={cat} busy={busy} />
          ))}
        </ul>
      )}
      <div className="space-cat-foot">
        {live.length > SHOW && (
          <button className="linkish" onClick={() => setAll((v) => !v)}>
            {all ? 'show fewer' : `show all ${live.length}`}
          </button>
        )}
        {keptItems.length > 0 && (
          <button className="linkish" onClick={() => setKept((v) => !v)}>
            {kept ? 'hide kept' : `${keptItems.length} kept`}
          </button>
        )}
      </div>
      {kept && (
        <ul className="space-items">
          {keptItems.map((it) => (
            <ItemRow key={it.id} it={it} cat={cat} busy={busy} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function SpacePane({ onClose }: { onClose: () => void }) {
  const { status: st, items, busy, error, trash, lapAt } = useSpace()
  const pane = useRef<HTMLElement>(null)
  const w = statusWord(st)

  useEffect(() => pane.current?.focus(), [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !el?.closest('.xterm, input, textarea, select')) onClose()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onClose])

  const cats = st ? [...st.categories].sort((a, b) => b.pendingBytes - a.pendingBytes || b.bytes - a.bytes) : []
  return (
    <section ref={pane} className="focus space-pane" tabIndex={-1}>
      <header className="pane-head">
        <HardDrive size={14} className="space-glyph" />
        <span className="name">Space</span>
        <span className={`badge space-badge ${w.cls}`}>{w.word}</span>
        {busy && <span className="badge space-badge busy">{busy}…</span>}
        <span className="spacer" />
        <button className="ghost" disabled={!!busy || st?.scanning} title="Scan the disk again (read-only)" onClick={() => void spaceAct({ op: 'scan' }, 'scanning')}>
          <RefreshCw size={12} /> rescan
        </button>
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>
      <div className="space-body">
        {!st ? (
          <p className="space-empty">
            No status from ~/space yet. Run <code>node ~/space/bin/space.mjs scan</code>, or press rescan.
          </p>
        ) : (
          <>
            <div className="space-summary">
              <div className="space-free">
                <b>{st.disk ? fmtBytes(st.disk.free) : '?'}</b> free
                {st.disk && <small> of {fmtBytes(st.disk.total)}</small>}
                <span className="spacer" />
                <small>
                  scanned {ago(st.lastScan)}
                  {st.freed.bytes > 0 && ` · ${fmtBytes(st.freed.bytes)} freed so far`}
                </small>
              </div>
              <DiskBar st={st} />
              <Spark st={st} />
              {st.reasons.length > 0 && <div className="space-reasons">{st.reasons.join(' · ')}</div>}
              {st.unreadable.length > 0 && (
                <div className="space-warn">
                  The daily scan could not read {st.unreadable.map((u) => u.path).join(', ')}. Give the node binary Full Disk Access (System Settings › Privacy &amp; Security).
                </div>
              )}
              {error && <div className="space-warn">{error}</div>}
              <p className="space-legend">
                Nothing moves until you click. <b>delete</b> asks twice. Installers go to the Trash, and <b>iCloud</b> moves to iCloud Drive › Space Archive. <b>handle automatically</b> gives a category
                standing approval, so the daily scan deals with its new items for you.
              </p>
            </div>
            <TrashCard g={trash} lapAt={lapAt} busy={!!busy} />
            {cats.map((c) => (
              <CategoryCard key={c.id} cat={c} items={items.filter((i) => i.category === c.id)} busy={!!busy} />
            ))}
          </>
        )}
      </div>
    </section>
  )
}
