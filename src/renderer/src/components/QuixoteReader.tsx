import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Heart, Maximize2, RotateCcw, X } from 'lucide-react'
import type { QuixoteIndex, QuixoteSection, SavedForm, TranslateResult, VocabEntry, VocabResult } from '@shared/types'
import { announceTranslation } from '../lib/bus'
import { BARK_MS } from '../lib/bark'
import { useSettings } from '../lib/theme'
import { Fox } from './Fox'
import { BarkBursts } from './FoxStatus'
import { plain } from '../lib/errors'
import { openQuixote, originOf, paintSaved, readPosNow, sentenceAround, setReadPos, shortLabel, useBookIndex, useReadPos, useSavedForms, useSection } from '../lib/quixote'

const PART_NAME = ['', 'Primera parte', 'Segunda parte']
/** What the translator takes in one go (main/translate.ts). */
const MAX_SELECTION = 1000
/** The pop's width, and roughly its height when choosing above or below the selection. */
const POP_W = 340
const POP_H = 190

const stop = (e: React.SyntheticEvent) => e.stopPropagation()
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** Up to two words, no punctuation inside: a dictionary lookup, not only a translation. */
const isWordish = (s: string) => s.split(' ').length <= 2 && !/[.,;:!?¿¡"«»()—]/.test(s)

/** An entry for what Wiktionary does not have (a phrase, an archaism): the pair alone, so it can still be a flash card. */
const bare = (word: string): VocabEntry => ({ word, ipa: null, formOf: null, senses: [], native: [], synonyms: [], etymology: null, example: null, url: '' })

interface Picked {
  text: string
  sentence: string
  /** Where the pop stands inside the scrolling body (content coordinates, so it scrolls with the text). */
  top: number | null
  bottom: number | null
  left: number
  width: number
}

/**
 * DON QUIJOTE, to read in Spanish: the TILE (a plugin cell of the right column) and the PANE (the
 * same reader at reading size in the center column, ⌘⇧D or the tile's ⤢) are two views of one
 * place in the book (lib/quixote.ts). Select any word or passage — a double-click takes a word —
 * and a pop translates it (Google, the translator tile's key); a word or two is also looked up
 * in Wiktionary, and SAVE puts it in the vocabulary store with the sentence it was met in and a
 * ♥, which makes it a flash card, a word of the dictionary's cycle, and a mark in the text here.
 */
function Reader({ big, onClose }: { big: boolean; onClose?: () => void }) {
  const owner = useRef({}).current
  const { index, error, retry } = useBookIndex()
  const { pos, jump } = useReadPos(owner)
  const section = useSection(pos.section)
  const forms = useSavedForms()
  const body = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const quiet = useRef(0)
  const [pick, setPick] = useState<Picked | null>(null)
  const info = index?.sections[pos.section] ?? null
  const count = index?.sections.length ?? 0

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= count) return
      setPick(null)
      setReadPos({ section: i, para: 0 }, null)
    },
    [count]
  )

  // Scroll to the place when the section arrives, and whenever another view moved it.
  useLayoutEffect(() => {
    const b = body.current
    if (!b || !section || section.i !== pos.section) return
    const el = b.querySelector<HTMLElement>(`[data-p="${readPosNow().para}"]`)
    quiet.current = performance.now() + 150
    b.scrollTop = el && readPosNow().para > 0 ? el.offsetTop - 10 : 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, jump])

  useEffect(() => {
    paintSaved(owner, text.current, forms)
  }, [owner, section, forms])
  useEffect(() => () => paintSaved(owner, null, forms), [owner]) // eslint-disable-line react-hooks/exhaustive-deps

  // The paragraph at the top of the view is the place (rAF-throttled).
  const frame = useRef(0)
  const onScroll = () => {
    if (frame.current || performance.now() < quiet.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const b = body.current
      if (!b || !section) return
      const ps = b.querySelectorAll<HTMLElement>('[data-p]')
      let lo = 0
      let hi = ps.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (ps[mid].offsetTop + ps[mid].offsetHeight <= b.scrollTop + 12) lo = mid + 1
        else hi = mid
      }
      const para = Number(ps[lo]?.dataset.p ?? 0)
      setReadPos({ section: section.i, para }, owner)
    })
  }

  /** A selection in the text: where it is, the sentence around it, and where the pop goes. */
  const onMouseUp = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.qx-pop')) return
    // A double-click's selection settles after this event.
    window.setTimeout(() => {
      const sel = window.getSelection()
      const b = body.current
      if (!sel || sel.isCollapsed || !sel.rangeCount || !b || !text.current) return
      const range = sel.getRangeAt(0)
      if (!text.current.contains(range.commonAncestorContainer)) return
      const raw = sel.toString().replace(/\s+/g, ' ').trim()
      const t = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '')
      if (!t || t.length > MAX_SELECTION) return
      const p = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : (range.startContainer as HTMLElement))?.closest<HTMLElement>('[data-p]')
      let sentence = t
      if (p) {
        const before = document.createRange()
        before.setStart(p, 0)
        before.setEnd(range.startContainer, range.startOffset)
        sentence = sentenceAround(p.textContent ?? '', before.toString().length, raw.length)
      }
      const r = range.getBoundingClientRect()
      const box = b.getBoundingClientRect()
      const width = Math.min(POP_W, box.width - 16)
      const left = Math.max(8, Math.min(r.left - box.left + r.width / 2 - width / 2, box.width - width - 8))
      const below = box.bottom - r.bottom
      const roomy = below >= POP_H || below >= r.top - box.top
      setPick({
        text: t,
        sentence,
        top: roomy ? r.bottom - box.top + b.scrollTop + 6 : null,
        bottom: roomy ? null : b.scrollHeight - (r.top - box.top + b.scrollTop) + 6,
        left,
        width
      })
    }, 0)
  }

  // Esc puts the pop away first; in the pane, then closes it. ← → turn the chapter (the pane only: the tile never takes the keyboard).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      if (e.key === 'Escape' && pick) {
        setPick(null)
        e.stopPropagation()
      } else if (big && e.key === 'Escape') onClose?.()
      else if (big && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.altKey) go(pos.section + (e.key === 'ArrowLeft' ? -1 : 1))
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [big, pick, onClose, go, pos.section])

  const pct = section && section.paras.length > 1 ? Math.round((pos.para / (section.paras.length - 1)) * 100) : 0
  const next = index?.sections[pos.section + 1] ?? null
  const saved = new Set([...forms.values()].map((f) => f.id)).size

  return (
    <>
      <header className="pane-head">
        <BookOpen size={big ? 14 : 13} className="lesson-glyph" />
        <span className="name">Don Quijote</span>
        {info && (
          <span className="badge" title={`${PART_NAME[info.part]}, ${info.label}${info.title ? `: ${info.title}` : ''}`}>
            {shortLabel(info)} · {pct}%
          </span>
        )}
        {big && saved > 0 && (
          <span className="badge" title="Words saved from reading (liked in the vocabulary store): marked in the text">
            ♥ {saved}
          </span>
        )}
        <span className="spacer" />
        <button className="ghost" disabled={pos.section <= 0} title={big ? 'The chapter before (←)' : 'The chapter before'} onClick={() => go(pos.section - 1)}>
          <ChevronLeft size={13} />
        </button>
        {big && index && <ChapterSelect index={index} value={pos.section} onPick={go} />}
        <button className="ghost" disabled={!next} title={big ? 'The next chapter (→)' : 'The next chapter'} onClick={() => go(pos.section + 1)}>
          <ChevronRight size={13} />
        </button>
        {big ? (
          <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
            close
          </button>
        ) : (
          <button className="ghost" title="Read at full size in the center column (⌘⇧D)" onClick={openQuixote}>
            <Maximize2 size={12} />
          </button>
        )}
      </header>
      <div
        ref={body}
        className="qx-body"
        onScroll={onScroll}
        onMouseUp={onMouseUp}
        onMouseDown={(e) => !(e.target as HTMLElement).closest('.qx-pop') && setPick(null)}
      >
        {error ? (
          <div className="plugin-empty">
            <p>The book did not load: {error}</p>
            <button className="ghost" onClick={retry}>
              <RotateCcw size={12} /> try again
            </button>
          </div>
        ) : !section || !info ? (
          <div className="plugin-empty">{index ? '…' : 'fetching Don Quijote from Project Gutenberg…'}</div>
        ) : (
          <div ref={text} className="qx-text" lang="es">
            <h2 className="qx-heading">
              <span className="lesson-tag">
                {PART_NAME[section.part]} · {section.label}
              </span>
              {section.title || (section.part === 1 ? 'Tasa, privilegio, prólogo y versos preliminares' : 'Tasa, aprobaciones, dedicatoria y prólogo')}
            </h2>
            {section.paras.map((p, k) => (
              <p key={k} data-p={k} className={p.verse ? 'qx-verse' : undefined}>
                {p.text}
              </p>
            ))}
            {next && (
              <button className="qx-next" onClick={() => go(next.i)}>
                {PART_NAME[next.part] !== PART_NAME[section.part] ? `${PART_NAME[next.part]} · ` : ''}
                {next.label} <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}
        {pick && section && <Pop key={`${pick.text}|${pick.top}|${pick.bottom}`} pick={pick} section={section} forms={forms} onClose={() => setPick(null)} />}
      </div>
    </>
  )
}

function ChapterSelect({ index, value, onPick }: { index: QuixoteIndex; value: number; onPick: (i: number) => void }) {
  return (
    <select className="qx-select" value={value} onChange={(e) => onPick(Number(e.target.value))} title="Go to a chapter">
      {[1, 2].map((part) => (
        <optgroup key={part} label={PART_NAME[part]}>
          {index.sections
            .filter((s) => s.part === part)
            .map((s) => (
              <option key={s.i} value={s.i}>
                {s.n ? `${s.n}. ${s.title.length > 60 ? `${s.title.slice(0, 58)}…` : s.title}` : s.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

/**
 * The translation pop over a selection. The translation comes first (a second or so); a word or
 * two is looked up in Wiktionary alongside, for the lemma and the glosses. SAVE stores the
 * translation, then the word — the Wiktionary entry, else the pair alone — with the sentence and
 * where it is, liked; every tile hears of it through main's `vocab:changed`, and the vocabulary
 * tile shows the word in its dictionary.
 */
function Pop({ pick, section, forms, onClose }: { pick: Picked; section: QuixoteSection; forms: Map<string, SavedForm>; onClose: () => void }) {
  const wordish = isWordish(pick.text)
  const [tr, setTr] = useState<TranslateResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dict, setDict] = useState<VocabResult | null | 'none'>(wordish ? null : 'none')
  const [sentence, setSentence] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const lookup = useRef<Promise<VocabResult | null> | null>(null)
  const already = forms.get(pick.text.toLowerCase()) ?? null
  const [savedId, setSavedId] = useState<number | null>(already?.id ?? null)
  // Foxtrot is the translator: he wags while he stands by and barks when he has it (and when it is saved).
  const barks = useSettings().foxBark
  const [run, setRun] = useState(0)
  const barkTimer = useRef<number | undefined>(undefined)
  const bark = useCallback(() => {
    if (!barks) return
    setRun((n) => n + 1)
    window.clearTimeout(barkTimer.current)
    barkTimer.current = window.setTimeout(() => setRun(0), BARK_MS)
  }, [barks])
  useEffect(() => () => window.clearTimeout(barkTimer.current), [])

  useEffect(() => {
    let alive = true
    window.deck
      .translate(pick.text, 'es', true)
      .then((r) => {
        if (!alive) return
        setTr(r)
        bark()
      })
      .catch((e: unknown) => alive && setErr(plain(e)))
    if (wordish) {
      lookup.current = window.deck.vocab(pick.text, 'es').catch(() => null)
      void lookup.current.then((r) => alive && setDict(r ?? 'none'))
    }
    return () => {
      alive = false
    }
  }, [pick.text, wordish]) // eslint-disable-line react-hooks/exhaustive-deps

  const translateSentence = () => {
    setSentence('…')
    window.deck
      .translate(pick.sentence, 'es', true)
      .then((r) => setSentence(r.translated))
      .catch((e: unknown) => setSentence(plain(e)))
  }

  const save = async () => {
    if (!tr || saving) return
    setSaving(true)
    try {
      if (savedId !== null) {
        // Saved already: the ♥ comes off (the card stays in the deck; only the mark and the extra passes go).
        await window.deck.setWordLiked(savedId, false)
        setSavedId(null)
        return
      }
      const tid = (await window.deck.saveTranslation(tr, null)) || null
      const found = wordish ? await lookup.current : null
      const entry: VocabResult = found ?? { source: 'es', es: bare(pick.text), en: bare(tr.translated) }
      const sw = await window.deck.saveWord(entry, tid, { context: pick.sentence, origin: originOf(section), liked: true })
      setSavedId(sw.id || null)
      bark()
      // The vocabulary tile shows it in its dictionary (and finds the row just written).
      if (found) announceTranslation({ ...tr, id: tid })
    } catch (e) {
      setErr(plain(e))
    } finally {
      setSaving(false)
    }
  }

  const es = dict && dict !== 'none' ? dict.es : null
  const glosses = es ? es.senses.flatMap((s) => s.glosses).slice(0, 3) : []
  const pos = es ? [...new Set(es.senses.map((s) => s.pos))].slice(0, 2).join(' · ') : ''
  const lemma = es && es.word.toLowerCase() !== pick.text.toLowerCase() ? es.word : null

  return (
    <div
      className="qx-pop"
      style={{ top: pick.top ?? undefined, bottom: pick.bottom ?? undefined, left: pick.left, width: pick.width }}
      onMouseDown={stop}
      onMouseUp={stop}
      onClick={stop}
    >
      <div className="qx-pop-top">
        <span className={`qx-pop-fox ${run > 0 ? 'barking' : ''}`} title="Foxtrot, translating">
          <Fox anim={err ? 'alert' : 'idle'} scale={2} />
          {run > 0 && <BarkBursts run={run} />}
        </span>
        <div className="qx-pop-words">
          <div className="qx-pop-es" lang="es">
            {pick.text}
            {lemma && <span className="qx-pop-lemma"> ← {lemma}</span>}
          </div>
          <div className={`qx-pop-en ${err ? 'err' : ''}`}>{err ?? tr?.translated ?? '…'}</div>
        </div>
      </div>
      {wordish && dict === null && <div className="qx-pop-dim">Wiktionary…</div>}
      {glosses.length > 0 && (
        <div className="qx-pop-dict">
          {pos && <i>{pos} </i>}
          {glosses.join('; ')}
        </div>
      )}
      {pick.sentence !== pick.text &&
        (sentence ? (
          <div className="qx-pop-sent">{sentence}</div>
        ) : (
          <button className="ghost qx-pop-more" onClick={translateSentence} title={pick.sentence}>
            translate the whole sentence
          </button>
        ))}
      <div className="qx-pop-actions">
        <button
          className={`qx-save ${savedId !== null ? 'on' : ''}`}
          disabled={!tr || saving}
          onClick={() => void save()}
          title={
            savedId !== null
              ? 'Saved: a flash card, a ♥ word of the dictionary, marked in the text. Click to take the ♥ off (the card stays).'
              : 'Save to the vocabulary store: a flash card with this sentence, and a ♥ word of the dictionary'
          }
        >
          <Heart size={12} fill={savedId !== null ? 'currentColor' : 'none'} />
          {savedId !== null ? 'saved to flash cards' : saving ? 'saving…' : 'save to flash cards'}
        </button>
        <span className="spacer" />
        <button className="ghost" onClick={onClose} title="Close (Esc)">
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

export function QuixoteTile() {
  return (
    <div className="tile tile-plugin quixote" onClick={stop}>
      <Reader big={false} />
    </div>
  )
}

export function QuixotePane({ onClose }: { onClose: () => void }) {
  const pane = useRef<HTMLElement>(null)
  useEffect(() => pane.current?.focus(), [])
  return (
    <section ref={pane} className="focus quixote-pane" tabIndex={-1}>
      <Reader big onClose={onClose} />
    </section>
  )
}
