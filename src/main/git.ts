// The changes tile's source: a working tree as git sees it. `gitChanges` is `git status` with
// line counts from `git diff HEAD --numstat` (untracked files are counted by hand), polled
// every couple of seconds by the tile, so everything here is read-only and never takes the
// index lock (GIT_OPTIONAL_LOCKS=0), which matters when Claude is running git in the same
// tree at the same time. `gitDiff` is one file's diff against HEAD for the tile to unfold.

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitChanges, GitDiff, GitFile, GitStatus } from '@shared/types'

/** A diff is cut off past this many characters; the tile says so. */
const DIFF_CAP = 300_000
/** Untracked files bigger than this are not read for a line count. */
const COUNT_CAP = 2_000_000
/** How many untracked files get a line count per poll (a fresh `node_modules` would be thousands). */
const COUNT_FILES = 60

interface Run {
  code: number
  stdout: string
  stderr: string
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { env: { ...env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, encoding: 'utf8', timeout: 8000, maxBuffer: 16_000_000 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
      }
    )
  })
}

/** One letter for a porcelain XY pair: what happened to the path, the more drastic thing first. */
function statusOf(x: string, y: string): GitStatus {
  if (x === '?') return '?'
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'U'
  if (x === 'D' || y === 'D') return 'D'
  if (x === 'A') return 'A'
  if (x === 'R' || x === 'C') return 'R'
  return 'M'
}

/** `git status --porcelain=v1 -z`: `XY path` entries, a rename carrying its origin as the next token. */
function parseStatus(z: string): GitFile[] {
  const out: GitFile[] = []
  const tok = z.split('\0')
  for (let i = 0; i < tok.length; i++) {
    const e = tok[i]
    if (e.length < 4) continue
    const x = e[0]
    const y = e[1]
    const path = e.slice(3)
    const file: GitFile = {
      path,
      status: statusOf(x, y),
      staged: x !== ' ' && x !== '?',
      untracked: x === '?',
      add: null,
      del: null,
      binary: false
    }
    if (x === 'R' || x === 'C') file.oldPath = tok[++i]
    out.push(file)
  }
  return out
}

/** `git diff --numstat -z`: `add\tdel\tpath`, a rename as `add\tdel\t` then the two paths. */
function parseNumstat(z: string): Map<string, { add: number | null; del: number | null }> {
  const map = new Map<string, { add: number | null; del: number | null }>()
  const tok = z.split('\0')
  for (let i = 0; i < tok.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tok[i])
    if (!m) continue
    let path = m[3]
    if (path === '') {
      i++ // the origin of a rename
      path = tok[++i] ?? ''
    }
    const n = (s: string) => (s === '-' ? null : Number(s))
    map.set(path, { add: n(m[1]), del: n(m[2]) })
  }
  return map
}

/** Lines in an untracked file (null past the cap, or when it looks binary). */
async function countLines(abs: string): Promise<{ lines: number | null; binary: boolean }> {
  try {
    const st = await stat(abs)
    if (!st.isFile() || st.size > COUNT_CAP) return { lines: null, binary: false }
    if (st.size === 0) return { lines: 0, binary: false }
    const buf = await readFile(abs)
    if (buf.subarray(0, 8000).includes(0)) return { lines: null, binary: true }
    let lines = 0
    for (const b of buf) if (b === 10) lines++
    if (buf[buf.length - 1] !== 10) lines++
    return { lines, binary: false }
  } catch {
    return { lines: null, binary: false }
  }
}

/** The changes of the working tree `cwd` is in. Outside a repository, `repo` is null and the rest empty. */
export async function gitChanges(cwd: string, env: NodeJS.ProcessEnv): Promise<GitChanges> {
  const none: GitChanges = { cwd, repo: null, branch: '', files: [], add: 0, del: 0 }
  const top = await git(cwd, ['rev-parse', '--show-toplevel'], env)
  if (top.code !== 0) return none
  const repo = top.stdout.trim()
  if (!repo) return none

  const [branch, status, numstat] = await Promise.all([
    git(repo, ['branch', '--show-current'], env),
    git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], env),
    git(repo, ['diff', 'HEAD', '--numstat', '-z', '-M'], env) // fails with no commit yet: counts stay unknown
  ])
  let name = branch.stdout.trim()
  if (!name) {
    const head = await git(repo, ['rev-parse', '--short', 'HEAD'], env)
    name = head.code === 0 ? head.stdout.trim() : ''
  }

  const files = status.code === 0 ? parseStatus(status.stdout) : []
  const counts = numstat.code === 0 ? parseNumstat(numstat.stdout) : new Map()
  let counted = 0
  for (const f of files) {
    if (f.untracked) {
      if (counted++ >= COUNT_FILES) continue
      const c = await countLines(join(repo, f.path))
      f.add = c.lines
      f.del = c.lines === null ? null : 0
      f.binary = c.binary
      continue
    }
    const c = counts.get(f.path)
    if (!c) continue
    f.add = c.add
    f.del = c.del
    f.binary = c.add === null && c.del === null
  }
  const add = files.reduce((n, f) => n + (f.add ?? 0), 0)
  const del = files.reduce((n, f) => n + (f.del ?? 0), 0)
  return { cwd, repo, branch: name, files, add, del }
}

/** One path's diff against HEAD. An untracked file is diffed against nothing, so it reads as all additions. */
export async function gitDiff(repo: string, path: string, untracked: boolean, env: NodeJS.ProcessEnv): Promise<GitDiff> {
  if (!repo || !path) return { path, text: '', truncated: false }
  const r = untracked
    ? await git(repo, ['diff', '--no-index', '--', '/dev/null', path], env) // exits 1 when they differ, which is the point
    : await git(repo, ['diff', 'HEAD', '-M', '--', path], env)
  let text = r.stdout
  if (!untracked && r.code !== 0 && !text) text = r.stderr.trim()
  const truncated = text.length > DIFF_CAP
  if (truncated) text = text.slice(0, DIFF_CAP)
  return { path, text, truncated }
}
