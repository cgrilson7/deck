import { useState } from 'react'
import { ArrowUp, Eye, EyeOff, FolderTree, House, Maximize2 } from 'lucide-react'
import { childOf, openFiles, parentOf, select, setHidden, setRoot, tilde, toggle, useFiles, type FilesState } from '../lib/files'
import { CellTools } from '../lib/celltools'

/**
 * The tree itself, the good old kind: one line per entry, folders first, a disclosure
 * triangle that unfolds a folder in place, nothing else. Drawn by the tile (small) and the
 * Files pane (reading size) from the one state in lib/files.ts. A file's click is the caller's
 * (`onFile`); a folder's double-click makes it the root.
 */
export function FileTree({ s, onFile }: { s: FilesState; onFile: (path: string) => void }) {
  const rows: React.ReactNode[] = []
  const walk = (dir: string, depth: number) => {
    const l = s.lists.get(dir)
    const pad = 8 + depth * 12
    if (!l) {
      rows.push(
        <div key={`${dir}//loading`} className="ft-row ft-note" style={{ paddingLeft: pad }}>
          reading…
        </div>
      )
      return
    }
    if (l.error) {
      rows.push(
        <div key={`${dir}//err`} className="ft-row ft-note" style={{ paddingLeft: pad }}>
          {l.error}
        </div>
      )
      return
    }
    let shown = 0
    for (const e of l.entries) {
      if (e.hidden && !s.hidden) continue
      shown++
      const p = childOf(dir, e.name)
      const isOpen = e.dir && s.open.has(p)
      rows.push(
        <div
          key={p}
          className={`ft-row ${e.dir ? 'dir' : 'file'} ${isOpen ? 'open' : ''} ${e.hidden ? 'dot' : ''} ${e.link ? 'link' : ''} ${s.selected === p ? 'sel' : ''}`}
          style={{ paddingLeft: pad }}
          title={e.link ? `${p} (a link)` : p}
          onClick={() => (e.dir ? toggle(p) : onFile(p))}
          onDoubleClick={() => {
            if (e.dir) setRoot(p)
          }}
        >
          <span className="ft-tri">{e.dir ? '▶' : ''}</span>
          <span className="ft-name">{e.name}</span>
        </div>
      )
      if (isOpen) walk(p, depth + 1)
    }
    if (l.more) {
      rows.push(
        <div key={`${dir}//more`} className="ft-row ft-note" style={{ paddingLeft: pad }}>
          … {l.more} more
        </div>
      )
    } else if (shown === 0) {
      rows.push(
        <div key={`${dir}//empty`} className="ft-row ft-note" style={{ paddingLeft: pad }}>
          {l.entries.length ? 'only hidden files' : 'empty'}
        </div>
      )
    }
  }
  walk(s.root, 0)
  return <div className="ft-list">{rows}</div>
}

/** The head's controls: the root as a button (click = type a path), ↑, ⌂, the dotfile eye. Shared by tile and pane. */
export function FileRoot({ s }: { s: FilesState }) {
  const [editing, setEditing] = useState<string | null>(null)
  const go = (path: string) => {
    setEditing(null)
    setRoot(path)
  }
  return (
    <>
      {editing === null ? (
        <button className="ft-root" title={`${s.root}\nclick to type a path`} onClick={() => setEditing(s.root)}>
          {tilde(s.root)}
        </button>
      ) : (
        <input
          className="ft-path"
          autoFocus
          value={editing}
          spellCheck={false}
          placeholder="/ or ~/somewhere"
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(editing)
            else if (e.key === 'Escape') setEditing(null)
            e.stopPropagation()
          }}
        />
      )}
      <button className="ft-btn" title="Up a level" disabled={s.root === '/'} onClick={() => go(parentOf(s.root))}>
        <ArrowUp size={11} />
      </button>
      <button className="ft-btn" title="Home" onClick={() => go('~')}>
        <House size={11} />
      </button>
      <button className={`ft-btn ${s.hidden ? 'on' : ''}`} title={s.hidden ? 'Hide dotfiles' : 'Show dotfiles'} onClick={() => setHidden(!s.hidden)}>
        {s.hidden ? <Eye size={11} /> : <EyeOff size={11} />}
      </button>
    </>
  )
}

/**
 * The Files tile: the tree in a grid cell. A file's click opens the Files pane in the center
 * with that file up; ⤢ opens the pane as it is. The root can be anywhere — ↑ goes up a level
 * as far as `/`, ⌂ back to home, the path in the head takes a typed one, a double-click on a
 * folder makes it the root. Dotfiles hide behind the eye.
 */
export function FilesTile() {
  const s = useFiles()
  return (
    <div className="tile tile-plugin filestile" onClick={(e) => e.stopPropagation()}>
      <div className="ft-head">
        <FolderTree size={12} />
        <FileRoot s={s} />
        <button className="ft-btn" title="Open the Files pane in the center (⌘⇧F)" onClick={() => openFiles()}>
          <Maximize2 size={11} />
        </button>
        <CellTools />
      </div>
      <FileTree
        s={s}
        onFile={(p) => {
          select(p)
          openFiles(p)
        }}
      />
    </div>
  )
}
