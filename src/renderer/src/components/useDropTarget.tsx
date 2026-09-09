import { useRef, useState } from 'react'
import { dropFilesInto, hasFiles } from '../lib/drop'

/**
 * Makes a pane accept Finder drops: files' paths are pasted into session `id`.
 * `over` is true while a file drag hovers the pane (dragenter/leave are counted because
 * they fire for every child element the pointer crosses).
 */
export function useDropTarget(id: string, onDropped?: () => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      e.preventDefault()
      depth.current += 1
      setOver(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      depth.current = 0
      setOver(false)
      if (dropFilesInto(id, e)) onDropped?.()
    }
  }

  return { over, handlers }
}
