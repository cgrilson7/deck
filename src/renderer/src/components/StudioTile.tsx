import { useEffect, useState } from 'react'
import { Maximize2, Sparkles, X } from 'lucide-react'
import type { StudioJob, StudioRatio, StudioSize } from '@shared/types'
import { STUDIO_REFS_MAX } from '@shared/types'
import { plain } from '../lib/errors'
import { dropEffectFor, droppedPaths, hasFiles } from '../lib/drop'
import { openStudio, useStudioJobs } from '../lib/studio'
import { Fox } from './Fox'

/**
 * What the tile and the pane both remember between openings, under the same keys on purpose:
 * a ratio picked in the pane is what the tile's prompt bar fires with, and a prompt half typed
 * in the pane survives closing it.
 */
export const LS = {
  prompt: 'deck.studio.prompt',
  refs: 'deck.studio.refs',
  tag: 'deck.studio.tag',
  model: 'deck.studio.model',
  ratio: 'deck.studio.ratio',
  size: 'deck.studio.size'
} as const

export function lsRead(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function lsWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* no storage (a private window, a cleared profile): a lost draft is survivable */
  }
}

/** The last ratio / size picked anywhere in the Studio. Main clamps anything odd, so this need not. */
export const savedRatio = (): StudioRatio => (lsRead(LS.ratio, '1:1') || '1:1') as StudioRatio
export const savedSize = (): StudioSize => (lsRead(LS.size, '1K') || '1K') as StudioSize

/**
 * Blob URLs for everything the gallery draws, kept for the life of the window: the thumbnails
 * re-render on every `studio:update` and re-reading each PNG over IPC that often would be
 * absurd. Nothing is revoked — a few hundred small images cost less than the bookkeeping.
 */
const urls = new Map<string, string>()
const reading = new Map<string, Promise<string | null>>()

function imageUrl(path: string): Promise<string | null> {
  const had = urls.get(path)
  if (had) return Promise.resolve(had)
  let p = reading.get(path)
  if (!p) {
    p = window.deck
      .readDoc(path)
      .then((d) => {
        if (!d?.bytes) return null
        // The bytes crossed IPC as a plain Uint8Array; Blob wants the DOM's stricter view type.
        const url = URL.createObjectURL(new Blob([d.bytes as BlobPart], { type: d.mime || 'image/png' }))
        urls.set(path, url)
        return url
      })
      .catch(() => null)
    reading.set(path, p)
    // Forget the in-flight read once it settles, so a file that appears later can be tried again.
    void p.then(() => reading.delete(path))
  }
  return p
}

export function useImageUrl(path?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? urls.get(path) ?? null : null))
  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    const had = urls.get(path)
    if (had) {
      setUrl(had)
      return
    }
    let live = true
    setUrl(null)
    void imageUrl(path).then((u) => {
      if (live) setUrl(u)
    })
    return () => {
      live = false
    }
  }, [path])
  return url
}

/** One image off disk, drawn once its bytes have come over IPC; a blank cell until then. */
export function StudioImage({ path, className, alt }: { path: string; className?: string; alt?: string }) {
  const url = useImageUrl(path)
  return url ? <img className={className} src={url} alt={alt ?? ''} draggable={false} /> : <div className={`${className ?? ''} studio-blank`} />
}

/**
 * The Studio as a grid cell: the newest image, whatever is cooking, and a prompt bar that
 * generates without opening anything. Everything bigger — the model, the references, the whole
 * gallery — lives in the pane, which is one click away from anywhere on the tile. Images
 * dropped from Finder become the next generation's references, here as in the pane.
 */
export function StudioTile() {
  const jobs = useStudioJobs()
  const [text, setText] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [err, setErr] = useState('')

  const running = jobs.filter((j) => j.status === 'running').length
  const newest: StudioJob | undefined = jobs[0]
  const shots = jobs.filter((j) => j.status === 'done' && j.image)
  const hero = shots[0]
  const strip = shots.slice(0, 6)
  // The newest job failing is the news; an older image keeps showing underneath it.
  const failed = newest && newest.status === 'error' ? newest.error || 'it did not come back' : ''

  const send = () => {
    const prompt = text.trim()
    if (!prompt) return
    setText('')
    setErr('')
    const sending = refs
    setRefs([])
    void window.deck
      .studioGenerate({ prompt, model: lsRead(LS.model) || undefined, ratio: savedRatio(), size: savedSize(), refs: sending, from: 'tile' })
      .catch((e) => setErr(plain(e)))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (text) setText('')
      else e.currentTarget.blur()
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    // The effect has to be one the source allows or the drop event never fires (lib/drop.ts).
    e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer)
    setOver(true)
  }

  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return
    // Claim it even if nothing usable comes of it: the default would navigate the window.
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const paths = await droppedPaths(Array.from(e.dataTransfer.files))
    if (paths.length) setRefs((r) => [...r, ...paths.filter((p) => !r.includes(p))].slice(0, STUDIO_REFS_MAX))
  }

  // Clicks inside the tile must not reach the grid, which would treat it as a session swap.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div
      className={`tile tile-plugin studio ${over ? 'drop-over' : ''}`}
      onClick={stop}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <header className="pane-head">
        <Sparkles size={13} className="studio-glyph" />
        <span className="name">Studio</span>
        {running > 0 && <span className="badge studio-run">{running} running</span>}
        <span className="spacer" />
        <button className="ghost" title="Open the Studio (⌘⇧I)" onClick={openStudio}>
          <Maximize2 size={12} />
        </button>
      </header>

      <div className="studio-face" onClick={openStudio} title="Open the Studio (⌘⇧I)">
        {hero?.image ? (
          <StudioImage path={hero.image} className="studio-hero" alt={hero.prompt.slice(0, 80)} />
        ) : running > 0 ? (
          <div className="plugin-empty">
            <Fox anim="run" scale={2} />
            <span>generating…</span>
          </div>
        ) : (
          <div className="plugin-empty">
            <Fox anim="idle" scale={2} />
            <span>Type a prompt, or open the Studio</span>
          </div>
        )}
        {hero?.image && running > 0 && (
          <div className="studio-cooking">
            <Fox anim="run" scale={1} />
            <span>generating…</span>
          </div>
        )}
        {(failed || err) && <div className="studio-err">{err || failed}</div>}
        {strip.length > 1 && (
          <div className="studio-strip" onClick={stop}>
            {strip.map((j) => (
              <button key={j.id} className={`studio-chip ${j.id === hero?.id ? 'on' : ''}`} title={j.prompt.slice(0, 160)} onClick={openStudio}>
                <StudioImage path={j.image!} className="studio-chip-img" />
              </button>
            ))}
          </div>
        )}
      </div>

      {refs.length > 0 && (
        <div className="studio-refs" onClick={stop}>
          {refs.map((p) => (
            <span key={p} className="studio-ref" title={p}>
              <StudioImage path={p} className="studio-ref-img" />
              {p.slice(p.lastIndexOf('/') + 1)}
              <button className="studio-ref-x" title="Not a reference after all" onClick={() => setRefs((r) => r.filter((x) => x !== p))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={`tile-prompt studio-prompt ${text ? 'has-text' : ''}`} onClick={stop} onMouseDown={stop} onDoubleClick={stop}>
        <textarea
          rows={1}
          value={text}
          spellCheck={false}
          placeholder="Describe an image…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Generate an image"
        />
        <button type="button" className="tile-prompt-send" onClick={send} disabled={!text.trim()} title="Generate (⏎)">
          ↵
        </button>
      </div>
    </div>
  )
}
