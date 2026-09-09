// Dropped files that would not stay put. A Finder drop carries a real path and is pasted as is.
// A macOS screenshot thumbnail (the floating preview, before it lands on the Desktop) is a file
// PROMISE: Chromium fulfils it into a per-process temp directory, sometimes a beat after the drop
// event, and dragging the thumbnail is what cancels the Desktop save, so that temp file is the only
// copy. An image dragged out of a page has no path at all, just bytes. Both are copied into
// userData/drops/ and the copy's path is what the session sees. Old copies are pruned on each drop.

import { copyFile, mkdir, readdir, stat, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

export interface DroppedFile {
  name: string
  /** The path Chromium reported ('' when the File has none). */
  path: string
  /** The File's bytes, sent only when it has no path. */
  bytes?: Uint8Array
}

const KEEP_MS = 30 * 24 * 3600 * 1000
/** How long to wait for a promised file to be written after the drop. */
const SETTLE_MS = 5000

const TEMP_ROOTS = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/']

/** True for a path under a temp directory, which Chromium may empty at any time. */
export function isTransient(p: string): boolean {
  const t = tmpdir().replace(/\/$/, '') + '/'
  return p.startsWith(t) || TEMP_ROOTS.some((r) => p.startsWith(r)) || p.includes('/TemporaryItems/')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait until the file exists and its size has stopped changing (a promise being fulfilled), or give up. */
async function settled(p: string): Promise<boolean> {
  let last = -1
  let stable = 0
  const until = Date.now() + SETTLE_MS
  while (Date.now() < until) {
    let size = -1
    try {
      size = (await stat(p)).size
    } catch {
      /* not there yet */
    }
    if (size > 0 && size === last) {
      stable += 1
      if (stable >= 2) return true
    } else stable = 0
    last = size
    await sleep(100)
  }
  return last > 0
}

function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const n = basename(name).replace(/[\x00-\x1f/]/g, '_').trim()
  return n && n !== '.' && n !== '..' ? n : 'dropped'
}

/** A name in `dir` that is not taken: "Screenshot.png", "Screenshot 2.png", ... */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  const taken = new Set(await readdir(dir).catch(() => [] as string[]))
  if (!taken.has(name)) return name
  for (let i = 2; ; i += 1) {
    const cand = `${stem} ${i}${ext}`
    if (!taken.has(cand)) return cand
  }
}

async function prune(dir: string): Promise<void> {
  const cutoff = Date.now() - KEEP_MS
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const p = join(dir, f)
    try {
      if ((await stat(p)).mtimeMs < cutoff) await unlink(p)
    } catch {
      /* gone already */
    }
  }
}

/**
 * The path a session should be given for a dropped file: the original when it will stay,
 * else a copy under `userData/drops/`. Null when there is nothing to keep.
 */
export async function keepDrop(userData: string, file: DroppedFile): Promise<string | null> {
  const p = String(file.path ?? '')
  if (p && !isTransient(p)) return p
  const dir = join(userData, 'drops')
  await mkdir(dir, { recursive: true })
  void prune(dir)
  const dest = join(dir, await freeName(dir, safeName(file.name || (p ? basename(p) : ''))))
  if (p) {
    if (!(await settled(p))) return null
    await copyFile(p, dest)
    return dest
  }
  if (file.bytes && file.bytes.byteLength > 0) {
    await writeFile(dest, file.bytes)
    return dest
  }
  return null
}
