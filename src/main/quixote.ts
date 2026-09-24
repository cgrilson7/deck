// The reader tile's book: Don Quijote in Cervantes' Spanish, Project Gutenberg #2000 (both parts,
// public domain). Fetched once from Gutenberg and kept in userData/quixote/, then parsed here into
// sections — each part's preliminaries, then its chapters — so the renderer asks for one section at
// a time and never holds 2MB of text. Runs in main because the renderer's CSP allows no outbound
// requests.
//
// The plain-text edition's shape (checked against the file, Sept 2026): a table of contents, then
// Part I's preliminaries from "TASA" to "Primera parte del ingenioso hidalgo…", 52 chapters, Part
// II's preliminaries from "Segunda parte del ingenioso caballero…" (the line AFTER Part I's first
// chapter; the contents list has one too), 74 chapters, "Fin". A chapter opens with a paragraph
// "Capítulo XLIV. Donde se prosiguen…" (the title may wrap). Lines are hard-wrapped at ~75: a
// paragraph whose lines are all short is verse and keeps its breaks. Quotations are written ''…''.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { QuixoteIndex, QuixotePara, QuixoteSection } from '@shared/types'

const SOURCE = 'https://www.gutenberg.org/cache/epub/2000/pg2000.txt'
const FILE = 'pg2000.txt'
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
  sections: QuixoteSection[]
}

export class QuixoteBook {
  private dir: string
  private parsed: Parsed | null = null
  private loading: Promise<Parsed> | null = null

  constructor(userData: string) {
    this.dir = join(userData, 'quixote')
  }

  async index(): Promise<QuixoteIndex> {
    const { sections } = await this.load()
    return {
      source: SOURCE,
      sections: sections.map(({ paras, ...s }) => ({ ...s, words: paras.reduce((n, p) => n + p.text.split(/\s+/).length, 0) }))
    }
  }

  async section(i: number): Promise<QuixoteSection> {
    const { sections } = await this.load()
    const s = sections[i]
    if (!s) throw new Error(`no section ${i} (0–${sections.length - 1})`)
    return s
  }

  private load(): Promise<Parsed> {
    if (this.parsed) return Promise.resolve(this.parsed)
    this.loading ??= this.read()
      .then((text) => (this.parsed = parse(text)))
      .finally(() => (this.loading = null))
    return this.loading
  }

  /** The cached file, else Gutenberg (once, kept for good). */
  private async read(): Promise<string> {
    const path = join(this.dir, FILE)
    if (existsSync(path)) return readFileSync(path, 'utf8')
    const res = await fetch(SOURCE)
    if (!res.ok) throw new Error(`Gutenberg: HTTP ${res.status}`)
    const text = await res.text()
    if (!text.includes('*** START OF THE PROJECT GUTENBERG EBOOK')) throw new Error('Gutenberg sent something that is not the book')
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(path, text)
    return text
  }
}

/** Blank-line paragraphs of a run of lines: verse keeps its line breaks, prose is joined. */
function paragraphs(lines: string[]): QuixotePara[] {
  const out: QuixotePara[] = []
  let cur: string[] = []
  const flush = () => {
    const ls = cur.map((l) => l.trim()).filter(Boolean)
    cur = []
    if (!ls.length) return
    const verse = ls.length > 1 && ls.every((l) => l.length < VERSE_MAX)
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

export function parse(raw: string): Parsed {
  const all = raw.replace(/\r/g, '').split('\n')
  const start = all.findIndex((l) => l.startsWith('*** START OF THE PROJECT GUTENBERG EBOOK'))
  const end = all.findIndex((l) => l.startsWith('*** END OF THE PROJECT GUTENBERG EBOOK'))
  const lines = all.slice(start + 1, end < 0 ? undefined : end)

  const isChapter = (l: string) => /^Capítulo [\wÁÉÍÓÚáéíóú]+\./.test(l)
  const firstChapter = lines.findIndex(isChapter)
  const tasa = lines.findIndex((l) => l.trim() === 'TASA')
  const part1 = lines.findIndex((l) => l.startsWith('Primera parte del ingenioso hidalgo'))
  const part2 = lines.findIndex((l, i) => i > firstChapter && l.startsWith('Segunda parte del ingenioso caballero'))
  if (firstChapter < 0 || tasa < 0 || part1 < 0 || part2 < 0) throw new Error('the book is not in the shape the reader knows')

  const sections: QuixoteSection[] = []
  const prelim = (part: 1 | 2, from: number, to: number) =>
    sections.push({ i: sections.length, part, n: 0, label: part === 1 ? 'Preliminares' : 'Preliminares de la segunda parte', title: '', paras: paragraphs(lines.slice(from, to)) })

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
      sections.push({ i: sections.length, part, n: num || k + 1, label: `Capítulo ${m[1] === 'primero' || m[1] === 'Primero' ? 'I' : m[1]}`, title: m[2], paras })
    })
  }

  prelim(1, tasa, part1)
  chapters(1, part1 + 1, part2)
  const part2First = lines.findIndex((l, i) => i > part2 && isChapter(l))
  // Part II's preliminaries repeat its own title line: drop it, the label says so.
  prelim(2, part2 + 1, part2First)
  chapters(2, part2First, lines.length)
  return { sections }
}
