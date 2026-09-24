// The reader tile's books: LA ODISEA (Project Gutenberg #58221, Luis Segalá y Estalella's 1910 prose
// translation from the Greek; the one the reader opens on) and DON QUIJOTE in Cervantes' Spanish
// (#2000, both parts), both public domain. Each is fetched once from Gutenberg and kept in
// userData/quixote/, then parsed here into sections, so the renderer asks for one section at a time
// and never holds a whole book. Runs in main because the renderer's CSP allows no outbound requests.
//
// DON QUIJOTE's plain-text edition (checked against the file, Sept 2026): a table of contents, then
// Part I's preliminaries from "TASA" to "Primera parte del ingenioso hidalgo…", 52 chapters, Part
// II's preliminaries from "Segunda parte del ingenioso caballero…" (the line AFTER Part I's first
// chapter; the contents list has one too), 74 chapters, "Fin". A chapter opens with a paragraph
// "Capítulo XLIV. Donde se prosiguen…" (the title may wrap). Lines are hard-wrapped at ~75: a
// paragraph whose lines are all short is verse and keeps its breaks. Quotations are written ''…''.
//
// LA ODISEA's (checked Sept 2026): the translator's "AL LECTOR" up to its "NOTAS", then "CANTO
// PRIMERO", "CANTO II" … "CANTO XXIV", each followed by a subtitle paragraph in capitals ("CONCILIO
// DE LOS DIOSES.--EXHORTACIÓN DE MINERVA Á TELÉMACO"), then "FIN" and the indexes. All prose. In
// the text: "[Ilustración: …]" captions (they may wrap; the last line ends in "]"), footnote marks
// "[1]" with the notes as indented "[1] …" paragraphs, Homer's line number opening a paragraph
// ("421 Así habló…"), and _italics_. The 1910 spelling (á, é as words, vió) is left as printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { READER_BOOKS, isReaderBook, type QuixoteIndex, type QuixotePara, type QuixoteSection, type ReaderBook } from '@shared/types'

/** Lines of prose run to ~75 characters; a paragraph whose every line is shorter than this is verse. */
const VERSE_MAX = 62

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 }
function roman(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]] ?? 0
    n += v < (ROMAN[s[i + 1]] ?? 0) ? -v : v
  }
  return n
}

interface Parsed {
  parts: string[]
  sections: QuixoteSection[]
}

const gutenberg = (n: number) => `https://www.gutenberg.org/cache/epub/${n}/pg${n}.txt`
const PARSE: Record<ReaderBook, (raw: string) => Parsed> = { odisea: parseOdisea, quijote: parseQuijote }

export class ReaderBooks {
  private dir: string
  private parsed = new Map<ReaderBook, Parsed>()
  private loading = new Map<ReaderBook, Promise<Parsed>>()

  constructor(userData: string) {
    this.dir = join(userData, 'quixote')
  }

  async index(book: unknown): Promise<QuixoteIndex> {
    const b = spec(book)
    const { parts, sections } = await this.load(b.id)
    return {
      book: b.id,
      title: b.title,
      short: b.short,
      source: gutenberg(b.gutenberg),
      parts,
      sections: sections.map(({ paras, ...s }) => ({ ...s, words: paras.reduce((n, p) => n + p.text.split(/\s+/).length, 0) }))
    }
  }

  async section(book: unknown, i: number): Promise<QuixoteSection> {
    const { sections } = await this.load(spec(book).id)
    const s = sections[i]
    if (!s) throw new Error(`no section ${i} (0–${sections.length - 1})`)
    return s
  }

  private load(book: ReaderBook): Promise<Parsed> {
    const done = this.parsed.get(book)
    if (done) return Promise.resolve(done)
    let p = this.loading.get(book)
    if (!p) {
      p = this.read(book)
        .then((text) => {
          const parsed = PARSE[book](text)
          this.parsed.set(book, parsed)
          return parsed
        })
        .finally(() => this.loading.delete(book))
      this.loading.set(book, p)
    }
    return p
  }

  /** The cached file, else Gutenberg (once, kept for good). */
  private async read(book: ReaderBook): Promise<string> {
    const n = spec(book).gutenberg
    const path = join(this.dir, `pg${n}.txt`)
    if (existsSync(path)) return readFileSync(path, 'utf8')
    const res = await fetch(gutenberg(n))
    if (!res.ok) throw new Error(`Gutenberg: HTTP ${res.status}`)
    const text = await res.text()
    if (!text.includes('*** START OF THE PROJECT GUTENBERG EBOOK')) throw new Error('Gutenberg sent something that is not the book')
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(path, text)
    return text
  }
}

function spec(book: unknown): (typeof READER_BOOKS)[number] {
  if (!isReaderBook(book)) throw new Error(`no book ${String(book)}`)
  return READER_BOOKS.find((b) => b.id === book)!
}

/** The lines between Gutenberg's START and END markers. */
function bookLines(raw: string): string[] {
  const all = raw.replace(/\r/g, '').split('\n')
  const start = all.findIndex((l) => l.startsWith('*** START OF THE PROJECT GUTENBERG EBOOK'))
  const end = all.findIndex((l) => l.startsWith('*** END OF THE PROJECT GUTENBERG EBOOK'))
  return all.slice(start + 1, end < 0 ? undefined : end)
}

/** Blank-line paragraphs of a run of lines: verse keeps its line breaks, prose is joined. */
function paragraphs(lines: string[], verseToo = true): QuixotePara[] {
  const out: QuixotePara[] = []
  let cur: string[] = []
  const flush = () => {
    const ls = cur.map((l) => l.trim()).filter(Boolean)
    cur = []
    if (!ls.length) return
    const verse = verseToo && ls.length > 1 && ls.every((l) => l.length < VERSE_MAX)
    const text = (verse ? ls.join('\n') : ls.join(' ')).replace(/''/g, '"')
    out.push({ text, verse })
  }
  for (const l of lines) {
    if (l.trim()) cur.push(l)
    else flush()
  }
  flush()
  return out
}

const QUIJOTE_PARTS = ['', 'Primera parte', 'Segunda parte']
const PART_ROMAN = ['', 'I', 'II']

export function parseQuijote(raw: string): Parsed {
  const lines = bookLines(raw)

  const isChapter = (l: string) => /^Capítulo [\wÁÉÍÓÚáéíóú]+\./.test(l)
  const firstChapter = lines.findIndex(isChapter)
  const tasa = lines.findIndex((l) => l.trim() === 'TASA')
  const part1 = lines.findIndex((l) => l.startsWith('Primera parte del ingenioso hidalgo'))
  const part2 = lines.findIndex((l, i) => i > firstChapter && l.startsWith('Segunda parte del ingenioso caballero'))
  if (firstChapter < 0 || tasa < 0 || part1 < 0 || part2 < 0) throw new Error('the book is not in the shape the reader knows')

  const sections: QuixoteSection[] = []
  const prelim = (part: 1 | 2, from: number, to: number) =>
    sections.push({
      i: sections.length,
      part,
      n: 0,
      label: part === 1 ? 'Preliminares' : 'Preliminares de la segunda parte',
      title: part === 1 ? 'Tasa, privilegio, prólogo y versos preliminares' : 'Tasa, aprobaciones, dedicatoria y prólogo',
      short: `${PART_ROMAN[part]}·prel.`,
      paras: paragraphs(lines.slice(from, to))
    })

  const chapters = (part: 1 | 2, from: number, to: number) => {
    const heads: number[] = []
    for (let i = from; i < to; i++) if (isChapter(lines[i])) heads.push(i)
    heads.forEach((h, k) => {
      const body = lines.slice(h, heads[k + 1] ?? to)
      // The heading is the first paragraph (it may wrap): "Capítulo XLIV. Donde se …".
      let e = 0
      while (e < body.length && body[e].trim()) e++
      const head = body.slice(0, e).map((l) => l.trim()).join(' ')
      const m = head.match(/^Capítulo ([\wÁÉÍÓÚáéíóú]+)\.\s*(.*)$/)!
      const num = /^(primero)$/i.test(m[1]) ? 1 : roman(m[1].toUpperCase())
      let paras = paragraphs(body.slice(e))
      if (part === 2 && k === heads.length - 1) paras = paras.filter((p) => p.text !== 'Fin')
      // Part I is cut into four "partes" by a line at a chapter's end; the tile's own heading says where you are.
      paras = paras.filter((p) => !/^(Segunda|Tercera|Cuarta) parte del ingenioso hidalgo/.test(p.text))
      const n = num || k + 1
      sections.push({ i: sections.length, part, n, label: `Capítulo ${m[1] === 'primero' || m[1] === 'Primero' ? 'I' : m[1]}`, title: m[2], short: `${PART_ROMAN[part]}·${n}`, paras })
    })
  }

  prelim(1, tasa, part1)
  chapters(1, part1 + 1, part2)
  const part2First = lines.findIndex((l, i) => i > part2 && isChapter(l))
  // Part II's preliminaries repeat its own title line: drop it, the label says so.
  prelim(2, part2 + 1, part2First)
  chapters(2, part2First, lines.length)
  return { parts: QUIJOTE_PARTS, sections }
}

const toRoman = (n: number): string =>
  [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ].reduce((acc, [v, r]) => {
    let out = acc
    while (n >= (v as number)) {
      out += r
      n -= v as number
    }
    return out
  }, '')

export function parseOdisea(raw: string): Parsed {
  // The illustrations' captions go first (a caption may wrap; its last line ends in "]"), so they never join a paragraph.
  const lines: string[] = []
  let caption = false
  for (const l of bookLines(raw)) {
    const t = l.trim()
    if (!caption && t.startsWith('[Ilustración')) caption = true
    if (caption) {
      if (t.endsWith(']')) caption = false
      lines.push('')
    } else lines.push(l)
  }

  const isCanto = (l: string) => /^CANTO (PRIMERO|[IVXL]+)$/.test(l.trim())
  const prologue = lines.findIndex((l) => l.trim() === 'AL LECTOR')
  const notes = lines.findIndex((l, i) => i > prologue && l.trim() === 'NOTAS')
  const heads = lines.flatMap((l, i) => (isCanto(l) ? [i] : []))
  const fin = lines.findIndex((l, i) => i > heads[heads.length - 1] && l.trim() === 'FIN')
  if (prologue < 0 || notes < 0 || heads.length !== 24 || fin < 0) throw new Error('the book is not in the shape the reader knows')

  // Homer's line number opens a paragraph; footnote marks and _italics_ are the printed page's, not the text's.
  const clean = (ps: QuixotePara[]) =>
    ps
      .filter((p) => !/^\[\d+\]/.test(p.text))
      .map((p) => ({ ...p, text: p.text.replace(/^\d+ /, '').replace(/\[\d+\]/g, '').replace(/_([^_]+)_/g, '$1') }))

  const cantos = heads.map((h, k) => {
    const body = lines.slice(h + 1, heads[k + 1] ?? fin)
    const [sub, ...paras] = paragraphs(body, false)
    return { n: k + 1, sub: sub?.text ?? '', paras: clean(paras) }
  })

  // The subtitles are in capitals: lower them, and give the names back their capitals as the text itself writes them.
  const names = new Set<string>()
  for (const c of cantos)
    for (const p of c.paras) for (const m of p.text.matchAll(/(?<=[\p{Ll},;] )\p{Lu}\p{Ll}+/gu)) names.add(m[0].toLowerCase())
  const title = (caps: string) =>
    caps
      .split(/\.?--/)
      .map((seg) => {
        const words = seg.replace(/\.$/, '').toLowerCase().split(' ')
        return words.map((w, i) => (i === 0 || names.has(w.replace(/\p{P}+$/u, '')) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
      })
      .join(' — ')

  const sections: QuixoteSection[] = [
    { i: 0, part: 1, n: 0, label: 'Al lector', title: 'Prólogo del traductor, Luis Segalá y Estalella (1910)', short: 'prel.', paras: clean(paragraphs(lines.slice(prologue + 1, notes), false)) },
    ...cantos.map((c) => ({ i: c.n, part: 1, n: c.n, label: `Canto ${toRoman(c.n)}`, title: title(c.sub), short: toRoman(c.n), paras: c.paras }))
  ]
  return { parts: ['', ''], sections }
}
