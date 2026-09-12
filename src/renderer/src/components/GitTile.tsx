import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, GitBranch, RefreshCw } from 'lucide-react'
import type { GitChanges, GitFile, SessionView } from '@shared/types'
import { plain } from '../lib/errors'
import { openDoc } from '../lib/paths'
import { Fox } from './Fox'

/** How often the working tree is re-read while the tile is showing. */
const POLL_MS = 2000
/** A transcript update (a tool call landing) re-reads sooner than the next poll, after this pause. */
const NUDGE_MS = 300

type DiffLine = { kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'; text: string }

/** A unified diff as rows to draw: the `diff --git` / `index` / `---` / `+++` preamble is dropped. */
function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = []
  for (const raw of text.split('\n')) {
    if (raw === '') continue
    if (raw.startsWith('@@')) out.push({ kind: 'hunk', text: raw.replace(/^(@@[^@]*@@)\s?/, '$1  ') })
    else if (raw.startsWith('+++') || raw.startsWith('---')) continue
    else if (raw.startsWith('+')) out.push({ kind: 'add', text: raw.slice(1) })
    else if (raw.startsWith('-')) out.push({ kind: 'del', text: raw.slice(1) })
    else if (raw.startsWith(' ')) out.push({ kind: 'ctx', text: raw.slice(1) })
    else if (raw.startsWith('\\')) out.push({ kind: 'meta', text: raw.slice(2) })
    else if (raw.startsWith('Binary files')) out.push({ kind: 'meta', text: 'binary file' })
    // diff --git, index, mode and similarity lines: the row above already says all that
  }
  return out
}

/** What one file's row looks like; a change in it re-reads an unfolded diff. */
const sig = (f: GitFile) => `${f.status}${f.staged ? 's' : ''}${f.untracked ? 'u' : ''}:${f.add}:${f.del}:${f.oldPath ?? ''}`

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')

function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf('/')
  return i < 0 ? { dir: '', base: p } : { dir: p.slice(0, i + 1), base: p.slice(i + 1) }
}

const Counts = ({ add, del }: { add: number | null; del: number | null }) =>
  add === null && del === null ? null : (
    <span className="gt-n">
      {add !== null && add > 0 && <span className="add">+{add}</span>}
      {del !== null && del > 0 && <span className="del">−{del}</span>}
    </span>
  )

/**
 * The changes tile: the focused session's working tree as git sees it. A row per changed path
 * (status letter, path, lines added / removed against HEAD); click one and its diff unfolds
 * beneath it, click again to fold it. The ↗ opens the file in the preview pane. Follows the
 * focus: swap sessions and it reads that session's tree (a worktree session's worktree).
 */
export function GitTile({ session }: { session: SessionView | null }) {
  const id = session?.id ?? null
  const [changes, setChanges] = useState<GitChanges | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [diffs, setDiffs] = useState<Map<string, { sig: string; lines: DiffLine[]; truncated: boolean; error?: string }>>(() => new Map())
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const lastJson = useRef('')

  const refresh = useCallback(async () => {
    if (!id) return
    const n = ++seq.current
    setBusy(true)
    try {
      const c = await window.deck.gitChanges(id)
      if (n !== seq.current) return
      const json = JSON.stringify(c)
      if (json !== lastJson.current) {
        lastJson.current = json
        setChanges(c)
      }
      setErr(null)
    } catch (e) {
      if (n === seq.current) setErr(plain(e))
    } finally {
      if (n === seq.current) setBusy(false)
    }
  }, [id])

  // A new focus: forget the old tree and read the new one now.
  useEffect(() => {
    seq.current++
    lastJson.current = ''
    setChanges(null)
    setErr(null)
    setOpen(new Set())
    setDiffs(new Map())
    if (!id) return
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    let nudge: number | null = null
    const off = window.deck.onTranscript((t) => {
      if (t.id !== id) return
      if (nudge) window.clearTimeout(nudge)
      nudge = window.setTimeout(() => void refresh(), NUDGE_MS)
    })
    return () => {
      window.clearInterval(timer)
      if (nudge) window.clearTimeout(nudge)
      off()
    }
  }, [id, refresh])

  const files = changes?.files ?? []
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])

  // Unfolded diffs follow the tree: re-read when the row changed, drop when the path is gone.
  useEffect(() => {
    const repo = changes?.repo
    if (!repo) return
    for (const p of open) {
      const f = byPath.get(p)
      if (!f) {
        setOpen((o) => {
          const n = new Set(o)
          n.delete(p)
          return n
        })
        continue
      }
      const have = diffs.get(p)
      if (have && have.sig === sig(f)) continue
      const want = sig(f)
      void window.deck
        .gitDiff(repo, f.path, f.untracked)
        .then((d) => setDiffs((m) => new Map(m).set(p, { sig: want, lines: parseDiff(d.text), truncated: d.truncated })))
        .catch((e) => setDiffs((m) => new Map(m).set(p, { sig: want, lines: [], truncated: false, error: plain(e) })))
    }
  }, [open, byPath, diffs, changes?.repo])

  const toggle = (p: string) =>
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  const head = (
    <div className="gt-head">
      <GitBranch size={12} />
      <span className="gt-branch" title={changes?.repo ?? ''}>
        {changes?.branch || (changes?.repo ? 'no commits' : '')}
      </span>
      {changes?.repo && <span className="gt-repo">{splitPath(changes.repo).base}</span>}
      {changes && (changes.add > 0 || changes.del > 0) && <Counts add={changes.add} del={changes.del} />}
      <button className={`gt-refresh ${busy ? 'busy' : ''}`} onClick={() => void refresh()} title="Re-read the working tree (it polls every 2s anyway)">
        <RefreshCw size={11} />
      </button>
    </div>
  )

  let body: React.ReactNode
  if (!id) {
    body = (
      <div className="plugin-empty">
        <Fox anim="idle" scale={2} />
        <span>focus a session to see its changes</span>
      </div>
    )
  } else if (err) {
    body = <div className="plugin-empty gt-err">{err}</div>
  } else if (!changes) {
    body = <div className="plugin-empty">reading…</div>
  } else if (!changes.repo) {
    body = (
      <div className="plugin-empty">
        <span>not a git repository</span>
        <span className="gt-dim">{tilde(changes.cwd)}</span>
      </div>
    )
  } else if (files.length === 0) {
    body = (
      <div className="plugin-empty">
        <Fox anim="sleep" scale={2} />
        <span>working tree clean</span>
      </div>
    )
  } else {
    body = (
      <div className="gt-list">
        {files.map((f) => {
          const { dir, base } = splitPath(f.path)
          const isOpen = open.has(f.path)
          const d = isOpen ? diffs.get(f.path) : undefined
          return (
            <div key={f.path} className={`gt-file ${isOpen ? 'open' : ''}`}>
              <div className="gt-row" onClick={() => toggle(f.path)} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
                <span className={`gt-st st-${f.status === '?' ? 'new' : f.status} ${f.staged ? 'staged' : ''}`}>{f.status}</span>
                <span className="gt-path">
                  {dir && <span className="gt-dir">{dir}</span>}
                  {base}
                </span>
                <Counts add={f.add} del={f.del} />
                {f.status !== 'D' && (
                  <button
                    className="gt-open"
                    title="Open in the preview pane"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      openDoc(f.path, changes.repo ?? undefined)
                    }}
                  >
                    <ExternalLink size={11} />
                  </button>
                )}
              </div>
              {isOpen && (
                <pre className="gt-diff">
                  {!d && <div className="gt-l meta">loading…</div>}
                  {d?.error && <div className="gt-l meta">{d.error}</div>}
                  {d && !d.error && d.lines.length === 0 && <div className="gt-l meta">{f.binary ? 'binary file' : 'no diff'}</div>}
                  {d?.lines.map((l, i) => (
                    <div key={i} className={`gt-l ${l.kind}`}>
                      {l.text}
                    </div>
                  ))}
                  {d?.truncated && <div className="gt-l meta">… cut off</div>}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="tile tile-plugin gittile" onClick={(e) => e.stopPropagation()}>
      {head}
      {body}
    </div>
  )
}
