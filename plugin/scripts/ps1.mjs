#!/usr/bin/env node
// The PS1 tile's CLI: how a Claude session reads and changes a running PlayStation game INSIDE THE DECK —
// its 2 MB of RAM (read, write, find, a value scanner, freezes), its buttons, its save states and a
// screenshot. Talks to the deck's hooks server (`POST /ps1`: main/hooks.ts → main/index.ts → the
// renderer's emulator, lib/ps1.ts) on 127.0.0.1, port from DECK_HOOK_PORT, else from the tmux socket's
// name ($TMUX: deck → 47800, anything else → 47801). Its absolute path is DECK_PS1 in every deck
// session's env (a session started before the door existed finds it beside mol.mjs:
// "$(dirname "$DECK_MOL")/ps1.mjs"). No dependencies; Node 18+. Prints JSON; exit 1 on { ok: false }.
//
// Addresses are PS1 addresses in any spelling (0x800A1234, 800a1234, or physical 0x0A1234); values
// are decimal or 0x-hex; sizes are 1, 2 or 4 bytes, little-endian.

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

const HELP = `ps1.mjs — the deck's PlayStation (the PS1 tile)
  status                                 what is running, whether RAM was found, freezes, the scan
  discs                                  the discs in the disc folder
  disc NAME                              load a disc (by name, part of one, or its path) and boot it
  read ADDR [LEN]                        LEN bytes (default 64, max 65536) as hex
  write ADDR HEX                         write bytes, e.g. write 0x800A1234 6400
  write ADDR VALUE --size N              write a number (N = 1, 2, 4)
  find HEX                               every place those bytes are (max 200)
  scan start [--size N] [--value V]      begin a scan: every N-byte value (or only those equal to V)
  scan eq|ne|gt|lt VALUE                 keep the candidates that compare so to VALUE now
  scan inc|dec|changed|unchanged         keep the candidates that moved so since the last step
  scan list [--limit N]                  show the candidates (default 40)
  freeze ADDR [VALUE] [--size N]         hold a value every frame (default: what it is now)
  unfreeze [ADDR|all]
  press BUTTON[,BUTTON…] [--ms N]        press (default 120 ms): up down left right cross circle
                                         square triangle l1 r1 l2 r2 start select
  wait MS
  state [save|load] [SLOT|NAME]          slots 1–3 are the pane's; any other word is a named checkpoint;
                                         no action lists the named ones
  shot                                   a PNG of the screen; prints its path (Read it to see the game)
  pause | resume | reset`

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

const num = (v, what) => {
  if (v === undefined) return undefined
  const n = /^0x/i.test(String(v)) ? parseInt(String(v).slice(2), 16) : Number(v)
  if (!Number.isFinite(n)) fail(`${what} wants a number, not “${v}”`)
  return n
}
const size = () => (flags.size !== undefined ? num(flags.size, '--size') : undefined)

if (!cmd || cmd === 'help' || flags.help) {
  console.log(HELP)
  process.exit(0)
}

let body
switch (cmd) {
  case 'status':
  case 'discs':
  case 'shot':
  case 'pause':
  case 'resume':
  case 'reset':
    body = { op: cmd }
    break
  case 'disc':
    if (!rest.length) fail('disc which? `discs` lists them')
    body = { op: 'disc', name: rest.join(' ') }
    break
  case 'read':
    if (!rest[0]) fail('read ADDR [LEN]')
    body = { op: 'read', addr: rest[0], len: num(rest[1], 'LEN') }
    break
  case 'write':
    if (rest.length < 2) fail('write ADDR HEX, or write ADDR VALUE --size N')
    body = flags.size !== undefined ? { op: 'write', addr: rest[0], value: num(rest[1], 'VALUE'), size: size() } : { op: 'write', addr: rest[0], hex: rest[1] }
    break
  case 'find':
    if (!rest[0]) fail('find HEX')
    body = { op: 'find', hex: rest.join('') }
    break
  case 'scan': {
    const mode = rest[0] ?? 'list'
    const value = flags.value !== undefined ? num(flags.value, '--value') : num(rest[1], 'VALUE')
    body = { op: 'scan', mode, value, size: size(), limit: num(flags.limit, '--limit') }
    break
  }
  case 'freeze':
    if (!rest[0]) fail('freeze ADDR [VALUE] [--size N]')
    body = { op: 'freeze', addr: rest[0], value: num(rest[1], 'VALUE'), size: size() }
    break
  case 'unfreeze':
    body = { op: 'unfreeze', addr: rest[0] ?? 'all' }
    break
  case 'press':
    if (!rest[0]) fail('press BUTTON[,BUTTON…] [--ms N]')
    body = { op: 'press', buttons: rest.join(',').split(',').filter(Boolean), ms: num(flags.ms, '--ms') }
    break
  case 'wait':
    body = { op: 'wait', ms: num(rest[0] ?? 1000, 'MS') }
    break
  case 'state': {
    const action = rest[0] === 'save' || rest[0] === 'load' ? rest[0] : undefined
    const which = action ? rest[1] : undefined
    if (action && !which) fail(`state ${action} SLOT|NAME (slots are 1–3)`)
    body = { op: 'state', action, ...(which === undefined ? {} : /^[1-3]$/.test(which) ? { slot: Number(which) - 1 } : { name: which }) }
    break
  }
  default:
    fail(`unknown command “${cmd}”.\n${HELP}`)
}

let res
try {
  res = await fetch(`http://127.0.0.1:${port()}/ps1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
} catch (err) {
  fail(`no deck answering on port ${port()} (${err.message}). This only works from a session running inside the deck app.`)
}
if (res.status === 204) fail('this deck is older than the /ps1 door: restart the deck')
const out = await res.json().catch(() => ({ ok: false, error: `bad reply (HTTP ${res.status}); is this deck older than the /ps1 door?` }))
console.log(JSON.stringify(out, null, 2))
process.exit(out.ok ? 0 : 1)
