import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Copy, CornerUpLeft, ExternalLink, Folder, FolderOpen, Maximize2, Minimize2, X } from 'lucide-react'
import type { FileDoc } from '@shared/types'
import { shortPath } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import type { DocRef } from '../lib/paths'

/**
 * The preview pane: a referenced file, laid over the grid (the right two thirds), so the
 * terminal in the focus pane stays visible and usable while you read. Opened by clicking a
 * path anywhere it shows — a tool line, Claude's prose, your own prompt, or the terminal
 * itself (lib/paths.ts carries the click here). Text and markdown are drawn here, images and
 * PDFs are framed from a blob URL of the bytes main read, a directory is a list you can walk
 * into, and anything else (or too big, or missing) says so and offers the real app: "open"
 * hands the path to macOS, which is Preview for a PDF. ⤢ takes the whole window; Esc closes,
 * unless the keystroke came from a terminal, where Esc belongs to Claude.
 */

/** Lines drawn with a number gutter; past this the text is one plain block (DOM cost). */
const LINE_CAP = 4000

export function DocPane({ target, onClose }: { target: DocRef; onClose: () => void }) {
  const [stack, setStack] = useState<DocRef[]>([target])
  const [doc, setDoc] = useState<FileDoc | null>(null)
  const [blob, setBlob] = useState<string | null>(null)
  const [source, setSource] = useState(false)
  const [problem, setProblem] = useState('')
  const [wide, setWide] = useState(() => localStorage.getItem('deck:docWide') === '1')
  const body = useRef<HTMLDivElement>(null)
  const cur = stack[stack.length - 1]

  // A fresh reference (a new click) starts a new walk, even for the file already showing.
  useEffect(() => setStack([target]), [target])

  useEffect(() => {
    let live = true
    setDoc(null)
    setProblem('')
    setSource(false)
    void window.deck.readDoc(cur.path, cur.cwd).then((d) => live && setDoc(d))
    return () => {
      live = false
    }
  }, [cur])

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

  // Esc closes, but not while you are typing into the terminal: there it is Claude's key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest('.xterm')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lines = useMemo(() => (doc?.text === undefined ? null : doc.text.split('\n')), [doc])

  // The line a `path:42` reference asked for, once it is drawn.
  useEffect(() => {
    if (!doc || !cur.line) return
    const hit = body.current?.querySelector('[data-hit="1"]')
    hit?.scrollIntoView({ block: 'center' })
  }, [doc, cur.line, source])

  const open = async () => {
    const err = await window.deck.openPath(cur.path)
    if (err) setProblem(err)
  }
  const walk = (path: string) => setStack((s) => [...s, { path, cwd: cur.cwd, line: null }])
  const parent = doc && doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/')) || '/' : null

  return (
    <section className={`doc ${wide ? 'is-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="doc-scrim" onClick={onClose} />
      <div className="doc-panel">
        <header className="doc-head">
          {stack.length > 1 && (
            <button className="doc-btn" title="Back" onClick={() => setStack((s) => s.slice(0, -1))}>
              <ArrowLeft size={13} />
            </button>
          )}
          <span className="doc-name" title={doc?.path ?? cur.path}>
            {doc?.name ?? cur.path}
          </span>
          {cur.line && <span className="doc-line">:{cur.line}</span>}
          <span className="doc-where" title={doc?.path ?? cur.path}>
            {shortPath((doc?.path ?? cur.path).replace(/\/[^/]+$/, ''))}
          </span>
          <span className="doc-meta">{doc ? describe(doc, lines) : 'reading…'}</span>
          <span className="spacer" />
          {doc?.kind === 'markdown' && (
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
          <button className="doc-btn" title="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        {problem && <div className="doc-problem">{problem}</div>}
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
          {doc && doc.kind === 'markdown' && !source && <div className="doc-md chat-text">{renderMarkdown(doc.text ?? '', cur.cwd)}</div>}
          {doc && lines && (doc.kind === 'text' || source) && (lines.length > LINE_CAP ? <pre className="doc-plain">{doc.text}</pre> : <Numbered lines={lines} hit={cur.line} />)}
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
