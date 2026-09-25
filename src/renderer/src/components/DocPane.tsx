import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Copy, CornerUpLeft, ExternalLink, Folder, FolderOpen, Maximize2, Minimize2, X } from 'lucide-react'
import type { FileDoc } from '@shared/types'
import { shortPath } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import { setDocGuard, type DocRef } from '../lib/paths'

/**
 * The preview pane: a referenced file, laid over the CENTER column — what you are reading is
 * what you are on now, so it takes the place of the focus pane (which lives on underneath)
 * and both side columns stay as they are. Opened by clicking a
 * path anywhere it shows — a tool line, Claude's prose, your own prompt, or the terminal
 * itself (lib/paths.ts carries the click here). Text and markdown are drawn here, images and
 * PDFs are framed from a blob URL of the bytes main read, a directory is a list you can walk
 * into, and anything else (or too big, or missing) says so and offers the real app: "open"
 * hands the path to macOS, which is Preview for a PDF. ⤢ takes the whole window; Esc closes,
 * unless the keystroke came from a terminal, where Esc belongs to Claude.
 *
 * It also WRITES, through main's careful `file:write` / `file:task` (main/files.ts): a markdown
 * task item's checkbox flips that one line on disk, and `edit` turns a text or markdown file
 * into a plain textarea (⌘S saves, ● = unsaved). Both carry the mtime the pane read, so a file
 * that changed underneath is refused, never overwritten, and the pane offers a reload. Unsaved
 * edits make every way out ask first: Esc, ×, the scrim, back, a new file, and (through the
 * guard in lib/paths.ts) whatever App closes the pane for.
 */

/** Lines drawn with a number gutter; past this the text is one plain block (DOM cost). */
const LINE_CAP = 4000

export function DocPane({ target, onClose }: { target: DocRef; onClose: () => void }) {
  const [stack, setStack] = useState<DocRef[]>([target])
  const [doc, setDoc] = useState<FileDoc | null>(null)
  const [blob, setBlob] = useState<string | null>(null)
  const [source, setSource] = useState(false)
  const [problem, setProblem] = useState('')
  const [stale, setStale] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const toggling = useRef(false)
  const [wide, setWide] = useState(() => localStorage.getItem('deck:docWide') === '1')
  const body = useRef<HTMLDivElement>(null)
  // It covers the terminal, so it takes the keyboard from it: typing must not land in a pane you cannot see, and Esc closes.
  const root = useRef<HTMLElement>(null)
  useEffect(() => root.current?.focus(), [])
  const cur = stack[stack.length - 1]

  // Unsaved edits: every way out asks first (a native confirm, like the kill button's).
  const dirty = edit && doc?.text !== undefined && draft !== doc.text
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const nameRef = useRef('')
  nameRef.current = doc?.name ?? cur.path
  const mayLeave = () => !dirtyRef.current || confirm(`Discard your unsaved edits to ${nameRef.current}?`)
  useEffect(() => {
    setDocGuard(dirty ? mayLeave : null)
    return () => setDocGuard(null)
  }, [dirty])
  const close = () => {
    if (mayLeave()) onClose()
  }

  // A fresh reference (a new click, a session's `open`) starts a new walk, even for the file already showing.
  const seen = useRef(target)
  useEffect(() => {
    if (target === seen.current) return
    seen.current = target
    if (mayLeave()) setStack([target])
  }, [target])

  useEffect(() => {
    setSource(false)
    setEdit(false)
  }, [cur])

  useEffect(() => {
    let live = true
    setDoc(null)
    setProblem('')
    setStale(false)
    void window.deck.readDoc(cur.path, cur.cwd).then((d) => {
      if (!live) return
      setDoc(d)
      setDraft(d.text ?? '')
    })
    return () => {
      live = false
    }
  }, [cur, reloads])

  // Image / PDF bytes become a blob URL for one <img> / <iframe>, revoked when it goes away.
  useEffect(() => {
    if (!doc?.bytes) {
      setBlob(null)
      return
    }
    // The bytes crossed IPC as a plain Uint8Array; Blob wants the DOM's stricter view type.
    const url = URL.createObjectURL(new Blob([doc.bytes as BlobPart], { type: doc.mime || 'application/octet-stream' }))
    setBlob(url)
    return () => URL.revokeObjectURL(url)
  }, [doc])

  useEffect(() => {
    localStorage.setItem('deck:docWide', wide ? '1' : '0')
  }, [wide])

  const save = async () => {
    if (!doc || !edit || saving) return
    setSaving(true)
    const r = await window.deck.writeDoc(doc.path, draft, doc.mtime)
    setSaving(false)
    // Read back: the new mtime is the next save's lock. The draft stays as typed (keys pressed while it saved included).
    if (r.ok) {
      setDoc(r.doc)
      setProblem('')
      setStale(false)
    } else {
      setProblem(r.error)
      setStale(!!r.stale)
    }
  }

  // A task item's checkbox: that one line, on disk, then the file as it now is.
  const task = async (line: number, checked: boolean) => {
    if (!doc || toggling.current) return
    toggling.current = true
    const r = await window.deck.toggleTask(doc.path, line, checked, doc.mtime)
    toggling.current = false
    if (r.ok) {
      setDoc(r.doc)
      setDraft(r.doc.text ?? '')
      setProblem('')
      setStale(false)
    } else {
      setProblem(r.error)
      setStale(!!r.stale)
    }
  }

  const reload = () => {
    if (mayLeave()) setReloads((n) => n + 1)
  }

  const toggleEdit = () => {
    if (!doc) return
    if (edit) {
      if (!mayLeave()) return
      setDraft(doc.text ?? '')
      setEdit(false)
      return
    }
    setDraft(doc.text ?? '')
    setEdit(true)
  }

  // Esc closes, but not while you are typing into the terminal: there it is Claude's key. ⌘S saves an edit.
  const keys = useRef({ close, save })
  keys.current = { close, save }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void keys.current.save()
        return
      }
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest('.xterm')) return
      keys.current.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const lines = useMemo(() => (doc?.text === undefined ? null : doc.text.split('\n')), [doc])
  const editable = !!doc && (doc.kind === 'text' || doc.kind === 'markdown') && !doc.truncated

  // The line a `path:42` reference asked for, once it is drawn (once per file: a checkbox's re-read does not jump back).
  const loaded = doc?.path ?? null
  useEffect(() => {
    if (!loaded || !cur.line) return
    const hit = body.current?.querySelector('[data-hit="1"]')
    hit?.scrollIntoView({ block: 'center' })
  }, [loaded, cur.line, source])

  const open = async () => {
    const err = await window.deck.openPath(cur.path)
    if (err) setProblem(err)
  }
  const walk = (path: string) => setStack((s) => [...s, { path, cwd: cur.cwd, line: null }])
  const parent = doc && doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/')) || '/' : null

  return (
    <section ref={root} tabIndex={-1} className={`doc ${wide ? 'is-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="doc-scrim" onClick={close} />
      <div className="doc-panel">
        <header className="doc-head">
          {stack.length > 1 && (
            <button className="doc-btn" title="Back" onClick={() => mayLeave() && setStack((s) => s.slice(0, -1))}>
              <ArrowLeft size={13} />
            </button>
          )}
          <span className="doc-name" title={doc?.path ?? cur.path}>
            {doc?.name ?? cur.path}
          </span>
          {dirty && (
            <span className="doc-dirty" title="Unsaved edits (⌘S saves)">
              ●
            </span>
          )}
          {cur.line && <span className="doc-line">:{cur.line}</span>}
          <span className="doc-where" title={doc?.path ?? cur.path}>
            {shortPath((doc?.path ?? cur.path).replace(/\/[^/]+$/, ''))}
          </span>
          <span className="doc-meta">{doc ? describe(doc, lines) : 'reading…'}</span>
          <span className="spacer" />
          {dirty && (
            <button className="doc-btn wide on" title="Write it to disk (⌘S)" disabled={saving} onClick={() => void save()}>
              {saving ? 'saving…' : 'save'}
            </button>
          )}
          {editable && (
            <button className={`doc-btn wide ${edit ? 'on' : ''}`} title={edit ? 'Back to reading (asks if there are unsaved edits)' : 'Edit the file here (⌘S saves)'} onClick={toggleEdit}>
              edit
            </button>
          )}
          {doc?.kind === 'markdown' && !edit && (
            <button className={`doc-btn wide ${source ? 'on' : ''}`} title="Show the markdown as written" onClick={() => setSource((v) => !v)}>
              source
            </button>
          )}
          <button className="doc-btn" title="Open in the app macOS uses for this type (Preview for a PDF)" onClick={() => void open()}>
            <ExternalLink size={13} />
          </button>
          <button className="doc-btn" title="Reveal in Finder" onClick={() => window.deck.revealPath(cur.path)}>
            <FolderOpen size={13} />
          </button>
          <button className="doc-btn" title="Copy the path" onClick={() => window.deck.copyText(doc?.path ?? cur.path)}>
            <Copy size={13} />
          </button>
          <button className="doc-btn" title={wide ? 'Back over the grid only' : 'Take the whole window'} onClick={() => setWide((v) => !v)}>
            {wide ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button className="doc-btn" title="Close (Esc)" onClick={close}>
            <X size={14} />
          </button>
        </header>
        {problem && (
          <div className="doc-problem">
            {problem}
            {stale && (
              <button className="doc-reload" onClick={reload}>
                reload
              </button>
            )}
          </div>
        )}
        <div className="doc-body" ref={body}>
          {!doc && <div className="doc-note">Reading…</div>}
          {doc && doc.kind === 'dir' && (
            <ul className="doc-dir">
              {parent && (
                <li>
                  <button onClick={() => walk(parent)}>
                    <CornerUpLeft size={12} /> ..
                  </button>
                </li>
              )}
              {doc.entries?.map((e) => (
                <li key={e.name}>
                  <button onClick={() => walk(`${doc.path.replace(/\/$/, '')}/${e.name}`)}>
                    {e.dir ? <Folder size={12} /> : <span className="doc-dot">·</span>}
                    {e.name}
                    {e.dir ? '/' : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {doc && doc.kind === 'image' && blob && <img className="doc-image" src={blob} alt={doc.name} />}
          {doc && doc.kind === 'pdf' && blob && <iframe className="doc-pdf" src={blob} title={doc.name} />}
          {doc && edit && (
            <textarea
              className="doc-edit"
              value={draft}
              spellCheck={false}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Tab indents (a nested list item) instead of leaving the box; execCommand keeps ⌘Z working.
                if (e.key === 'Tab' && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                  e.preventDefault()
                  document.execCommand('insertText', false, '  ')
                }
              }}
            />
          )}
          {doc && !edit && doc.kind === 'markdown' && !source && <div className="doc-md chat-text">{renderMarkdown(doc.text ?? '', cur.cwd, { task: editable ? (line, checked) => void task(line, checked) : undefined })}</div>}
          {doc && !edit && lines && (doc.kind === 'text' || source) && (lines.length > LINE_CAP ? <pre className="doc-plain">{doc.text}</pre> : <Numbered lines={lines} hit={cur.line} />)}
          {doc && doc.note && <div className="doc-note">{doc.note}</div>}
          {doc && (doc.kind === 'binary' || doc.kind === 'missing' || (!blob && (doc.kind === 'pdf' || doc.kind === 'image'))) && (
            <div className="doc-none">
              <p className="doc-path">{doc.path}</p>
              {doc.kind !== 'missing' && (
                <button className="doc-open" onClick={() => void open()}>
                  Open in the app for this file
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** Text with a line-number gutter; the line a reference pointed at is marked. */
function Numbered({ lines, hit }: { lines: string[]; hit: number | null }) {
  return (
    <div className="doc-code">
      {lines.map((l, i) => (
        <div className="doc-row" key={i} data-hit={hit === i + 1 ? '1' : undefined}>
          <span className="doc-ln">{i + 1}</span>
          <code>{l || ' '}</code>
        </div>
      ))}
    </div>
  )
}

const KINDS: Record<FileDoc['kind'], string> = {
  text: '',
  markdown: 'markdown',
  image: 'image',
  pdf: 'PDF',
  dir: 'folder',
  binary: 'binary',
  missing: 'missing'
}

function describe(doc: FileDoc, lines: string[] | null): string {
  const bits: string[] = []
  if (KINDS[doc.kind]) bits.push(KINDS[doc.kind])
  if (doc.kind === 'dir') bits.push(`${doc.entries?.length ?? 0} items`)
  else if (lines) bits.push(`${lines.length} lines${doc.truncated ? ' (cut)' : ''}`)
  if (doc.kind !== 'dir' && doc.kind !== 'missing') bits.push(size(doc.size))
  return bits.join(' · ')
}

function size(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
