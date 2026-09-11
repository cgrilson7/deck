// File references as elements: the little underlined path you click to open the preview pane.
// Used by the tiles' conversation (your prompts, Claude's prose via markdown.tsx) and by the
// tool lines. The click never reaches the tile, so opening a file does not swap it into focus.

import type { ReactNode } from 'react'
import { openDoc, pathRefs } from './paths'

export function FileRef({ path, cwd, line, label, code = false }: { path: string; cwd?: string; line?: number | null; label?: string; code?: boolean }) {
  return (
    <button
      type="button"
      className={`fileref ${code ? 'is-code' : ''}`}
      title={`Preview ${path}${line ? `:${line}` : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openDoc(path, cwd, line ?? null)
      }}
    >
      {label ?? `${path}${line ? `:${line}` : ''}`}
    </button>
  )
}

/** `text` with every file reference in it turned into a FileRef; plain strings in between. */
export function linkifyPaths(text: string, cwd?: string, keyPrefix = 'p'): ReactNode[] {
  const refs = pathRefs(text)
  if (refs.length === 0) return [text]
  const out: ReactNode[] = []
  let last = 0
  refs.forEach((r, i) => {
    if (r.start > last) out.push(text.slice(last, r.start))
    out.push(<FileRef key={`${keyPrefix}${i}`} path={r.path} cwd={cwd} line={r.line} label={r.raw} />)
    last = r.end
  })
  if (last < text.length) out.push(text.slice(last))
  return out
}
