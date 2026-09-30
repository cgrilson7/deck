#!/usr/bin/env node
// The Space tile's CLI: how a Claude session puts the disk in front of the user INSIDE THE DECK.
// `open` shows the Space pane (POST /space: main/hooks.ts → `hooks.onSpace` in main/index.ts →
// the renderer's toggleSpace); everything else is handed to the space repo's own CLI
// (~/space/bin/space.mjs, or $SPACE_DIR), which owns the data and every decision. Its absolute
// path is DECK_SPACE in every deck session's env (a session started before it finds it beside
// mol.mjs: "$(dirname "$DECK_MOL")/space.mjs"). No dependencies; Node 18+.
//
//   space.mjs open                 show the Space pane in the center column
//   space.mjs <anything else>      ~/space/bin/space.mjs <anything else> (status, list, rules, scan…)

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const dir = (process.env.SPACE_DIR || join(homedir(), 'space')).replace(/^~(?=\/|$)/, homedir())

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

if (argv[0] === 'open') {
  let res
  try {
    res = await fetch(`http://127.0.0.1:${port()}/space`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'open' }) })
  } catch (err) {
    fail(`no deck answering on port ${port()} (${err.message}). This only works from a session running inside the deck app.`)
  }
  if (res.status === 204) fail('this deck is older than the /space door: restart the deck')
  const out = await res.json().catch(() => ({ ok: false, error: `bad reply (HTTP ${res.status})` }))
  console.log(JSON.stringify({ ok: out.ok, error: out.error }, null, 2))
  process.exit(out.ok ? 0 : 1)
}

const script = join(dir, 'bin', 'space.mjs')
if (!existsSync(script)) fail(`no space repo at ${dir} (set SPACE_DIR)`)
const r = spawnSync(process.execPath, [script, ...argv], { stdio: 'inherit' })
process.exit(r.status ?? 1)
