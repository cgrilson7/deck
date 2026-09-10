import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Heart, Layers, ListChecks, Pause, Play, RotateCcw, Search, SkipBack, SkipForward } from 'lucide-react'
import type { Lang, SavedWord, StoredWord, VocabEntry, VocabResult, VocabStats, VocabWord } from '@shared/types'
import { onTranslation } from '../lib/bus'
import { plain } from '../lib/errors'
import { useSettings } from '../lib/theme'

const KEY_LAST = 'deck.vocab.last'
const KEY_QUEUE = 'deck.vocab.queue'
const KEY_PAUSED = 'deck.vocab.paused'
const SKIP_TOP = 0 // list positions below this are skipped (was 100 when the list was plain frequency)
const HISTORY = 30
const DECK_SIZE = 40
const LIST_SIZE = 300

/** The tile's three faces, in the order the stats chip cycles them. */
type Mode = 'dict' | 'cards' | 'list'
const NEXT_MODE: Record<Mode, Mode> = { dict: 'cards', cards: 'list', list: 'dict' }

const read = <T,>(k: string, dflt: T): T => {
  try {
    const raw = localStorage.getItem(k)
    return raw ? (JSON.parse(raw) as T) : dflt
  } catch {
    return dflt
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}

/**
 * A fresh run through the supply: every word once, frequent ones sooner. Your own languagelog
 * words are front-loaded; a list word's position is its list position blurred by ±50%, so
 * position 200 lands somewhere in 100..300 and 2000 in 1000..3000.
 */
function shuffle(words: VocabWord[]): string[] {
  return words
    .filter((w) => w.mine || w.rank >= SKIP_TOP)
    .map((w) => ({ word: w.word, key: w.mine ? Math.random() * 400 : w.rank * (0.5 + Math.random()) }))
    .sort((a, b) => a.key - b.key)
    .map((w) => w.word)
}

/** One or two words, no sentence punctuation: what can be looked up as vocabulary. */
function isWordish(s: string): boolean {
  const t = s.trim()
  return t.length > 0 && t.length <= 40 && t.split(/\s+/).length <= 2 && !/[.,;:!?¿¡"()]/.test(t)
}

/**
 * Vocabulary builder, three faces cycled by the stats chip (the word counts in the top bar):
 * the DICTIONARY, one Spanish word every `vocabCycleSeconds` as two columns, Spanish left and
 * English right; the FLASH CARDS dealt from the store (SM-2, graded here); and the REVIEW LIST
 * of everything stored, whose rows open back in the dictionary. Type a word or translate one
 * next door to see it now; ‹ › step, ⏸ holds.
 */
export function VocabTile() {
  const cycleSeconds = useSettings().vocabCycleSeconds
  const [mode, setMode] = useState<Mode>('dict')
  /** Bumped by every face change: it re-keys the stage, which is what flips it (and it stays flat on the first paint). */
  const [flips, setFlips] = useState(0)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<VocabResult | null>(() => read<VocabResult | null>(KEY_LAST, null))
  const [paused, setPaused] = useState(() => read(KEY_PAUSED, false))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0) // restarts the countdown bar
  const [stats, setStats] = useState<VocabStats | null>(null)
  /** The store row of the word on screen, once it is recorded; drives the ♥. */
  const [saved, setSaved] = useState<SavedWord | null>(null)
  const modeRef = useRef<Mode>('dict')
  const supply = useRef<VocabWord[]>([])
  const queue = useRef<string[]>(read<string[]>(KEY_QUEUE, []))
  const history = useRef<string[]>([])
  const seq = useRef(0)

  /** Turn the tile to another face. A tap on the same face is nothing, so the card only flips once. */
  const go = useCallback((m: Mode) => {
    if (modeRef.current === m) return
    modeRef.current = m
    setFlips((f) => f + 1)
    setMode(m)
  }, [])

  const refreshStats = useCallback(() => window.deck.vocabStats().then(setStats).catch(() => undefined), [])

  // The list's SAT word for a lemma, so the English headword is "perspicacious", not "insightful".
  const counterpart = (w: string) => supply.current.find((x) => x.word === w)?.en

  const lookup = useCallback(async (word: string, hint: Lang, remember = true, translationId: number | null = null) => {
    const w = word.trim()
    if (!w) return
    const mine = ++seq.current
    setBusy(true)
    setErr(null)
    setSaved(null)
    setTick((t) => t + 1)
    try {
      const r = await window.deck.vocab(w, hint, hint === 'es' ? counterpart(w) : undefined)
      if (mine !== seq.current) return
      setResult(r)
      write(KEY_LAST, r)
      if (remember) {
        history.current = [...history.current.filter((x) => x !== w), w].slice(-HISTORY)
      }
      // Shown = seen: store it (with the full entry) for flash cards. Prefetches never get here.
      window.deck
        .saveWord(r, translationId)
        .then((sw) => {
          if (mine === seq.current && sw.id) setSaved(sw)
          return window.deck.vocabStats()
        })
        .then(setStats)
        .catch(() => undefined)
    } catch (e) {
      if (mine === seq.current) setErr(plain(e))
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }, [])

  const next = useCallback(() => {
    if (!queue.current.length) queue.current = shuffle(supply.current)
    const w = queue.current.shift()
    write(KEY_QUEUE, queue.current)
    if (!w) return
    void lookup(w, 'es')
    // Warm the one after so the swap is instant.
    const n = queue.current[0]
    if (n) void window.deck.vocab(n, 'es', counterpart(n)).catch(() => undefined)
  }, [lookup])

  const prev = useCallback(() => {
    const h = history.current
    if (h.length < 2) return
    const cur = h.pop()!
    const w = h[h.length - 1]
    queue.current.unshift(cur)
    void lookup(w, 'es', false)
  }, [lookup])

  // Load the supply; show the first word right away if nothing is on screen.
  useEffect(() => {
    let alive = true
    void window.deck
      .vocabWords()
      .then((ws) => {
        if (!alive) return
        supply.current = ws
        // A queue saved from an older list keeps only what the supply still has.
        const has = new Set(ws.map((w) => w.word))
        const kept = queue.current.filter((w) => has.has(w))
        if (kept.length !== queue.current.length) write(KEY_QUEUE, (queue.current = kept))
        if (!result) next()
      })
      .catch((e: unknown) => alive && setErr(plain(e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The clock. Any lookup bumps `tick`, which restarts the interval from that moment. It only
  // runs on the dictionary face: cards and the list are read at your own pace.
  useEffect(() => {
    if (paused || mode !== 'dict') return
    const t = window.setInterval(next, cycleSeconds * 1000)
    return () => window.clearInterval(t)
  }, [paused, mode, cycleSeconds, next, tick])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  // Single words translated next door show up here, linked to their stored translation.
  useEffect(
    () =>
      onTranslation((r) => {
        if (!isWordish(r.text)) return
        go('dict')
        void lookup(r.text, r.source, true, r.id)
      }),
    [go, lookup]
  )

  const togglePause = () => {
    setPaused((p) => {
      write(KEY_PAUSED, !p)
      return !p
    })
  }

  /** ♥: keep this word. It is already in the store; this marks it worth revisiting and puts it in every pass. */
  const like = useCallback(
    (id: number, liked: boolean) =>
      window.deck
        .setWordLiked(id, liked)
        .then(refreshStats)
        .then(() => window.deck.vocabWords())
        .then((ws) => (supply.current = ws))
        .catch(() => undefined),
    [refreshStats]
  )

  const toggleLike = () => {
    if (!saved) return
    setSaved({ ...saved, liked: !saved.liked })
    void like(saved.id, !saved.liked)
  }

  /** A row of the review list: show it in the dictionary. */
  const open = useCallback(
    (w: StoredWord) => {
      go('dict')
      void lookup(w.es || w.en, w.es ? 'es' : 'en')
    },
    [go, lookup]
  )

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    if (!isWordish(q)) {
      // A dictionary, not a translator: a sentence has no Wiktionary entry.
      setErr('one or two words at a time; the translator next door takes sentences')
      return
    }
    go('dict')
    void lookup(q, /[áéíóúñü]/i.test(q) ? 'es' : 'en')
    setQuery('')
  }

  return (
    <div className="tile tile-plugin vocab" onClick={(e) => e.stopPropagation()}>
      <form className="vb-search" onSubmit={submit}>
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          placeholder="look up a word, either language…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <ModeChip mode={mode} stats={stats} onClick={() => go(NEXT_MODE[mode])} />
        {mode === 'dict' && (
          <span className="vb-nav">
            <button type="button" onClick={prev} title="Previous word">
              <SkipBack size={12} />
            </button>
            <button type="button" onClick={togglePause} title={paused ? 'Resume cycling' : `Pause (a new word every ${cycleSeconds}s)`}>
              {paused ? <Play size={12} /> : <Pause size={12} />}
            </button>
            <button type="button" onClick={next} title="Next word">
              <SkipForward size={12} />
            </button>
          </span>
        )}
      </form>
      {err && <div className="vb-err">{err}</div>}
      <div className={`vb-stage ${flips ? 'flip' : ''}`} key={`${mode}-${flips}`}>
        {mode === 'dict' &&
          (result ? (
            <Dictionary r={result} busy={busy} liked={saved?.liked ?? false} onLike={saved ? toggleLike : null} />
          ) : (
            <div className="plugin-empty">{busy ? '…' : 'vocabulary'}</div>
          ))}
        {mode === 'cards' && <Cards onGraded={refreshStats} onLike={like} />}
        {mode === 'list' && <ReviewList onPick={open} onLike={like} />}
      </div>
      {mode === 'dict' && <div key={tick} className={`vb-timer ${paused ? 'paused' : ''}`} style={{ animationDuration: `${cycleSeconds}s` }} />}
    </div>
  )
}

/**
 * The counts, and the way between the three faces: dictionary → flash cards → review list →
 * dictionary. What it reads is what the face it is on is made of.
 */
function ModeChip({ mode, stats, onClick }: { mode: Mode; stats: VocabStats | null; onClick: () => void }) {
  const Icon = mode === 'dict' ? Layers : mode === 'cards' ? ListChecks : Search
  const title = mode === 'dict' ? 'Flash cards' : mode === 'cards' ? 'Review list' : 'Back to the dictionary'
  const label = !stats
    ? '…'
    : mode === 'dict'
      ? `${stats.words} words · ${stats.translations} tr · ${stats.liked} ♥`
      : mode === 'cards'
        ? `${stats.due} due · ${stats.words} words`
        : `${stats.words} words · ${stats.liked} ♥`
  return (
    <button type="button" className={`vb-chip ${mode}`} onClick={onClick} title={`${title} (${stats?.due ?? 0} due)`}>
      <span>{label}</span>
      <Icon size={11} />
    </button>
  )
}

const glossesOf = (e: VocabEntry | null, native: boolean) => (e ? (native ? e.native : e.senses).flatMap((s) => s.glosses) : [])
const posOf = (e: VocabEntry | null, native: boolean) => (e ? (native ? e.native : e.senses).map((s) => s.pos) : [])
const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean).slice(0, 3)

/**
 * The dictionary face: one word, two columns, a language each — Spanish left (it is the word
 * being learned), English right. Definitions sit across from each other and each side keeps its
 * own part of speech, example, synonyms and etymology, so nothing has to be told apart by eye.
 */
function Dictionary({ r, busy, liked, onLike }: { r: VocabResult; busy: boolean; liked: boolean; onLike: (() => void) | null }) {
  const { en, es } = r
  // English glosses of the Spanish entry are the English side when there is no English entry
  // ("gustar" → "to like, to please"); when there is one they fill in for missing es.wiktionary
  // definitions on the Spanish side instead. They are never printed twice.
  const esOwn = glossesOf(es, true)
  const esDefs = esOwn.length ? esOwn : en ? glossesOf(es, false) : []
  const enDefs = en ? glossesOf(en, false) : glossesOf(es, false)
  const enWord = en?.word ?? glossesOf(es, false).slice(0, 2).join(', ')
  const hasEs = !!es
  const hasEn = !!enWord
  return (
    <section className={`vb-card ${busy ? 'busy' : ''}`}>
      <div className={`vb-cols ${hasEs && hasEn ? '' : 'one'}`}>
        {hasEs && (
          <Side
            lang="es"
            word={es!.word}
            url={es!.url}
            ipa={es!.ipa}
            formOf={es!.formOf}
            pos={uniq(posOf(es, esOwn.length > 0))}
            defs={esDefs}
            example={es!.example}
            syn={es!.synonyms}
            etym={es!.etymology}
          />
        )}
        {hasEn && (
          <Side
            lang="en"
            word={enWord}
            url={en?.url ?? null}
            ipa={en?.ipa ?? null}
            formOf={en?.formOf ?? null}
            pos={uniq(posOf(en, false))}
            defs={enDefs}
            example={en?.example ?? null}
            syn={en?.synonyms ?? []}
            etym={en?.etymology ?? null}
          >
            <button
              className={`vb-like ${liked ? 'on' : ''}`}
              onClick={onLike ?? undefined}
              disabled={!onLike}
              title={liked ? 'Liked: kept in every pass. Click to unlike.' : 'Like: keep this word and bring it back in every pass'}
            >
              <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
            </button>
          </Side>
        )}
      </div>
    </section>
  )
}

/** One language's column: headword and IPA, then its own definitions, example, synonyms, etymology. */
function Side({
  lang,
  word,
  url,
  ipa,
  formOf,
  pos,
  defs,
  example,
  syn,
  etym,
  children
}: {
  lang: Lang
  word: string
  url: string | null
  ipa: string | null
  formOf: string | null
  pos: string[]
  defs: string[]
  example: { text: string; translation: string | null } | null
  syn: string[]
  etym: string | null
  children?: React.ReactNode
}) {
  return (
    <div className={`vb-col ${lang}`}>
      <div className="vb-colhead">
        {url ? (
          <button className="vb-word" onClick={() => window.deck.openExternal(url)} title="Open on Wiktionary">
            {word}
            <ExternalLink size={9} />
          </button>
        ) : (
          <span className="vb-word plain">{word}</span>
        )}
        {ipa && <span className="vb-ipa">{ipa}</span>}
        {children}
      </div>
      <p className="vb-posline">
        {lang}
        {pos.length > 0 && ` · ${pos.join(' · ')}`}
        {formOf && ` · ← ${formOf}`}
      </p>
      {defs.length > 0 && (
        <ol className="vb-defs">
          {defs.slice(0, 6).map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ol>
      )}
      {example && (
        <p className="vb-example">
          “{example.text}”{example.translation && <span className="vb-extrans"> — {example.translation}</span>}
        </p>
      )}
      {syn.length > 0 && (
        <p className="vb-syn">
          <i className="vb-pos">{lang === 'es' ? 'sin' : 'syn'}</i>
          {syn.slice(0, 10).join(', ')}
        </p>
      )}
      {etym && (
        <p className="vb-etym">
          <i className="vb-pos">{lang === 'es' ? 'etim' : 'etym'}</i>
          {etym}
        </p>
      )}
    </div>
  )
}

/** 0 again · 3 hard · 4 good · 5 easy — SM-2's answer quality, as four buttons. */
const GRADES: [label: string, grade: number, key: string][] = [
  ['again', 0, '1'],
  ['hard', 3, '2'],
  ['good', 4, '3'],
  ['easy', 5, '4']
]

/**
 * The flash cards: the Spanish word, then its English side and what the store already knows
 * about it. Grading is SM-2 in main (`VocabStore.gradeWord`), so a card that is missed comes
 * back inside the sitting and one that sticks leaves for months.
 */
function Cards({ onGraded, onLike }: { onGraded: () => Promise<unknown>; onLike: (id: number, liked: boolean) => Promise<unknown> }) {
  const [deck, setDeck] = useState<StoredWord[] | null>(null)
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(false)
  const [done, setDone] = useState(0)

  const deal = useCallback(() => {
    setDeck(null)
    setI(0)
    setShown(false)
    void window.deck
      .vocabDeck(DECK_SIZE)
      .then(setDeck)
      .catch(() => setDeck([]))
  }, [])
  useEffect(deal, [deal])

  const card = deck?.[i] ?? null

  const grade = (g: number) => {
    if (!card) return
    void window.deck
      .gradeWord(card.id, g)
      .then(onGraded)
      .catch(() => undefined)
    setDone((n) => n + 1)
    setShown(false)
    setI((n) => n + 1)
  }

  const toggleLike = () => {
    if (!card || !deck) return
    const liked = !card.liked
    setDeck(deck.map((w, n) => (n === i ? { ...w, liked } : w)))
    void onLike(card.id, liked)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      setShown(true)
      return
    }
    const g = GRADES.find((x) => x[2] === e.key)
    if (g && shown) grade(g[1])
  }

  if (!deck) return <div className="plugin-empty">…</div>
  if (!card)
    return (
      <div className="vb-cards done">
        <p>{done > 0 ? `${done} card${done === 1 ? '' : 's'} reviewed` : 'nothing stored yet — words show up here as the dictionary shows them'}</p>
        {deck.length > 0 && (
          <button className="vb-again" onClick={deal}>
            <RotateCcw size={12} /> deal again
          </button>
        )}
      </div>
    )

  const entry = card.entry
  const defs = entry ? (glossesOf(entry.en, false).length ? glossesOf(entry.en, false) : glossesOf(entry.es, false)) : []
  const native = glossesOf(entry?.es ?? null, true)
  const ex = entry?.es?.example ?? entry?.en?.example ?? null
  return (
    // tabIndex so the deck can take the keyboard: space/⏎ reveals, 1–4 grade.
    <div className="vb-cards" tabIndex={0} onKeyDown={onKey}>
      <button className={`vb-flash ${shown ? 'shown' : ''}`} onClick={() => setShown(true)} title={shown ? '' : 'Show the answer'}>
        <span className="vb-flash-front">{card.es || card.en}</span>
        {shown && (
          <span className="vb-flash-back">
            <span className="vb-flash-en">{card.en || '—'}</span>
            {defs.length > 0 && <span className="vb-flash-def">{defs.slice(0, 2).join(' · ')}</span>}
            {native.length > 0 && <span className="vb-flash-def es">{native.slice(0, 1).join(' · ')}</span>}
            {ex && <span className="vb-flash-ex">“{ex.text}”</span>}
          </span>
        )}
      </button>
      <div className="vb-cardfoot">
        <button className={`vb-like ${card.liked ? 'on' : ''}`} onClick={toggleLike} title={card.liked ? 'Unlike' : 'Like: keep this word'}>
          <Heart size={13} fill={card.liked ? 'currentColor' : 'none'} />
        </button>
        {shown ? (
          <span className="vb-grades">
            {GRADES.map(([label, g, key]) => (
              <button key={g} className={`vb-grade g${g}`} onClick={() => grade(g)} title={`${label} (${key})`}>
                {label}
              </button>
            ))}
          </span>
        ) : (
          <span className="vb-hint" onClick={() => setShown(true)}>
            tap to reveal
          </span>
        )}
        <span className="vb-count">
          {i + 1}/{deck.length}
        </span>
      </div>
    </div>
  )
}

/** "3d", "2mo", "due" — how far off a card's next review is. */
function dueLabel(due: string | null): string {
  if (!due) return 'new'
  const ms = Date.parse(due) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'due'
  const days = ms / 86_400_000
  if (days < 1) return `${Math.max(1, Math.round(ms / 3_600_000))}h`
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${(days / 365).toFixed(1)}y`
}

/** Everything the store has, soonest due first. A row opens the word back in the dictionary. */
function ReviewList({ onPick, onLike }: { onPick: (w: StoredWord) => void; onLike: (id: number, liked: boolean) => Promise<unknown> }) {
  const [rows, setRows] = useState<StoredWord[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    void window.deck
      .vocabList(LIST_SIZE)
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows ?? []).filter((w) => !needle || w.es.toLowerCase().includes(needle) || w.en.toLowerCase().includes(needle))
  }, [rows, q])

  const toggleLike = (w: StoredWord) => {
    setRows((rs) => (rs ?? []).map((r) => (r.id === w.id ? { ...r, liked: !w.liked } : r)))
    void onLike(w.id, !w.liked)
  }

  if (!rows) return <div className="plugin-empty">…</div>
  if (!rows.length) return <div className="plugin-empty">no words stored yet</div>
  return (
    <div className="vb-list">
      <input className="vb-filter" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder={`filter ${rows.length} words…`} spellCheck={false} />
      <ul>
        {shown.map((w) => (
          <li key={w.id} className={w.known ? 'known' : ''}>
            <button className="vb-row" onClick={() => onPick(w)} title="Show in the dictionary">
              <span className="vb-row-es">{w.es || '—'}</span>
              <span className="vb-row-en">{w.en}</span>
            </button>
            <span className={`vb-due ${w.due && Date.parse(w.due) > Date.now() ? '' : 'now'}`}>{w.known ? 'known' : dueLabel(w.due)}</span>
            <button className={`vb-like small ${w.liked ? 'on' : ''}`} onClick={() => toggleLike(w)} title={w.liked ? 'Unlike' : 'Like'}>
              <Heart size={11} fill={w.liked ? 'currentColor' : 'none'} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
