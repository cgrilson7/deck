#!/usr/bin/env node
// The Reminders tile's CLI: how any Claude session, in any project, writes a reminder, a note or a
// log line. Talks to the deck's hooks server (`POST /reminders`: main/hooks.ts → main/reminders.ts)
// on 127.0.0.1, port from DECK_HOOK_PORT, else from the tmux socket's name ($TMUX: deck → 47800,
// anything else → 47801). Its absolute path is DECK_REMINDERS in every deck session's env (a session
// started before the door existed finds it beside mol.mjs: "$(dirname "$DECK_MOL")/reminders.mjs").
// No dependencies; Node 18+. Prints JSON: { ok: true, … } or { ok: false, error } (exit 1).

import { resolve } from 'node:path'
import { homedir } from 'node:os'

const HELP = `reminders.mjs — the deck's Reminders tile. The project defaults to this folder's repo.
  add TEXT [--priority high|normal|low] [--due YYYY-MM-DD|today|tomorrow] [--detail TEXT] [--project DIR]
  note TEXT [--project DIR]           a note on the project
  log TEXT [--project DIR]            a line in the project's running log (work done)
  list [--all] [--done] [--project DIR]        open reminders, most important first
  notes [--all] [--limit N] [--project DIR]
  history [--all] [--limit N] [--project DIR]  the running log, newest first
  done ID | undo ID | rm ID           rm also takes a note's or log line's id
  set ID [--text T] [--priority P] [--due DATE|none] [--detail T] [--project DIR]`

const BOOL = new Set(['all', 'done', 'help'])
const flags = {}
const args = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const [k, inline] = a.slice(2).split(/=(.*)/s)
    if (BOOL.has(k)) flags[k] = true
    else {
      const v = inline !== undefined ? inline : argv[++i]
      if (v === undefined) fail(`--${k} wants a value`)
      flags[k] = v
    }
  } else args.push(a)
}
const [cmd, ...rest] = args

function fail(error) {
  console.log(JSON.stringify({ ok: false, error }, null, 2))
  process.exit(1)
}

function port() {
  if (process.env.DECK_HOOK_PORT) return Number(process.env.DECK_HOOK_PORT)
  const sock = (process.env.TMUX ?? '').split(',')[0]
  const name = sock.slice(sock.lastIndexOf('/') + 1)
  return name === 'deck' ? 47800 : 47801
}

function day(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function due(v) {
  if (v === 'none') return null
  if (v === 'today') return day(0)
  if (v === 'tomorrow') return day(1)
  return v
}

function folder(v) {
  return v === '~' ? homedir() : v.startsWith('~/') ? `${homedir()}/${v.slice(2)}` : resolve(process.cwd(), v)
}

if (!cmd || cmd === 'help' || flags.help) {
  console.log(HELP)
  process.exit(0)
}

const where = flags.project !== undefined ? { project: folder(flags.project) } : { cwd: process.cwd() }
const text = rest.join(' ')
const id = rest[0]
const opt = (keys) => Object.fromEntries(keys.filter((k) => flags[k] !== undefined).map((k) => [k, k === 'due' ? due(flags[k]) : flags[k]]))
const limit = flags.limit !== undefined ? { limit: Number(flags.limit) } : {}

let body
switch (cmd) {
  case 'add':
    body = { op: 'add', text, ...where, ...opt(['priority', 'due', 'detail']) }
    break
  case 'note':
  case 'log':
    body = { op: cmd, text, ...where }
    break
  case 'list':
    body = { op: 'list', ...where, all: flags.all === true, done: flags.done === true }
    break
  case 'notes':
  case 'history':
    body = { op: cmd, ...where, all: flags.all === true, ...limit }
    break
  case 'done':
  case 'undo':
  case 'rm':
    if (!id) fail(`${cmd} which id? \`list\` shows them`)
    body = { op: cmd, id }
    break
  case 'set':
    if (!id) fail('set which id? `list` shows them')
    body = { op: 'set', id, ...opt(['text', 'priority', 'due', 'detail']), ...(flags.project !== undefined ? { project: folder(flags.project) } : {}) }
    break
  default:
    fail(`unknown command “${cmd}”.\n${HELP}`)
}

// Who wrote it: main turns this into the session's name.
body.session = process.env.CLAUDE_CODE_SESSION_ID ?? ''

let res
try {
  res = await fetch(`http://127.0.0.1:${port()}/reminders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
} catch (err) {
  fail(`no deck answering on port ${port()} (${err.message}). This only works while the deck app is running.`)
}
if (res.status === 204) fail('this deck is older than the /reminders door: restart the deck')
const out = await res.json().catch(() => ({ ok: false, error: `bad reply (HTTP ${res.status})` }))
console.log(JSON.stringify(out, null, 2))
process.exit(out.ok ? 0 : 1)
