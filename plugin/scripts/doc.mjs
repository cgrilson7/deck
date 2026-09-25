#!/usr/bin/env node
// The preview pane's CLI: how a Claude session puts a file in front of the user INSIDE THE DECK —
// the preview pane in the center column, where markdown renders, task-list checkboxes click, and
// `edit` makes any text or markdown file editable in place (⌘S saves) — instead of macOS `open`,
// which hands it to whatever app owns the type (RStudio, Xcode…). Talks to the deck's hooks server
// (`POST /doc`: main/hooks.ts → `hooks.onDoc` in main/index.ts → the renderer's `openDoc`) on
// 127.0.0.1, port from DECK_HOOK_PORT, else from the tmux socket's name ($TMUX: deck → 47800,
// anything else → 47801). Its absolute path is DECK_DOC in every deck session's env (a session
// started before the door existed finds it beside mol.mjs: "$(dirname "$DECK_MOL")/doc.mjs").
// No dependencies; Node 18+. Prints JSON: { ok: true, path, kind, editable } or { ok: false, error } (exit 1).
//
//   doc.mjs open <path> [--line N]     open the file (or folder) in the preview pane, scrolled to line N

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const flags = {}
const args = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const [k, inline] = a.slice(2).split(/=(.*)/s)
    flags[k] = inline !== undefined ? inline : k === 'help' ? true : argv[++i]
  } else args.push(a)
}
const [cmd, ...rest] = args

const HELP = `doc.mjs — open a file in the deck's preview pane (read it, tick its checkboxes, edit it)
  open PATH [--line N]`

function port() {
  if (process.env.DECK_HOOK_PORT) return Number(process.env.DECK_HOOK_PORT)
  const sock = (process.env.TMUX ?? '').split(',')[0]
  const name = sock.slice(sock.lastIndexOf('/') + 1)
  return name === 'deck' ? 47800 : 47801
}

function fail(error) {
  console.log(JSON.stringify({ ok: false, error }, null, 2))
  process.exit(1)
}

if (!cmd || cmd === 'help' || flags.help) {
  console.log(HELP)
  process.exit(0)
}
if (cmd !== 'open') fail(`unknown command “${cmd}”.\n${HELP}`)

let f = rest.join(' ')
if (!f) fail('open which file? e.g. `open notes/checklist.md`')
// `path:42` works too, the way paths are written everywhere else in the deck.
let line = flags.line
const tail = /^(.*):(\d+)$/.exec(f)
if (tail && !existsSync(f)) [f, line] = [tail[1], line ?? tail[2]]
const p = f.startsWith('~/') ? join(homedir(), f.slice(2)) : f
const abs = isAbsolute(p) ? p : resolve(process.cwd(), p)
if (!existsSync(abs)) fail(`no such file: ${abs}`)
if (line !== undefined && !/^[1-9]\d*$/.test(String(line))) fail(`--line wants a line number, not “${line}”`)

let res
try {
  res = await fetch(`http://127.0.0.1:${port()}/doc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'open', path: abs, line: line === undefined ? null : Number(line) }) })
} catch (err) {
  fail(`no deck answering on port ${port()} (${err.message}). This only works from a session running inside the deck app.`)
}
if (res.status === 204) fail('this deck is older than the /doc door: restart the deck')
const out = await res.json().catch(() => ({ ok: false, error: `bad reply (HTTP ${res.status}); is this deck older than the /doc door?` }))
console.log(JSON.stringify(out, null, 2))
process.exit(out.ok ? 0 : 1)
