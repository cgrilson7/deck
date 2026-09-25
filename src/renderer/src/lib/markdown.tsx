// A small markdown → React renderer for Claude's prose in the grid tiles: paragraphs,
// headings, bullet / numbered lists (nested, and `- [ ]` / `- [x]` task items as checkboxes), fenced code, pipe tables, and inline code / bold /
// italic / links (and, for a caller that asks, footnote marks). Builds elements, never HTML, so nothing in a reply can inject markup.
// `cwd` is the session's folder: file references in the prose become clickable and are
// resolved against it (lib/filerefs.tsx).

import type { ReactNode } from 'react'
import { FileRef, linkifyPaths } from './filerefs'
import { isPathRef, splitRef } from './paths'

/**
 * What a caller may add to the renderer. `foot`: a footnote mark `[^id]` (the Lesson tile's sources); without it the mark stays text.
 * `task`: a click on a task item's checkbox, with its 0-based line in `src` and whether it was checked (the preview pane
 * writes it to disk); without it the checkboxes are drawn disabled.
 */
export interface MarkdownExt {
  foot?: (id: string, key: string) => ReactNode
  task?: (line: number, checked: boolean) => void
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
/** A task item's text: `[ ]` / `[x]`, then what it says. */
const TASK_ITEM = /^\[([ xX])\](?:\s+(.*))?$/

interface ListItem {
  indent: number
  ordered: boolean
  text: string
  /** Its line in the source, for a task's checkbox. */
  line: number
  kids: ListItem[]
}

export function renderMarkdown(src: string, cwd?: string, ext?: MarkdownExt): ReactNode[] {
  // Split on \n (a \r\n counts as one), so a line's index is the one main counts to toggle a task.
  const lines = src.split(/\r?\n/)
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  const k = () => `m${key++}`

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    // fenced code
    const fence = /^\s*(```+|~~~+)\s*(\S*)/.exec(line)
    if (fence) {
      const close = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(close)) body.push(lines[i++])
      i++
      out.push(
        <pre key={k()} className="md-code" data-lang={fence[2] || undefined}>
          <code>{body.join('\n')}</code>
        </pre>
      )
      continue
    }
    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = Math.min(h[1].length + 2, 6) // tiles are small: h1 renders as h3
      const Tag = `h${level}` as 'h3'
      out.push(<Tag key={k()}>{inline(h[2], cwd, ext)}</Tag>)
      i++
      continue
    }
    // rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={k()} />)
      i++
      continue
    }
    // table (header row + separator row)
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows: string[][] = []
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
      const head = cells(line)
      i += 2
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]))
      out.push(
        <div key={k()} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, cwd, ext)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, cwd, ext)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    // list (bullets or numbers, nested by indentation, continuation lines indented)
    if (LIST_ITEM.test(line)) {
      const roots: ListItem[] = []
      const open: ListItem[] = []
      let last: ListItem | null = null
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i])
        if (m) {
          const item: ListItem = { indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3], line: i, kids: [] }
          while (open.length && open[open.length - 1].indent >= item.indent) open.pop()
          ;(open.length ? open[open.length - 1].kids : roots).push(item)
          open.push(item)
          last = item
        } else if (/^\s{2,}\S/.test(lines[i]) && last) last.text += ' ' + lines[i].trim()
        else break
        i++
      }
      out.push(list(roots, k(), cwd, ext))
      continue
    }
    // blockquote
    if (/^\s*>/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      // A quote's lines are not the file's lines, so its task items are drawn but not clickable.
      out.push(<blockquote key={k()}>{renderMarkdown(q.join('\n'), cwd, { ...ext, task: undefined })}</blockquote>)
      continue
    }
    // paragraph: run until a blank line or a block start
    const p: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(\s*(```|~~~|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|))/.test(lines[i])) p.push(lines[i++])
    out.push(<p key={k()}>{inline(p.join(' '), cwd, ext)}</p>)
  }
  return out
}

/** One level of a list, its nested lists inside their items. A task item leads with its checkbox. */
function list(items: ListItem[], key: string, cwd?: string, ext?: MarkdownExt): ReactNode {
  const Tag = items[0]?.ordered ? 'ol' : 'ul'
  const tasks = items.some((it) => TASK_ITEM.test(it.text))
  return (
    <Tag key={key} className={tasks ? 'md-tasks' : undefined}>
      {items.map((it, j) => {
        const t = TASK_ITEM.exec(it.text)
        const done = !!t && t[1] !== ' '
        const kids = it.kids.length ? list(it.kids, `${key}.${j}`, cwd, ext) : null
        if (!t) return <li key={j}>{inline(it.text, cwd, ext)}{kids}</li>
        return (
          <li key={j} className={done ? 'md-task done' : 'md-task'}>
            <input
              type="checkbox"
              checked={done}
              disabled={!ext?.task}
              readOnly={!ext?.task}
              onChange={ext?.task ? () => ext.task!(it.line, done) : undefined}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="md-task-text">{inline(t[2] ?? '', cwd, ext)}</span>
            {kids}
          </li>
        )
      })}
    </Tag>
  )
}

const INLINE = /(`+)([\s\S]*?)\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>)]+)|\[\^([\w-]+)\]/g

/** Inline markdown inside one block. Plain runs also get their file references linkified. */
export function inline(text: string, cwd?: string, ext?: MarkdownExt): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    const key = `i${n++}`
    if (at > last) out.push(...linkifyPaths(text.slice(last, at), cwd, `${key}p`))
    if (m[2] !== undefined) {
      // A code span that is nothing but a path (`src/main/index.ts`) is the commonest way a
      // reply names a file, so it opens the preview pane instead of sitting there as code.
      const ref = isPathRef(m[2]) ? splitRef(m[2]) : null
      out.push(ref ? <FileRef key={key} path={ref.path} cwd={cwd} line={ref.line} label={m[2]} code /> : <code key={key}>{m[2]}</code>)
    } else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={key}>{inline(m[3] ?? m[4], cwd, ext)}</strong>)
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<em key={key}>{inline(m[5] ?? m[6], cwd, ext)}</em>)
    else if (m[7] !== undefined) out.push(link(key, m[8], m[7]))
    else if (m[9] !== undefined) out.push(link(key, m[9], m[9]))
    else if (m[10] !== undefined) out.push(ext?.foot ? ext.foot(m[10], key) : m[0])
    last = at + m[0].length
  }
  if (last < text.length) out.push(...linkifyPaths(text.slice(last), cwd, `i${n}p`))
  return out
}

function link(key: string, url: string, label: string): ReactNode {
  return (
    <a
      key={key}
      href={url}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        window.deck.openExternal(url)
      }}
    >
      {label}
    </a>
  )
}
