#!/usr/bin/env node
// The wolfpack's leash: run by the ALPHA (a Claude session inside the deck) from its Bash tool.
// Talks to the deck's hooks server (main/hooks.ts → main/pack.ts) on 127.0.0.1, identifying the
// caller by CLAUDE_CODE_SESSION_ID (the UUID deck handed `--session-id`) with $TMUX_PANE as the
// fallback, and the port by DECK_HOOK_PORT, else by the tmux socket's name ($TMUX: deck → 47800,
// anything else → 47801). No dependencies; Node 18+.
//
//   wolfpack.mjs spawn <manifest.json>      start the betas in the manifest → JSON of what was made
//   wolfpack.mjs status                     every open beta: status, attention, transcript path, last words
//   wolfpack.mjs wait [--timeout S] [--every S]
//                                           poll until no beta is starting/busy (default 540s, 5s) → final status
//   wolfpack.mjs say <beta> <text…>         paste + ⏎ into one beta (by id, task name, or session id)
//   wolfpack.mjs dismiss [--park] [beta…]   kill (or park) the pack, or only the betas named
//
// Manifest: { "betas": [ { "task": "engine hooks", "prompt": "…", "cwd"?: "/abs", "worktree"?: false,
//                          "model"?: "opus", "permissionMode"?: "acceptEdits" }, … ] }

import { readFileSync } from 'node:fs'

const [cmd, ...rest] = process.argv.slice(2)

function port() {
  if (process.env.DECK_HOOK_PORT) return Number(process.env.DECK_HOOK_PORT)
  const sock = (process.env.TMUX ?? '').split(',')[0]
  const name = sock.slice(sock.lastIndexOf('/') + 1)
  return name === 'deck' ? 47800 : 47801
}

function who() {
  return { alpha: process.env.CLAUDE_CODE_SESSION_ID ?? '', pane: process.env.TMUX_PANE ?? '' }
}

async function call(body) {
  let res
  try {
    res = await fetch(`http://127.0.0.1:${port()}/pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...who(), ...body })
    })
  } catch (err) {
    die(`no deck answering on port ${port()} (${err.message}). Is this session running inside the deck?`)
  }
  const out = await res.json().catch(() => ({ ok: false, error: `bad reply (${res.status})` }))
  if (!res.ok || out.ok === false) die(out.error ?? `HTTP ${res.status}`)
  return out
}

function die(msg) {
  console.error(`wolfpack: ${msg}`)
  process.exit(1)
}

function flags(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--park') out.park = true
    else if (a === '--timeout' || a === '--every') out[a.slice(2)] = Number(args[++i])
    else out._.push(a)
  }
  return out
}

const print = (x) => console.log(JSON.stringify(x, null, 2))
const settled = (b) => b.status !== 'busy' && b.status !== 'starting' && b.status !== 'unknown'

switch (cmd) {
  case 'spawn': {
    const file = rest[0]
    if (!file) die('usage: spawn <manifest.json>')
    let manifest
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      die(`cannot read ${file}: ${err.message}`)
    }
    print(await call({ op: 'spawn', betas: manifest.betas }))
    break
  }
  case 'status':
    print(await call({ op: 'status' }))
    break
  case 'wait': {
    const f = flags(rest)
    const timeout = (f.timeout ?? 540) * 1000
    const every = (f.every ?? 5) * 1000
    const t0 = Date.now()
    let last = ''
    for (;;) {
      const s = await call({ op: 'status' })
      const line = s.betas.map((b) => `${b.task}: ${b.status}${b.attention ? ' (needs you)' : ''}`).join(' · ')
      if (line !== last) {
        console.error(`[${Math.round((Date.now() - t0) / 1000)}s] ${line || 'no betas'}`)
        last = line
      }
      if (s.betas.length === 0 || s.betas.every(settled)) {
        print(s)
        break
      }
      if (Date.now() - t0 > timeout) {
        print(s)
        console.error(`wolfpack: still running after ${Math.round(timeout / 1000)}s; call wait again`)
        process.exit(2)
      }
      await new Promise((r) => setTimeout(r, every))
    }
    break
  }
  case 'say': {
    const [beta, ...words] = rest
    const text = words.join(' ')
    if (!beta || !text) die('usage: say <beta> <text…>')
    print(await call({ op: 'say', beta, text }))
    break
  }
  case 'dismiss': {
    const f = flags(rest)
    print(await call({ op: 'dismiss', park: !!f.park, ...(f._.length ? { betas: f._ } : {}) }))
    break
  }
  default:
    console.error('usage: wolfpack.mjs spawn <manifest.json> | status | wait [--timeout S] [--every S] | say <beta> <text…> | dismiss [--park] [beta…]')
    process.exit(1)
}
