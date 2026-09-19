#!/usr/bin/env node
// The Molecule tile's CLI: how a Claude session teaching chemistry or protein structure DRIVES
// the deck's 3D molecule viewer while it explains — "here is water" and it appears, turns, gets
// its partial charges labelled — and SEES what the learner clicked (`look`). Talks to the deck's
// hooks server (`POST /mol`: main/hooks.ts → main/index.ts, which resolves any structure first —
// the built-in library, RCSB, AlphaFold DB, PubChem, a local file; cached under userData/mol —
// → the renderer's viewer, lib/mol.ts) on 127.0.0.1, port from DECK_HOOK_PORT, else from the tmux
// socket's name ($TMUX: deck → 47800, anything else → 47801). Its absolute path is DECK_MOL in
// every deck session's env. No dependencies; Node 18+. Every command prints JSON: { ok: true, … }
// or { ok: false, error } (exit 1) with a message that says how to fix it.
//
// THERE ARE SEVERAL MOLECULE TILES (8 at most), a scene each. Every command but `list` / `tiles`
// takes --tile <n>; without it, it goes to the tile the door used last (every answer carries
// `tile`). `show` / `compare` take --new: the first EMPTY tile, else one more tile.
//
//   mol.mjs show <target> [--style stick|ball-stick|sphere|line|cartoon|surface]
//                         [--color element|charge|hydrophobicity|residue|chain|secondary|plddt|bfactor|model]
//                         [--surface none|vdw|sas|electrostatic] [--labels none|atoms|charges|residues]
//                         [--add]                  add to the scene instead of replacing it
//       target: a library name (`list`) · a PDB id (1UBQ) · AF-<uniprot> · any molecule name or
//               smiles:<…> or cid:<n> (PubChem) · a structure file (.pdb .cif .sdf .mol .mol2 .xyz .cube)
//   mol.mjs style [--style …] [--color …] [--surface …] [--labels …]     restyle what is showing
//   mol.mjs compare <targetA> <targetB>            load both, lay B on A, colour by model; the RMSD
//   mol.mjs select <expr> | select none            "resi 14,87" · "chain A and resn HIS" · "elem O"
//   mol.mjs highlight [--hbonds] [--contacts <Å>] [--select <expr>] | highlight --off
//   mol.mjs measure <atomA> <atomB> [<atomC> [<atomD>]] | measure --clear
//                                                  distance / angle / dihedral, drawn + returned.
//                                                  an atom: its number from `look` (12, or 2.12 =
//                                                  model 2), p1…p4 (the user's picks), or a
//                                                  selection matching one atom ("resi 48 and atom NZ")
//   mol.mjs label <expr> "<text>" | label --clear  a teaching callout pinned to those atoms
//   mol.mjs view [--zoom <expr>] [--spin on|off] [--reset]
//   mol.mjs look                                   the scene as JSON — models, style, the user's
//                                                  PICKED atoms, measurements — and a PNG snapshot
//                                                  (its path is `image`: Read it to see the screen)
//   mol.mjs list                                   the built-in library + what is cached
//   mol.mjs clear                                  empty the tile's scene (the tile stays)
//   mol.mjs tiles                                  every Molecule tile and what it shows; `current` = where a bare command goes
//   mol.mjs close [--tile <n>]                     take a tile away (the last one is only emptied)

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const BOOL = new Set(['new', 'add', 'hbonds', 'reset', 'clear', 'off', 'help'])
const argv = process.argv.slice(2)
const flags = {}
const args = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const [k, inline] = a.slice(2).split(/=(.*)/s)
    if (inline !== undefined) flags[k] = inline
    else if (BOOL.has(k)) flags[k] = true
    // `--contacts` alone means the usual 4 Å.
    else if (k === 'contacts' && (argv[i + 1] === undefined || argv[i + 1].startsWith('--'))) flags[k] = true
    else flags[k] = argv[++i]
  } else args.push(a)
}
const [cmd, ...rest] = args

const HELP = `mol.mjs — drive the deck's Molecule tile
  show TARGET [--style S] [--color C] [--surface F] [--labels L] [--add]     style [--style …]
  compare A B     select EXPR|none     highlight [--hbonds] [--contacts Å] [--select EXPR] | --off
  measure A B [C [D]] | --clear     label EXPR "TEXT" | --clear     view [--zoom EXPR] [--spin on|off] [--reset]
  look     list     clear     tiles     close
TILES: several Molecule tiles, a scene each. --tile N on any command (default: the tile used last; answers carry "tile");
       show|compare --new = the first empty tile, else one more (8 at most)
TARGET: a library name (list) · 1UBQ · AF-P0CG48 · a molecule's name · smiles:CCO · cid:2519 · a file
styles: stick ball-stick sphere line cartoon surface      surfaces: none vdw sas electrostatic
colors: element charge hydrophobicity residue chain secondary plddt bfactor model      labels: none atoms charges residues
EXPR: resi 14,87 · resi 10-20 · chain A · resn HIS · elem O · atom CA · model 2 · protein · water · hetero
      · backbone · sidechain · helix · sheet · picked · within 5 of (…) · byres (…) — with and / or / not`

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

/** A target that names a file on disk goes as an absolute path (the deck does not know this session's cwd). */
function target(t) {
  if (!t) return t
  const p = t.startsWith('~/') ? join(homedir(), t.slice(2)) : t
  if (isAbsolute(p)) return p
  if (/\.(pdb|ent|cif|mmcif|sdf|mol|mol2|xyz|cube)$/i.test(p) || p.startsWith('./') || p.startsWith('../')) {
    const abs = resolve(process.cwd(), p)
    if (existsSync(abs)) return abs
    fail(`no such file: ${abs}`)
  }
  return t
}

async function call(body) {
  if (flags.tile !== undefined) {
    if (!/^[1-9]\d?$/.test(String(flags.tile))) fail(`--tile wants a tile number (\`tiles\` lists them), not “${flags.tile}”`)
    body.tile = Number(flags.tile)
  }
  let res
  try {
    res = await fetch(`http://127.0.0.1:${port()}/mol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch (err) {
    fail(`no deck answering on port ${port()} (${err.message}). This only works from a session running inside the deck app.`)
  }
  const out = await res.json().catch(() => ({ ok: false, error: `bad reply (HTTP ${res.status}); is this deck older than the Molecule tile?` }))
  console.log(JSON.stringify(out, null, 2))
  process.exit(out.ok ? 0 : 1)
}

const looks = { style: flags.style, color: flags.color ?? flags.colour, surface: flags.surface, labels: flags.labels }

if (!cmd || cmd === 'help' || flags.help) {
  console.log(HELP)
  process.exit(0)
}

switch (cmd) {
  case 'show':
    if (!rest.length) fail('show what? e.g. `show water`, `show 1UBQ --style cartoon`. `list` has the built-in library.')
    // An unquoted two-word name ("acetic acid") is still one target.
    if (flags.new && flags.add) fail('--new opens a tile of its own; --add joins the scene of an existing one. Pick one.')
    await call({ op: 'show', target: target(rest.join(' ')), add: !!flags.add, new: !!flags.new, ...looks })
    break
  case 'style':
    if (!Object.values(looks).some(Boolean)) fail('style wants at least one of --style --color --surface --labels')
    await call({ op: 'style', ...looks })
    break
  case 'compare':
    if (rest.length !== 2) fail('compare wants two targets: `compare 1UBQ AF-P0CG48`')
    await call({ op: 'compare', a: target(rest[0]), b: target(rest[1]), new: !!flags.new, ...looks })
    break
  case 'select':
    await call({ op: 'select', expr: rest.join(' ') })
    break
  case 'highlight':
    await call({ op: 'highlight', hbonds: !!flags.hbonds, contacts: flags.contacts ?? null, select: flags.select, off: !!flags.off })
    break
  case 'measure':
    await call({ op: 'measure', atoms: rest, clear: !!flags.clear })
    break
  case 'label':
    if (!flags.clear && rest.length < 2) fail('label wants a selection and a text: label "elem O" "oxygen pulls the shared electrons its way"')
    await call({ op: 'label', expr: rest[0], text: rest.slice(1).join(' '), clear: !!flags.clear })
    break
  case 'view':
    if (flags.zoom === undefined && flags.spin === undefined && !flags.reset) fail('view wants --zoom <expr>, --spin on|off, or --reset')
    await call({ op: 'view', zoom: flags.zoom, spin: flags.spin === undefined ? undefined : flags.spin === true || /^(on|true|1|yes)$/i.test(String(flags.spin)), reset: !!flags.reset })
    break
  case 'look':
  case 'list':
  case 'clear':
  case 'tiles':
  case 'close':
    await call({ op: cmd })
    break
  default:
    fail(`unknown command “${cmd}”.\n${HELP}`)
}
