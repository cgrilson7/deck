import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Pause, Play, Search, SkipBack, SkipForward } from 'lucide-react'
import type { Lang, VocabEntry, VocabResult, VocabWord } from '@shared/types'
import { onTranslation } from '../lib/bus'
import { useSettings } from '../lib/theme'

const KEY_LAST = 'deck.vocab.last'
const KEY_QUEUE = 'deck.vocab.queue'
const KEY_PAUSED = 'deck.vocab.paused'
const SKIP_TOP = 0 // list positions below this are skipped (was 100 when the list was plain frequency)
const HISTORY = 30

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
 * Vocabulary builder: cycles through Spanish words (frequency list + your languagelog
 * history) every `vocabCycleSeconds`, each shown as ONE merged bilingual entry: both
 * headwords, then the English and Spanish definitions, synonyms and etymologies mixed
 * together as if they were a single language. Type a word or translate one next door to
 * see it now; ‹ › step, ⏸ holds.
 */
export function VocabTile() {
  const cycleSeconds = useSettings().vocabCycleSeconds
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<VocabResult | null>(() => read<VocabResult | null>(KEY_LAST, null))
  const [paused, setPaused] = useState(() => read(KEY_PAUSED, false))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0) // restarts the countdown bar
  const supply = useRef<VocabWord[]>([])
  const queue = useRef<string[]>(read<string[]>(KEY_QUEUE, []))
  const history = useRef<string[]>([])
  const seq = useRef(0)

  // The list's SAT word for a lemma, so the English headword is "perspicacious", not "insightful".
  const counterpart = (w: string) => supply.current.find((x) => x.word === w)?.en

  const lookup = useCallback(async (word: string, hint: Lang, remember = true) => {
    const w = word.trim()
    if (!w) return
    const mine = ++seq.current
    setBusy(true)
    setErr(null)
    setTick((t) => t + 1)
    try {
      const r = await window.deck.vocab(w, hint, hint === 'es' ? counterpart(w) : undefined)
      if (mine !== seq.current) return
      setResult(r)
      write(KEY_LAST, r)
      if (remember) {
        history.current = [...history.current.filter((x) => x !== w), w].slice(-HISTORY)
      }
    } catch (e) {
      if (mine === seq.current) setErr(e instanceof Error ? e.message : String(e))
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
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The clock. Any lookup bumps `tick`, which restarts the interval from that moment.
  useEffect(() => {
    if (paused) return
    const t = window.setInterval(next, cycleSeconds * 1000)
    return () => window.clearInterval(t)
  }, [paused, cycleSeconds, next, tick])

  // Single words translated next door show up here.
  useEffect(() => onTranslation((r) => isWordish(r.text) && void lookup(r.text, r.source)), [lookup])

  const togglePause = () => {
    setPaused((p) => {
      write(KEY_PAUSED, !p)
      return !p
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void lookup(query, /[áéíóúñü]/i.test(query) ? 'es' : 'en')
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
      </form>
      {err && <div className="vb-err">{err}</div>}
      {result ? <Merged r={result} busy={busy} /> : <div className="plugin-empty">{busy ? '…' : 'vocabulary'}</div>}
      <div key={tick} className={`vb-timer ${paused ? 'paused' : ''}`} style={{ animationDuration: `${cycleSeconds}s` }} />
    </div>
  )
}

/** Alternate two lists: a, b, a, b… then whatever is left of the longer one. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

const glossesOf = (e: VocabEntry | null, native: boolean) => (e ? (native ? e.native : e.senses).flatMap((s) => s.glosses) : [])
const posOf = (e: VocabEntry | null, native: boolean) => (e ? (native ? e.native : e.senses).map((s) => s.pos) : [])

/** The two entries as one: both headwords, then everything else mixed, English and Spanish alternating. */
function Merged({ r, busy }: { r: VocabResult; busy: boolean }) {
  const { en, es } = r
  // Spanish first: the Spanish word is the one being learned. English glosses of the Spanish
  // entry stand in for a missing English headword ("gustar" → "to like, to please").
  const enHead = en?.word ?? glossesOf(es, false).slice(0, 2).join(', ')
  // One headword when both languages spell it the same ("naval"); the IPA line still shows both.
  const heads = [es, en].filter((x): x is VocabEntry => !!x).filter((x, i, a) => i === 0 || x.word.toLowerCase() !== a[0].word.toLowerCase())
  const defs = interleave(glossesOf(en, false), es ? (es.native.length ? glossesOf(es, true) : glossesOf(es, false)) : [])
  const pos = [...new Set([...posOf(es, true), ...posOf(en, false)])].filter(Boolean).slice(0, 3)
  const syn = interleave(en?.synonyms ?? [], es?.synonyms ?? []).slice(0, 16)
  const etym = [es?.etymology, en?.etymology].filter(Boolean)
  const ex = es?.example ?? en?.example ?? null
  return (
    <section className={`vb-card ${busy ? 'busy' : ''}`}>
      <header className="vb-head">
        {heads.map((e, i) => (
          <span key={i} className="vb-headword">
            {i > 0 && <span className="vb-dot">·</span>}
            <button className="vb-word" onClick={() => window.deck.openExternal(e.url)} title="Open on Wiktionary">
              {e.word}
              <ExternalLink size={10} />
            </button>
            {e.formOf && <span className="vb-formof">← {e.formOf}</span>}
          </span>
        ))}
        {!en && enHead && <span className="vb-headword"><span className="vb-dot">·</span><span className="vb-word plain">{enHead}</span></span>}
        <span className="vb-ipa">{heads.map((e) => e.ipa).filter(Boolean).join('  ')}</span>
      </header>
      <div className="vb-body">
        {pos.length > 0 && <p className="vb-posline">{pos.join(' · ')}</p>}
        {defs.length > 0 && (
          <ol className="vb-defs">
            {defs.slice(0, 8).map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ol>
        )}
        {ex && (
          <p className="vb-example">
            “{ex.text}”{ex.translation && <span className="vb-extrans"> — {ex.translation}</span>}
          </p>
        )}
        {syn.length > 0 && (
          <p className="vb-syn">
            <i className="vb-pos">syn · sin</i>
            {syn.join(', ')}
          </p>
        )}
        {etym.length > 0 && (
          <p className="vb-etym">
            <i className="vb-pos">etym · etim</i>
            {etym.join(' ')}
          </p>
        )}
      </div>
    </section>
  )
}
