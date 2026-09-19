// THE LESSON TILE's state: the other half of the teacher. A teaching session (in ~/grail) drives
// the Molecule tiles through $DECK_MOL and points at THE LESSON through $DECK_LESSON: a markdown
// file of the learner's repo cut into cards (shared/lesson.ts), one card up at a time, with a
// question the learner answers IN the tile — which `look` then tells the session.
//
// The Molecule tile's plan: the state lives HERE, one module singleton with a deck per Lesson
// tile (`lesson(n)`, `useLesson(n)`; the `lessonTiles` setting), and the UI and the door
// (`POST /lesson` → main's `lessonCall`, which reads the file FIRST → `lesson:req`) call the SAME
// `drive(body)`. The tile owns no content and writes nothing to the repo: a tile's
// `{ file, card }` is kept in localStorage (`lesson:scene:<n>`) so it survives ⌘R, and the answers
// in `lesson:answers:<absolute file>` (shared by every tile showing that file). Main watches the
// files that are up and re-sends a changed one: the card is kept by id.

import { useEffect, useState } from 'react'
import { cardText, parseLesson, type Lesson, type LessonAnswer, type LessonAsk, type LessonCard, type LessonMol } from '@shared/lesson'
import type { CurriculumRead, LessonFile } from '@shared/types'

/** One press of a card's mol button. */
export interface LessonRun {
  label: string
  card: string
  at: number
  ok: boolean
  /** The Molecule tile it landed in. */
  tile: number | null
  error?: string
}

/** What happened in a tile, for `look`'s `since`. */
type LessonEvent = { at: number } & (
  | { kind: 'answer'; card: string; ask: string; correct: boolean | null; answer: string }
  | { kind: 'run'; card: string; label: string; ok: boolean }
  | { kind: 'card'; card: string; by: 'learner' | 'session' }
  | { kind: 'reload' }
)

export interface LessonState {
  tile: number
  /** Absolute path of the lesson up; null = the HOME view (the curriculum). */
  file: string | null
  lesson: Lesson | null
  /** Index of the card up. */
  card: number
  /** Phrases the teacher is pointing at on this card. */
  marks: string[]
  /** An ad-hoc callout pinned over the card (markdown; not in the file). */
  note: string | null
  /** Ad-hoc questions by card id (the door's `ask`; not in the file). */
  extra: Record<string, LessonAsk[]>
  /** This file's answers, by ask id. */
  answers: Record<string, LessonAnswer>
  runs: LessonRun[]
  /** Bumped on every (re)load: figures are read again. */
  rev: number
  busy: boolean
  error: string | null
}

const MARKS_MAX = 6
const sceneKey = (tile: number) => `lesson:scene:${tile}`
const answersKey = (file: string) => `lesson:answers:${file}`

function stored<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}

// ── answers: by file, shared by every tile showing it ──

const answerCache = new Map<string, Record<string, LessonAnswer>>()
function answersOf(file: string): Record<string, LessonAnswer> {
  let a = answerCache.get(file)
  if (!a) answerCache.set(file, (a = stored<Record<string, LessonAnswer>>(answersKey(file)) ?? {}))
  return a
}
function writeAnswers(file: string, next: Record<string, LessonAnswer>): void {
  answerCache.set(file, next)
  try {
    if (Object.keys(next).length) localStorage.setItem(answersKey(file), JSON.stringify(next))
    else localStorage.removeItem(answersKey(file))
  } catch {
    /* storage full: the answer still shows until a reload */
  }
  for (const d of decks.values()) if (d.state.file === file) d.patch({ answers: next })
}

const iso = (t: number) => new Date(t).toISOString()

/** What was answered, in the option's words (what the session teaches to). */
function answerWords(ask: LessonAsk, a: LessonAnswer): string {
  return ask.options.length ? a.chosen.map((i) => ask.options[i]?.text ?? `option ${i + 1}`).join(' + ') : a.text
}

class LessonDeck {
  state: LessonState
  private readonly subs = new Set<(s: LessonState) => void>()
  private events: LessonEvent[] = []
  private looked = 0

  constructor(readonly tile: number) {
    this.state = { tile, file: null, lesson: null, card: 0, marks: [], note: null, extra: {}, answers: {}, runs: [], rev: 0, busy: false, error: null }
    const saved = stored<{ file?: string; card?: string; extra?: Record<string, LessonAsk[]> }>(sceneKey(tile))
    if (saved?.file) void this.open(saved.file, { card: saved.card, extra: saved.extra, lenient: true }).catch(() => {})
  }

  subscribe(cb: (s: LessonState) => void): () => void {
    this.subs.add(cb)
    return () => void this.subs.delete(cb)
  }

  patch(p: Partial<LessonState>): void {
    const files = p.file !== undefined && p.file !== this.state.file
    this.state = { ...this.state, ...p }
    this.subs.forEach((s) => s(this.state))
    changed()
    if (files) syncWatch()
  }

  private log(e: LessonEvent): void {
    this.events.push(e)
    if (this.events.length > 100) this.events.shift()
  }

  private save(): void {
    const { file, lesson, card, extra } = this.state
    try {
      if (!file || !lesson) localStorage.removeItem(sceneKey(this.tile))
      else localStorage.setItem(sceneKey(this.tile), JSON.stringify({ file, card: lesson.cards[card]?.id, extra }))
    } catch {
      /* not worth a word */
    }
  }

  get current(): LessonCard | null {
    return this.state.lesson?.cards[this.state.card] ?? null
  }

  /** The asks of a card: the file's, then the ad-hoc ones. */
  asksOf(card: LessonCard): LessonAsk[] {
    return [...card.parts.flatMap((p) => (p.kind === 'ask' ? [p] : [])), ...(this.state.extra[card.id] ?? [])]
  }

  /** A card by number (1-based), id, or next / prev. */
  private find(which: unknown, cards: LessonCard[] = this.state.lesson?.cards ?? []): number {
    const w = String(which ?? '').trim()
    if (w === 'next' || w === 'prev') {
      const i = this.state.card + (w === 'next' ? 1 : -1)
      if (i < 0 || i >= cards.length) throw new Error(w === 'next' ? `card ${cards.length} is the last one` : 'this is the first card')
      return i
    }
    const byId = cards.findIndex((c) => c.id === w)
    if (byId >= 0) return byId
    if (/^\d+$/.test(w) && Number(w) >= 1 && Number(w) <= cards.length) return Number(w) - 1
    throw new Error(`no card “${w}”: the cards are ${cards.map((c, i) => `${i + 1} ${c.id}`).join(' · ')}`)
  }

  /**
   * Put a lesson's text up: a `show`, a restore, a reload. Without a card asked for, the SAME file
   * keeps the card that is up, BY ID (the teacher edits the lesson under the learner's eyes), and
   * with it the marks, the note and the ad-hoc asks. A card that does not exist refuses the whole
   * load (nothing changes) unless `lenient` (a restore: the card may have been renamed since).
   */
  load(f: LessonFile, opts: { card?: unknown; extra?: Record<string, LessonAsk[]>; lenient?: boolean } = {}): void {
    const same = this.state.file === f.file
    const keep = same ? this.current?.id : undefined
    const parsed = parseLesson(f.text)
    const wanted = opts.card !== undefined && opts.card !== null && opts.card !== ''
    let at = 0
    if (wanted) {
      try {
        at = this.find(opts.card, parsed.cards)
      } catch (err) {
        if (!opts.lenient) throw err
      }
    } else if (keep !== undefined && parsed.cards.some((c) => c.id === keep)) at = parsed.cards.findIndex((c) => c.id === keep)
    else if (same) at = Math.min(this.state.card, Math.max(0, parsed.cards.length - 1))
    const stay = same && parsed.cards[at]?.id === keep
    this.patch({
      file: f.file,
      lesson: parsed,
      card: at,
      answers: answersOf(f.file),
      extra: same ? this.state.extra : (opts.extra ?? {}),
      marks: stay ? this.state.marks : [],
      note: stay ? this.state.note : null,
      rev: this.state.rev + 1,
      busy: false,
      error: null
    })
    if (same && !wanted) this.log({ at: Date.now(), kind: 'reload' })
    this.save()
  }

  /** Read a lesson off the disk (main does) and show it: the UI's way in (the door's `show` arrives with the text). */
  async open(file: string, opts: { card?: unknown; extra?: Record<string, LessonAsk[]>; lenient?: boolean } = {}): Promise<void> {
    this.patch({ busy: true, error: null })
    try {
      this.load(await window.deck.lessonRead(file), opts)
    } catch (err) {
      this.patch({ busy: false, error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) })
      throw err
    }
  }

  goto(which: unknown, by: 'learner' | 'session' = 'learner'): void {
    if (!this.state.lesson) throw new Error(`Lesson tile ${this.tile} shows the curriculum, not a lesson: \`show <file.md>\` first`)
    const at = this.find(which)
    if (at === this.state.card) return
    this.patch({ card: at, marks: [], note: null })
    this.log({ at: Date.now(), kind: 'card', card: this.current!.id, by })
    this.save()
  }

  home(): void {
    this.patch({ file: null, lesson: null, card: 0, marks: [], note: null, extra: {}, answers: {}, error: null })
    this.save()
  }

  /** The learner answers an ask: kept by file, told to the session at its next `look`. */
  answer(ask: LessonAsk, chosen: number[], text: string): void {
    const { file } = this.state
    const card = this.current
    if (!file || !card) return
    const right = ask.options.flatMap((o, i) => (o.right ? [i] : []))
    const correct = ask.options.length ? (right.length ? right.length === chosen.length && right.every((i) => chosen.includes(i)) : null) : null
    const a: LessonAnswer = { chosen, text, correct, at: Date.now() }
    writeAnswers(file, { ...answersOf(file), [ask.id]: a })
    this.log({ at: a.at, kind: 'answer', card: card.id, ask: ask.id, correct, answer: answerWords(ask, a) })
  }

  /** A card's mol button: its lines through the Molecule door (main runs them). */
  async run(block: LessonMol, n: number): Promise<void> {
    const { file } = this.state
    const card = this.current
    if (!file || !card) return
    const r = await window.deck.lessonMol({ file, key: `${file}#${card.id}#${n}`, lines: block.lines, tile: block.tile, fresh: block.fresh }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    const run: LessonRun = { label: block.label, card: card.id, at: Date.now(), ok: r.ok, tile: r.ok ? r.tile : null, ...(r.ok ? {} : { error: r.error }) }
    this.patch({ runs: [...this.state.runs, run].slice(-40) })
    this.log({ at: run.at, kind: 'run', card: card.id, label: block.label, ok: r.ok })
  }

  private look(): Record<string, unknown> {
    const { file, lesson, marks, note, runs, answers } = this.state
    const since = { first: this.looked === 0, events: this.events.filter((e) => e.at > this.looked).map((e) => ({ ...e, at: iso(e.at) })) }
    this.looked = Date.now()
    if (!file || !lesson) return { home: true, note: 'this tile shows the curriculum (curriculum.json of the focused session\'s folder): `show <file.md>` puts a lesson up', since }
    const cur = this.current
    return {
      file,
      title: lesson.title,
      card: cur ? { n: this.state.card + 1, id: cur.id, heading: cur.heading } : null,
      of: lesson.cards.length,
      cards: lesson.cards.map((c, i) => ({
        n: i + 1,
        id: c.id,
        heading: c.heading,
        asks: this.asksOf(c).map((a) => {
          const got = answers[a.id]
          return { id: a.id, q: a.q, ...(a.adhoc ? { adhoc: true } : {}), answered: got ? { answer: answerWords(a, got), correct: got.correct, at: iso(got.at) } : null }
        })
      })),
      marks,
      note,
      molRuns: runs.map((r) => ({ ...r, at: iso(r.at) })),
      since
    }
  }

  /** Every op of the door (and the UI's paging): one place, so the two can never disagree. */
  drive(b: Record<string, unknown>): Record<string, unknown> {
    const where = () => {
      const c = this.current
      return c ? { card: { n: this.state.card + 1, id: c.id, heading: c.heading }, of: this.state.lesson!.cards.length } : { home: true }
    }
    const needCard = (): LessonCard => {
      const c = this.current
      if (!c) throw new Error(`Lesson tile ${this.tile} shows the curriculum, not a lesson: \`show <file.md>\` first`)
      return c
    }
    switch (b.op) {
      case 'show': {
        if (typeof b.file !== 'string' || typeof b.text !== 'string') throw new Error('show wants a lesson file')
        this.load({ file: b.file, text: b.text, mtime: Number(b.mtime) || 0 }, { card: b.card })
        const problems = this.state.lesson!.problems
        return { file: b.file, title: this.state.lesson!.title, ...where(), cards: this.state.lesson!.cards.map((c, i) => `${i + 1} ${c.id}`), ...(problems.length ? { problems } : {}) }
      }
      case 'goto':
        this.goto(b.to, 'session')
        return where()
      case 'home':
        this.home()
        return { home: true }
      case 'mark': {
        const phrase = String(b.phrase ?? '').replace(/\s+/g, ' ').trim()
        if (b.clear) {
          this.patch({ marks: phrase ? this.state.marks.filter((m) => m.toLowerCase() !== phrase.toLowerCase()) : [] })
          return { marks: this.state.marks, ...where() }
        }
        const card = needCard()
        if (!phrase) throw new Error('mark wants a phrase that is on the card: mark "bent"')
        const all = [cardText(card), ...(this.state.extra[card.id] ?? []).map((a) => a.q), this.state.note ?? ''].join(' ').toLowerCase()
        if (!all.includes(phrase.toLowerCase())) throw new Error(`“${phrase}” is not on card ${this.state.card + 1} (${card.id}): mark a phrase as the card words it (\`look\` says which card is up)`)
        this.patch({ marks: [...this.state.marks.filter((m) => m.toLowerCase() !== phrase.toLowerCase()), phrase].slice(-MARKS_MAX) })
        return { marks: this.state.marks, ...where() }
      }
      case 'note': {
        const text = String(b.text ?? '').trim()
        if (!b.clear) needCard()
        if (!b.clear && !text) throw new Error('note wants some markdown: note "look at the **angle**"')
        this.patch({ note: b.clear ? null : text })
        return { note: this.state.note, ...where() }
      }
      case 'ask': {
        const card = needCard()
        const q = String(b.q ?? '').trim()
        if (!q) throw new Error('ask wants --q "<the question>"')
        const opts = Array.isArray(b.options) ? b.options.map(String).filter(Boolean) : []
        const right = (Array.isArray(b.right) ? b.right : []).map(Number)
        if (opts.length === 1) throw new Error('one option is not a choice: give several --opt, or none for a free-text answer')
        if (right.some((n) => !Number.isInteger(n) || n < 1 || n > opts.length)) throw new Error(`--right is an option's number, 1–${opts.length}`)
        if (opts.length && !right.length) throw new Error('say which option is right: --right <n>')
        const id = String(b.id ?? '').trim() || `adhoc-${Date.now().toString(36)}`
        if (this.state.lesson!.cards.some((c) => this.asksOf(c).some((a) => a.id === id))) throw new Error(`there is already an ask “${id}” in this lesson`)
        const ask: LessonAsk = { kind: 'ask', id, q, options: opts.map((text, i) => ({ text, right: right.includes(i + 1) })), why: String(b.why ?? ''), adhoc: true }
        this.patch({ extra: { ...this.state.extra, [card.id]: [...(this.state.extra[card.id] ?? []), ask] } })
        this.save()
        return { asked: id, ...where() }
      }
      case 'look':
        return this.look()
      default:
        throw new Error(`the Lesson tile has no “${String(b.op)}”`)
    }
  }
}

// ── one deck per Lesson tile ──

const decks = new Map<number, LessonDeck>()
const watchers = new Set<() => void>()
const changed = () => watchers.forEach((w) => w())

/** Tile `n`'s deck (made, and its scene restored, on first use). */
export function lesson(tile = 1): LessonDeck {
  let d = decks.get(tile)
  if (!d) decks.set(tile, (d = new LessonDeck(tile)))
  return d
}

/** Main watches what is up, all tiles together. */
function syncWatch(): void {
  window.deck.lessonWatch([...new Set([...decks.values()].flatMap((d) => d.state.file ?? []))])
}

/** The `lessonTiles` setting changed: a closed tile's deck (and its kept scene) goes; every tile that exists has one, so the door reaches a tile never scrolled to. */
export function syncLessonTiles(tiles: number[]): void {
  for (const n of [...decks.keys()])
    if (!tiles.includes(n)) {
      decks.delete(n)
      localStorage.removeItem(sceneKey(n))
    }
  for (const n of tiles) lesson(n)
  syncWatch()
  changed()
}

let installed = false
/** Answer the door (`POST /lesson`) and take reloads. Once, at boot, when the tile is on. */
export function installLesson(): void {
  if (installed) return
  installed = true
  window.deck.onLesson(({ id, body }) => {
    const reply = (r: Record<string, unknown>) => window.deck.lessonReply(id, r)
    try {
      if (body.op === 'tiles') {
        const tiles = (Array.isArray(body.tiles) ? body.tiles : [1]).map(Number)
        return reply({ ok: true, tiles: tiles.map((n) => ({ tile: n, empty: !lesson(n).state.file, file: lesson(n).state.file, title: lesson(n).state.lesson?.title ?? null, card: lesson(n).current?.id ?? null })) })
      }
      if (body.op === 'reset') {
        const file = String(body.file ?? '')
        const n = Object.keys(answersOf(file)).length
        writeAnswers(file, {})
        return reply({ ok: true, file, forgot: n })
      }
      const tile = Number(body.tile) || 1
      reply({ ok: true, tile, ...lesson(tile).drive(body) })
    } catch (e) {
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
  window.deck.onLessonChanged((f) => {
    for (const d of decks.values())
      if (d.state.file === f.file) {
        try {
          d.load(f)
        } catch {
          /* a half-saved file: the next save brings it back */
        }
      }
  })
}

/** One tile's state, live. */
export function useLesson(tile = 1): LessonState {
  const [s, setS] = useState<LessonState>(() => lesson(tile).state)
  useEffect(() => {
    setS(lesson(tile).state)
    return lesson(tile).subscribe(setS)
  }, [tile])
  return s
}

/** What each of these tiles shows, live: the pane's rail. */
export function useLessonScenes(tiles: number[]): { tile: number; label: string }[] {
  const [, bump] = useState(0)
  useEffect(() => {
    const w = () => bump((n) => n + 1)
    watchers.add(w)
    return () => void watchers.delete(w)
  }, [])
  return tiles.map((tile) => ({ tile, label: decks.get(tile)?.state.lesson?.title ?? 'curriculum' }))
}

/** A `fig` block's image as a blob: URL (main reads the bytes; the CSP allows `img-src blob:`). */
export function useLessonFigure(file: string | null, src: string, rev: number): { url: string | null; error: string | null } {
  const [got, setGot] = useState<{ url: string | null; error: string | null }>({ url: null, error: null })
  useEffect(() => {
    if (!file || !src) return
    let alive = true
    let url: string | null = null
    void window.deck
      .lessonFigure(file, src)
      .then((r) => {
        if (!alive) return
        if (!r.ok) return setGot({ url: null, error: r.error })
        url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }))
        setGot({ url, error: null })
      })
      .catch((e: unknown) => alive && setGot({ url: null, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [file, src, rev])
  return got
}

const HOME_KEY = 'lesson:home'
const CURRICULUM_POLL_MS = 3000

/**
 * The home view's data: `curriculum.json` of the focused session's folder, re-read every few
 * seconds while showing (the teaching session edits it). The folder it was last found in is
 * remembered, so focusing another session does not blank the curriculum.
 */
export function useCurriculum(sessionId: string | null, active: boolean): CurriculumRead | null {
  const [cur, setCur] = useState<CurriculumRead | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    let last = ''
    const read = () => {
      if (document.visibilityState === 'hidden') return
      void window.deck
        .lessonCurriculum(sessionId, localStorage.getItem(HOME_KEY) ?? undefined)
        .then((c) => {
          if (!alive) return
          if (c.data) localStorage.setItem(HOME_KEY, c.dir)
          const json = JSON.stringify(c)
          if (json !== last) {
            last = json
            setCur(c)
          }
        })
        .catch(() => {})
    }
    read()
    const t = window.setInterval(read, CURRICULUM_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [sessionId, active])
  return cur
}

// ── the teacher's pointer: `mark` phrases, painted with the CSS Custom Highlight API (no DOM is touched, so React never notices) ──

const markRanges = new Map<object, Range[]>()
function paintMarks(): void {
  const all = [...markRanges.values()].flat()
  if (all.length) CSS.highlights.set('lesson-mark', new Highlight(...all))
  else CSS.highlights.delete('lesson-mark')
}

/** Highlight every occurrence of `phrases` under `root` (case-blind, across inline elements); returns the first range, to scroll to. */
export function setMarks(owner: object, root: HTMLElement | null, phrases: string[]): Range | null {
  const ranges: Range[] = []
  if (root && phrases.length) {
    const nodes: { node: Text; at: number }[] = []
    let text = ''
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      nodes.push({ node: n as Text, at: text.length })
      text += (n as Text).data
    }
    const lower = text.toLowerCase()
    const place = (offset: number): [Text, number] => {
      let i = nodes.length - 1
      while (i > 0 && nodes[i].at > offset) i--
      return [nodes[i].node, offset - nodes[i].at]
    }
    for (const p of phrases) {
      const needle = p.toLowerCase()
      for (let at = lower.indexOf(needle); at >= 0 && needle; at = lower.indexOf(needle, at + needle.length)) {
        const r = document.createRange()
        r.setStart(...place(at))
        const [endNode, endAt] = place(at + needle.length - 1)
        r.setEnd(endNode, endAt + 1)
        ranges.push(r)
      }
    }
  }
  if (ranges.length) markRanges.set(owner, ranges)
  else markRanges.delete(owner)
  paintMarks()
  return ranges[0] ?? null
}

// The pane in the center column: the window event the Studio, the Game Boy and the Molecule viewer use, plus which tile it takes.
const EVENT = 'deck:lesson'
export interface LessonWant {
  want: boolean | 'toggle'
  tile?: number
}
export function openLesson(tile?: number): void {
  window.dispatchEvent(new CustomEvent<LessonWant>(EVENT, { detail: { want: true, tile } }))
}
export function onLessonPane(cb: (want: LessonWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<LessonWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
