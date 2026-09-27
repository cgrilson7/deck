# Sprites: drawing our own pictures into Pokémon Yellow, from the deck

The direction note for the sprites work — what four research tracks established on 27 Sept 2026
(reports in `docs/sprites/reports/`, evidence in `docs/sprites/evidence/`, tools in
`docs/sprites/tools/`), and the framework that follows from it. Nothing here is built yet except
what the Trainer rule in CLAUDE.md already describes (the sprite gag).

## The short answer to "are they transparent PNGs?"

Nothing in the cartridge is a PNG and nothing has an alpha channel. Every picture is 8×8 tiles of
2 bits per pixel: four shades, numbered 0–3, and the shade's colour comes from a palette the SCREEN
assigns to the rectangle the picture sits in, never from the picture. Whether shade 0 is see-through
depends on how the picture is shown:

- **Background tiles are opaque.** Battle pictures, trainer pictures, the player's pictures, the
  Pokédex picture, the trainer card, the title screen: shade 0 is painted as the palette's colour 0,
  which every palette the game uses makes white. It only *looks* transparent because the paper is
  white too. Author these on a white (or alpha) background mapped to shade 0. One trap: in the battle
  intro both pictures slide in as silhouettes with shades 1–3 black, so a white pixel INSIDE the
  figure (an eye, a highlight) shows as a hole.
- **Hardware sprites are transparent at shade 0.** Overworld people, the follower Pikachu, party-menu
  icons, emote bubbles, and the top rows of the player's back picture while it slides in. And in the
  overworld the palette register makes shade 1 white too, so an overworld figure has three visible
  shades plus transparent. White inside a fox must be shade 1.

So a PNG is only our authoring format: RGBA in, four shades out, per place.

## What was established (the facts the framework rests on)

**The cartridge is pret's build, byte for byte.** Colin's ROM has the same SHA-1 as pret's
`pokeyellow.gbc`, so pret's symbol and linker-map files (the `symbols` branch of
github.com/pret/pokeyellow) give an exact file offset for every label and an exact list of free
space. A CLI should still check a few signature bytes before patching, but nothing has to be found
by scanning any more. `tools/symoff.mjs` turns a label into an offset.

**The picture codec is ported and exact.** `tools/pic.mjs` (236 lines) is the Gen-1 compressor and
decompressor from `tools/pkmncompress.c`. All 357 pictures in the ROM decompress and recompress
byte-identical, the same as pret's C tool compiled locally. There is no uncompressed mode: noise
compresses to more than raw. Typical sizes: a 7×7 picture 50–599 bytes (median 439), the Notes icon
127, Village 501 because of its dithering, a back picture 57–198.

**Free space is known.** 60 runs, 160,828 bytes, all zero (`tools/free.json`). The picture banks are
tight: 197–683 bytes in the five Pokémon-picture banks, 230 in the trainer bank. The sprite gag
already uses runs in banks $27 and $2F, the home bank's tail, and the RST area at $0010; an
allocator must know these. Do not scan for zero runs: 46 KB of real data is zeros.

**The sizes, per place.**
- Mon front pictures are 5×5, 6×6 or 7×7 tiles, bottom-aligned and centred in the 7×7 block, stored
  column-major. The bank is chosen in code by the species' internal id, so a replacement must stay
  in its species' bank (or overwrite the old picture in place when it is no bigger).
- **Every back picture is 4×4 tiles, and the game drops 4 pixels off the right and bottom and
  doubles the remaining 28×28 to 56×56.** Back art should be authored at 28×28: it matches the
  game and is a quarter of the work. A VRAM poke can still carry full 56×56 detail (what the gag
  does) but it is gone at the next reload.
- Trainer pictures are all 7×7 in bank $13, drawn in PAL_MEWMON (the game's red-and-yellow default,
  also used by the trainer card, the party menu and generic screens, so patching that palette is
  global). Red's back picture and head slide in with 15–21 hardware sprites copied from the same
  tiles, so a full replacement of Red writes $9310 AND $8000.
- Overworld sheets are raw 2bpp, 384 bytes: six 16×16 frames (stand down / up / left, walk down / up
  / left), right and the second walking frame made by flipping. Red, the bike, the surfing Seel and
  the follower Pikachu each have one; all NPCs share the one OBJ palette, so the follower is not
  yellow in the overworld and a fox in his own colours needs a code patch or the live palette write.
- Party icons are one icon per CLASS (not species), 16×16, two frames, and every icon but the Helix
  is drawn from its left half mirrored: a Foxtrot icon must be a symmetric front view. Pikachu's icon
  borrows the follower's sheet, so patching one changes both.
- The Pokédex shows the species' front picture mirrored, with tile columns laid right to left; there
  are no footprints in Yellow. Text entries live in bank $10, which has 8,326 free bytes.

**What survives what.** Patches into the loaded ROM image last until the cartridge is reloaded (a
ROM pick, reset, ⌘R). **A save state carries the whole ROM image**, so a state saved with patches on
brings them back on load even with the overlay off; this already applies to the sprite gag's text,
move and trainer patches in any `userData/pokemon/*.state` saved while it ran. The rule that follows:
after every ROM load, every state load and every toggle, rewrite EVERY overlay's byte ranges, patched
for the ones that are on and the file's original bytes for the ones that are off. Battery saves never
contain ROM, but they keep derived facts (a nickname, dex bits, a species id).

**Writes drop, and there is a fix.** serverboy drops a VRAM write when the LCD is in mode 3 and reads
$FF then; headless, a step ended in mode 3 a third of the time and a plain 192-byte write landed whole
in 130 of 200 tries. Forcing the core's STAT mode to 0 around its own writer (and naming the VRAM bank)
landed 200 of 200 and keeps the tile cache right. The core also exposes direct palette writers that do
not touch the game's palette pointer. A per-step keep hook inside the emulator's loop costs about
30µs per step. These three facts are what make an in-renderer runtime cheap and a headless preview
exact.

**Verified, permanent (loaded-ROM) replacements, headless with screenshots:** a trainer's picture
(Youngster → Notes), Red's back (a 28×28 Foxtrot in every battle intro), Red's front on the trainer
card, a species' front picture with its size byte, Red's and the follower's overworld sheets in place
(both foxes after the next map load), Vulpix relabelled FOXTROT with his own name, pictures, Pokédex
entry and palette (the unused `PAL_0F`), and a 21-byte hook plus a 47-byte table that lets each
trainer class take its picture from any bank (Giovanni wore the 501-byte Village from bank $3D while
Youngster loaded normally). The dex page's height and weight printed as `?` in that run; the entry's
number bytes need a second look.

**A 152nd species is out.** Its base-stats entry would land on the cry table, and a caught one becomes
a glitch Pokémon in the battery save the moment the patch is not applied. Relabelling Vulpix (dex 37,
its species line already says FOX) is safe: to an unpatched ROM a caught FOXTROT is a Vulpix with a
nickname. Eevee is the alternative.

**Drawing.** Before the pack was redirected to framework-only, one track drew a few sprites as
evidence and painted them into the game headless: a Foxtrot from behind at 28×28 (four passes; it
sits beside Gen-1 backs without looking out of place — `evidence/foxback-*`), 16×16 overworld frames
facing down (good first try) and up (fair), and a generic bearded bust at 56×56 (three passes). A text
grid of four symbols, one line per row, was the representation that worked; mistakes were row-length
slips a converter must reject, not judgment. Direct photo quantization gives a preview, not trainer
art: a likeness needs a photo → Gemini stylization → post-process → a cleanup pass by hand.
Measured over all 47 trainer pictures: about 72% white, bottom-anchored, black is the line (~13%), the
greys are fills, dithering only as 2×2 checker texture in hair and fabric.

## The framework

Five layers, each one a thing a session can run on its own.

### 1. Authoring: a text grid is the source of truth

One file per frame: a header line (place, size, palette request), a legend, then rows of `.:+#`
(shades 0–3) at the place's exact size. Back pictures at 28×28, front and trainer at 56×56,
overworld frames at 16×16, icons as a 8×16 left half. The CLI validates width, height and characters
and prints a ruler when it rejects. Sugar that compiles to the same grid: `mirror` (a left half plus
overrides) and `shapes` (ellipses and polygons for blocking a silhouette, then refined by hand). The
preview is the grid at 8× in greys and in the place's palette with a faint tile grid, and a 1× in-game
shot from layer 3. Every drawing carries a palette request (four colours), because the colours are
the place's, not the picture's.

### 2. Conversion: four sources, all ending in a grid

- **The fox sheet** (exists: `scripts/sprites.mjs`): side views only. Front, back and up views cannot
  be derived from it; the sheet is the colour and marking reference for drawn ones.
- **An icon** (exists: Village and Notes).
- **A photo**: crop, subject mask, area-average, quantize over the subject only, force a rim. Good
  for a preview; the likeness pipeline goes through Gemini.
- **Gemini via the Studio**: ask for the smallest size (512), a flat white background for background
  places (flood-fill from the border; the outline stops the fill) or a green or magenta key for
  hardware-sprite places (the reply is JPEG, so no alpha); then find the model's pixel pitch, downsample
  by majority vote per cell, snap to four shades, force the rim, emit a grid for cleanup. The prompt
  template is in the drawing report; it needs two or three real generations to tune.

### 3. Testing: headless first, always

`fixture <place>` builds a named headless save state that shows the place (bedroom, wild battle,
trainer intro, party menu, Pokédex, trainer card; the formats track left a set in its scratch folder,
and a battle can be forced cheaply by poking `wCurOpponent` in the overworld). `try <place> <grid>`
loads the fixture, applies the art through THE SAME runtime code the deck uses, settles, screenshots,
and crops the place's box at 6–8× beside the 1× shot. Measured: 0.2 s wall-clock per iteration
including node start-up; the slow part is the model looking. Three pitfalls the loop handles: tiles
reload after a state load (paint after a settle), fades undo palette writes (renew before the shot),
and fixtures made from another session carry that session's ROM patches (build fixtures from a clean
image and say what they carry). Only after `try` does `put` touch the live game.

### 4. Runtime: places, patch sets, looks — in the renderer, no child process

The renderer's emulator loop gets one `stepCore()` that every core step goes through (the free-running
loop, a door job's step, the run-at-once path; HeadlessDoor's `step()` calls the same module), and after
each step a runtime walks a table of active PLACES: a fixed vocabulary in code, each with a `when`
(the predicates the gag already verified: block whole, HUD up, "sent out" in the text box, in a
battle or not) and a `keep` (compare, then write only on difference, through the forced-mode VRAM
writer and the direct palette writers). Overlay packs are DATA compiled by the CLI (frames as bytes,
timings, a palette); no session code runs in the renderer. Places to start with: `player`, `follower`,
`enemyFront`, `enemyTrainer`, `playerBack`, `trainerBack`, `enemyName`, `playerName`, `battleMoves`;
then the permanent ones (`dexEntry`, `trainerCard`, `partyIcon`, the player's pictures), which are
PATCH SETS rather than per-step work.

A PATCH SET is a named, reversible list of `[offset, new bytes, original bytes]`, bound to the
cartridge by its originals and reconciled against a pristine copy of the ROM after every load, state
load and toggle. The gag's "A boring", the quiz moves, the Bug Catchers and the player name become
patch sets; the pictures' permanent replacements are patch sets too. A LOOK is a preset over places
and patch sets ("Village vs Notes", "Foxtrot"). Settings become a place → art map plus a list of patch
sets; `spriteGag: true` migrates to the Village-vs-Notes look.

New door ops, on both ends: `vram` (bank-explicit, mode-safe), `oam` (read only: the game rebuilds OAM
every frame), `palette`, `patchset`, `overlay`, and `info.ops` so a new CLI can feature-detect an older
running deck. No `tiles` op: PNG decoding and layouts stay in the CLI.

### 5. Surfaces

The Pokemon pane's `gag` pill becomes a `sprites` popover (a row per place, checkboxes for patch sets,
the looks as buttons); View ▸ Pokemon ▸ Sprites holds the looks; the CLI has
`sprite status | places | arts | looks | new | check | preview | convert | fixture | try | put | clear |
look | patch | add`, with `put`/`clear`/`look`/`patch`/`add` answered by main itself (it owns settings
and userData). Art lives in `plugin/data/sprites/` when shipped and `userData/sprites/art/` when made
in a session (Colin's portrait never enters the repo); compiled packs in `userData/sprites/packs/`.
The skill, `plugin/skills/sprites/SKILL.md`, is a drawing session's guide: the places and their
constraints, the loop, the safety rules (never the ROM file, never a save, headless first, transient
and named patch sets only).

## Build order (each step leaves the app working)

1. **Door ops, old loop.** Add `vram`, `oam`, `palette`, `info.ops` to both ends from one shared pure
   module; the gag's helpers use them when present. Fixes dropped writes, the bank hazard and the
   palette-pointer collision at once; about a third of the requests.
2. **Patch sets.** The pristine copy, `patchset`, reconcile on mount and on every state load. Fixes the
   states already saved with the gag on. The 2 s renewal clock goes.
3. **Runtime with the overworld places** (`player`, `follower`): the simplest predicates, the most
   visible win, and "Foxtrot where Pikachu is" falls out of it.
4. **Battle places**, with a headless parity test: the same battle script through the old watch and
   the new runtime, screenshots compared at fixed step counts.
5. **Settings, pane, menu, looks**; delete `src/main/spritegag.ts`.
6. **The CLI stays the lab**: `sprite try` and `sprite watch --rules` for prototyping a place the
   runtime does not have yet; promotion is copying the rule into the registry.

Roughly +850 / −130 lines for steps 1–5. Step 1 pays for itself even if the rest waits.

## Decisions taken (Colin, 27 Sept 2026)

- **FOXTROT is Vulpix** (dex 37). And Colin wants a level-1 Vulpix of his own, in Bill's PC, so
  he can meet Foxtrot without hunting Route 7: a forge job (a box lives in the battery save, so that
  one write to a save is on his word, once, and reported).
- **Back pictures are 28×28 doubled, permanent.** Authored at 28×28; patched once; no repaint loop.
- **Overworld coat by the live palette write, for now**, through the core's direct palette writer.
  The palette-engine code patch (bank $1C) stays an option.
- **One shared runtime module**: `plugin/scripts/lib/gbcore.mjs` (pure JS) imported by both the
  headless door and the renderer, with a hand-written `gbcore.d.mts`. A first cross-import, chosen
  because headless parity is the whole authoring story.
- **A likeness of Colin goes through Gemini**: his photo as a reference image, under his key, kept in
  userData/sprites and never in the repo.
- **FOXTROT gets a new symmetric front-view party icon** (an 8×16 left half, two frames) in a free
  icon slot; Vulpix's class nybble points at it.
- **Settings are places + patch sets + looks** (`gbPlaces`, `gbPatches`, shipped looks);
  `spriteGag: true` migrates to the village-vs-notes look.
- **Build starts with steps 1 and 2** (door ops, then patch sets with reconcile), the old watch
  running on top.

## Files

- `docs/sprites/reports/formats.md` — the hardware and format layer, the catalogue of places.
- `docs/sprites/reports/rom-patching.md` — tables, free space, the codec, the verified patches.
- `docs/sprites/reports/drawing.md` — the authoring representation, pipelines, test loop, style checklist.
- `docs/sprites/reports/skill-design.md` — the door ops, the runtime, settings, the skill, the migration.
- `docs/sprites/tools/pic.mjs` (the codec), `free.json` (the 60 free runs), `symoff.mjs` (label →
  offset; needs `pokeyellow.sym` from pret's `symbols` branch beside it), `grid.mjs` (grid → PNG).
- `docs/sprites/evidence/` — the screenshots named above.
