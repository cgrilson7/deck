import { useEffect, useRef } from 'react'
import { Check, GraduationCap, Home } from 'lucide-react'
import type { SessionView } from '@shared/types'
import { lesson, openLesson, useLesson, useLessonScenes } from '../lib/lesson'
import { useSettings } from '../lib/theme'
import { LessonCardView, LessonHome, SourceLine, tilde } from './LessonCard'
import { LessonPager } from './LessonTile'

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || !!el.closest('.xterm'))
}

/**
 * A Lesson tile at reading size in the CENTER column, in the focus pane's place, the way the
 * Studio, the Game Boy and the Molecule viewer take it (they take turns; a focus change or Esc
 * gives the center back). The SAME state as the tile it was opened from (lib/lesson), plus what a
 * tile has no room for: a left rail of the lesson's cards (answered ones ticked), the file's
 * sources, and with several Lesson tiles a rail of chips to step between them. ← → page the cards.
 */
export function LessonPane({ tile, session, onClose }: { tile: number; session: SessionView | null; onClose: () => void }) {
  const st = useLesson(tile)
  const { lessonTiles } = useSettings()
  const rail = useLessonScenes(lessonTiles)
  const pane = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const deck = lesson(tile)
  const card = st.lesson?.cards[st.card] ?? null

  useEffect(() => {
    pane.current?.focus()
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      if (e.key === 'Escape') onClose()
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.altKey) {
        try {
          lesson(tile).goto(e.key === 'ArrowLeft' ? 'prev' : 'next')
        } catch {
          /* the first / last card, or the curriculum */
        }
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onClose, tile])
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [card?.id, st.file])

  return (
    <section ref={pane} className="focus lesson-pane" tabIndex={-1}>
      <header className="pane-head">
        <GraduationCap size={14} className="lesson-glyph" />
        <span className="name" title={st.file ? tilde(st.file) : undefined}>
          {st.lesson ? st.lesson.title : 'Lesson'}
          {lessonTiles.length > 1 ? ` · ${tile}` : ''}
        </span>
        {st.lesson && st.lesson.cards.length > 0 && (
          <span className="badge">
            {st.card + 1} / {st.lesson.cards.length}
          </span>
        )}
        {st.lesson?.meta.block && <span className="badge">block {st.lesson.meta.block}</span>}
        <span className="spacer" />
        {st.lesson && (
          <button className="ghost" title="Back to the curriculum" onClick={() => deck.home()}>
            <Home size={12} /> curriculum
          </button>
        )}
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      {rail.length > 1 && (
        <div className="mol-rail">
          {rail.map((r) => (
            <button key={r.tile} className={`pill ${r.tile === tile ? 'on' : ''}`} title={`Lesson tile ${r.tile}`} onClick={() => openLesson(r.tile)}>
              <span className="mol-ref">{r.tile}</span> {r.label}
            </button>
          ))}
        </div>
      )}

      {st.lesson ? (
        <div className="lesson-pane-main">
          <nav className="lesson-rail">
            {st.lesson.cards.map((c, i) => {
              const asks = deck.asksOf(c)
              const answered = asks.filter((a) => st.answers[a.id]).length
              return (
                <button key={c.id + i} className={`lesson-rail-card ${i === st.card ? 'on' : ''}`} onClick={() => deck.goto(i + 1)} title={`${c.id}${asks.length ? ` · ${answered} of ${asks.length} answered` : ''}`}>
                  <span className="lesson-rail-n">{i + 1}</span>
                  <span className="lesson-rail-name">{c.heading}</span>
                  {asks.length > 0 && <span className={`lesson-rail-tick ${answered === asks.length ? 'done' : ''}`}>{answered === asks.length ? <Check size={11} /> : `${answered}/${asks.length}`}</span>}
                </button>
              )
            })}
            <div className="lesson-rail-sources">
              <span className="mol-label">sources</span>
              {st.lesson.sources.length ? st.lesson.sources.map((s) => <SourceLine key={s.id} n={null} source={s} />) : <span className="lesson-unsourced">none listed</span>}
            </div>
          </nav>
          <div className="lesson-pane-card">
            <div ref={body} className="lesson-body">
              {card ? (
                <>
                  <h2 className="lesson-heading">{card.heading}</h2>
                  <LessonCardView st={st} card={card} />
                </>
              ) : (
                <div className="plugin-empty">no cards in this file: a card starts at a `## ` heading</div>
              )}
            </div>
            {st.lesson.cards.length > 1 && <LessonPager st={st} />}
          </div>
        </div>
      ) : (
        <div className="lesson-body">
          <LessonHome st={st} session={session} />
        </div>
      )}
    </section>
  )
}
