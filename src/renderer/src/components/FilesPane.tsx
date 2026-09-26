import { useEffect, useMemo, useRef } from 'react'
import { FolderTree } from 'lucide-react'
import { docMayClose, type DocRef } from '../lib/paths'
import { select, tilde, useFiles } from '../lib/files'
import { DocPane } from './DocPane'
import { FileRoot, FileTree } from './FilesTile'
import { Fox } from './Fox'

/**
 * The Files pane: the tree at reading size on the left, the selected file on the right — the
 * preview pane's own reader (`DocPane`, embedded: markdown, images, PDFs, folders, the edit
 * mode and its task boxes), so what you can read in the center you can read here. Takes the
 * CENTER column like the Molecule and Lesson panes (they all take turns; a focus change or Esc
 * closes it). Esc inside the reader closes the pane too, unless it holds unsaved edits.
 */
export function FilesPane({ onClose }: { onClose: () => void }) {
  const s = useFiles()
  const pane = useRef<HTMLElement>(null)
  // The reader takes the keyboard when a file is up; with none, the pane does, so Esc works.
  useEffect(() => {
    if (!s.selected) pane.current?.focus()
  }, [s.selected])
  // With a file up the reader owns Esc (it asks about unsaved edits first, then closes the pane through `close`).
  const hasFile = useRef(false)
  hasFile.current = !!s.selected
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !hasFile.current && !el?.closest('.xterm, input, textarea')) onClose()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onClose])

  const target = useMemo<DocRef | null>(() => (s.selected ? { path: s.selected, line: null } : null), [s.selected])
  const close = () => {
    if (docMayClose()) onClose()
  }

  return (
    <section ref={pane} className="focus files-pane" tabIndex={-1}>
      <header className="pane-head">
        <FolderTree size={14} />
        <span className="name">Files</span>
        <span className="badge" title={s.root}>
          {tilde(s.root)}
        </span>
        <span className="spacer" />
        <button className="ghost" title="Back to the terminal (Esc)" onClick={close}>
          close
        </button>
      </header>
      <div className="files-body">
        <div className="files-tree">
          <div className="ft-head">
            <FileRoot s={s} />
          </div>
          <FileTree s={s} onFile={select} />
        </div>
        <div className="files-read">
          {target ? (
            <DocPane key={target.path} target={target} embedded onClose={close} />
          ) : (
            <div className="plugin-empty">
              <Fox anim="idle" scale={2} />
              <span>click a file to read it here</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
