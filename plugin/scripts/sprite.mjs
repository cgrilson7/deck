#!/usr/bin/env node
// sprite.mjs — put art into the places of the game on the deck's Game Boy: the overlay packs of
// lib/gbplaces.mjs, a runtime both ends step after every core step (docs/sprites/reports/skill-design.md
// §3). The lab of step 6 in embryo: two places, two arts.
//
//   sprite.mjs put <place> <art>      place: player | follower; art: foxtrot | blank (the follower only)
//   sprite.mjs clear <place|all>      what it painted stays until the game reloads those tiles (a map change)
//   sprite.mjs status                 per place: the pack and what the last step did (painted / kept / idle / battle)
//   sprite.mjs list                   the packs that are on
//   sprite.mjs foxtrot on [species]|off FOXTROT the species (lib/foxtrot.mjs): Eevee (or [species]) relabelled in the loaded ROM as the patch
//                                     set `foxtrot` — name, pictures, Pokédex page, coat, party icon; the deck re-applies it
//                                     after every state load and `off` puts the cartridge's bytes back
//   sprite.mjs build place <place> <art>   no door: print the place's compiled art as JSON (main's library calls this)
//   sprite.mjs build set foxtrot --rom <path> [--species s]   no door: print the patch set's writes, [[offset, base64]…]
//
// What `put` and `foxtrot on` install is KEPT by the deck (the `gbPlaces` / `gbPatches` settings + main's library
// under userData/pokemon/sprites), so a ⌘R or a restart puts it back; `clear` and `foxtrot off` let it go.
// `put` installs a pack NAMED AFTER THE PLACE holding that one place, so `clear <place>` takes exactly it.
// The door is the trainer's (lib/door.mjs): the deck's POST /gameboy (DECK_HOOK_PORT), or
// `--headless <rom> --dir <d>` for serverboy in this process (packs kept in <d>/overlays.json; trainer.mjs
// with the same --dir then steps them). In the deck the packs are in the renderer's memory only: a ⌘R
// (or a deck restart) drops them, and `put` again brings them back. Add --json for JSON out.

import { join } from 'node:path'
import { DeckDoor, HeadlessDoor } from './lib/door.mjs'
import { PLACES } from './lib/gbplaces.mjs'
import { ARTS } from './lib/packs.mjs'
import { readFileSync } from 'node:fs'
import { foxtrotPatch, foxtrotWrites, SET_FOXTROT } from './lib/foxtrot.mjs'

const argv = process.argv.slice(2)
const flags = {}
const args = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const k = a.slice(2)
    if (k === 'json') flags[k] = true
    else flags[k] = argv[++i]
  } else args.push(a)
}
const [cmd, ...rest] = args

const HELP = `sprite.mjs — art in the game's places (overlay packs)
  put <${PLACES.join('|')}> <${Object.keys(ARTS).join('|')}>     clear <place|all>     status     list     foxtrot on|off
  --headless <rom> --dir <d>   serverboy in this process instead of the deck     --json`

function die(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

function port() {
  if (process.env.DECK_HOOK_PORT) return Number(process.env.DECK_HOOK_PORT)
  const sock = (process.env.TMUX ?? '').split(',')[0]
  return sock.slice(sock.lastIndexOf('/') + 1) === 'deck' ? 47800 : 47801
}

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(HELP)
  process.exit(0)
}

if (cmd === 'build') {
  // Door-free compiling for main's library: JSON on stdout, nothing else.
  try {
    const [kind, what, art] = rest
    if (kind === 'place') {
      const entry = PLACES.includes(what) ? ARTS[art]?.().places[what] : null
      if (!entry) die(`build place: ${art} has nothing for ${what}`)
      console.log(JSON.stringify(entry))
    } else if (kind === 'set' && what === SET_FOXTROT) {
      if (!flags.rom) die('build set foxtrot: --rom <path>')
      const writes = await foxtrotWrites(new Uint8Array(readFileSync(flags.rom)), flags.species)
      console.log(JSON.stringify(writes.map(([o, b]) => [o, Buffer.from(b).toString('base64')])))
    } else die(`build: place <place> <art> | set ${SET_FOXTROT} --rom <path>`)
    process.exit(0)
  } catch (e) {
    die(e instanceof Error ? e.message : String(e))
  }
}

let door
if (flags.headless) {
  door = new HeadlessDoor(flags.dir ?? join(process.cwd(), '.trainer'))
  door.loadRom(flags.headless)
} else door = new DeckDoor(port())

const out = (obj, text) => console.log(flags.json ? JSON.stringify(obj) : text)

try {
  const ops = await door.ops()
  if (cmd === 'foxtrot') {
    // A patch set, not a place: the game itself draws him once the bytes are in.
    const species = rest[1]
    const on = rest[0] === 'on' ? true : rest[0] === 'off' ? false : die('foxtrot: on or off')
    if (!ops.has('patchset')) die('this Game Boy has no `patchset` op: the deck predates it — restart it (npm run dev / a new build)')
    const changed = await foxtrotPatch(door, on, species)
    out({ ok: true, set: SET_FOXTROT, on, changed }, on ? `FOXTROT is on (${changed} bytes): ${species ?? 'Eevee'} is Foxtrot from the next battle, Pokédex page or party menu on` : `FOXTROT is off (${changed} bytes back to the cartridge's)`)
    process.exit(0)
  }
  if (!ops.has('overlay')) die('this Game Boy has no `overlay` op: the deck predates the overlay runtime — restart it (npm run dev / a new build)')
  if (cmd === 'put') {
    const [place, artName] = rest
    if (!PLACES.includes(place)) die(`put: place is ${PLACES.join(' | ')}\n${HELP}`)
    const make = ARTS[artName]
    if (!make) die(`put: art is ${Object.keys(ARTS).join(' | ')}`)
    const entry = make().places[place]
    if (!entry) die(`put: ${artName} has nothing for the ${place}`)
    await door.call({ op: 'overlay', set: { name: place, art: artName, v: 1, places: { [place]: entry } } })
    out({ ok: true, place, art: artName }, `${place} = ${artName} (painted at the next step, and kept across a ⌘R; the game's own tiles come back only with clear + a map change)`)
  } else if (cmd === 'clear') {
    const [what] = rest
    if (!what) die('clear: a place, or all')
    const names = what === 'all' ? (await door.call({ op: 'overlay', list: true })).packs.map((p) => p.name) : [what]
    const removed = []
    for (const name of names) if ((await door.call({ op: 'overlay', clear: name })).removed) removed.push(name)
    out({ ok: true, removed }, removed.length ? `cleared ${removed.join(', ')} (the game's own sprites return at the next map load)` : 'nothing to clear')
  } else if (cmd === 'status') {
    const { places } = await door.call({ op: 'overlay', status: true })
    const lines = PLACES.map((p) => `${p.padEnd(9)} ${places[p] ? `${places[p].pack} · ${places[p].state}` : '— (the game\'s own)'}`)
    out({ ok: true, places }, lines.join('\n'))
  } else if (cmd === 'list') {
    const { packs } = await door.call({ op: 'overlay', list: true })
    out({ ok: true, packs }, packs.length ? packs.map((p) => `${p.name}: ${p.places.join(', ')}`).join('\n') : 'no packs')
  } else die(HELP)
} catch (e) {
  die(e instanceof Error ? e.message : String(e))
}
