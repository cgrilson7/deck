#!/usr/bin/env node
// The Lesson tile's CLI: how a Claude session TEACHING from a repo of lessons (~/grail) points at
// THE LESSON while it explains — a card goes up, a phrase on it lights, a question is asked —
// and SEES what the learner answered in the tile (`look`). The Molecule tile's other half
// ($DECK_MOL shows the molecule; this shows the idea, its source, and the question). Talks to the
// deck's hooks server (`POST /lesson`: main/hooks.ts → `lessonCall` in main/index.ts, which READS
// THE FILE first — the renderer reads nothing — → lib/lesson.ts) on 127.0.0.1, port from
// DECK_HOOK_PORT, else from the tmux socket's name ($TMUX: deck → 47800, anything else → 47801).
// Its absolute path is DECK_LESSON in every deck session's env (a session started before the
// Lesson tile existed finds it beside mol.mjs: "$(dirname "$DECK_MOL")/lesson.mjs"). No
// dependencies; Node 18+. Every command prints JSON: { ok: true, tile, … } or
// { ok: false, error } (exit 1) with a message that says how to fix it.
//
// A LESSON is a markdown file of the learner's repo (the format: plugin/skills/lesson/SKILL.md).
// The tile renders it and never writes to the repo. THERE ARE SEVERAL LESSON TILES (4 at most).
// Every command but `lint` / `reset` / `tiles` takes --tile <n>; without it, it goes to the tile
// the door used last (every answer carries `tile`). `show --new` = the first tile showing the
// curriculum, else one more tile.
//
//   lesson.mjs show <file.md> [--card <n|id>] [--new | --tile <n>]    put a lesson up (.md, 1MB at most)
//   lesson.mjs goto <n|id|next|prev>                                  the card that is up
//   lesson.mjs mark "<phrase>" | mark --clear                         light a phrase ON THE CARD and scroll to it: the teacher's pointer
//   lesson.mjs note "<markdown>" | note --clear                       a callout pinned over the card (not in the file)
//   lesson.mjs ask --q "<question>" [--opt "<text>"]… [--right <n>]… [--why "<text>"] [--id <id>]
//                                                                     a question appended to the card (not in the file); no --opt = free text
//   lesson.mjs look                                                   file, the card up, every card's asks WITH THE LEARNER'S ANSWERS, marks,
//                                                                     the note, the mol buttons they pressed, and `since`: what happened since the last look
//   lesson.mjs home                                                   back to the curriculum (curriculum.json of the focused session's folder)
//   lesson.mjs reset <file.md>                                        forget that file's answers
//   lesson.mjs tiles | close [--tile <n>]                             the tiles and what each shows; take one away (the last only goes home)
//   lesson.mjs lint <file.md>                                         parse only, NO TILE NEEDED: cards, ids, duplicate ids, asks with no right
//                                                                     answer, figs that do not resolve, unsourced cards, footnotes with no source,
//                                                                     mol lines that are not mol.mjs commands

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const BOOL = new Set(['new', 'clear', 'help'])
/** Flags that may be given several times. */
const MANY = new Set(['opt', 'right'])
const argv = process.argv.slice(2)
const flags = {}
const args = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const [k, inline] = a.slice(2).split(/=(.*)/s)
    const v = inline !== undefined ? inline : BOOL.has(k) ? true : argv[++i]
    if (MANY.has(k)) (flags[k] ??= []).push(v)
    else flags[k] = v
  } else args.push(a)
}
const [cmd, ...rest] = args

const HELP = `lesson.mjs — drive the deck's Lesson tile
  show FILE.md [--card N|ID] [--new]     goto N|ID|next|prev     home
  mark "PHRASE" | --clear     note "MARKDOWN" | --clear
  ask --q "QUESTION" [--opt "TEXT"]… [--right N]… [--why "TEXT"] [--id ID]
  look     reset FILE.md     tiles     close     lint FILE.md
TILES: several Lesson tiles (4 at most). --tile N on any command (default: the tile used last; answers carry "tile");
       show --new = the first tile showing the curriculum, else one more
look is how you learn what was answered: teach to THAT answer. lint needs no tile.`

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

/** A lesson file as an absolute path (the deck does not know this session's cwd). */
function file(f, what) {
  if (!f) fail(`${what} which file? e.g. \`${what} lessons/01-atoms-and-bonds.md\``)
  const p = f.startsWith('~/') ? join(homedir(), f.slice(2)) : f
  const abs = isAbsolute(p) ? p : resolve(process.cwd(), p)
  if (!/\.md$/i.test(abs)) fail(`a lesson is a .md file, not “${f}”`)
  if (!existsSync(abs)) fail(`no such file: ${abs}`)
  return abs
}

async function call(body) {
  if (flags.tile !== undefined) {
    if (!/^[1-9]\d?$/.test(String(flags.tile))) fail(`--tile wants a tile number (\`tiles\` lists them), not “${flags.tile}”`)
    body.tile = Number(flags.tile)
  }
  let res
  try {
    res = await fetch(`http://127.0.0.1:${port()}/lesson`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch (err) {
    fail(`no deck answering on port ${port()} (${err.message}). This only works from a session running inside the deck app.`)
  }
  if (res.status === 204) fail('this deck is older than the Lesson tile (it has no /lesson door): restart the deck')
  const out = await res.json().catch(() => ({ ok: false, error: `bad reply (HTTP ${res.status}); is this deck older than the Lesson tile?` }))
  console.log(JSON.stringify(out, null, 2))
  process.exit(out.ok ? 0 : 1)
}

if (!cmd || cmd === 'help' || flags.help) {
  console.log(HELP)
  process.exit(0)
}

switch (cmd) {
  case 'show':
    if (flags.new && flags.tile !== undefined) fail('--new opens (or finds) a free tile; --tile names one. Pick one.')
    await call({ op: 'show', file: file(rest[0], 'show'), card: flags.card, new: !!flags.new })
    break
  case 'goto':
    if (!rest[0]) fail('goto where? a card number, a card id, `next` or `prev` (`look` lists the cards)')
    await call({ op: 'goto', to: rest[0] })
    break
  case 'mark':
    if (!flags.clear && !rest.length) fail('mark what? a phrase as the card words it: mark "bent" (or mark --clear)')
    await call({ op: 'mark', phrase: rest.join(' '), clear: !!flags.clear })
    break
  case 'note':
    if (!flags.clear && !rest.length) fail('note what? some markdown: note "look at the **angle**" (or note --clear)')
    await call({ op: 'note', text: rest.join(' '), clear: !!flags.clear })
    break
  case 'ask':
    if (typeof flags.q !== 'string' || !flags.q.trim()) fail('ask wants --q "<the question>" (and --opt "<text>" … --right <n> for choices; none = a free-text answer)')
    await call({ op: 'ask', q: flags.q, options: flags.opt ?? [], right: (flags.right ?? []).map(Number), why: flags.why, id: flags.id })
    break
  case 'reset':
    await call({ op: 'reset', file: file(rest[0], 'reset') })
    break
  case 'lint':
    await call({ op: 'lint', file: file(rest[0], 'lint') })
    break
  case 'look':
  case 'home':
  case 'tiles':
  case 'close':
    await call({ op: cmd })
    break
  default:
    fail(`unknown command “${cmd}”.\n${HELP}`)
}
