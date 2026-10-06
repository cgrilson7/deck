#!/usr/bin/env node
// THE LEDGER, for any project: what a piece of Claude Code work cost, in tokens, list-price
// dollars and time, one JSON line per piece in `<repo>/docs/costs/ledger.jsonl`. It began as
// ~/fridge's scripts/token-cost.mjs (2026-10-04) and keeps its line format, so fridge's ledger is
// one ledger among several and the deck's Spend tile reads them all. `/deck:ledger` is the skill.
//
//   node "$DECK_LEDGER" init                        opt this project in (creates the ledger file)
//   node "$DECK_LEDGER" log --tag <t> --kind <k> --summary "what was done"
//       one entry covering everything since THIS session's last entry (or its start)
//   node "$DECK_LEDGER" show [--since <ISO>]        this session's table, nothing written
//   node "$DECK_LEDGER" where                       the ledger this session would write to
//   ... --session <id>    another session (default $CLAUDE_CODE_SESSION_ID)
//   ... --hook            read session_id / cwd from a hook's stdin (SessionEnd), silent, never fails
//
// Differences from fridge's script: the session is THIS one ($CLAUDE_CODE_SESSION_ID), never "the
// newest transcript in the folder" (which is another session's whenever two run at once); a
// Workflow's agents (subagents/workflows/wf_*/) are counted too; CLAUDE_CONFIG_DIR is honoured;
// `--tag` is free text where fridge had `--game` (which still works and still writes `game`).
// A project with no ledger file is not logged to: `init` is the opt-in, so no repo grows one unasked.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { costOf, projectOf, LEDGER_PATH, IDLE_MS } from './lib/spend.mjs'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const v = argv[i + 1]
  const bare = v === undefined || v.startsWith('--')
  argv.splice(i, bare ? 1 : 2)
  return bare ? true : v
}
const hook = flag('--hook') === true
const game = flag('--game')
const tag = flag('--tag') ?? (typeof game === 'string' ? game : undefined)
const kind = flag('--kind')
const summary = flag('--summary')
const sinceArg = flag('--since')
let id = flag('--session')
let cwd = process.cwd()
const cmd = argv[0] ?? 'show'

const fail = (msg) => {
  if (!hook) console.error(msg)
  process.exit(hook ? 0 : 1)
}

if (hook) {
  try {
    const h = JSON.parse(fs.readFileSync(0, 'utf8'))
    id = h.session_id ?? id
    if (h.cwd) cwd = h.cwd
  } catch {
    /* no stdin */
  }
}
id = typeof id === 'string' ? id : process.env.CLAUDE_CODE_SESSION_ID

/** The repo this folder belongs to (a worktree's main repo), else the folder itself. */
function rootOf(dir) {
  const base = projectOf(dir)
  try {
    return execFileSync('git', ['-C', base, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || base
  } catch {
    return base
  }
}
const ROOT = rootOf(cwd)
const LEDGER = path.join(ROOT, LEDGER_PATH)

if (cmd === 'where') {
  console.log(fs.existsSync(LEDGER) ? LEDGER : `${LEDGER} (not created: run init to opt this project in)`)
  process.exit(0)
}
if (cmd === 'init') {
  if (fs.existsSync(LEDGER)) console.log(`already kept: ${LEDGER}`)
  else {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true })
    fs.writeFileSync(LEDGER, '')
    console.log(`created ${LEDGER}: log each piece of work with \`log --tag … --kind … --summary …\``)
  }
  process.exit(0)
}
if (cmd !== 'log' && cmd !== 'show') fail(`unknown command ${cmd}: init | log | show | where`)
if (!id) fail('no session: run inside a Claude Code session ($CLAUDE_CODE_SESSION_ID) or pass --session <id>')
if (cmd === 'log' && !fs.existsSync(LEDGER)) fail(`${ROOT} keeps no ledger (${LEDGER_PATH}); \`init\` opts it in`)

// The session's transcript, wherever the CLI filed it (the folder name encodes the launch cwd,
// which is not this cwd after a `cd`), and every transcript of its subagents, Workflows' included.
const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
let main = null
for (const d of fs.existsSync(projects) ? fs.readdirSync(projects) : []) {
  const f = path.join(projects, d, `${id}.jsonl`)
  if (fs.existsSync(f)) {
    main = f
    break
  }
}
if (!main) fail(`no transcript for session ${id} under ${projects}`)
const files = [{ who: 'main', file: main }]
const walk = (dir) => {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.jsonl')) files.push({ who: 'subagents', file: p })
  }
}
walk(path.join(path.dirname(main), id, 'subagents'))

const ledger = fs.existsSync(LEDGER)
  ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
  : []
const lastTo = ledger.filter((e) => e.session === id).map((e) => Date.parse(e.to)).sort((a, b) => b - a)[0]
const since = typeof sinceArg === 'string' ? Date.parse(sinceArg) : cmd === 'log' && lastTo ? lastTo : -Infinity

const rows = {}
const seen = new Set()
const mainTimes = []
let until = since
let unpriced = 0
for (const { who, file } of files) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let d
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    const t = Date.parse(d.timestamp)
    if (!(t > since)) continue
    if (who === 'main') mainTimes.push(t)
    until = Math.max(until, t)
    const m = d.message
    if (!m?.usage || !m.id || seen.has(m.id) || m.model === '<synthetic>') continue
    seen.add(m.id)
    const c = costOf(m.model, m.usage)
    if (c.unpriced) unpriced++
    const r = (rows[who] ??= { calls: 0, input: 0, write5m: 0, write1h: 0, read: 0, output: 0, cost: 0 })
    r.calls++
    for (const k of ['input', 'write5m', 'write1h', 'read', 'output', 'cost']) r[k] += c[k]
  }
}

mainTimes.sort((a, b) => a - b)
let activeMs = 0
for (let i = 1; i < mainTimes.length; i++) {
  const gap = mainTimes[i] - mainTimes[i - 1]
  if (gap < IDLE_MS) activeMs += gap
}
const from = mainTimes[0] ?? since
const wallMin = mainTimes.length ? (mainTimes.at(-1) - mainTimes[0]) / 60e3 : 0
const sum = (k) => Object.values(rows).reduce((s, r) => s + r[k], 0)
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d

if (cmd === 'log') {
  if (!sum('calls')) {
    if (!hook) console.log('nothing new since the last entry for this session')
    process.exit(0)
  }
  const entry = {
    at: new Date().toISOString(),
    session: id,
    ...(typeof game === 'string' ? { game } : {}),
    tag: tag ?? null,
    kind: hook && kind === undefined ? 'unlabelled' : typeof kind === 'string' ? kind : null,
    summary: typeof summary === 'string' ? summary : hook ? '(session end: work not logged by Claude)' : null,
    from: new Date(from).toISOString(),
    to: new Date(until).toISOString(),
    active_min: round(activeMs / 60e3, 1),
    wall_min: round(wallMin, 1),
    calls: sum('calls'),
    tokens: { input: sum('input'), write5m: sum('write5m'), write1h: sum('write1h'), read: sum('read'), output: sum('output') },
    cost: round(sum('cost')),
    cost_main: round(rows.main?.cost ?? 0),
    cost_subagents: round(rows.subagents?.cost ?? 0),
  }
  fs.appendFileSync(LEDGER, JSON.stringify(entry) + '\n')
  if (!hook) console.log(`logged: $${entry.cost.toFixed(2)}, ${entry.active_min} min active, ${entry.wall_min} min wall (${entry.kind ?? 'no kind'}${entry.tag ? ', ' + entry.tag : ''}) → ${LEDGER}`)
  process.exit(0)
}

const k = (n) => (n / 1000).toFixed(0).padStart(7) + 'k'
console.log(`session ${id}${since > -Infinity ? ` since ${new Date(since).toISOString()}` : ''}`)
console.log('            calls    input  write5m  write1h     read   output      cost')
for (const [who, r] of Object.entries(rows)) {
  console.log(`${who.padEnd(10)} ${String(r.calls).padStart(6)} ${k(r.input)} ${k(r.write5m)} ${k(r.write1h)} ${k(r.read)} ${k(r.output)} ${('$' + r.cost.toFixed(2)).padStart(9)}`)
}
console.log(`total${' '.repeat(59)}${('$' + sum('cost').toFixed(2)).padStart(9)}`)
console.log(`time: ${round(activeMs / 60e3, 1)} min active, ${round(wallMin, 1)} min wall`)
if (unpriced) console.log(`(${unpriced} responses from a model with no list price here were costed as Opus 5.5)`)
console.log(fs.existsSync(LEDGER) ? `ledger: ${LEDGER}` : `no ledger in ${ROOT} (init opts it in)`)
