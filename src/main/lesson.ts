// The Lesson tile's disk side. Lessons are markdown files in the LEARNER'S repo
// (`~/grail/lessons/*.md`), written by a teaching session; the tile only renders them and
// NEVER WRITES THERE. The renderer reads nothing itself (CSP, sandbox), so everything comes
// through here: a lesson's text (`.md`, 1MB at most), a figure's bytes (an image INSIDE the
// lesson file's own folder tree — main/files.ts reads it, the renderer makes a blob: URL), the
// curriculum (`<folder>/curriculum.json`, the tile's home view), `lint` (the parser of
// shared/lesson.ts plus what needs the disk: do the figures exist), and the WATCH — the files
// that are up in some tile are watched, and a change re-sends the text, so the teacher edits a
// lesson and the card updates under the learner's eyes.

import { existsSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { LESSON_FIG_TYPES, cleanCurriculum, lintLesson, parseLesson, type LessonProblem } from '@shared/lesson'
import type { CurriculumRead, LessonFigure, LessonFile } from '@shared/types'
import { readDoc, resolveRef } from './files'

const LESSON_MAX = 1 << 20
const CURRICULUM_MAX = 1 << 20
/** An editor's save is often several events (write, rename, chmod): read once they settle. */
const SETTLE_MS = 120

/** The absolute path of a lesson file, or a message that says what to fix. */
function lessonPath(file: string): string {
  const path = resolveRef(file)
  if (!file || !isAbsolute(path)) throw new Error('a lesson is an absolute path to a .md file')
  if (extname(path).toLowerCase() !== '.md') throw new Error(`a lesson is a .md file, not “${basename(path)}”`)
  let s: ReturnType<typeof statSync>
  try {
    s = statSync(path)
  } catch {
    throw new Error(`no such file: ${path}`)
  }
  if (!s.isFile()) throw new Error(`not a file: ${path}`)
  if (s.size > LESSON_MAX) throw new Error(`${basename(path)} is ${(s.size / 1024).toFixed(0)}KB; a lesson is 1MB at most`)
  return path
}

export async function readLesson(file: string): Promise<LessonFile> {
  const path = lessonPath(file)
  return { file: path, text: await readFile(path, 'utf8'), mtime: (await stat(path)).mtimeMs }
}

/** Where a fig's `src` points, if that is an image inside the lesson file's folder tree. */
function figPath(file: string, src: string): { path: string } | { error: string } {
  const dir = dirname(resolveRef(file))
  const clean = String(src ?? '').trim()
  if (!clean) return { error: 'no src' }
  if (isAbsolute(clean) || clean.startsWith('~')) return { error: `${clean}: a figure's src is relative to the lesson file` }
  const ext = extname(clean).slice(1).toLowerCase()
  if (!(LESSON_FIG_TYPES as readonly string[]).includes(ext)) return { error: `${clean}: a figure is one of ${LESSON_FIG_TYPES.join(' ')}` }
  const path = resolve(dir, clean)
  if (!existsSync(path)) return { error: `${clean}: no such file (looked in ${dir})` }
  // A symlink may not lead out of the tree either.
  const inside = relative(realpathSync(dir), realpathSync(path))
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return { error: `${clean}: a figure must sit inside the lesson file's folder (${dir})` }
  return { path }
}

export async function lessonFigure(file: string, src: string): Promise<LessonFigure> {
  const at = figPath(file, src)
  if ('error' in at) return { ok: false, error: at.error }
  const doc = await readDoc(at.path)
  if (doc.kind !== 'image' || !doc.bytes || !doc.mime) return { ok: false, error: `${src}: ${doc.note ?? 'not an image'}` }
  return { ok: true, bytes: doc.bytes, mime: doc.mime }
}

/** `<dir>/curriculum.json`, cleaned. `data` null = there is none (or it does not parse: `error` says). */
export async function readCurriculum(dir: string): Promise<CurriculumRead> {
  const path = join(dir, 'curriculum.json')
  try {
    const s = await stat(path)
    if (!s.isFile() || s.size > CURRICULUM_MAX) return { dir, data: null, error: s.isFile() ? 'curriculum.json is over 1MB' : undefined }
    return { dir, data: cleanCurriculum(JSON.parse(await readFile(path, 'utf8'))) }
  } catch (err) {
    return { dir, data: null, error: err instanceof SyntaxError ? `curriculum.json does not parse: ${err.message}` : undefined }
  }
}

/** `lint`: parse only, no tile needed. Everything shared/lesson.ts can tell, plus the figures on disk. */
export async function lintLessonFile(file: string): Promise<Record<string, unknown>> {
  const { file: path, text } = await readLesson(file)
  const lesson = parseLesson(text)
  const problems: LessonProblem[] = lintLesson(lesson)
  for (const c of lesson.cards)
    for (const p of c.parts)
      if (p.kind === 'fig' && p.src) {
        const at = figPath(path, p.src)
        if ('error' in at) problems.push({ line: c.line, card: c.id, message: `fig ${at.error}` })
      }
  problems.sort((a, b) => a.line - b.line)
  return {
    ok: problems.length === 0,
    file: path,
    title: lesson.title,
    sources: lesson.sources.map((s) => s.id),
    cards: lesson.cards.map((c, i) => ({
      n: i + 1,
      id: c.id,
      heading: c.heading,
      line: c.line,
      cites: c.cites,
      asks: c.parts.flatMap((p) => (p.kind === 'ask' ? [p.id] : [])),
      mol: c.parts.flatMap((p) => (p.kind === 'mol' ? [p.label] : [])),
      figs: c.parts.flatMap((p) => (p.kind === 'fig' ? [p.src] : []))
    })),
    problems,
    ...(problems.length ? { error: `${problems.length} problem${problems.length === 1 ? '' : 's'} in ${basename(path)}: ${problems.map((p) => `line ${p.line}: ${p.message}`).join(' · ')}` } : {})
  }
}

/**
 * The files some tile is showing, watched. The FOLDER is what is watched, filtered to the file's
 * name: an editor that saves by writing a temp file and renaming it over the original would leave
 * a watch on the file itself holding the old inode.
 */
export class LessonWatch {
  private readonly watching = new Map<string, { w: FSWatcher; timer: NodeJS.Timeout | null }>()

  constructor(private readonly changed: (f: LessonFile) => void) {}

  /** The renderer says which files are up (all tiles together); the rest are let go. */
  sync(files: string[]): void {
    const want = new Set(files.filter((f) => typeof f === 'string' && isAbsolute(f) && f.toLowerCase().endsWith('.md')))
    for (const [file, v] of this.watching)
      if (!want.has(file)) {
        v.w.close()
        if (v.timer) clearTimeout(v.timer)
        this.watching.delete(file)
      }
    for (const file of want) {
      if (this.watching.has(file)) continue
      try {
        const entry = { w: null as unknown as FSWatcher, timer: null as NodeJS.Timeout | null }
        entry.w = watch(dirname(file), (_ev, name) => {
          if (name && name !== basename(file)) return
          if (entry.timer) clearTimeout(entry.timer)
          entry.timer = setTimeout(() => {
            entry.timer = null
            // Mid-save the file may be gone for a moment: the next event brings it back.
            readLesson(file).then(this.changed, () => {})
          }, SETTLE_MS)
        })
        entry.w.on('error', () => this.watching.delete(file))
        this.watching.set(file, entry)
      } catch {
        /* a folder that cannot be watched: the lesson still shows, it just does not reload */
      }
    }
  }

  stop(): void {
    this.sync([])
  }
}
