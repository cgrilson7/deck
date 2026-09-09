// Drag a file from Finder (or a screenshot thumbnail) onto a pane and its path lands
// in that session's prompt, escaped the way Terminal.app does it.

import { pasteText } from './terminals'

/** Backslash-escape everything a POSIX shell would otherwise interpret. */
export function shellEscapePath(p: string): string {
  return p.replace(/([^A-Za-z0-9_\-.,:/@+=~])/g, '\\$1')
}

export function droppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return []
  const out: string[] = []
  for (const f of Array.from(dt.files)) {
    let p = ''
    try {
      p = window.deck.pathForFile(f)
    } catch {
      /* not a real file (an image dragged out of a page, say): skip it */
    }
    if (p) out.push(p)
  }
  return out
}

export function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files')
}

/** Drop handler for a pane: writes the escaped paths (space-separated, trailing space) into the session. */
export function dropFilesInto(id: string, ev: React.DragEvent): boolean {
  // Always claim a file drop, even one we can't use: the default would navigate the window to it.
  if (hasFiles(ev.dataTransfer)) {
    ev.preventDefault()
    ev.stopPropagation()
  }
  const paths = droppedPaths(ev.dataTransfer)
  if (paths.length === 0) return false
  pasteText(id, paths.map(shellEscapePath).join(' ') + ' ')
  return true
}
