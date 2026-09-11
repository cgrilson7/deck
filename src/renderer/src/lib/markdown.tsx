// A small markdown → React renderer for Claude's prose in the grid tiles: paragraphs,
// headings, bullet / numbered lists, fenced code, pipe tables, and inline code / bold /
// italic / links. Builds elements, never HTML, so nothing in a reply can inject markup.
// `cwd` is the session's folder: file references in the prose become clickable and are
// resolved against it (lib/filerefs.tsx).

import type { ReactNode } from 'react'
import { FileRef, linkifyPaths } from './filerefs'
import { isPathRef, splitRef } from './paths'

export function renderMarkdown(src: string, cwd?: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
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
      out.push(<Tag key={k()}>{inline(h[2], cwd)}</Tag>)
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
                  <th key={j}>{inline(c, cwd)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, cwd)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    // list (bullets or numbers; one level, continuation lines indented)
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      const ordered = /\d/.test(li[2])
      const items: string[] = []
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (m) items.push(m[3])
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ' ' + lines[i].trim()
        else break
        i++
      }
      const Tag = ordered ? 'ol' : 'ul'
      out.push(
        <Tag key={k()}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, cwd)}</li>
          ))}
        </Tag>
      )
      continue
    }
    // blockquote
    if (/^\s*>/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(<blockquote key={k()}>{renderMarkdown(q.join('\n'), cwd)}</blockquote>)
      continue
    }
    // paragraph: run until a blank line or a block start
    const p: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(\s*(```|~~~|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|))/.test(lines[i])) p.push(lines[i++])
    out.push(<p key={k()}>{inline(p.join(' '), cwd)}</p>)
  }
  return out
}

const INLINE = /(`+)([\s\S]*?)\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>)]+)/g

/** Inline markdown inside one block. Plain runs also get their file references linkified. */
export function inline(text: string, cwd?: string): ReactNode[] {
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
    } else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={key}>{inline(m[3] ?? m[4], cwd)}</strong>)
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<em key={key}>{inline(m[5] ?? m[6], cwd)}</em>)
    else if (m[7] !== undefined) out.push(link(key, m[8], m[7]))
    else if (m[9] !== undefined) out.push(link(key, m[9], m[9]))
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
