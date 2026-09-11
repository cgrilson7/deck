// Finding file references in text, and the one channel that opens one in the preview pane.
//
// A reference can be an absolute path, a ~ path, an explicitly relative one, a path relative to
// the session's cwd, or a bare filename with a telling extension — and it may carry a `:42`.
// Everything that shows a path uses `pathRefs` to find them: the tiles' conversation (your
// prompts, Claude's prose), and the xterm link provider in the focus pane. Resolution and
// existence are main's business (`main/files.ts`); a wrong guess just says "no such file".

/** Extensions that make a bare name a file reference ("package.json", "index.ts"). */
const EXT = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl', 'ndjson', 'md', 'markdown', 'mdx', 'txt', 'text', 'log',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'svelte', 'vue', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'sh', 'zsh', 'bash', 'fish', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'm', 'mm',
  'cs', 'php', 'pl', 'lua', 'sql', 'csv', 'tsv', 'diff', 'patch', 'lock', 'db', 'sqlite', 'pdf', 'png', 'jpg', 'jpeg',
  'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'mp3', 'wav', 'mp4', 'mov', 'zip', 'gz', 'plist', 'icns', 'ipynb'
].join('|')

// Three shapes, tried in this order: something rooted at / ~/ ./ ../ ; a name (nested or not)
// ending in a known extension; a directory written with a trailing slash. The lookbehind keeps
// it from starting inside a word or after a colon, so "https://x/y.ts" stays a URL, and the
// trailing group takes the line number off "index.ts:42".
const REF = new RegExp(
  String.raw`(?<![\w@./~:-])(?:` +
    String.raw`(?:~|\.{1,2})?\/[A-Za-z0-9._~@+\-/]*[A-Za-z0-9_~@+]` +
    '|' +
    String.raw`[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*\.(?:${EXT})` +
    '|' +
    String.raw`[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*\/` +
    String.raw`)(?::(\d+))?(?![\w/])`,
  'g'
)

export interface PathRef {
  /** The path as written, without the `:42`. */
  path: string
  /** The line it pointed at, or null. */
  line: number | null
  /** The whole reference as it appears in the text, `:42` included. */
  raw: string
  /** Where `raw` sits in the text. */
  start: number
  end: number
}

/** Every file reference in `text`, in order. */
export function pathRefs(text: string): PathRef[] {
  const out: PathRef[] = []
  for (const m of text.matchAll(REF)) {
    const raw = m[0]
    const line = m[1] ? Number(m[1]) : null
    const path = line === null ? raw : raw.slice(0, raw.length - m[1].length - 1)
    if (path.length < 2 || path === '..' || path === './') continue
    out.push({ path, line, raw, start: m.index ?? 0, end: (m.index ?? 0) + raw.length })
  }
  return out
}

/** True when the whole string is one file reference (an inline code span, a tool line's label). */
export function isPathRef(text: string): boolean {
  const t = text.trim()
  if (!t || /\s/.test(t)) return false
  const refs = pathRefs(t)
  return refs.length === 1 && refs[0].raw === t
}

/** Split a reference into the path and the line it points at. */
export function splitRef(ref: string): { path: string; line: number | null } {
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(ref.trim())
  return m ? { path: m[1], line: Number(m[2]) } : { path: ref.trim(), line: null }
}

// ---- the channel to the preview pane ---------------------------------------

/** What the preview pane is asked to show: a reference, and the folder to resolve it against. */
export interface DocRef {
  path: string
  /** The session's cwd, when the reference came from one of its panes. */
  cwd?: string
  line: number | null
}

const EVENT = 'deck:opendoc'

/** Show a referenced path in the preview pane over the grid. */
export function openDoc(path: string, cwd?: string, line: number | null = null): void {
  window.dispatchEvent(new CustomEvent<DocRef>(EVENT, { detail: { path, cwd, line } }))
}

export function onOpenDoc(cb: (r: DocRef) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<DocRef>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
