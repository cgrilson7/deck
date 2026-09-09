import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Lang, TranslateResult } from '@shared/types'
import { announceTranslation } from '../lib/bus'

const DEBOUNCE_MS = 700
const RESET_MS = 5 * 60 * 1000
const STORE_KEY = 'deck.translate.last'

interface Pair {
  en: string
  es: string
}
const EMPTY: Pair = { en: '', es: '' }
const HINT: Pair = { en: 'English', es: 'Español' }

function loadLast(): Pair {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return EMPTY
    const p = JSON.parse(raw) as Partial<Pair>
    return { en: typeof p.en === 'string' ? p.en : '', es: typeof p.es === 'string' ? p.es : '' }
  } catch {
    return EMPTY
  }
}

/**
 * A two-box English ⇄ Spanish translator (languagelog, boiled down). Type into either box;
 * after a pause (or ⏎) the text is detected and translated into the other box. Text typed
 * into the wrong box is moved to the right one. Reset (or five idle minutes) empties both
 * boxes and leaves the last pair showing as placeholders.
 */
export function TranslateTile() {
  const [text, setText] = useState<Pair>(EMPTY)
  const [last, setLast] = useState<Pair>(loadLast)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** Which box was typed into most recently; that side is the source of the next translation. */
  const dirty = useRef<Lang | null>(null)
  const debounce = useRef<number | null>(null)
  const idle = useRef<number | null>(null)
  const seq = useRef(0)
  const boxes = { en: useRef<HTMLTextAreaElement>(null), es: useRef<HTMLTextAreaElement>(null) }

  const reset = useCallback(() => {
    seq.current++ // any in-flight result is stale
    dirty.current = null
    setText(EMPTY)
    setBusy(false)
    setErr(null)
  }, [])

  const touch = useCallback(() => {
    if (idle.current) window.clearTimeout(idle.current)
    idle.current = window.setTimeout(reset, RESET_MS)
  }, [reset])

  useEffect(() => {
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current)
      if (idle.current) window.clearTimeout(idle.current)
    }
  }, [])

  const run = useCallback(
    async (from: Lang, value: string) => {
      const src = value.trim()
      if (!src) return
      const mine = ++seq.current
      setBusy(true)
      setErr(null)
      try {
        const r: TranslateResult = await window.deck.translate(src, from)
        if (mine !== seq.current) return
        const pair: Pair = r.source === 'en' ? { en: r.text, es: r.translated } : { en: r.translated, es: r.text }
        dirty.current = null
        setText(pair)
        setLast(pair)
        announceTranslation(r)
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(pair))
        } catch {
          /* private mode or full: placeholders just don't persist */
        }
        touch()
      } catch (e) {
        if (mine === seq.current) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    },
    [touch]
  )

  const schedule = (from: Lang, value: string) => {
    if (debounce.current) window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(() => void run(from, value), DEBOUNCE_MS)
  }

  const onChange = (lang: Lang) => (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    dirty.current = lang
    setText((t) => ({ ...t, [lang]: value }))
    setErr(null)
    touch()
    if (value.trim()) schedule(lang, value)
    else if (debounce.current) window.clearTimeout(debounce.current)
  }

  const onKeyDown = (lang: Lang) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (debounce.current) window.clearTimeout(debounce.current)
      void run(lang, text[lang])
    } else if (e.key === 'Escape') {
      reset()
      e.currentTarget.blur()
    }
  }

  const box = (lang: Lang) => (
    <label className={`xl-box xl-${lang} ${dirty.current === lang ? 'dirty' : ''}`}>
      <span className="xl-lang">{HINT[lang]}</span>
      <textarea
        ref={boxes[lang]}
        value={text[lang]}
        placeholder={last[lang] || (lang === 'en' ? 'Type English here…' : 'Escribe español aquí…')}
        onChange={onChange(lang)}
        onKeyDown={onKeyDown(lang)}
        onFocus={touch}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={2}
      />
    </label>
  )

  return (
    <div className="tile tile-plugin translate" onClick={(e) => e.stopPropagation()}>
      {box('en')}
      <div className="xl-mid">
        <span className={`xl-status ${err ? 'err' : ''}`}>{err ?? (busy ? 'translating…' : '')}</span>
        <button className="xl-reset" onClick={reset} title="Clear both boxes (Esc). The last pair stays as placeholders.">
          <RotateCcw size={12} />
          reset
        </button>
      </div>
      {box('es')}
    </div>
  )
}
