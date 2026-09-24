// THE READER's state (La Odisea and Don Quijote, main/quixote.ts). The tile and the pane are two
// views of ONE place in ONE book (each book keeps its own place): the section and the paragraph at the top of whichever view was scrolled
// last, kept in localStorage and told to the other view by a window event, so opening the pane
// lands where the tile was and closing it leaves the tile where you stopped. The pane itself opens
// like the Studio's (a window event App listens to). The words saved from reading are the
// vocabulary store's liked words (`savedForms`), re-read whenever main says the store changed, and
// painted in the text with the CSS Custom Highlight API (no DOM is touched, so React never notices).

import { useEffect, useState } from 'react'
import { READER_BOOKS, isReaderBook, type QuixoteIndex, type QuixoteSection, type ReaderBook, type SavedForm } from '@shared/types'

// ── the pane in the center ──

const PANE = 'deck:quixote'
export type QuixoteWant = boolean | 'toggle'
export const openQuixote = (): void => void window.dispatchEvent(new CustomEvent<QuixoteWant>(PANE, { detail: true }))
export const toggleQuixote = (): void => void window.dispatchEvent(new CustomEvent<QuixoteWant>(PANE, { detail: 'toggle' }))
export function onQuixote(cb: (want: QuixoteWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<QuixoteWant>).detail)
  window.addEventListener(PANE, h)
  return () => window.removeEventListener(PANE, h)
}

// ── which book, and where you are in it ──

export interface ReadPos {
  section: number
  para: number
}
const BOOK_KEY = 'deck.reader.book'
/** Don Quijote keeps the key it had before the reader had a second book, so its place survives. */
const posKey = (book: ReaderBook) => (book === 'quijote' ? 'deck.quixote.pos' : `deck.reader.pos.${book}`)
const MOVED = 'deck:quixote:pos'
/** Chapter / Canto I, not the licences or the translator's preface: that is where a first reading starts. */
const START: ReadPos = { section: 1, para: 0 }

function readBook(): ReaderBook {
  try {
    const b = localStorage.getItem(BOOK_KEY)
    if (isReaderBook(b)) return b
  } catch {
    /* fall through */
  }
  return READER_BOOKS[0].id
}
function readPos(book: ReaderBook): ReadPos {
  try {
    const p = JSON.parse(localStorage.getItem(posKey(book)) ?? 'null') as Partial<ReadPos> | null
    if (p && Number.isInteger(p.section) && Number.isInteger(p.para) && p.section! >= 0 && p.para! >= 0) return { section: p.section!, para: p.para! }
  } catch {
    /* fall through */
  }
  return START
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* the place just won't survive a reload */
  }
}
let book = readBook()
let pos = readPos(book)
const tell = (from: object | null) => window.dispatchEvent(new CustomEvent(MOVED, { detail: { book, pos, from } }))

/** Move the reading place. `from` is the view that moved it (it does not scroll itself to where it already is). */
export function setReadPos(next: ReadPos, from: object | null = null): void {
  if (next.section === pos.section && next.para === pos.para) return
  pos = next
  store(posKey(book), JSON.stringify(pos))
  tell(from)
}
export const readPosNow = (): ReadPos => pos

/** Open another book, where it was left. Every view follows. */
export function setBook(next: ReaderBook): void {
  if (next === book) return
  book = next
  pos = readPos(book)
  store(BOOK_KEY, book)
  tell(null)
}

/** The book and the reading place, live; `jump` is set when ANOTHER view (or a chapter or book change) moved it, which is when this one scrolls. */
export function useReadPos(owner: object): { book: ReaderBook; pos: ReadPos; jump: number } {
  const [st, setSt] = useState({ book, pos, jump: 0 })
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ book: ReaderBook; pos: ReadPos; from: object | null }>).detail
      setSt((s) => ({ book: d.book, pos: d.pos, jump: d.from === owner && d.book === s.book && d.pos.section === s.pos.section ? s.jump : s.jump + 1 }))
    }
    window.addEventListener(MOVED, h)
    return () => window.removeEventListener(MOVED, h)
  }, [owner])
  return st
}

// ── the books ──

const indexes = new Map<ReaderBook, Promise<QuixoteIndex>>()
const sections = new Map<string, Promise<QuixoteSection>>()

function loadIndex(b: ReaderBook): Promise<QuixoteIndex> {
  let p = indexes.get(b)
  if (!p) {
    p = window.deck.quixoteIndex(b).catch((e: unknown) => {
      indexes.delete(b) // the first fetch from Gutenberg failed: try again next time
      throw e
    })
    indexes.set(b, p)
  }
  return p
}
function loadSection(b: ReaderBook, i: number): Promise<QuixoteSection> {
  const key = `${b}:${i}`
  let p = sections.get(key)
  if (!p) {
    p = window.deck.quixoteSection(b, i).catch((e: unknown) => {
      sections.delete(key)
      throw e
    })
    sections.set(key, p)
  }
  return p
}

export function useBookIndex(b: ReaderBook): { index: QuixoteIndex | null; error: string | null; retry: () => void } {
  const [st, setSt] = useState<{ index: QuixoteIndex | null; error: string | null }>({ index: null, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setSt({ index: null, error: null })
    let alive = true
    loadIndex(b)
      .then((index) => alive && setSt({ index, error: null }))
      .catch((e: unknown) => alive && setSt({ index: null, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      alive = false
    }
  }, [b, attempt])
  return { ...st, retry: () => setAttempt((n) => n + 1) }
}

export function useSection(b: ReaderBook, i: number): QuixoteSection | null {
  const [s, setS] = useState<QuixoteSection | null>(null)
  useEffect(() => {
    let alive = true
    setS(null)
    loadSection(b, i)
      .then((x) => {
        if (!alive) return
        setS(x)
        // The next chapter, warm, so "next" is instant.
        void loadSection(b, i + 1).catch(() => undefined)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [b, i])
  return s
}

// ── the words saved from reading ──

export function useSavedForms(): Map<string, SavedForm> {
  const [forms, setForms] = useState<Map<string, SavedForm>>(new Map())
  useEffect(() => {
    let alive = true
    const load = () =>
      window.deck
        .savedForms()
        .then((fs) => alive && setForms(new Map(fs.map((f) => [f.form, f]))))
        .catch(() => undefined)
    void load()
    const off = window.deck.onVocabChanged((c) => {
      if (c.kind === 'word' || c.kind === 'liked') void load()
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return forms
}

const WORD = /\p{L}+/gu
const markRanges = new Map<object, Range[]>()

/** Mark every saved form under `root` (whole words, case-blind). Each view owns its ranges; the highlight is all of them. */
export function paintSaved(owner: object, root: HTMLElement | null, forms: Map<string, SavedForm>): void {
  const ranges: Range[] = []
  if (root && forms.size) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      for (const m of n.data.matchAll(WORD)) {
        if (!forms.has(m[0].toLowerCase())) continue
        const r = document.createRange()
        r.setStart(n, m.index!)
        r.setEnd(n, m.index! + m[0].length)
        ranges.push(r)
      }
    }
  }
  if (ranges.length) markRanges.set(owner, ranges)
  else markRanges.delete(owner)
  const all = [...markRanges.values()].flat()
  if (all.length) CSS.highlights.set('quixote-saved', new Highlight(...all))
  else CSS.highlights.delete('quixote-saved')
}

/** The sentence around [at, at + len) of a paragraph's text: from after the last stop before it to the first stop after it. */
export function sentenceAround(text: string, at: number, len: number): string {
  const stop = /[.!?;:]["»”)]*\s/g
  let from = 0
  let to = text.length
  for (const m of text.matchAll(stop)) {
    const end = m.index! + m[0].length
    if (end <= at) from = end
    else if (m.index! >= at + len - 1) {
      to = m.index! + m[0].trimEnd().length
      break
    }
  }
  const s = text.slice(from, to).replace(/\s+/g, ' ').trim()
  // A run-on period of Cervantes can go on for a page: keep the part around the selection.
  if (s.length <= 400) return s
  const mid = at - from
  return `…${s.slice(Math.max(0, mid - 180), mid + len + 180).trim()}…`
}
