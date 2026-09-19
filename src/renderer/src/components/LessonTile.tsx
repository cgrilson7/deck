import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, GraduationCap, Home, Maximize2, Plus } from 'lucide-react'
import { LESSON_TILES_MAX, nextLessonTile, type SessionView } from '@shared/types'
import { lesson, openLesson, useLesson, type LessonState } from '../lib/lesson'
import { patchSettings, useSettings } from '../lib/theme'
import { LessonCardView, LessonHome } from './LessonCard'

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

/** ‹ › and a dot per card (an answered card's dot is ticked in colour): the tile's foot, and the pane's. */
export function LessonPager({ st }: { st: LessonState }) {
  const cards = st.lesson?.cards ?? []
  const deck = lesson(st.tile)
  const go = (to: string | number) => {
    try {
      deck.goto(to)
    } catch {
      /* the first / last card: nowhere to go */
    }
  }
  return (
    <div className="lesson-pager" onClick={stop}>
      <button className="ghost" disabled={st.card <= 0} title="The card before (←)" onClick={() => go('prev')}>
        <ChevronLeft size={13} />
      </button>
      <div className="lesson-dots">
        {cards.map((c, i) => {
          const asks = deck.asksOf(c)
          const answered = asks.length > 0 && asks.every((a) => st.answers[a.id])
          return <button key={c.id + i} className={`lesson-dot ${i === st.card ? 'on' : ''} ${answered ? 'answered' : ''}`} title={`${i + 1} · ${c.heading}`} onClick={() => go(i + 1)} />
        })}
      </div>
      <button className="ghost" disabled={st.card >= cards.length - 1} title="The next card (→)" onClick={() => go('next')}>
        <ChevronRight size={13} />
      </button>
    </div>
  )
}

/**
 * The Lesson tile as a grid cell: the card that is up, scrolling, with ‹ › and the card dots
 * under it; with no lesson up, HOME (the focused session's curriculum.json). A teaching session
 * drives it through `$DECK_LESSON` (`/deck:lesson`), and the learner can page through a lesson
 * alone — its mol buttons work with no session involved. THERE CAN BE SEVERAL (`lessonTiles`),
 * numbered in the head once there are; the head's + opens another, ⤢ the pane in the center.
 */
export function LessonTile({ tile, session }: { tile: number; session: SessionView | null }) {
  const st = useLesson(tile)
  const { lessonTiles } = useSettings()
  const next = nextLessonTile(lessonTiles)
  const card = st.lesson?.cards[st.card] ?? null
  const body = useRef<HTMLDivElement>(null)
  // A new card starts at its top.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [card?.id, st.file])

  return (
    <div className="tile tile-plugin lesson" onClick={stop}>
      <header className="pane-head">
        <GraduationCap size={13} className="lesson-glyph" />
        <span className="name" title={st.file ?? `Lesson tile ${tile}: a session reaches it with --tile ${tile}`}>
          {st.lesson ? st.lesson.title : 'Lesson'}
          {lessonTiles.length > 1 ? ` · ${tile}` : ''}
        </span>
        {st.lesson && st.lesson.cards.length > 0 && (
          <span className="badge">
            {st.card + 1} / {st.lesson.cards.length}
          </span>
        )}
        <span className="spacer" />
        {st.lesson && (
          <button className="ghost" title="Back to the curriculum" onClick={() => lesson(tile).home()}>
            <Home size={12} />
          </button>
        )}
        <button className="ghost" disabled={next === null} title={next === null ? `${LESSON_TILES_MAX} Lesson tiles is the most` : 'Another Lesson tile'} onClick={() => next !== null && patchSettings({ lessonTiles: [...lessonTiles, next] })}>
          <Plus size={12} />
        </button>
        <button className="ghost" title="This lesson at reading size in the center column (⌘⇧E)" onClick={() => openLesson(tile)}>
          <Maximize2 size={12} />
        </button>
      </header>
      <div ref={body} className="lesson-body">
        {st.lesson ? (
          card ? (
            <>
              <h3 className="lesson-heading">{card.heading}</h3>
              <LessonCardView st={st} card={card} />
            </>
          ) : (
            <div className="plugin-empty">no cards in this file: a card starts at a `## ` heading</div>
          )
        ) : (
          <LessonHome st={st} session={session} />
        )}
      </div>
      {st.lesson && st.lesson.cards.length > 1 && <LessonPager st={st} />}
    </div>
  )
}
