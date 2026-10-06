// The Spend tile: what Claude Code work has cost, EVERY project's, at API list prices — main reads
// the transcripts (main/spend.ts) and this draws the report. Four windows as chips (the last hour,
// 8 hours, day, week), each with its total; the one picked drives a chart of stacked bars, a bar
// per bin coloured by project, and the projects under it with their share. A project that keeps a
// ledger (`docs/costs/ledger.jsonl`, written by `/deck:ledger`) unfolds into its newest lines: what
// the money was FOR. Colours follow the week's ranking, so a project keeps its colour across windows.

import { useEffect, useMemo, useState } from 'react'
import { CircleDollarSign, NotebookPen } from 'lucide-react'
import type { SpendProject, SpendReport, SpendWindow, SpendWindowId } from '@shared/types'
import { CellTools } from '../lib/celltools'

/** How often the tile asks while it is mounted and the window is visible. */
const POLL_MS = 20_000
/** Projects that get a colour of their own; the rest are "other". */
const SERIES = ['--blue', '--magenta', '--yellow', '--green', '--cyan', '--red']
const OTHER = '\u0000other'
const WINDOW_KEY = 'deck.spend.window'
const WINDOW_WORD: Record<SpendWindowId, string> = { '1h': 'last hour', '8h': 'last 8 hours', '24h': 'last 24 hours', '7d': 'last 7 days' }

const money = (n: number): string => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`)
const count = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n))
const clock = (t: number, withDay: boolean): string =>
  new Date(t).toLocaleString(undefined, withDay ? { weekday: 'short', hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' })
const ago = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60_000)
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}

function readWindow(): SpendWindowId {
  try {
    const v = localStorage.getItem(WINDOW_KEY)
    if (v === '1h' || v === '8h' || v === '24h' || v === '7d') return v
  } catch {
    /* no storage */
  }
  return '24h'
}

function useSpend(): { report: SpendReport | null; error: string | null } {
  const [report, setReport] = useState<SpendReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    const ask = (): void => {
      if (document.visibilityState === 'hidden') return
      window.deck
        .spend()
        .then((r) => !dead && (setReport(r), setError(null)))
        .catch((e: unknown) => !dead && setError(e instanceof Error ? e.message : String(e)))
    }
    ask()
    const t = window.setInterval(ask, POLL_MS)
    window.addEventListener('focus', ask)
    return () => {
      dead = true
      window.clearInterval(t)
      window.removeEventListener('focus', ask)
    }
  }, [])
  return { report, error }
}

/** The chart: one stacked bar per bin, oldest on the left, a segment per coloured project. */
function Chart({ w, colour, order, hover }: { w: SpendWindow; colour: (k: string) => string; order: string[]; hover: string | null }) {
  const keyOf = (k: string): string => (order.includes(k) ? k : OTHER)
  const bins = w.bins.map((b) => {
    const by = new Map<string, number>()
    for (const [k, v] of Object.entries(b)) by.set(keyOf(k), (by.get(keyOf(k)) ?? 0) + v)
    return by
  })
  const max = Math.max(...bins.map((by) => [...by.values()].reduce((s, v) => s + v, 0)), 1e-9)
  const n = bins.length
  const gap = n > 20 ? 0.15 : 0.25
  const long = w.ms > 24 * 3600_000
  return (
    <div className="spend-chart">
      <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-label={`spend per ${Math.round(w.binMs / 60_000)} minutes, ${WINDOW_WORD[w.id]}`}>
        {bins.map((by, i) => {
          let y = 100
          const total = [...by.values()].reduce((s, v) => s + v, 0)
          const tip = `${clock(w.start + i * w.binMs, long)} – ${clock(w.start + (i + 1) * w.binMs, long)}: ${money(total)}` + [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `\n${k === OTHER ? 'other' : k.split('/').pop() || k} ${money(v)}`).join('')
          return (
            <g key={i}>
              <title>{tip}</title>
              <rect x={i} y={0} width={1} height={100} className="spend-hit" />
              {[...order, OTHER].map((k) => {
                const v = by.get(k)
                if (!v) return null
                const h = (v / max) * 96
                y -= h
                return <rect key={k} x={i + gap / 2} y={y} width={1 - gap} height={h} fill={colour(k)} className={hover && hover !== k ? 'dim' : ''} />
              })}
            </g>
          )
        })}
      </svg>
      <div className="spend-axis">
        <span>{clock(w.start, long)}</span>
        <span>max {money(max)} / {w.binMs >= 3600_000 ? `${w.binMs / 3600_000}h` : `${w.binMs / 60_000}m`}</span>
        <span>now</span>
      </div>
    </div>
  )
}

function Ledger({ p }: { p: SpendProject }) {
  if (!p.ledger) return null
  if (!p.ledger.length) return <div className="spend-ledger spend-muted">ledger kept, nothing logged yet</div>
  return (
    <ul className="spend-ledger">
      {p.ledger.map((e, i) => (
        <li key={i} title={`${new Date(e.at).toLocaleString()} · ${e.activeMin} min active${e.kind ? ' · ' + e.kind : ''}${e.tag ? ' · ' + e.tag : ''}`}>
          <b>{money(e.cost)}</b>
          {e.tag && <span className="spend-tag">{e.tag}</span>}
          <span className="spend-sum">{e.summary ?? e.kind ?? '—'}</span>
          <small>{ago(e.at)}</small>
        </li>
      ))}
    </ul>
  )
}

export function SpendTile() {
  const { report, error } = useSpend()
  const [win, setWin] = useState<SpendWindowId>(readWindow)
  const [hover, setHover] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const pick = (id: SpendWindowId): void => {
    setWin(id)
    try {
      localStorage.setItem(WINDOW_KEY, id)
    } catch {
      /* no storage */
    }
  }

  // Colours by the WEEK's ranking (report.projects is in that order), so they hold across windows.
  const order = useMemo(() => (report?.projects ?? []).slice(0, SERIES.length).map((p) => p.key), [report])
  const colour = (k: string): string => {
    const i = order.indexOf(k)
    return i < 0 ? 'var(--muted)' : `var(${SERIES[i]})`
  }
  const w = report?.windows.find((x) => x.id === win) ?? null
  const rows = w && report ? report.projects.filter((p) => w.byProject[p.key]?.cost > 0).sort((a, b) => w.byProject[b.key].cost - w.byProject[a.key].cost) : []
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

  return (
    <div className="tile tile-plugin spend-tile" onClick={stop}>
      <header className="pane-head">
        <CircleDollarSign size={13} className="spend-glyph" />
        <span className="name">Spend</span>
        <span className="spacer" />
        <small className="spend-muted" title="API list prices for every response in every project's transcripts, subagents included. On a subscription this is what the work would have cost on the API, not a bill.">
          list prices{report?.unpriced ? ` · ${report.unpriced} unpriced` : ''}
        </small>
        <CellTools />
      </header>
      <div className="spend-body">
        {!report ? (
          <p className="spend-muted spend-empty">{error ? `Could not read the transcripts: ${error}` : 'Reading the last week of transcripts…'}</p>
        ) : (
          <>
            <div className="spend-windows" role="tablist">
              {report.windows.map((x) => (
                <button
                  key={x.id}
                  role="tab"
                  aria-selected={x.id === win}
                  className={`spend-win ${x.id === win ? 'on' : ''}`}
                  onClick={() => pick(x.id)}
                  title={`${WINDOW_WORD[x.id]}: ${x.calls} responses · ${count(x.tokens.output)} out · ${count(x.tokens.input + x.tokens.write)} in · ${count(x.tokens.read)} cache reads` + Object.entries(x.byModel).sort((a, b) => b[1] - a[1]).map(([m, c]) => `\n${m} ${money(c)}`).join('')}
                >
                  <small>{x.id}</small>
                  <b>{money(x.cost)}</b>
                </button>
              ))}
            </div>
            {w && w.calls > 0 ? (
              <>
                <Chart w={w} colour={colour} order={order} hover={hover} />
                <ul className="spend-projects">
                  {rows.map((p) => {
                    const s = w.byProject[p.key]
                    const share = s.cost / w.cost
                    return (
                      <li key={p.key} onMouseEnter={() => setHover(order.includes(p.key) ? p.key : OTHER)} onMouseLeave={() => setHover(null)}>
                        <button className={`spend-row ${p.ledger ? 'has-ledger' : ''}`} onClick={() => p.ledger && setOpen(open === p.key ? null : p.key)} title={`${p.key || 'no folder recorded'}\n${s.calls} responses · ${count(s.tokens)} tokens${p.ledger ? '\nclick for its ledger' : ''}`}>
                          <span className="spend-swatch" style={{ background: colour(p.key) }} />
                          <span className="spend-name">{p.name}</span>
                          {p.ledger && <NotebookPen size={10} className="spend-muted" />}
                          <span className="spend-share">
                            <span style={{ width: `${Math.max(2, share * 100)}%`, background: colour(p.key) }} />
                          </span>
                          <small>{Math.round(share * 100)}%</small>
                          <b>{money(s.cost)}</b>
                        </button>
                        {open === p.key && <Ledger p={p} />}
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <p className="spend-muted spend-empty">Nothing spent in the {WINDOW_WORD[win]}.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
