---
name: mol
description: Show and annotate molecules in 3D on the deck's Molecule tile while you explain them — small molecules (water, methane, glycine, anything PubChem knows, a SMILES string) and proteins (a PDB id like 1UBQ, an AlphaFold model AF-<uniprot>, a local .pdb/.cif/.sdf). Use for "show me the molecule", "show me water / ubiquitin / 1UBQ", "visualize this", "what does X look like", "what does a hydrogen bond look like", "rotate it", "what did I click", "/deck:mol", any message that names a PDB id or asks to see a structure, and THROUGHOUT lessons in a chemistry / biochemistry / protein-folding repo (e.g. ~/grail), where a picture should go up with every new idea. There can be SEVERAL Molecule tiles at once, a scene each (`show … --new`, `--tile <n>`), so a lesson can keep water, ice and a protein up side by side. The CLI is `node "$DECK_MOL" show|style|compare|select|highlight|measure|label|view|look|list|clear|tiles|close`; `look` returns what is on screen AND which atoms the learner clicked. Only meaningful from a session running inside the deck app (it sets DECK_MOL and DECK_HOOK_PORT in every session's env) with the Molecule tile on; outside it there is nothing listening.
---

# Molecule — you explain, the deck shows

The learner is a visual one. When you say "water is bent", water should already be turning on
their screen with its charges labelled. The Molecule tile is a 3D viewer in the deck's grid (and
full size in the center column, ⌘⇧A); you drive it from your Bash tool, and you can *see* it:
`look` tells you what is showing and which atoms the learner clicked, and writes a PNG you can Read.

```bash
node "$DECK_MOL" show water --labels charges
```

Every command prints JSON. `{ "ok": true, … }` means it is on screen. `{ "ok": false, "error": … }`
says what to fix — read it, it is written for you.

## Rules

- **`$DECK_MOL` is the only door.** Do not `curl` RCSB or PubChem yourself, do not write an HTML
  viewer, do not render with matplotlib or py3Dmol: the tile exists, the deck fetches and caches
  structures for it, and the learner's eyes are already on it.
- **Outside the deck, say so.** If `$DECK_MOL` is unset, tell the user this needs a session
  started by the deck app, and carry on in words. Do not improvise a substitute.
- **Tile off?** The error says "turn on the Molecule tile": pass that on (the `+` picker in the
  grid, or View ▸ Molecule ▸ Show Molecule Tile), then run the command again.
- **Prefer the built-in library for small molecules** (`list`): it is instant, works offline, and
  carries partial charges. H₂, O₂, N₂, water, methane, ammonia, CO₂, NaCl (ion pair), methanol,
  ethanol, acetic acid, benzene, the hydrogen-bonded water dimer, glycine, alanine, Gly-Ala.
  Anything else by name goes to PubChem (also with charges); if a name fails, try `smiles:<…>`.
- **One idea per scene — and as many scenes as the lesson needs.** A `show` replaces its tile's
  scene; `show … --new` puts the molecule in a tile of its own and leaves the others up (see
  *Several tiles*). Use `--add` only when two molecules belong in ONE frame (the water dimer's
  partner, a ligand beside its pocket). Keep labels few: `--labels
  charges` on water is a lesson, on a protein it is refused (and would be noise).
- **Say what the picture cannot.** `--surface electrostatic` and `--color charge` paint
  *partial charges* (MMFF94 for small molecules, Amber-style per-residue for proteins): a
  cartoon of where the electrons sit, not a computed potential. `highlight --hbonds` is a
  geometric guess (the answer's `hbondMethod` says how). Tell the learner when it matters.

## Several tiles

The grid holds up to 8 Molecule tiles, each its own viewer and scene, numbered in their heads
("Molecule 2"). Use them the way a teacher uses a whiteboard: leave the thing you will refer back
to where it is, and put the next thing beside it.

```bash
node "$DECK_MOL" show methane --new --labels charges     # → "tile": 2   (an empty tile is reused before a new one opens)
node "$DECK_MOL" show water   --new --labels charges     # → "tile": 3
node "$DECK_MOL" style --tile 2 --surface electrostatic  # restyle methane; water is untouched
node "$DECK_MOL" look --tile 3                           # what they clicked ON WATER
node "$DECK_MOL" tiles                                   # every tile, what it shows, which is `current`
node "$DECK_MOL" close --tile 2                          # done with it
```

- Every answer carries `"tile"`. A command without `--tile` goes to the tile the door used last
  (`current` in `tiles`), so a `show --new` followed by bare `label` / `measure` lines annotates
  the new one. **Once two or more are up, pass `--tile` on everything** — the learner may have
  you talking about one while your last command touched another.
- Say which tile you mean in words too: "in Molecule 2, the carbon…". The number is in the head.
- `look` is per tile (`picked` is that tile's clicks; the PNG is that tile's). To find where the
  learner clicked when you do not know, `look` at each tile `tiles` lists.
- The learner can open and close tiles too (a + in a tile's head, the × on hover). If `--tile 2`
  answers "there is no Molecule tile 2", run `tiles` and carry on with what is there.
- **Clean up.** A comparison that is over → `close` its tiles. Eight is the ceiling (a WebGL
  context each), and a wall of stale molecules teaches nothing. Tiles and their scenes survive
  a reload of the deck.
- Side-by-side tiles are for CONTRAST (methane vs water, a helix vs a sheet, element colours vs
  charge colours of the same molecule); `compare` is for SUPERPOSITION of two structures of the
  same thing in one frame.

## The teaching loop

1. **Show** the thing, styled for the one idea: `show water --labels charges`.
2. **Annotate** what you are about to say: `label "elem O" "hogs the shared electrons: δ−"`,
   `measure 2 1 3` (the H–O–H angle: atom numbers come from `look`), `view --spin on`.
3. **Ask the learner to predict, and to point**: "click the atom you think another water's
   hydrogen would stick to."
4. **`look`** — `picked` lists what they clicked (oldest first, `p1`…`p4`), with element, residue,
   partial charge, B-factor or pLDDT. Respond to *that*: confirm, or show why not
   (`show water-dimer` then `highlight --hbonds`).
5. Read the `image` path from `look` when you need to check the scene actually shows what you
   think — a label over the wrong atom, a protein zoomed to nothing.

## Commands

```
show <target> [--style stick|ball-stick|sphere|line|cartoon|surface]
              [--color element|charge|hydrophobicity|residue|chain|secondary|plddt|bfactor|model]
              [--surface none|vdw|sas|electrostatic] [--labels none|atoms|charges|residues] [--add]
style  [--style …] [--color …] [--surface …] [--labels …]      restyle without reloading
compare <A> <B>             both loaded, B laid onto A (proteins: Cα matched by sequence), RMSD back
select <expr> | select none          sticks + a halo on the matches; also lights the sequence strip
highlight [--hbonds] [--contacts <Å>] [--select <expr>] | highlight --off
measure <a> <b> [<c> [<d>]] | measure --clear        distance (Å) / angle (°) / dihedral (°)
label <expr> "<text>" | label --clear                a callout pinned to those atoms (8 at most)
view [--zoom <expr>] [--spin on|off] [--reset]
look      list      clear      tiles      close
any of them: --tile <n>          show / compare: --new  (a tile of its own)
```

**Targets**: a library name · a 4-character PDB id (`1UBQ`, fetched from RCSB as mmCIF) ·
`AF-<uniprot>` (`AF-P0CG48`, AlphaFold DB; pLDDT is in the B-factor, so `--color plddt`) · a
molecule's name or `smiles:CCO` or `cid:2519` (PubChem's 3D conformer) · a structure file, path
relative to your cwd (`.pdb .cif .sdf .mol .mol2 .xyz .cube`). Everything fetched is cached:
the second `show 1UBQ` is instant and works offline.

**Defaults**: a small molecule shows as ball-and-stick in element colours; a protein as a
cartoon coloured by chain, its ligands as sticks, its waters hidden.

**Selections** (`select`, `--select`, `--zoom`, `label`, and a `measure` atom):
`resi 14,87` · `resi 10-20` · `chain A` · `resn HIS` · `elem O` · `atom CA` · `model 2` · `id 12`
· `protein` `water` `hetero` `backbone` `sidechain` `hydrogens` `helix` `sheet` `picked` `all`
· `within 5 of (resn HEM)` · `byres (…)` — joined with `and` / `or` / `not` and parentheses.
Quote the whole expression as one shell argument.

**Atoms for `measure`**: a number from `look` (`12`; with two models on screen, `2.12`), `p1`…`p4`
(the learner's picks — "measure what you clicked": `measure p1 p2`), or a selection that matches
exactly one atom (`"resi 48 and atom NZ"`).

**Colours, and what each one teaches**
- `element` — what the atoms are. `charge` — red δ−, blue δ+: polarity, why water sticks to itself.
- `hydrophobicity` — orange avoids water, blue seeks it: on a folded protein the orange is inside.
- `residue` — side-chain chemistry: oily, aromatic, polar, +, −, and Gly / Pro / Cys on their own.
- `secondary` — helix red, sheet yellow, loops grey. `chain` — one colour per chain.
- `plddt` — AlphaFold's per-residue confidence (blue sure → orange guess). `bfactor` — how
  restless each atom was in the crystal. `model` — one colour per structure (`compare`).

**The sequence strip** (the pane, proteins): the chain as one-letter residues in the active
colours, linked both ways with the 3D view — hovering a letter names the residue in 3D, clicking
picks it. It is the "1D string folds into a 3D shape" picture; point the learner at it, and use
`select "resi 1-7"` to light a stretch in both at once.

## Recipes

```bash
# a polar bond, then why it matters
node "$DECK_MOL" show water --labels charges
node "$DECK_MOL" show water-dimer --labels charges && node "$DECK_MOL" highlight --hbonds

# an amino acid, and the bond that chains them
node "$DECK_MOL" show glycine --labels atoms
node "$DECK_MOL" show gly-ala --labels atoms     # then `look`: its `atoms` list gives every atom's number, for label / measure

# a protein: fold, then what holds it
node "$DECK_MOL" show 1UBQ --style cartoon --color hydrophobicity
node "$DECK_MOL" highlight --hbonds
node "$DECK_MOL" style --style cartoon --color secondary --surface sas

# a contrast, side by side: why oil and water do not mix
node "$DECK_MOL" show methane --new --color charge --surface electrostatic     # note the "tile" each answers with
node "$DECK_MOL" show water   --new --color charge --surface electrostatic

# experiment vs prediction
node "$DECK_MOL" compare 1UBQ AF-P0CG48        # RMSD in the answer; then: style --color plddt
```

`compare` on `AF-P0CG48` is a good lesson in itself: that UniProt entry is *poly*ubiquitin, nine
copies in a row, and the crystal structure is one — the sequence match finds the first copy and
the rest hangs off it, low-confidence linkers and all.
