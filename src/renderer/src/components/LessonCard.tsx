import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Play, X } from 'lucide-react'
import { cardSources, type LessonAsk, type LessonCard as Card, type LessonFig, type LessonMol, type LessonSource } from '@shared/lesson'
import type { SessionView } from '@shared/types'
import { lesson, setMarks, useCurriculum, useLessonFigure, type LessonState } from '../lib/lesson'
import { inline, renderMarkdown, type MarkdownExt } from '../lib/markdown'
import { patchSettings, useSettings } from '../lib/theme'
import { Fox } from './Fox'

const stop = (e: React.SyntheticEvent) => e.stopPropagation()
const dirOf = (file: string) => file.slice(0, file.lastIndexOf('/')) || '/'

/**
 * ONE CARD of a lesson, the same in the tile and in the pane (the pane only sets it larger): the
 * prose (lib/markdown, with `[^id]` as a footnote mark), and the four blocks the lesson format
 * adds — a MOL button (its lines go through the Molecule door), a FIGURE, an ASK answered right
 * here (that answer is what the session's `look` reads), a "for Dad" callout — then the teacher's
 * ad-hoc note and questions, and a footer of the sources the card cites. No source = a quiet
 * "unsourced" tag, so the teacher notices.
 */
export function LessonCardView({ st, card }: { st: LessonState; card: Card }) {
  const box = useRef<HTMLDivElement>(null)
  const { sources, own } = cardSources(st.lesson!, card)
  const cwd = st.file ? dirOf(st.file) : undefined
  const ext = useMemo<MarkdownExt>(
    () => ({
      foot: (id, key) => {
        const n = sources.findIndex((s) => s.id === id)
        const src = sources[n]
        return (
          <sup key={key} className={`lesson-foot ${src ? '' : 'missing'}`} title={src ? src.cite : `no source “${id}” in the front matter`} onClick={(e) => (stop(e), src?.url && openSource(src))}>
            {src ? n + 1 : '?'}
          </sup>
        )
      }
    }),
    [sources]
  )

  // The teacher's pointer: paint the marked phrases and bring the first into view.
  const marks = st.marks.join('\n')
  useEffect(() => {
    const first = setMarks(box, box.current, st.marks)
    const el = first?.startContainer.parentElement
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return () => void setMarks(box, null, [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, card.id, st.rev, st.note])

  let mols = 0
  return (
    <div ref={box} className="lesson-card chat-text">
      {st.note && (
        <div className="lesson-note">
          <span className="lesson-tag">note</span>
          {renderMarkdown(st.note, cwd)}
        </div>
      )}
      {card.parts.map((p, i) => {
        if (p.kind === 'md') return <div key={i}>{renderMarkdown(p.text, cwd, ext)}</div>
        if (p.kind === 'mol') return <MolButton key={i} st={st} block={p} n={mols++} />
        if (p.kind === 'fig') return <Figure key={i} st={st} fig={p} />
        if (p.kind === 'ask') return <Ask key={p.id} st={st} ask={p} />
        return (
          <aside key={i} className="lesson-dad">
            <span className="lesson-tag">for Dad</span>
            {renderMarkdown(p.text, cwd)}
          </aside>
        )
      })}
      {(st.extra[card.id] ?? []).map((a) => (
        <Ask key={a.id} st={st} ask={a} />
      ))}
      {!card.parts.length && <p className="lesson-dim">This card is empty.</p>}
      <footer className="lesson-sources">
        {sources.length === 0 ? (
          <span className="lesson-unsourced" title="This card cites nothing and the file lists no sources. Every card cites a source.">
            unsourced
          </span>
        ) : (
          <>
            {!own && <span className="lesson-dim">cites none of its own · the lesson’s sources:</span>}
            {sources.map((s, n) => (
              <SourceLine key={s.id} n={own ? n + 1 : null} source={s} />
            ))}
          </>
        )}
      </footer>
      {st.error && <div className="lesson-error">{st.error}</div>}
    </div>
  )
}

const openSource = (s: LessonSource) => s.url && /^https?:\/\//.test(s.url) && window.deck.openExternal(s.url)

export function SourceLine({ n, source }: { n: number | null; source: LessonSource }) {
  const link = !!source.url && /^https?:\/\//.test(source.url)
  return (
    <span className={`lesson-source ${link ? 'link' : ''}`} title={link ? source.url : undefined} onClick={(e) => (stop(e), openSource(source))}>
      {n !== null && <sup>{n}</sup>} {source.cite}
      {link && ' ↗'}
    </span>
  )
}

/** ▶ + the label: the block's lines, in order, through the Molecule door. With the Molecule tile off it says so, and turns it on. */
function MolButton({ st, block, n }: { st: LessonState; block: LessonMol; n: number }) {
  const { showMol } = useSettings()
  const [busy, setBusy] = useState(false)
  const last = [...st.runs].reverse().find((r) => r.label === block.label && r.card === st.lesson?.cards[st.card]?.id)
  return (
    <div className="lesson-mol" onClick={stop}>
      <button
        className="pill lesson-mol-btn"
        disabled={busy}
        title={showMol ? block.lines.join('\n') : 'The Molecule tile is off: click to turn it on, then click again'}
        onClick={() => {
          if (!showMol) return patchSettings({ showMol: true })
          setBusy(true)
          void lesson(st.tile)
            .run(block, n)
            .finally(() => setBusy(false))
        }}
      >
        <Play size={11} /> {block.label}
        {!showMol && <small>Molecule tile is off · turn it on</small>}
        {showMol && last?.ok && last.tile !== null && <small>in Molecule {last.tile}</small>}
      </button>
      {last && !last.ok && <div className="lesson-error">{last.error}</div>}
    </div>
  )
}

function Figure({ st, fig }: { st: LessonState; fig: LessonFig }) {
  const { url, error } = useLessonFigure(st.file, fig.src, st.rev)
  return (
    <figure className="lesson-fig">
      {url ? <img src={url} alt={fig.caption} draggable={false} /> : <div className="lesson-fig-missing">{error ?? 'loading…'}</div>}
      {fig.caption && <figcaption>{fig.caption}</figcaption>}
    </figure>
  )
}

/** A question answered in the tile. Options = one click (several right ones = tick, then check); none = a free-text box. Then right / wrong, then the why. */
function Ask({ st, ask }: { st: LessonState; ask: LessonAsk }) {
  const got = st.answers[ask.id]
  const many = ask.options.filter((o) => o.right).length > 1
  const [picked, setPicked] = useState<number[]>([])
  const [text, setText] = useState('')
  const deck = lesson(st.tile)
  return (
    <div className={`lesson-ask ${got ? (got.correct === null ? 'answered' : got.correct ? 'right' : 'wrong') : ''}`} onClick={stop}>
      <div className="lesson-q">
        {ask.adhoc && <span className="lesson-tag">asked now</span>}
        {inline(ask.q)}
      </div>
      {ask.options.length > 0 ? (
        <div className="lesson-opts">
          {ask.options.map((o, i) => {
            const chose = got ? got.chosen.includes(i) : picked.includes(i)
            return (
              <button
                key={i}
                className={`lesson-opt ${chose ? 'chose' : ''} ${got && o.right ? 'is-right' : ''} ${got && chose && !o.right ? 'is-wrong' : ''}`}
                disabled={!!got}
                onClick={() => (many ? setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i])) : deck.answer(ask, [i], ''))}
              >
                <span className="lesson-opt-mark">{got ? o.right ? <Check size={11} /> : chose ? <X size={11} /> : null : many && chose ? <Check size={11} /> : null}</span>
                <span>{inline(o.text)}</span>
              </button>
            )
          })}
          {many && !got && (
            <button className="pill" disabled={!picked.length} onClick={() => deck.answer(ask, [...picked].sort(), '')}>
              check · more than one is right
            </button>
          )}
        </div>
      ) : got ? (
        <div className="lesson-free">{got.text}</div>
      ) : (
        <form
          className="lesson-free-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) deck.answer(ask, [], text.trim())
          }}
        >
          <textarea
            value={text}
            rows={2}
            placeholder="your answer (⏎ sends, ⇧⏎ a new line)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
                e.preventDefault()
                deck.answer(ask, [], text.trim())
              }
            }}
          />
        </form>
      )}
      {got && (
        <div className="lesson-why">
          {got.correct !== null && <strong>{got.correct ? 'Right. ' : 'Not quite. '}</strong>}
          {ask.why ? inline(ask.why) : got.correct === null ? <span className="lesson-dim">answered · the session reads it at its next look</span> : null}
        </div>
      )}
    </div>
  )
}

/**
 * HOME: a Lesson tile with no lesson up shows `curriculum.json` of the focused session's folder
 * (read-only: the teaching session edits it). Blocks in order with their status, the active one
 * opened to its items; a block's title opens its lesson, an item with a `card` opens it AT that
 * card; and the running list of questions for Dad under them.
 */
export function LessonHome({ st, session }: { st: LessonState; session: SessionView | null }) {
  const tile = st.tile
  const cur = useCurriculum(session?.id ?? null, true)
  const [open, setOpen] = useState<string | null>(null)
  if (!cur?.data)
    return (
      <div className="plugin-empty lesson-empty">
        <Fox anim={st.busy ? 'run' : 'idle'} scale={2} />
        <span>{cur?.error ?? (cur ? `no curriculum.json in ${cur.dir ? tilde(cur.dir) : 'this folder'}` : 'reading…')}</span>
        <span className="lesson-dim">a session puts a lesson up with /deck:lesson</span>
        {st.error && <div className="lesson-error">{st.error}</div>}
      </div>
    )
  const c = cur.data
  const at = (p: string) => (p.startsWith('/') || p.startsWith('~') ? p : `${cur.dir}/${p}`)
  const go = (file: string | undefined, card?: string) => file && void lesson(tile).open(at(file), { card, lenient: true }).catch(() => {})
  const asked = c.questions.filter((q) => q.asked).length
  return (
    <div className="lesson-home" onClick={stop}>
      <h3 title={tilde(`${cur.dir}/curriculum.json`)}>{c.title}</h3>
      <ol className="lesson-blocks">
        {c.blocks.map((b) => {
          const unfolded = open === null ? b.status === 'active' : open === b.id
          const done = b.items.filter((i) => i.done).length
          return (
            <li key={b.id} className={`lesson-block is-${b.status}`}>
              <div className="lesson-block-head">
                <span className="lesson-block-n">{b.id}</span>
                <button className={`lesson-block-title ${b.lesson ? 'link' : ''}`} title={b.lesson ? `Open ${b.lesson}` : 'No lesson file yet'} onClick={() => (b.lesson ? go(b.lesson) : setOpen(unfolded ? '' : b.id))}>
                  {b.title}
                </button>
                <span className="spacer" />
                {b.items.length > 0 && (
                  <button className="ghost" title="Its items" onClick={() => setOpen(unfolded ? '' : b.id)}>
                    {done} / {b.items.length}
                  </button>
                )}
                <span className={`lesson-status is-${b.status}`}>{b.status}</span>
              </div>
              {unfolded && b.items.length > 0 && (
                <ul className="lesson-items">
                  {b.items.map((it, i) => (
                    <li key={i} className={`${it.done ? 'done' : ''} ${it.card && b.lesson ? 'link' : ''}`} onClick={() => it.card && go(b.lesson, it.card)} title={it.card && b.lesson ? `Open at card “${it.card}”` : undefined}>
                      <span className="lesson-tick">{it.done ? <Check size={11} /> : null}</span>
                      {it.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
      {c.questions.length > 0 && (
        <>
          <h4>
            Questions for Dad <span className="lesson-dim">{asked ? `${asked} of ${c.questions.length} asked` : c.questions.length}</span>
          </h4>
          <ul className="lesson-questions">
            {c.questions.map((q, i) => (
              <li key={i} className={q.asked ? 'done' : ''}>
                {q.block && <span className="lesson-block-n">{q.block}</span>}
                {q.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {st.error && <div className="lesson-error">{st.error}</div>}
    </div>
  )
}

export const tilde = (p: string) => p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
