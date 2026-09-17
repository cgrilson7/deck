import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, ExternalLink, FolderOpen, ImagePlus, MessageSquarePlus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import type { SessionView, StudioInfo, StudioJob, StudioModel, StudioRatio, StudioSize } from '@shared/types'
import { STUDIO_RATIOS, STUDIO_REFS_MAX, STUDIO_SIZES } from '@shared/types'
import { plain } from '../lib/errors'
import { dropEffectFor, droppedPaths, hasFiles } from '../lib/drop'
import { openDoc } from '../lib/paths'
import { pasteText } from '../lib/paste'
import { useStudioJobs } from '../lib/studio'
import { Fox } from './Fox'
import { LS, lsRead, lsWrite, StudioImage } from './StudioTile'

/** How many gallery cells are read at once; the rest wait behind "show more" (each is a file read). */
const PAGE = 40

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

function refsFromStorage(): string[] {
  try {
    const parsed: unknown = JSON.parse(lsRead(LS.refs, '[]'))
    return Array.isArray(parsed) ? parsed.map(String).slice(0, STUDIO_REFS_MAX) : []
  } catch {
    return []
  }
}

/**
 * The Studio, full size in the CENTER column: the composer on top, the selected job under it,
 * the whole gallery below. It takes the focus pane's place rather than covering the grid, so the
 * sessions stay where they were and any of them is one click from coming back.
 *
 * Two ways to fill the composer: type the prompt yourself and Generate, or hand the notes to the
 * focused session with "Ask Claude for help" — the session reads the `/deck:studio` skill, works
 * the prompt out with you in its own conversation (questions, drafts, images dropped in as
 * references) and runs it through the CLI when you say go; the result lands in this same gallery.
 * Everything typed here is kept in localStorage, so closing the pane loses nothing.
 */
export function StudioPane({ session, onClose }: { session: SessionView | null; onClose: () => void }) {
  const jobs = useStudioJobs()
  const [prompt, setPrompt] = useState(() => lsRead(LS.prompt))
  const [tag, setTag] = useState(() => lsRead(LS.tag))
  const [model, setModel] = useState(() => lsRead(LS.model))
  const [ratio, setRatio] = useState<StudioRatio>(() => (lsRead(LS.ratio, '1:1') || '1:1') as StudioRatio)
  const [size, setSize] = useState<StudioSize>(() => (lsRead(LS.size, '1K') || '1K') as StudioSize)
  const [refs, setRefs] = useState<string[]>(refsFromStorage)
  const [picked, setPicked] = useState<string | null>(null)
  const [info, setInfo] = useState<StudioInfo | null>(null)
  const [models, setModels] = useState<StudioModel[] | null>(null)
  const [filter, setFilter] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const [now, setNow] = useState(Date.now())
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => lsWrite(LS.prompt, prompt), [prompt])
  useEffect(() => lsWrite(LS.tag, tag), [tag])
  useEffect(() => lsWrite(LS.model, model), [model])
  useEffect(() => lsWrite(LS.ratio, ratio), [ratio])
  useEffect(() => lsWrite(LS.size, size), [size])
  useEffect(() => lsWrite(LS.refs, JSON.stringify(refs)), [refs])

  useEffect(() => {
    let live = true
    void window.deck
      .studioInfo()
      .then((i) => live && setInfo(i))
      .catch(() => {})
    // An empty list and a failed call come to the same thing here: nothing to pick from, so type it.
    void window.deck
      .studioModels()
      .then((m) => live && setModels(m))
      .catch(() => live && setModels([]))
    return () => {
      live = false
    }
  }, [])

  // Esc closes the pane, but not while you are typing into it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.closest('.xterm'))) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tags = useMemo(() => Array.from(new Set(jobs.map((j) => j.tag).filter((t): t is string => !!t))), [jobs])
  const filtered = useMemo(() => (filter ? jobs.filter((j) => j.tag === filter) : jobs), [jobs, filter])
  // No pick = follow the head of the list, which is where a generation just started sits.
  const sel: StudioJob | null = useMemo(() => {
    const chosen = picked ? jobs.find((j) => j.id === picked) : undefined
    return chosen ?? filtered[0] ?? jobs[0] ?? null
  }, [jobs, filtered, picked])

  useEffect(() => setShown(PAGE), [filter])

  // Only a running job needs the clock; anything else is a fixed number.
  useEffect(() => {
    if (sel?.status !== 'running') return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [sel?.status])

  const addRefs = (paths: string[]) => setRefs((r) => [...r, ...paths.filter((p) => !r.includes(p))].slice(0, STUDIO_REFS_MAX))

  const generate = async () => {
    const p = prompt.trim()
    if (!p || !info?.ready) return
    setErr('')
    setPicked(null)
    try {
      const job = await window.deck.studioGenerate({ prompt: p, model: model || undefined, ratio, size, refs, tag: tag.trim() || undefined, from: 'pane' })
      setPicked(job.id)
      if (job.error) setErr(job.error)
    } catch (e) {
      setErr(plain(e))
    }
  }

  /**
   * Hand the composer to the focused session and START A CONVERSATION about the image, not an
   * order to run one: the session (the `/deck:studio` skill) asks what is wanted, drafts, refines
   * with the user, takes images dropped into the chat as references, and generates only when told
   * to go. Half-typed notes and references ride along as the opening; an empty composer is fine.
   */
  const ask = () => {
    if (!session) return
    const notes = prompt.trim()
    const lines = [
      '[deck studio] Help me make an image. Read /deck:studio first.',
      notes ? `What I have so far: ${notes}` : 'I have nothing written yet: ask me what I want to make.',
      refs.length ? `References so far: ${refs.join(', ')}` : '',
      `Settings so far: model ${model || 'default'}, ratio ${ratio}, size ${size}${tag.trim() ? `, tag ${tag.trim()}` : ''}`,
      'Work it out with me here: ask what you need to know, draft the hyper-specific prompt, refine it with me, take any image path I drop into this chat as a reference. Generate with `node "$DECK_STUDIO" gen …` only when I say go; it lands in the Studio gallery.'
    ].filter(Boolean)
    pasteText(session.id, lines.join('\n'))
    // Bracketed paste lands first; a beat later ⏎ submits it (the beat TilePrompt waits too).
    setTimeout(() => window.deck.ptyInput(session.id, '\r'), 40)
    onClose()
  }

  const reuse = (j: StudioJob) => {
    setPrompt(j.prompt)
    setModel(j.model)
    setRatio(j.ratio)
    setSize(j.size)
    setTag(j.tag ?? '')
    setRefs(j.refs.slice(0, STUDIO_REFS_MAX))
    box.current?.focus()
  }

  const remove = (j: StudioJob) => {
    if (!confirm(`Delete this image? ${j.image ? base(j.image) : j.id} goes from the gallery and from disk.`)) return
    if (picked === j.id) setPicked(null)
    void window.deck.studioDelete(j.id)
  }

  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer)
    setOver(true)
  }

  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    addRefs(await droppedPaths(Array.from(e.dataTransfer.files)))
  }

  /** Where a job came from, said the way the gallery wants it. */
  const whose = (j: StudioJob): string => {
    if (j.from !== 'cli') return j.from
    if (!j.session) return 'cli'
    return `cli · ${session && session.id === j.session ? session.name : j.session.slice(0, 8)}`
  }

  const meta = (j: StudioJob): string => {
    const bits = [j.model, j.ratio, j.size]
    if (j.ms) bits.push(`${(j.ms / 1000).toFixed(1)}s`)
    bits.push(whose(j))
    if (j.tag) bits.push(`#${j.tag}`)
    return bits.join(' · ')
  }

  return (
    <section className={`focus studio-pane ${over ? 'drop-over' : ''}`} onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={(e) => void onDrop(e)}>
      <header className="pane-head">
        <Sparkles size={14} className="studio-glyph" />
        <span className="name">Studio</span>
        <span className="badge" title="The model a request that names none generates with (the `studioModel` setting)">
          {model || info?.model || 'default'}
        </span>
        {info && !info.ready && (
          <span className="badge studio-nokey" title="Set geminiApiKey in config.json (aistudio.google.com → Get API key), or export GEMINI_API_KEY in your login shell.">
            no key
          </span>
        )}
        <span className="spacer" />
        <button className="ghost" title={info ? `Reveal ${info.dir} in Finder` : 'The gallery folder'} disabled={!info} onClick={() => info && window.deck.revealPath(info.dir)}>
          <FolderOpen size={13} />
        </button>
        <button className="ghost" title="Close the Studio (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      <div className="studio-composer">
        <textarea
          ref={box}
          className="studio-text"
          value={prompt}
          spellCheck={false}
          placeholder="Describe the image…"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) {
              e.preventDefault()
              void generate()
            }
          }}
          aria-label="The image to generate"
        />
        <div className="studio-controls">
          {models && models.length === 0 ? (
            <input className="studio-in studio-model" value={model} placeholder="model id" title="The model list did not answer; type a Gemini image model id, or leave it empty for the setting." onChange={(e) => setModel(e.target.value)} />
          ) : (
            <select className="studio-in" value={model} title="Which Gemini image model" onChange={(e) => setModel(e.target.value)}>
              <option value="">default (setting)</option>
              {(models ?? []).map((m) => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.name}
                </option>
              ))}
              {/* A model from an earlier run that the list no longer carries must still be selectable. */}
              {model && !(models ?? []).some((m) => m.id === model) && <option value={model}>{model}</option>}
            </select>
          )}
          <select className="studio-in" value={ratio} title="Aspect ratio" onChange={(e) => setRatio(e.target.value as StudioRatio)}>
            {STUDIO_RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select className="studio-in" value={size} title="Output size — 4K is slow and costs the most" onChange={(e) => setSize(e.target.value as StudioSize)}>
            {STUDIO_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input className="studio-in studio-tag" value={tag} placeholder="tag" title="Groups jobs in the gallery (a comic's name, say)" onChange={(e) => setTag(e.target.value)} />
        </div>

        <div className="studio-refs">
          {refs.map((p) => (
            <span key={p} className="studio-ref" title={p}>
              <StudioImage path={p} className="studio-ref-img" />
              {base(p)}
              <button className="studio-ref-x" title="Not a reference after all" onClick={() => setRefs((r) => r.filter((x) => x !== p))}>
                <X size={10} />
              </button>
            </span>
          ))}
          <span className="studio-hint" title="There is no file dialog here: drop images from Finder onto this pane, or take one from the gallery with “use as reference”.">
            <ImagePlus size={11} /> drop images here ({refs.length}/{STUDIO_REFS_MAX})
          </span>
        </div>

        <div className="studio-actions">
          <button className="studio-go" disabled={!prompt.trim() || !info?.ready} title={info?.ready ? 'Generate (⌘⏎)' : 'No Gemini API key — see the “no key” badge'} onClick={() => void generate()}>
            Generate
          </button>
          <button className="ghost" disabled={!session} title={session ? `Work the prompt out with “${session.name}”: it asks, drafts, refines, takes dropped images as references, and generates when you say go` : 'focus a session first'} onClick={ask}>
            <MessageSquarePlus size={13} /> Ask Claude for help
          </button>
          <button className="ghost" title="Empty the composer" onClick={() => setPrompt('')}>
            Clear
          </button>
          {err && <span className="studio-err-line">{err}</span>}
        </div>
      </div>

      <div className="studio-scroll">
        {!sel ? (
          <div className="plugin-empty studio-viewer">
            <Fox anim="idle" scale={3} />
            <span>Nothing generated yet. Describe an image and hit Generate.</span>
          </div>
        ) : (
          <div className="studio-viewer">
            <div className="studio-stage">
              {sel.status === 'running' ? (
                <div className="plugin-empty">
                  <Fox anim="run" scale={3} />
                  <span>generating… {Math.max(0, Math.round((now - sel.at) / 1000))}s</span>
                </div>
              ) : sel.status === 'error' ? (
                <div className="plugin-empty studio-failed">{sel.error || 'it did not come back'}</div>
              ) : sel.image ? (
                <StudioImage path={sel.image} className="studio-shot" alt={sel.prompt.slice(0, 80)} />
              ) : (
                <div className="plugin-empty">no image</div>
              )}
            </div>
            <div className="studio-side">
              <div className="studio-meta">{meta(sel)}</div>
              <div className="studio-prompt-text">{sel.prompt}</div>
              {sel.text && <div className="studio-said">{sel.text}</div>}
              <div className="studio-viewer-bar">
                <button className="ghost" title="Load this prompt and its settings back into the composer" onClick={() => reuse(sel)}>
                  <RotateCcw size={12} /> reuse prompt
                </button>
                {sel.image && (
                  <button className="ghost" title="Send this image along with the next generation" onClick={() => sel.image && addRefs([sel.image])}>
                    <ImagePlus size={12} /> use as reference
                  </button>
                )}
                {sel.image && (
                  <button className="ghost" title="Open it in the preview pane" onClick={() => sel.image && openDoc(sel.image)}>
                    <ExternalLink size={12} /> open
                  </button>
                )}
                {sel.image && (
                  <button className="ghost" title="Reveal in Finder" onClick={() => sel.image && window.deck.revealPath(sel.image)}>
                    <FolderOpen size={12} /> reveal
                  </button>
                )}
                {sel.image && (
                  <button className="ghost" title="Copy the path" onClick={() => sel.image && window.deck.copyText(sel.image)}>
                    <Copy size={12} /> copy path
                  </button>
                )}
                <button className="ghost danger" title="Forget the job and delete its image" onClick={() => remove(sel)}>
                  <Trash2 size={12} /> delete
                </button>
              </div>
            </div>
          </div>
        )}

        {tags.length > 0 && (
          <div className="studio-tags">
            <button className={`studio-tagchip ${filter ? '' : 'on'}`} onClick={() => setFilter('')}>
              all
            </button>
            {tags.map((t) => (
              <button key={t} className={`studio-tagchip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(filter === t ? '' : t)}>
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="studio-gallery">
          {filtered.slice(0, shown).map((j) => (
            <button
              key={j.id}
              className={`studio-cell studio-${j.status} ${j.id === sel?.id ? 'on' : ''}`}
              title={`${j.prompt.slice(0, 160)}\n${meta(j)}`}
              onClick={() => setPicked(j.id)}
            >
              {j.image ? <StudioImage path={j.image} className="studio-cell-img" alt="" /> : <span className="studio-cell-mark">{j.status === 'running' ? '…' : '!'}</span>}
            </button>
          ))}
        </div>
        {filtered.length > shown && (
          <button className="ghost studio-more" onClick={() => setShown((s) => s + PAGE)}>
            show {filtered.length - shown} more
          </button>
        )}
      </div>
    </section>
  )
}
