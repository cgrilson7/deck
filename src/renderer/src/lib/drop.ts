// Drag a file from Finder (or a screenshot thumbnail) onto a pane and its path lands
// in that session's prompt, escaped the way Terminal.app does it.

import { pasteText } from './terminals'

/** Backslash-escape everything a POSIX shell would otherwise interpret. */
export function shellEscapePath(p: string): string {
  return p.replace(/([^A-Za-z0-9_\-.,:/@+=~])/g, '\\$1')
}

/**
 * The paths to paste for a drop. Main answers per file: a Finder file's own path, or the path of
 * a copy it kept when the original would not last (a macOS screenshot thumbnail is a file promise
 * Chromium fulfils into a temp dir, and dragging it is what cancels the Desktop save).
 */
export async function droppedPaths(files: File[]): Promise<string[]> {
  const out: string[] = []
  for (const f of files) {
    try {
      const p = await window.deck.keepDroppedFile(f)
      if (p) out.push(p)
    } catch {
      /* not a usable file (an image dragged out of a page with no bytes, say): skip it */
    }
  }
  return out
}

/**
 * The drop effect to claim while a drag hovers a pane. It has to be one the SOURCE allows, or the
 * browser turns it into 'none' and the drop never fires: Finder allows everything, but the macOS
 * screenshot thumbnail (a file promise) offers copy only, and asking for 'link' made it spring back.
 */
export function dropEffectFor(dt: DataTransfer): 'copy' | 'link' | 'move' {
  switch (dt.effectAllowed) {
    case 'link':
    case 'linkMove':
      return 'link'
    case 'move':
      return 'move'
    default:
      return 'copy'
  }
}

export function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files')
}

/**
 * Drop handler for a pane: writes the escaped paths (space-separated, trailing space) into the
 * session. Resolves true once something was pasted. The File objects are taken synchronously,
 * since the DataTransfer is only readable during the event; reading them can wait.
 */
export async function dropFilesInto(id: string, ev: React.DragEvent): Promise<boolean> {
  // Always claim a file drop, even one we can't use: the default would navigate the window to it.
  if (hasFiles(ev.dataTransfer)) {
    ev.preventDefault()
    ev.stopPropagation()
  }
  const files = ev.dataTransfer ? Array.from(ev.dataTransfer.files) : []
  if (files.length === 0) return false
  const paths = await droppedPaths(files)
  if (paths.length === 0) {
    console.warn('drop: nothing usable', files.map((f) => ({ name: f.name, type: f.type, size: f.size })))
    return false
  }
  pasteText(id, paths.map(shellEscapePath).join(' ') + ' ')
  return true
}
