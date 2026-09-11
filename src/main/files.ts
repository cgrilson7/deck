// Reading a referenced file for the preview pane. A path can come from a tool line in a tile,
// from Claude's prose, from your own prompt, or from a click in the terminal, so it may be
// absolute, ~-relative, relative to the session's cwd, or a file:// URL — `resolveRef` settles
// that, and `readDoc` says what the thing is and hands back just enough to draw it: text for
// anything text-shaped (capped), bytes for an image or a PDF (the renderer makes a blob URL of
// them), a listing for a directory. What it cannot show it still reports, with a note, so the
// pane can offer to open it in the app macOS would use.

import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FileDoc, FileKind } from '@shared/types'

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
