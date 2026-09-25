// Reading a referenced file for the preview pane. A path can come from a tool line in a tile,
// from Claude's prose, from your own prompt, or from a click in the terminal, so it may be
// absolute, ~-relative, relative to the session's cwd, or a file:// URL — `resolveRef` settles
// that, and `readDoc` says what the thing is and hands back just enough to draw it: text for
// anything text-shaped (capped), bytes for an image or a PDF (the renderer makes a blob URL of
// them), a listing for a directory. What it cannot show it still reports, with a note, so the
// pane can offer to open it in the app macOS would use.
//
// It also WRITES, for the pane's edit mode and its task-list checkboxes — carefully: only an
// existing regular text / markdown file of valid UTF-8, only if it has not changed since the
// pane read it (the mtime it read is the lock), never past the text cap, and atomically (a temp
// file beside it, then a rename, with the file's own mode). A task toggle flips ONE byte of ONE
// line, so the rest of the file stays exactly as it was.

import { chmod, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import type { DocWrite, FileDoc, FileKind } from '@shared/types'

/** Text is read up to here; the rest is dropped and the pane says so. */
const TEXT_CAP = 1_500_000
/** Bytes handed to the renderer for an image / PDF; past this, open it in the real app instead. */
const BYTES_CAP = 40_000_000
/** Entries listed for a directory. */
const DIR_CAP = 400

const IMAGE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])

/** Extensions that are text however they sniff (an empty file, a file of only tabs). */
const TEXTISH = new Set([
  '.txt', '.text', '.log', '.json', '.jsonl', '.ndjson', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.less', '.html', '.htm', '.xml', '.svelte', '.vue',
  '.sh', '.zsh', '.bash', '.fish', '.py', '.rb', '.rs', '.go', '.java', '.kt', '.swift', '.c', '.h', '.cc', '.cpp',
  '.hpp', '.m', '.mm', '.cs', '.php', '.pl', '.lua', '.sql', '.csv', '.tsv', '.diff', '.patch', '.lock', '.ipynb',
  '.gitignore', '.editorconfig', '.plist', '.gradle', '.mk', '.r', '.jl'
])

/**
 * The absolute path a reference means: `~/x`, `/x`, `./x`, `x/y` (against `cwd`), or a file: URL.
 * A trailing `:12` is the caller's business (`splitRef` in the renderer strips it first).
 */
export function resolveRef(ref: string, cwd?: string): string {
  let p = String(ref ?? '').trim()
  if (p.startsWith('file://')) {
    try {
      p = fileURLToPath(p)
    } catch {
      /* not a URL after all; take it as written */
    }
  }
  p = p.replace(/^['"]+|['"]+$/g, '')
  if (p === '~') p = homedir()
  else if (p.startsWith('~/')) p = join(homedir(), p.slice(2))
  return isAbsolute(p) ? normalize(p) : resolve(cwd || homedir(), p)
}

/** True when the head of the file looks binary: a NUL byte, or too much of it unprintable. */
async function sniffBinary(path: string): Promise<boolean> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    if (bytesRead === 0) return false
    let odd = 0
    for (let i = 0; i < bytesRead; i += 1) {
      const b = buf[i]
      if (b === 0) return true
      if (b < 9 || (b > 13 && b < 32)) odd += 1
    }
    return odd / bytesRead > 0.1
  } finally {
    await fh.close()
  }
}

/** Everything the preview pane needs about one path. Never throws: trouble comes back as a note. */
export async function readDoc(ref: string, cwd?: string): Promise<FileDoc> {
  const path = resolveRef(ref, cwd)
  const name = basename(path) || path
  let s: Awaited<ReturnType<typeof stat>>
  try {
    s = await stat(path)
  } catch {
    // A caller that kept the `:42` on the reference still gets the file (the renderer strips it).
    const cut = /^(.*):\d+(?::\d+)?$/.exec(ref)
    if (cut) return readDoc(cut[1], cwd)
    return { path, name, kind: 'missing', size: 0, mtime: 0, note: 'No such file.' }
  }
  const doc: FileDoc = { path, name, kind: 'binary', size: s.size, mtime: s.mtimeMs }

  if (s.isDirectory()) {
    try {
      const ents = await readdir(path, { withFileTypes: true })
      const rows = ents
        .filter((e) => !e.name.startsWith('.') || ents.length < 40)
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
      const extra = rows.length - DIR_CAP
      return { ...doc, kind: 'dir', entries: rows.slice(0, DIR_CAP), note: extra > 0 ? `${extra} more entries not shown.` : undefined }
    } catch (err) {
      return { ...doc, kind: 'dir', entries: [], note: err instanceof Error ? err.message : String(err) }
    }
  }
  if (!s.isFile()) return { ...doc, note: 'Not a regular file.' }

  const ext = extname(path).toLowerCase()
  const mime = ext === '.pdf' ? 'application/pdf' : IMAGE[ext]
  if (mime) {
    const kind: FileKind = ext === '.pdf' ? 'pdf' : 'image'
    if (s.size > BYTES_CAP) return { ...doc, kind, mime, note: 'Too big to preview here.' }
    try {
      return { ...doc, kind, mime, bytes: new Uint8Array(await readFile(path)) }
    } catch (err) {
      return { ...doc, kind, mime, note: err instanceof Error ? err.message : String(err) }
    }
  }

  try {
    if (!TEXTISH.has(ext) && !MARKDOWN.has(ext) && (await sniffBinary(path))) return { ...doc, note: 'Binary file.' }
    const fh = await open(path, 'r')
    let text: string
    try {
      const take = Math.min(s.size, TEXT_CAP)
      const buf = Buffer.alloc(take)
      const { bytesRead } = await fh.read(buf, 0, take, 0)
      text = buf.toString('utf8', 0, bytesRead)
    } finally {
      await fh.close()
    }
    return { ...doc, kind: MARKDOWN.has(ext) ? 'markdown' : 'text', text, truncated: s.size > TEXT_CAP }
  } catch (err) {
    return { ...doc, note: err instanceof Error ? err.message : String(err) }
  }
}

/** A task-list item's line: the list marker, then `[ ]` / `[x]`. Group 1 runs up to the mark itself. */
const TASK = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/

/**
 * The file behind `path` if the pane may write it: an existing regular file (a symlink is
 * followed, so the link stays a link), text or markdown, whole (not cut at the cap), valid
 * UTF-8, and unchanged since the pane read it at `mtime`.
 */
async function editable(path: string, mtime: number): Promise<{ real: string; mode: number; buf: Buffer } | { error: string; stale?: boolean }> {
  const doc = await readDoc(path)
  if (doc.kind !== 'text' && doc.kind !== 'markdown') return { error: doc.kind === 'missing' ? 'The file is gone.' : 'Only a text or markdown file can be edited here.' }
  if (doc.truncated) return { error: 'Too big to edit here.' }
  let real: string
  try {
    real = await realpath(doc.path)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  const s = await stat(real)
  if (!s.isFile()) return { error: 'Not a regular file.' }
  if (s.mtimeMs !== mtime) return { error: 'The file changed on disk since it was read.', stale: true }
  const buf = await readFile(real)
  if (!Buffer.from(buf.toString('utf8'), 'utf8').equals(buf)) return { error: 'Not UTF-8 text: editing it here could change bytes you did not touch.' }
  return { real, mode: s.mode & 0o7777, buf }
}

/** Temp file in the same folder, then a rename over the original: a reader never sees half a file. */
async function replaceFile(real: string, mode: number, data: Buffer): Promise<void> {
  const tmp = join(dirname(real), `.${basename(real)}.deck-${randomBytes(4).toString('hex')}.tmp`)
  try {
    await writeFile(tmp, data, { mode, flag: 'wx' })
    await chmod(tmp, mode) // writeFile's mode passes through the umask
    await rename(tmp, real)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

async function commit(path: string, mtime: number, next: (buf: Buffer) => Buffer | string): Promise<DocWrite> {
  try {
    const e = await editable(resolveRef(path), mtime)
    if ('error' in e) return { ok: false, error: e.error, stale: e.stale }
    const out = next(e.buf)
    if (typeof out === 'string') return { ok: false, error: out }
    if (out.length > TEXT_CAP) return { ok: false, error: `That would make the file bigger than ${Math.round(TEXT_CAP / 1e6 * 10) / 10}MB, the most edited here.` }
    await replaceFile(e.real, e.mode, out)
    return { ok: true, doc: await readDoc(path) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The pane's edit mode: the whole text, written over the file the pane read at `mtime`. */
export function writeDoc(path: string, text: string, mtime: number): Promise<DocWrite> {
  return commit(path, mtime, () => Buffer.from(String(text ?? ''), 'utf8'))
}

/**
 * A task-list checkbox: line `line` (0-based, split on \n) must still be a task that is
 * `checked`; its mark becomes the other one ('x' / ' ') and not another byte moves.
 */
export function toggleTask(path: string, line: number, checked: boolean, mtime: number): Promise<DocWrite> {
  return commit(path, mtime, (buf) => {
    let start = 0
    for (let n = 0; n < line; n += 1) {
      const nl = buf.indexOf(0x0a, start)
      if (nl < 0) return 'That line is not in the file any more.'
      start = nl + 1
    }
    const end = buf.indexOf(0x0a, start)
    const m = TASK.exec(buf.toString('utf8', start, end < 0 ? buf.length : end))
    if (!m || (m[2] !== ' ') !== checked) return 'That line is not the task it was: reload.'
    // Everything before the mark is ASCII (spaces, a bullet or a number, `[`), so its length is its byte count.
    const out = Buffer.from(buf)
    out[start + m[1].length] = checked ? 0x20 : 0x78
    return out
  })
}
