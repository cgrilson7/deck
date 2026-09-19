// The LESSON file: markdown in the learner's repo (`~/grail/lessons/*.md`) that the Lesson tile
// renders and a teaching session writes. Pure (no DOM, no node): the renderer draws what
// `parseLesson` returns, and main's `lint` (the door's, `lesson.mjs lint`) reports what it found
// wrong, so the two can never disagree about what a file means.
//
//   ---                                 front matter: a YAML SUBSET read by hand — `key: value`
//   title: Atoms and bonds              scalars, and ONE list of maps (`sources`). Unknown keys
//   sources:                            are kept in `meta` and ignored.
//     - id: covalent
//       cite: OpenStax, Chemistry 2e, §7.2
//       url: https://…
//   ---
//   intro prose                         text before the first `## ` = the intro card (id `intro`)
//   ## Polar covalent: water {#water}   a CARD per `## `; its id is `{#id}`, else a slug of the heading
//   prose with a footnote [^covalent]   `[^id]` cites a source
//   ```mol  ```fig  ```ask  ```dad      the four fenced blocks the tile takes over (below);
//                                       any other fence is an ordinary code block
//
// Also here: `molBody`, one line of a `mol` block → the body the Molecule door takes. It MIRRORS
// the argv handling of plugin/scripts/mol.mjs (which cannot be imported: it is a CLI, and it
// exits); keep the two in step.

export interface LessonSource {
  id: string
  cite: string
  url?: string
}

/** A button that puts a molecule up: every line is one Molecule-door command, run in order. */
export interface LessonMol {
  kind: 'mol'
  label: string
  lines: string[]
  /** `tile: <n>`: every line goes to that Molecule tile. */
  tile?: number
  /** `new: true`: the first `show` / `compare` opens a tile of its own. */
  fresh?: boolean
}
export interface LessonFig {
  kind: 'fig'
  src: string
  caption: string
}
export interface LessonAskOption {
  text: string
  right: boolean
}
/** A question answered IN the tile. No options = a free-text box. */
export interface LessonAsk {
  kind: 'ask'
  id: string
  q: string
  options: LessonAskOption[]
  why: string
  /** Asked through the door (`ask --q …`), not written in the file. */
  adhoc?: boolean
}
export interface LessonDad {
  kind: 'dad'
  text: string
}
export type LessonPart = { kind: 'md'; text: string } | LessonMol | LessonFig | LessonAsk | LessonDad

export interface LessonCard {
  id: string
  heading: string
  parts: LessonPart[]
  /** The source ids its prose cites (`[^id]`), in order, each once. */
  cites: string[]
  /** 1-based line of its heading in the file (1 for the intro). */
  line: number
}

export interface LessonProblem {
  line: number
  card?: string
  message: string
}

export interface Lesson {
  title: string
  /** Front-matter scalars as written (title and block included). */
  meta: Record<string, string>
  sources: LessonSource[]
  cards: LessonCard[]
  /** What the parser itself could not take (a front-matter line it cannot read, a block with a missing field). */
  problems: LessonProblem[]
}

/** What a learner answered to one ask. `chosen` indexes the options; `text` is a free answer. */
export interface LessonAnswer {
  chosen: number[]
  text: string
  /** null = a free-text answer: nobody marked it. */
  correct: boolean | null
  at: number
}

export const LESSON_BLOCKS = ['mol', 'fig', 'ask', 'dad'] as const
export const LESSON_FIG_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, '$2')

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'card'
  )
}

/** The prose of a card as a reader sees it, for finding a `mark` phrase: no emphasis marks, no footnotes, one space between words. */
export function plainText(md: string): string {
  return md
    .replace(/\[\^[\w-]+\]/g, '')
    .replace(/[*_`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Everything a card says, in plain words (its prose, its questions, its callouts). */
export function cardText(card: LessonCard): string {
  return plainText(
    [card.heading, ...card.parts.map((p) => (p.kind === 'md' ? p.text : p.kind === 'ask' ? [p.q, ...p.options.map((o) => o.text), p.why].join(' ') : p.kind === 'dad' ? p.text : p.kind === 'fig' ? p.caption : p.label))].join(' ')
  )
}

interface Fence {
  lang: string
  body: string[]
  /** 1-based line of the opening fence. */
  line: number
}

function frontMatter(lines: string[], problems: LessonProblem[]): { meta: Record<string, string>; sources: LessonSource[]; next: number } {
  const meta: Record<string, string> = {}
  const sources: LessonSource[] = []
  if (lines[0]?.trim() !== '---') return { meta, sources, next: 0 }
  let end = -1
  for (let i = 1; i < lines.length; i++)
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  if (end < 0) {
    problems.push({ line: 1, message: 'the front matter opens with --- and never closes' })
    return { meta, sources, next: 0 }
  }
  let list: string | null = null
  let item: Record<string, string> | null = null
  const lists: Record<string, Record<string, string>[]> = {}
  for (let i = 1; i < end; i++) {
    const raw = lines[i]
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(raw)
    if (top) {
      item = null
      if (top[2].trim() === '') {
        list = top[1]
        lists[list] = []
      } else {
        list = null
        meta[top[1]] = unquote(top[2])
      }
      continue
    }
    const first = /^\s+-\s+([A-Za-z][\w-]*):\s*(.*)$/.exec(raw)
    if (first && list) {
      item = { [first[1]]: unquote(first[2]) }
      lists[list].push(item)
      continue
    }
    const more = /^\s+([A-Za-z][\w-]*):\s*(.*)$/.exec(raw)
    if (more && item) {
      item[more[1]] = unquote(more[2])
      continue
    }
    problems.push({ line: i + 1, message: `front matter: cannot read “${raw.trim()}” (it takes \`key: value\` lines and one list of maps, \`sources\`)` })
  }
  ;(lists.sources ?? []).forEach((s, n) => {
    if (!s.id || !s.cite) problems.push({ line: 1, message: `source ${n + 1} needs both \`id\` and \`cite\`` })
    else if (sources.some((o) => o.id === s.id)) problems.push({ line: 1, message: `two sources share the id “${s.id}”` })
    else sources.push({ id: s.id, cite: s.cite, ...(s.url ? { url: s.url } : {}) })
  })
  return { meta, sources, next: end + 1 }
}

/** `key: value` lines at the head of a block (a line that is none of `keys` ends them); the rest is the body. A value runs on over lines that start no key. */
function fields(body: string[], keys: string[]): { got: Record<string, string>; rest: string[] } {
  const got: Record<string, string> = {}
  const rest: string[] = []
  let last: string | null = null
  for (const raw of body) {
    const m = /^([a-z]+):\s*(.*)$/.exec(raw.trim())
    if (m && keys.includes(m[1])) {
      got[m[1]] = m[2].trim()
      last = m[1]
    } else if (last !== null && raw.trim() && /^\s/.test(raw) && !rest.length) got[last] += ` ${raw.trim()}`
    else {
      last = null
      rest.push(raw)
    }
  }
  return { got, rest }
}

function block(f: Fence, card: string, n: number, problems: LessonProblem[]): LessonPart {
  const bad = (message: string) => problems.push({ line: f.line, card, message })
  if (f.lang === 'dad') return { kind: 'dad', text: f.body.join('\n').trim() }
  if (f.lang === 'fig') {
    const { got } = fields(f.body, ['src', 'caption'])
    if (!got.src) bad('a fig block needs `src: <image, relative to this file>`')
    return { kind: 'fig', src: got.src ?? '', caption: got.caption ?? '' }
  }
  if (f.lang === 'mol') {
    const { got, rest } = fields(f.body, ['label', 'tile', 'new'])
    const lines = rest.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    if (!lines.length) bad('a mol block needs at least one command line (`show water`)')
    const tile = got.tile !== undefined ? Number(got.tile) : undefined
    if (tile !== undefined && !(Number.isInteger(tile) && tile >= 1 && tile <= 99)) bad(`mol block: \`tile: ${got.tile}\` is not a tile number`)
    return { kind: 'mol', label: got.label || lines[0] || 'show', lines, ...(tile !== undefined && Number.isInteger(tile) ? { tile } : {}), ...(/^(true|yes|1)$/i.test(got.new ?? '') ? { fresh: true } : {}) }
  }
  // ask: `- ` lines are options, `* ` (on its own, or after the dash) marks a right one.
  const options: LessonAskOption[] = []
  const head: string[] = []
  const tail: string[] = []
  for (const raw of f.body) {
    const o = /^\s*(?:-\s+(\*\s+)?|(\*)\s+)(.*)$/.exec(raw)
    if (o) options.push({ text: o[3].trim(), right: !!(o[1] || o[2]) })
    else (options.length ? tail : head).push(raw)
  }
  const { got } = fields([...head, ...tail], ['id', 'q', 'why'])
  if (!got.q) bad('an ask block needs `q: <the question>`')
  return { kind: 'ask', id: got.id || `${card}-ask-${n}`, q: got.q ?? '', options, why: got.why ?? '' }
}

export function parseLesson(src: string): Lesson {
  const lines = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const problems: LessonProblem[] = []
  const { meta, sources, next } = frontMatter(lines, problems)
  const title = meta.title || 'Lesson'

  // Cut into cards on `## ` — never inside a fence.
  const raw: { heading: string; id: string | null; line: number; body: { text: string; line: number }[] }[] = [{ heading: title, id: 'intro', line: next + 1, body: [] }]
  let fence: string | null = null
  for (let i = next; i < lines.length; i++) {
    const l = lines[i]
    const f = /^\s*(```+|~~~+)/.exec(l)
    if (f) fence = fence === null ? f[1] : l.trim().startsWith(fence) ? null : fence
    const h = fence === null && !f ? /^##\s+(.*?)\s*$/.exec(l) : null
    if (h) {
      const id = /\s*\{#([\w-]+)\}\s*$/.exec(h[1])
      raw.push({ heading: id ? h[1].slice(0, id.index).trim() : h[1], id: id ? id[1] : null, line: i + 1, body: [] })
    } else raw[raw.length - 1].body.push({ text: l, line: i + 1 })
  }

  const cards: LessonCard[] = []
  for (const r of raw) {
    const id = r.id ?? slug(r.heading)
    const parts: LessonPart[] = []
    let md: string[] = []
    let open: (Fence & { close: string }) | null = null
    let asks = 0
    const flush = () => {
      if (md.join('').trim()) parts.push({ kind: 'md', text: md.join('\n').trim() })
      md = []
    }
    for (const { text, line } of r.body) {
      if (open) {
        if (text.trim().startsWith(open.close)) {
          parts.push(block(open, id, open.lang === 'ask' ? ++asks : 0, problems))
          open = null
        } else open.body.push(text)
        continue
      }
      const f = /^\s*(```+|~~~+)\s*(\S*)\s*$/.exec(text)
      if (f && (LESSON_BLOCKS as readonly string[]).includes(f[2])) {
        flush()
        open = { lang: f[2], body: [], line, close: f[1] }
      } else md.push(text)
    }
    if (open) {
      problems.push({ line: open.line, card: id, message: `the \`${open.lang}\` block is never closed` })
      parts.push(block(open, id, open.lang === 'ask' ? ++asks : 0, problems))
    }
    flush()
    if (r.id === 'intro' && r === raw[0] && !parts.length) continue
    const cites: string[] = []
    for (const p of parts) if (p.kind === 'md') for (const m of p.text.matchAll(/\[\^([\w-]+)\]/g)) if (!cites.includes(m[1])) cites.push(m[1])
    cards.push({ id, heading: r.heading, parts, cites, line: r.line })
  }
  return { title, meta, sources, cards, problems }
}

/** The sources a card's footer lists: the ones it cites, else all of the file's. None = "unsourced". */
export function cardSources(lesson: Lesson, card: LessonCard): { sources: LessonSource[]; own: boolean } {
  const own = card.cites.flatMap((id) => lesson.sources.find((s) => s.id === id) ?? [])
  return own.length ? { sources: own, own: true } : { sources: lesson.sources, own: false }
}

/**
 * Everything wrong with a lesson that can be told without the disk: what the parser reported,
 * duplicate ids, a question with options and no right one, a footnote with no source, an
 * unsourced card, a mol line the Molecule door would refuse. (Main adds the figures: they need the disk.)
 */
export function lintLesson(lesson: Lesson): LessonProblem[] {
  const out = [...lesson.problems]
  const seen = new Set<string>()
  const asks = new Set<string>()
  if (!lesson.meta.title) out.push({ line: 1, message: 'no `title:` in the front matter' })
  if (!lesson.cards.length) out.push({ line: 1, message: 'no cards: a card starts at a `## ` heading' })
  for (const c of lesson.cards) {
    const bad = (message: string) => out.push({ line: c.line, card: c.id, message })
    if (seen.has(c.id)) bad(`two cards share the id “${c.id}” (\`goto\` and the curriculum's \`card\` could not tell them apart): give one a {#id}`)
    seen.add(c.id)
    for (const id of c.cites) if (!lesson.sources.some((s) => s.id === id)) bad(`[^${id}] cites a source the front matter does not have`)
    if (!cardSources(lesson, c).sources.length) bad('unsourced: the card cites nothing and the file lists no sources')
    for (const p of c.parts) {
      if (p.kind === 'ask') {
        if (asks.has(p.id)) bad(`two asks share the id “${p.id}” (answers are kept by id)`)
        asks.add(p.id)
        if (p.options.length && !p.options.some((o) => o.right)) bad(`ask “${p.id}” marks no right answer (\`- * <text>\`)`)
        if (p.options.length === 1) bad(`ask “${p.id}” has one option: give it more, or none for a free-text answer`)
      }
      if (p.kind === 'mol')
        for (const l of p.lines) {
          const b = molBody(l)
          if ('error' in b) bad(`mol line \`${l}\`: ${b.error}`)
        }
    }
  }
  return out
}

// ── one line of a `mol` block → the Molecule door's body (mirrors plugin/scripts/mol.mjs) ──

export const MOL_VERBS = ['show', 'style', 'compare', 'select', 'highlight', 'measure', 'label', 'view', 'look', 'list', 'clear', 'tiles', 'close'] as const
const MOL_BOOL = new Set(['new', 'add', 'hbonds', 'reset', 'clear', 'off'])

/** A command line as a shell would cut it: spaces, with "double" and 'single' quotes holding words together. */
export function splitArgv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let any = false
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      any = true
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur)
      cur = ''
      any = false
    } else cur += ch
  }
  if (cur || any) out.push(cur)
  return out
}

export function molBody(line: string): { body: Record<string, unknown> } | { error: string } {
  const argv = splitArgv(line)
  const flags: Record<string, string | true> = {}
  const args: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq)
      if (eq >= 0) flags[k] = a.slice(eq + 1)
      else if (MOL_BOOL.has(k)) flags[k] = true
      else if (k === 'contacts' && (argv[i + 1] === undefined || argv[i + 1].startsWith('--'))) flags[k] = true
      else if (argv[i + 1] === undefined) return { error: `--${k} wants a value` }
      else flags[k] = argv[++i]
    } else args.push(a)
  }
  const [cmd, ...rest] = args
  if (!cmd) return { error: 'an empty line' }
  if (!(MOL_VERBS as readonly string[]).includes(cmd)) return { error: `“${cmd}” is not a mol.mjs command (${MOL_VERBS.join(' ')})` }
  const tile: Record<string, unknown> = {}
  if (flags.tile !== undefined) {
    if (!/^[1-9]\d?$/.test(String(flags.tile))) return { error: `--tile wants a tile number, not “${String(flags.tile)}”` }
    tile.tile = Number(flags.tile)
  }
  const looks = { style: flags.style, color: flags.color ?? flags.colour, surface: flags.surface, labels: flags.labels }
  const body = (b: Record<string, unknown>) => ({ body: { ...b, ...tile } })
  switch (cmd) {
    case 'show':
      if (!rest.length) return { error: 'show what? e.g. `show water`' }
      if (flags.new && flags.add) return { error: '--new opens a tile of its own; --add joins an existing scene. Pick one.' }
      return body({ op: 'show', target: rest.join(' '), add: !!flags.add, new: !!flags.new, ...looks })
    case 'style':
      if (!Object.values(looks).some(Boolean)) return { error: 'style wants at least one of --style --color --surface --labels' }
      return body({ op: 'style', ...looks })
    case 'compare':
      if (rest.length !== 2) return { error: 'compare wants two targets' }
      return body({ op: 'compare', a: rest[0], b: rest[1], new: !!flags.new, ...looks })
    case 'select':
      return body({ op: 'select', expr: rest.join(' ') })
    case 'highlight':
      return body({ op: 'highlight', hbonds: !!flags.hbonds, contacts: flags.contacts ?? null, select: flags.select, off: !!flags.off })
    case 'measure':
      if (!flags.clear && (rest.length < 2 || rest.length > 4)) return { error: 'measure wants two, three or four atoms (or --clear)' }
      return body({ op: 'measure', atoms: rest, clear: !!flags.clear })
    case 'label':
      if (!flags.clear && rest.length < 2) return { error: 'label wants a selection and a text' }
      return body({ op: 'label', expr: rest[0], text: rest.slice(1).join(' '), clear: !!flags.clear })
    case 'view':
      if (flags.zoom === undefined && flags.spin === undefined && !flags.reset) return { error: 'view wants --zoom <expr>, --spin on|off, or --reset' }
      return body({ op: 'view', zoom: flags.zoom, spin: flags.spin === undefined ? undefined : flags.spin === true || /^(on|true|1|yes)$/i.test(String(flags.spin)), reset: !!flags.reset })
    default:
      return body({ op: cmd })
  }
}

// ── the curriculum (the Lesson tile's home view): `<folder>/curriculum.json`, every field optional ──

export interface CurriculumItem {
  text: string
  done: boolean
  card?: string
}
export interface CurriculumBlock {
  id: string
  title: string
  status: 'todo' | 'active' | 'done'
  lesson?: string
  items: CurriculumItem[]
}
export interface CurriculumQuestion {
  text: string
  block?: string
  asked: boolean
}
export interface Curriculum {
  title: string
  blocks: CurriculumBlock[]
  questions: CurriculumQuestion[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])

/** Whatever the JSON holds, as a curriculum: missing fields take a quiet default, junk is dropped. */
export function cleanCurriculum(raw: unknown): Curriculum {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    title: str(r.title) || 'Curriculum',
    blocks: rows(r.blocks).map((b, i) => ({
      id: str(b.id) || String(i + 1),
      title: str(b.title) || `Block ${i + 1}`,
      status: b.status === 'active' || b.status === 'done' ? b.status : 'todo',
      ...(str(b.lesson) ? { lesson: str(b.lesson) } : {}),
      items: rows(b.items).map((it) => ({ text: str(it.text), done: it.done === true, ...(str(it.card) ? { card: str(it.card) } : {}) }))
    })),
    questions: rows(r.questions).map((q) => ({ text: str(q.text), ...(str(q.block) ? { block: str(q.block) } : {}), asked: q.asked === true }))
  }
}
