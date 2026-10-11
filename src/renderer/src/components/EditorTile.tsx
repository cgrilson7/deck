import { useCallback, useEffect, useRef, useState } from 'react'
import { FilePen, Maximize2, RotateCcw } from 'lucide-react'
import type { FileDoc } from '@shared/types'
import { openFiles, tilde, useFiles } from '../lib/files'
import { CellTools } from '../lib/celltools'

/** How often a file with no unsaved edits is read again, so a change made elsewhere shows. */
const POLL_MS = 4000

/**
 * The Editor tile: the file SELECTED IN THE FILES TREE (lib/files.ts) as plain text — an .env,
 * a config — in a monospace textarea; ⌘S saves. With this tile on, a file's click in the Files
 * tile selects it here instead of opening the Files pane. Writes go through `writeDoc`, so the
 * preview pane's rules hold: an existing text file of valid UTF-8, not cut at the cap, unchanged
 * on disk since it was read (else `stale`, and "reload" is offered), written atomically.
 * Switching files with unsaved edits asks first; a file with none is re-read every few seconds.
 */
export function EditorTile() {
  const s = useFiles()
  const [path, setPath] = useState<string | null>(s.selected)
  const [doc, setDoc] = useState<FileDoc | null>(null)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  const editable = !!doc && (doc.kind === 'text' || doc.kind === 'markdown') && !doc.truncated
  const dirty = editable && draft !== (doc?.text ?? '')
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // The tree's selection moved: follow it, unless that would throw edits away.
  useEffect(() => {
    if (s.selected === path) return
    if (dirtyRef.current && !window.confirm(`Discard unsaved edits to ${doc?.name ?? 'this file'}?`)) return
    setPath(s.selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selected])

  const docRef = useRef<FileDoc | null>(null)
  docRef.current = doc
  const load = useCallback(async (p: string, fresh: boolean) => {
    const d = await window.deck.readDoc(p)
    const have = docRef.current
    if (!fresh && (dirtyRef.current || (have && have.path === d.path && have.mtime === d.mtime))) return
    setDoc(d)
    setDraft(d.text ?? '')
    setProblem('')
    setStale(false)
  }, [])

  useEffect(() => {
    setDoc(null)
    setDraft('')
    setProblem('')
    setStale(false)
    if (!path) return
    void load(path, true)
    const t = window.setInterval(() => {
      if (!dirtyRef.current && document.visibilityState === 'visible') void load(path, false)
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [path, load])

  const save = async () => {
    if (!doc || !dirty || saving) return
    setSaving(true)
    const r = await window.deck.writeDoc(doc.path, draft, doc.mtime)
    setSaving(false)
    // The draft stays as typed; the file read back carries the next save's mtime lock.
    if (r.ok) {
      setDoc(r.doc)
      setProblem('')
      setStale(false)
    } else {
      setProblem(r.error)
      setStale(!!r.stale)
    }
  }

  const revert = () => {
    if (!path || (dirty && !window.confirm('Throw away your edits and read the file again?'))) return
    void load(path, true)
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Two spaces, through execCommand so ⌘Z still undoes it.
      e.preventDefault()
      document.execCommand('insertText', false, '  ')
    }
    e.stopPropagation()
  }

  let body: React.ReactNode
  if (!path) body = <div className="ed-note">pick a file in the Files tree to edit it here</div>
  else if (!doc) body = <div className="ed-note">reading…</div>
  else if (!editable)
    body = (
      <div className="ed-note">
        {doc.kind === 'missing' ? 'No such file.' : doc.truncated ? 'Too big to edit here.' : doc.kind === 'dir' ? 'A folder.' : doc.note || `Not a text file (${doc.kind}).`}
        {doc.kind !== 'missing' && (
          <button className="ghost" onClick={() => openFiles(doc.path)}>
            open in Files
          </button>
        )}
      </div>
    )
  else
    body = (
      <textarea
        ref={area}
        className="ed-text"
        value={draft}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
      />
    )

  return (
    <div className="tile tile-plugin editortile" onClick={(e) => e.stopPropagation()}>
      <div className="ft-head">
        <FilePen size={12} />
        <span className="ed-name" title={path ?? ''}>
          {doc?.name ?? (path ? path.split('/').pop() : 'Editor')}
          {path && <span className="ed-dir">{tilde(path.replace(/\/[^/]*$/, '')) || '/'}</span>}
        </span>
        {dirty && <span className="ed-dot" title="Unsaved edits">●</span>}
        {dirty && (
          <button className="ed-save" disabled={saving} title="Save (⌘S)" onClick={() => void save()}>
            {saving ? 'saving…' : 'save'}
          </button>
        )}
        {path && (
          <button className="ft-btn" title="Read the file again" onClick={revert}>
            <RotateCcw size={11} />
          </button>
        )}
        {path && (
          <button className="ft-btn" title="Open in the Files pane" onClick={() => openFiles(path)}>
            <Maximize2 size={11} />
          </button>
        )}
        <CellTools />
      </div>
      {problem && (
        <div className="ed-problem">
          {problem}
          {stale && (
            <button className="ghost" onClick={() => path && void load(path, true)}>
              reload (drops your edits)
            </button>
          )}
        </div>
      )}
      {body}
    </div>
  )
}
