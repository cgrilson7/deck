// The vocabulary tile's backend: Wiktionary, read from kaikki.org's per-word JSONL exports
// (Wiktextract; CC BY-SA). English Wiktionary supplies the English-language glosses, IPA,
// synonyms and etymology for both languages; Spanish Wiktionary adds Spanish-language
// definitions and a much fuller synonym list for Spanish words; Datamuse (WordNet-backed,
// no key) tops up the thin English synonyms. Runs in main: the renderer has no network.
//
// lookup(word) → which language it is and its counterpart (the translator, if a key is
// set; else whichever Wiktionary has it) → both entries, inflections resolved to their lemma.

import type { Lang, VocabEntry, VocabResult, VocabSenses } from '@shared/types'
import { translate } from './translate'

const UA = 'deck/0.1 (https://github.com/cgrilson7/deck)'
const KAIKKI: Record<Lang, string> = {
  en: 'https://kaikki.org/dictionary/English/meaning',
  es: 'https://kaikki.org/dictionary/Spanish/meaning'
}
const KAIKKI_ES_NATIVE = 'https://kaikki.org/eswiktionary/Espa%C3%B1ol/meaning'
const DATAMUSE = 'https://api.datamuse.com/words'
const MAX_SENSES = 4
const MAX_SYNONYMS = 12
const CACHE_MAX = 200

/** One Wiktextract entry (one part of speech) as kaikki serves it; only what we read. */
interface Raw {
  word?: string
  pos?: string
  pos_title?: string
  senses?: {
    glosses?: string[]
    tags?: string[]
    form_of?: { word: string }[]
    alt_of?: { word: string }[]
    synonyms?: { word: string }[]
    examples?: { text?: string; english?: string; translation?: string }[]
  }[]
  synonyms?: { word: string }[]
  sounds?: { ipa?: string }[]
  etymology_text?: string
  etymology_texts?: string[]
}

const cache = new Map<string, Promise<VocabResult>>()

async function getText(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`dictionary: HTTP ${res.status}`)
  return res.text()
}

/** kaikki files live at <base>/<first char>/<first two>/<word>.jsonl, case-sensitive. */
async function fetchRaw(base: string, word: string): Promise<Raw[] | null> {
  const enc = encodeURIComponent
  const w = word.normalize('NFC')
  const body = await getText(`${base}/${enc(w[0])}/${enc(w.slice(0, 2))}/${enc(w)}.jsonl`)
  if (body === null) return null
  return body
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Raw)
}

/** Try the word as typed, then lowercased (kaikki paths are case-sensitive; "Hunger" is a 404). */
async function fetchEntry(base: string, word: string): Promise<{ word: string; raws: Raw[] } | null> {
  const tries = [word, word.toLowerCase()].filter((w, i, a) => w && a.indexOf(w) === i)
  for (const w of tries) {
    const raws = await fetchRaw(base, w)
    if (raws && raws.length) return { word: w, raws }
  }
  return null
}

/**
 * Wiktextract glosses are a path (parent sense → sub-sense); the last one is the specific
 * meaning. Keep one gloss per sense, deduped, in the order Wiktionary lists them.
 */
function senses(raws: Raw[]): VocabSenses[] {
  const out: VocabSenses[] = []
  for (const r of raws) {
    const seen = new Set<string>()
    const glosses: string[] = []
    for (const s of r.senses ?? []) {
      if (s.tags?.includes('form-of') || s.form_of?.length || s.alt_of?.length) continue
      const g = (s.glosses ?? []).at(-1)?.trim()
      if (!g || seen.has(g)) continue
      seen.add(g)
      glosses.push(g)
      if (glosses.length >= MAX_SENSES) break
    }
    if (glosses.length) out.push({ pos: r.pos_title ?? r.pos ?? '', glosses })
  }
  return out
}

/** The lemma this word inflects, when every sense says it is a form of something. */
function lemmaOf(raws: Raw[]): string | null {
  let lemma: string | null = null
  for (const r of raws) {
    for (const s of r.senses ?? []) {
      const of = s.form_of?.[0]?.word ?? s.alt_of?.[0]?.word
      if (!of) return null // a real sense of its own: show this word
      lemma ??= of
    }
  }
  return lemma
}

function synonyms(raws: Raw[]): string[] {
  const out: string[] = []
  for (const r of raws) {
    for (const s of r.synonyms ?? []) out.push(s.word)
    for (const sn of r.senses ?? []) for (const s of sn.synonyms ?? []) out.push(s.word)
  }
  return out
}

function ipa(raws: Raw[]): string | null {
  for (const r of raws) for (const s of r.sounds ?? []) if (s.ipa?.startsWith('/')) return s.ipa
  for (const r of raws) for (const s of r.sounds ?? []) if (s.ipa) return s.ipa
  return null
}

const LANG_NAME: Record<Lang, string> = { en: 'English', es: 'Spanish' }
const PROSE_OPENER = /^(From|Inherited|Borrowed|Derived|Ultimately|Via|Learned|Possibly|Probably|Perhaps|Cognate|Compare|Unknown|Uncertain|Of |By |Clipping|Blend|Coined|Named|Short|Back-formation|Alteration|Doublet|Formed|Compound|Univerbation|Calque|See |Attested|First|Origin|The |A |An |This |Its )/

/**
 * Wiktionary's "Etymology tree" box comes through as a run of bare ancestor lines before the
 * prose: "Etymology tree\nLatin annus\nOld Spanish anno\nSpanish año\nInherited from ...". The
 * tree's last line is the entry itself ("Spanish año"); keep what follows it.
 */
function etymology(raws: Raw[], lang: Lang, word: string): string | null {
  for (const r of raws) {
    let t = r.etymology_text?.trim() || r.etymology_texts?.[0]?.trim()
    if (!t) continue
    if (t.startsWith('Etymology tree')) {
      const lines = t.split('\n').map((l) => l.trim())
      const self = lines.lastIndexOf(`${LANG_NAME[lang]} ${word}`)
      const prose = lines.findIndex((l, n) => n > 0 && PROSE_OPENER.test(l))
      const start = self > 0 ? self + 1 : prose > 0 ? prose : 1
      t = lines.slice(start).join(' ')
    }
    return t.replace(/\s+/g, ' ').trim()
  }
  return null
}

/**
 * One usage example: a translated one if Wiktionary has any (Spanish entries usually do),
 * else the shortest untranslated sentence. English entries mostly quote literature at length,
 * so long ones are skipped.
 */
function example(raws: Raw[]): VocabEntry['example'] {
  let fallback: VocabEntry['example'] = null
  for (const r of raws) {
    for (const s of r.senses ?? []) {
      for (const ex of s.examples ?? []) {
        const text = ex.text?.replace(/\s+/g, ' ').trim()
        if (!text || text.length < 20 || text.length > 140) continue
        const translation = (ex.english ?? ex.translation)?.replace(/\s+/g, ' ').trim() || null
        if (translation) return { text, translation }
        if (!fallback || text.length < fallback.text.length) fallback = { text, translation: null }
      }
    }
  }
  return fallback
}

function dedupe(words: string[], self: string): string[] {
  const seen = new Set<string>([self.toLowerCase()])
  const out: string[] = []
  for (const w of words) {
    const k = w.trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(w.trim())
    if (out.length >= MAX_SYNONYMS) break
  }
  return out
}

async function datamuse(word: string): Promise<string[]> {
  try {
    const body = await getText(`${DATAMUSE}?rel_syn=${encodeURIComponent(word)}&max=${MAX_SYNONYMS}`)
    return ((body ? JSON.parse(body) : []) as { word: string }[]).map((x) => x.word)
  } catch {
    return []
  }
}

/** Fetch a word in one language; if it is only an inflection, follow it to the lemma (one hop). */
async function entry(lang: Lang, word: string): Promise<VocabEntry | null> {
  let hit = await fetchEntry(KAIKKI[lang], word)
  if (!hit) return null
  let formOf: string | null = null
  const lemma = lemmaOf(hit.raws)
  if (lemma && lemma !== hit.word) {
    const l = await fetchEntry(KAIKKI[lang], lemma)
    if (l) {
      formOf = hit.word
      hit = l
    }
  }
  const [native, extra] = await Promise.all([
    lang === 'es' ? fetchEntry(KAIKKI_ES_NATIVE, hit.word).catch(() => null) : null,
    lang === 'en' ? datamuse(hit.word) : Promise.resolve([] as string[])
  ])
  const site = lang === 'es' && native ? 'es' : 'en'
  return {
    word: hit.word,
    ipa: ipa(hit.raws) ?? (native ? ipa(native.raws) : null),
    formOf,
    senses: senses(hit.raws),
    native: native ? senses(native.raws) : [],
    synonyms: dedupe([...(native ? synonyms(native.raws) : []), ...synonyms(hit.raws), ...extra], hit.word),
    etymology: etymology(hit.raws, lang, hit.word) ?? (native ? etymology(native.raws, lang, hit.word) : null),
    example: example(hit.raws) ?? (native ? example(native.raws) : null),
    url: `https://${site}.wiktionary.org/wiki/${encodeURIComponent(hit.word)}#${lang === 'es' ? (site === 'es' ? 'Español' : 'Spanish') : 'English'}`
  }
}

const other = (l: Lang): Lang => (l === 'en' ? 'es' : 'en')

async function lookup(word: string, hint: Lang, key: string, given?: string): Promise<VocabResult> {
  let source = hint
  let counterpart: string | null = given ?? null
  if (key && !given) {
    try {
      const t = await translate(word, hint, key)
      source = t.source
      counterpart = t.translated
    } catch {
      /* no translator: fall back to whichever Wiktionary has the word */
    }
  }
  let first = await entry(source, word)
  if (!first && !counterpart) {
    const alt = await entry(other(source), word)
    if (alt) {
      source = other(source)
      first = alt
    }
  }
  // The counterpart of an inflection is the counterpart of its lemma ("corría" → "run", not "ran").
  if (key && !given && first?.formOf) {
    try {
      counterpart = (await translate(first.word, source, key)).translated
    } catch {
      /* keep the first translation */
    }
  }
  const second = counterpart ? await entry(other(source), counterpart.replace(/^(to|the|a|an|el|la|los|las|un|una) /i, '')) : null
  if (!first && !second) throw new Error(`No Wiktionary entry for “${word}”`)
  return source === 'en' ? { source, en: first, es: second } : { source, en: second, es: first }
}

/** `counterpart`: the other-language headword to pair, instead of asking the translator (the list's SAT word). */
export function lookupVocab(raw: string, hint: Lang, key: string, counterpart?: string): Promise<VocabResult> {
  const word = raw.trim().replace(/\s+/g, ' ')
  if (!word) return Promise.reject(new Error('nothing to look up'))
  if (word.length > 60) return Promise.reject(new Error('one word or a short phrase'))
  const k = `${hint}:${word}:${counterpart ?? ''}`
  let p = cache.get(k)
  if (!p) {
    p = lookup(word, hint, key, counterpart).catch((e: unknown) => {
      cache.delete(k) // failures (network, 5xx) are not worth remembering
      throw e
    })
    cache.set(k, p)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  }
  return p
}
