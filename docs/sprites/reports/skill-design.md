# Track D — the seams in the deck for a "sprites" skill and CLI

Status: complete.

Sources read: plugin/scripts/lib/door.mjs, src/renderer/src/lib/gameboy.ts, src/main/spritegag.ts,
plugin/scripts/trainer.mjs, plugin/scripts/lib/sprites.mjs, src/main/index.ts (gameboyCall + hooks
wiring), src/main/hooks.ts, src/main/settings.ts, src/shared/types.ts (DeckSettings),
src/renderer/src/components/PokemonPane.tsx, src/main/menu.ts, and serverboy's core
(node_modules/serverboy/src/gameboy_core/gameboy.js, saveState.js).

## 1. What the deck has today (audit)

### The door protocol, two ends
- Ops are the same on both ends: `info ram poke patch hold settle screen save load speed pause rom`
  (plugin/scripts/lib/door.mjs:5-19; HeadlessDoor.call door.mjs:146-202; renderer `driveNow`
  src/renderer/src/lib/gameboy.ts:494-629). `speed`/`pause` are no-ops headless (door.mjs:196-198).
- Every VRAM/palette touch the sprite gag makes goes through the GENERIC `poke`/`ram` ops, i.e. the
  core's CPU-side `memoryWrite`/`memoryRead` (door.mjs:156-161, gameboy.ts:509-516, 449-454). Those
  obey the LCD: serverboy drops a VRAM write when `modeSTAT >= 3` (gameboy.js:4197-4216,
  4218-4236 in node_modules/serverboy/src/gameboy_core) and reads return $FF then (gameboy.js:3824-3838);
  OAM is refused in modes 2–3 (gameboy.js:3812, 4163-4169). Hence sprites.mjs's read-back-and-retry
  (`readVram`/`pokeVram`, TRIES = 24, plugin/scripts/lib/sprites.mjs:777-798) and, in the deck, a
  6ms `setTimeout` between tries because a `hold` would steal the player's keys (sprites.mjs:779).
- `patch` writes `core.ROM[]` (and `core.memory[]` for bank 0) — both ends identical
  (door.mjs:162-174, gameboy.ts:517-532).
- The renderer serializes EVERY door request on one promise chain (gameboy.ts:487-492) and a
  `hold`/`settle` is a job paced by the rAF loop, 8ms of real time per step (gameboy.ts:456-478).

### How the sprite gag runs now
- Main spawns `trainer.mjs sprite watch --moves <set>` as a child with Electron-as-node
  (src/main/spritegag.ts:76-105), following `spriteGag` / `spriteGagMoves` (spritegag.ts:37-51;
  wired at src/main/index.ts:509-514, killed at index.ts:775). Restart after 2s, give up after 5 a
  minute (spritegag.ts:14-17, 107-123).
- The watch loop (plugin/scripts/trainer.mjs:356-385) every 20ms (`SPRITE_POLL_MS`, trainer.mjs:137):
  `S.apply` (battle pictures, names, palettes, the species-palette ROM entry), every ≥2s in a battle
  re-`patch`es ALL text/move/trainer patches (trainer.mjs:364-369; "a state load restores the whole
  ROM"), `S.quizMoves` (battle-copy moves + PP pokes), and with `--foxtrot` `S.overworld`.
- Each hop is HTTP → main (`gameboyCall`, index.ts:281-302, 15s budget) → IPC → renderer → IPC →
  main → HTTP. Counting the calls in `apply`/`overworld`/`notesRom` (sprites.mjs:925-971, 742-766,
  894-923, 860-882): ~6 requests per poll on the map with Foxtrot, ~8–12 in a battle, i.e. roughly
  300–600 requests/s through main while the gag is on (READ, not measured).

### Defects and seams found (the reasons to move)
1. **Mode-3 drops are the common case, not the edge.** Headless, over 2000 steps from the bedroom,
   the core ended a step in STAT mode 3 35.5% of the time (modes 0/1/2/3 = 836/130/323/711).
   A naive 192-byte `memoryWrite` to $8000 landed whole in 130/200 attempts. (VERIFIED,
   research/skill-design/exp.mjs.)
2. **VRAM bank hazard.** A `poke` goes to whatever VRAM bank the game has selected at the step
   boundary (`VRAMGBCDATAWrite` honours `currVRAMBank`, gameboy.js:4197-4216). Yellow selects bank 1
   (the BG-map ATTRIBUTES) in `LoadBGMapAttributes` (pokeyellow engine/gfx/bg_map_attributes.asm:18-20,
   back to 0 at :102) and VBlank saves/restores it (home/vblank.asm:8-11, 76). A gag poke landing in
   that window writes tile bytes into bank 1. Rare, never observed; READ.
3. **The palette pokes move the game's palette pointer.** `setBgPalette`/`foxPalette`/`bgByte`
   write BCPS/OCPS then BCPD/OCPD (sprites.mjs:702-706, 860-869). Yellow uploads a palette with the
   LCD on one colour per H-blank wait (`TransferCurBGPData`, pokeyellow engine/gfx/palettes.asm:845-867),
   which can straddle a step boundary; if our BCPS write lands mid-upload, the game's remaining bytes
   go to OUR index. The core exposes `updateGBCBGPalette(index, byte)` / `updateGBCOBJPalette`
   (gameboy.js:2301-2330) which write the palette RAM directly without touching BCPS/OCPS.
   VERIFIED: writing OBJ palette 0 that way gave Foxtrot his coat and left OCPS unchanged
   (research/skill-design/exp2.mjs, palette-direct.png).
4. **The gag stalls whenever a trainer session drives.** Door requests are serialized
   (gameboy.ts:487-492) and a `hold` of N steps holds the chain for N×8ms. A `walk`/`advance`/`fight`
   of a few hundred steps means the watch's 20ms polls queue for seconds, and the game's own redraws
   (send-outs, the move list's screen restore) show the real pictures meanwhile. READ.
5. **A save state carries the patched ROM.** `saveState()` serializes `this.ROM` and
   `returnFromState` replaces it (serverboy saveState.js:3, 215). VERIFIED headless: set a ROM byte,
   `save`, change it, `load` → the byte saved comes back (exp2.mjs). So "a state load brings the
   original back" (CLAUDE.md, door.mjs:9) is only true for states saved WITHOUT the gag; any state
   in userData/pokemon/ saved while the gag ran now loads with Bug Catchers, APP type, the fired line
   etc. even with the gag off, and nothing reverts them (the CLI only reverts when called with
   `on=false`, sprites.mjs:589-633, which nothing calls).
6. **Foxtrot is not reachable from the toggle.** SpriteGag spawns without `--foxtrot`
   (spritegag.ts:80); only a hand-run CLI gets him.
7. **Doc drift:** CLAUDE.md says the default moveset is the first ("update"); the setting's default
   is `download` (src/shared/types.ts:727, spritegag.ts:38).

### What an in-core write costs (measured)
- Forcing `modeSTAT = 0` (and the wanted bank through the VBK writer, `memoryWriter[0xFF4F]`,
  gameboy.js:4987-4995) around the core's OWN writer, then restoring both, landed 200/200 and keeps
  serverboy's tile cache right (the writer calls `graphicsJIT` + `generateGBCTileLine…`). The
  screen shows it the next step (keep-hook.png: Foxtrot in Red's cells, bedroom).
- A per-step hook that reads the 360-byte tile map + `wIsInBattle` and keep-checks Red's two 192-byte
  blocks, rewriting when not ours: 129µs/step vs 99µs bare in node (8 interleaved rounds of 500
  steps, bench.mjs) → ~30µs/step, ≈4ms per real second at 1×, ≈15ms/s at 4×. Negligible.
- Direct reads for VRAM/OAM need no retry either: bank 0 tiles are `memory[0x8000..0x97FF]`, bank 1
  `VRAM[addr & 0x1FFF]`, the maps `BGCHRBank1/2[addr & 0x7FF]` (gameboy.js:3824-3838), OAM
  `memory[0xFE00..0xFE9F]` (OAM read headless: Red = y76 x72 tiles 8–11 attr 0).

## 2. Door ops to add (both ends, HeadlessDoor at parity)

All of these are between-steps operations on the core, so they need NO tick integration to be
correct: the forced-mode write works in `driveNow` just as it did in exp.mjs. The "inside the tick"
part is only needed for KEEPING bytes (section 3). Line counts are per end unless stated; the two
ends should share one helper module (below).

| op | shape | why | cost | risk |
|---|---|---|---|---|
| `vram` | `{ writes: [[addr, b64, bank?]], reads: [[addr, len, bank?]] }` → `{ data }` | mode-3-safe, bank-explicit writes and reads of $8000–$9FFF; ends `readVram`/`pokeVram`'s 24 retries and the bank hazard | ~30 lines helper (shared) + ~8 per end | low: it is the core's own writer; worst case a one-frame tear (graphicsJIT renders the queued lines first) |
| `oam` | `{}` → `{ data: b64(160) }` (+ optional `writes`, forced like `vram`) | see where the game put Red / Pikachu / NPCs (tile, attr, flip, palette) — needed to target a place by its OAM entry rather than a fixed tile range, and for debugging | ~10 | none for reads; writes are pointless (the game rebuilds OAM every VBlank: `PrepareOAMData` + `hDMARoutine`, pokeyellow home/vblank.asm:34-38) — offer reads only |
| `palette` | `{ bg?: [[i, [c0,c1,c2,c3]]], obj?: [[i, cols]] }` (BGR555 or `#rrggbb`) → `{ bg: b64(64), obj: b64(64) }` | through `updateGBCBGPalette/updateGBCOBJPalette`, never touching BCPS/OCPS (fixes defect 3); one call instead of 17 pokes | ~25 shared + ~5 | low |
| `tiles` (PNG/shades in) | — | NOT recommended: it would put PNG decoding and the column-major/row-major layouts into both ends. Keep conversion in the CLI (sprites.mjs `tilesOf`/`foxFrames` already do it) and send bytes through `vram` / an overlay pack | (60+ ×2 saved) | — |
| `patchset` | `{ name, writes: [[off, b64 new, b64 orig]] }` / `{ name, off: true }` / `{ list: true }` | named, REVERSIBLE ROM patches bound to the cartridge by their originals (refused if `orig` ≠ the pristine byte); the end keeps a pristine copy of the ROM (the renderer already has `bytes` in `load`, gameboy.ts:342) and re-applies wanted sets / reverts unwanted ones after EVERY state load and mount (fixes defect 5, drops the 2s ROM_RENEW clock, sprites.mjs:891) | ~70 shared + ~10 per end | medium: bounds-check offsets, cap total bytes (64K), cartridge binding by `orig` |
| `overlay` | `{ set: <pack> }` / `{ clear: name }` / `{ list: true }` / `{ status: true }` | installs a compiled overlay into the per-step table (section 3) | ~40 per end + the runtime | medium (it is the runtime) |
| `info` | add `ops: [...]`, `runtime: version` | lets the CLI feature-detect so a new CLI works against an old running deck (fall back to poke+retry) | ~2 | none |

Where the shared code lives: a pure ES module `plugin/scripts/lib/gbcore.mjs` (no `Buffer`, no fs:
`Uint8Array` in, out) holding `vramWrite/vramRead/oamRead/paletteSet/paletteRead/patchsets` and the
overlay runtime, imported by door.mjs directly and by gameboy.ts through a relative import with a
hand-written `gbcore.d.mts`. Nothing in src/ imports from plugin/ today (checked: no such import),
and tsconfig.web.json includes only src/ — so this is a first; the alternative is the repo's usual
"MIRRORS … keep them in step" duplication (as `molBody` does for mol.mjs). The shared module is
worth it here because HEADLESS PARITY is the whole authoring story: a preview that runs a different
runtime than the deck is a preview of nothing. (Open question for the alpha.)

## 3. The runtime: a per-step overlay table in the renderer

The shape: after EVERY core step — the free-running loop (gameboy.ts:304-311), a door job's step
(`runJobStep`, gameboy.ts:456-467) and the "no view, run at once" path (gameboy.ts:473-476), and
headless `step()` (door.mjs:133-136) — call `runtime.step(core, now)`. Put the two renderer call
sites behind one `stepCore(keys)` so none is missed.

```
runtime.step(core, now):
  ctx = { core, now, inBattle: read(wIsInBattle), map: lazy(read wTileMap 360), walk: read(wWalkCounter) }
  for place of ACTIVE (in PLACES order):
    if place.when(ctx) → place.keep(ctx, art)          // compare, then vramWrite / palette / wram only when not ours
  after a state load / ROM mount → patchsets.reconcile(core)   // wanted sets on, every other known set's bytes back to pristine
```

An OVERLAY PACK is DATA, compiled by the CLI (it knows PNGs and can read the cartridge file to find
tables by content, as sprites.mjs does today, sprites.mjs:580-586); the runtime is a fixed
vocabulary of PLACES written in code. No expressions, no session code in the renderer.

```jsonc
// userData/sprites/packs/foxtrot.json  (a pack may fill several places)
{ "name": "foxtrot", "v": 1, "cart": "sha1 of the ROM file",
  "places": {
    "player":      { "frames": { "idle": ["<b64 192>", …], "run": [ … ] }, "ms": { "idle": 280, "run": 69 },
                     "palette": { "obj": 0, "colours": ["#ffffff", "#ffffff", "#d67941", "#2f2f2e"] } },
    "follower":    { "blank": true },
    "trainerBack": { "frames": ["<b64 784>", …], "ms": 280, "palette": { "bg": 2, "colours": [ … ], "guard": "redLow" } } } }
```

PLACES (the runtime's registry; `when` = the predicates sprites.mjs already verified, ported):

| place | when (from) | writes | exists today as |
|---|---|---|---|
| `player` | not in battle (sprites.mjs:743-744) | OBJ tiles $8000/$8800, 3 frames×4 tiles, frame by `wWalkCounter` (sprites.mjs:745-753) + OBJ pal 0 | `overworld` with `--foxtrot` |
| `follower` | not in battle | $80C0/$88C0 (sprites.mjs:690-691, 754-760); blank or art | Pikachu blanked |
| `enemyFront` | battle, front 7×7 whole AND (wild ∥ HUD up ∥ "sent out") (sprites.mjs:956-957, 800-811) | $9000 784 bytes; BG pal 3 when colour 0 is white (sprites.mjs:877-882); `speciesPalette` patch rule (sprites.mjs:894-923) | Notes |
| `playerBack` | battle, back block whole AND your HUD up | $9310 784 bytes | Village |
| `trainerBack` | battle, back block whole AND no HUD (Red waiting) | $9310 frames + BG pal 2 guarded by Red's low byte $3F (sprites.mjs:870-876) | Foxtrot back |
| `enemyTrainer` | battle kind 2, front block whole, no HUD, no "sent out" | $9000 | new, trivial (the negation of enemyFront's test) |
| `enemyName` / `playerName` | the slot's nick non-empty; HUD cells while the frame tiles are up (sprites.mjs:938-954) | wEnemyMonNick / wBattleMonNick + tile-map cells | NOTES APP / VILLAGE |
| `battleMoves` | battle; first party mon out (sprites.mjs:650-673) | wBattleMon / wEnemyMon moves + PP (WRAM, battle-only copies) | the quiz moves |
| `dexEntry`, `partyIcon`, `trainerCard`, … | per Track A/B | mostly PERMANENT (a `patchset` repointing pictures) rather than per-step | — |

Renewal cadence becomes event-driven, not a clock: VRAM places keep-check every step (cheap
compare, write only on difference — measured ~30µs/step); palettes every step guarded as today;
ROM patch sets on mount, on every state load, and on toggle (reconcile against the pristine copy).
The `speciesPalette` rule needs one piece of state (which entry it borrowed) and reverts it when
the battle ends, as `notesRom` does.

Cost: runtime + places ≈ 350–450 lines (sprites.mjs's `apply`/`overworld`/`quizMoves`/`notesRom`/
palette helpers are ~250 of it, ported to direct core access and minus all the retry code);
gameboy.ts +40 (stepCore, the op, pristine copy, reconcile after `loadState`/`load`/`rom`);
door.mjs +25. Risk: medium, contained — a bad place can garble VRAM for a frame but writes nothing
a save keeps (VRAM, palette RAM, battle-only WRAM, the loaded ROM image). The one real hazard is
a patch set baked into a state (defect 5), which `reconcile` is what fixes.

## 4. The toggles: named overlays, place → art

Colin's examples (`follower: foxtrot`, `player: colin`, `enemyFront: notes`, `backSlot: village`,
`dexEntry: foxtrot`) are a map from PLACE to ART, and that is the right key: a place holds one art
at a time, so a map makes conflicts impossible by construction. ROM text gags are not places; they
are named patch sets. A LOOK is a named preset of both (what "Village vs Notes" is).

```ts
// src/shared/types.ts, DeckSettings (replacing spriteGag / spriteGagMoves at the end of the migration)
gbPlaces: Partial<Record<GbPlace, string>>   // { player: 'foxtrot', follower: 'blank', enemyFront: 'notes', playerBack: 'village' }
gbPatches: string[]                           // ['boring', 'quiz:download', 'bugCatchers', 'playerName:VILLAGER']
// GbPlace = 'player' | 'follower' | 'enemyFront' | 'enemyTrainer' | 'playerBack' | 'trainerBack'
//         | 'enemyName' | 'playerName' | 'battleMoves' | 'dexEntry' | …   (GB_PLACES const, the sanitizer's list)
```
Looks are shipped data (plugin/data/sprites/looks.json): `village-vs-notes` = { places: { enemyFront:
notes, enemyName: "NOTES APP", playerBack: village, playerName: "VILLAGE", battleMoves: quiz },
patches: [boring, quiz:<set>, bugCatchers, playerName:VILLAGER] }, `foxtrot` = { player, follower:
blank, trainerBack }. Applying a look writes those keys; the settings stay the truth.
Sanitizer (src/main/settings.ts, beside `spriteGagMoves` at :153-155): keys ∈ GB_PLACES, values
`^[a-z0-9_-]{1,32}$` (they name files), patches from a known list with a `:arg` of the same shape
(the moveset / player name reach no argv any more, but keep them plain). ~25 lines. Migration: a
config.json with `spriteGag: true` and no `gbPlaces` becomes the `village-vs-notes` look.

Surfaces (one truth, three doors):
- **Pane** (PokemonPane.tsx:168-174 today: one `gag` pill): a `sprites` pill opening a small popover
  — a row per place that has art (select: off / each art that fits the place's kind), a row of
  patch-set checkboxes, the looks as buttons. ~80 lines + CSS.
- **Menu** (src/main/menu.ts:167-174): View ▸ Pokemon ▸ Sprites ▸ one checkbox per LOOK plus
  "Everything Off"; per-place control stays in the pane (a menu per place is too deep). ~20 lines.
- **CLI**: `sprite put <place> <art>` / `sprite clear <place>|all` / `sprite look <name>` /
  `sprite patch <set> on|off` / `sprite status`, through a door op that main answers ITSELF
  (the way `molCall` answers `list` itself before forwarding, CLAUDE.md Molecule rule): main patches
  the settings and the renderer's runtime follows the broadcast. Headless, the same commands write
  the state file's sidecar (`<dir>/overlays.json`) and HeadlessDoor's runtime reads it.

Where art lives:
- SHIPPED: `plugin/data/sprites/` (notes.png, village.png, fox-*.png, movesets.json as now; + looks.json).
- USER-MADE: `userData/sprites/art/<name>.png` + `<name>.json` (`{ kind: 'pic56' | 'obj16', frames,
  ms, palette, source: 'claude' | 'studio:<job id>' | 'converted:<path>', made }`). Colin's
  portrait lives here and never in the repo. A user art of the same name shadows a shipped one.
- COMPILED: `userData/sprites/packs/<name>.json` (section 3), rebuilt by the CLI when art changes;
  main hands the renderer the packs for the places in `gbPlaces` (`sprites:packs` IPC, ~40 lines).

How a session ADDS a sprite: `sprite add <name> <png | grid.txt> [--kind pic56|obj16] [--frames n]
[--ms n] [--colours #..,#..,#..,#..]`. The CLI validates size per kind (56×56; 16×16 cells ×
frames), quantizes to four shades (sprites.mjs `shadesOf` / `foxFrames` rule: alpha < 128 = shade 0),
writes the normalized PNG + meta via a main-answered door op `{ op: 'art', add: { name, png: b64,
meta } }` (main owns userData; the CLI does not know the profile's folder), and prints the 8×
preview path for the Read tool. `grid.txt` = rows of 0–3 (Track C's representation). Art is never
written into plugin/ by a session.

Art constraints per place (the skill must state them; details are Track A's):
- `pic56` (enemyFront, playerBack, trainerBack, enemyTrainer): 56×56, 49 BG tiles column-major,
  4 shades, NO transparency (shade 0 shows palette colour 0, white in the game's palettes),
  one BG palette for the whole block (enemy = BG pal 3, Red's block = BG pal 2 shared with the
  text box, so only colours 1–2 are free there).
- `obj16` (player, follower): 16×16 = four 8×8 OBJ tiles row-major per frame, shade 0 = TRANSPARENT,
  3 colours from one OBJ palette (Red's = 0; Pikachu's palette: Track A), the game x-flips the left
  frame for right; 3 frame slots (down, up, left) × stand/walk; today one side view for all.
- names: ≤ 10 characters of the game's charset (`encodeName`, sprites.mjs:170-185); ≤ 9 for the
  enemy while `boring` is on (FRONT_NAME_MAX, sprites.mjs:200).

## 5. The skill: `plugin/skills/sprites/SKILL.md` (outline)

A new skill beside trainer's rather than an extension of it: trainer is "play the game" (Haiku,
one command at a time); this is "change what the game looks like" (a drawing session, Fable/Opus,
looking at pictures). They share the CLI binary (`$DECK_TRAINER sprite …`) — or a thin
`plugin/scripts/sprites.mjs` that imports the same libs and is `DECK_SPRITES` in the env (derived
beside trainer.mjs in hooks.ts the way DECK_LESSON / DECK_DOC are, hooks.ts:188, so no constructor
change — see the "hooks ctor edits must be atomic" memory).

Frontmatter description triggers: "put Foxtrot where Pikachu is", "make the trainer Colin", "draw
a sprite", "Foxtrot in the Pokédex", "turn the gag on/off", "/deck:sprites".

Body sections:
1. **What it can change** — the place table (section 3) with each place's kind and what the player
   sees; permanent vs per-step; "not yet" places named honestly.
2. **Commands** — `sprite status | places | arts | looks`; `sprite add <name> <png|grid>`;
   `sprite show <art>` (8× PNG for the Read tool); `sprite preview <place> <art>` (HEADLESS: loads
   a checkpoint state that shows the place — the skill ships a small set, e.g. `bedroom`,
   `wild-battle`, `trainer-intro`, made once with trainer.mjs — applies the pack with the SAME
   runtime, runs N steps, screenshots); `sprite put | clear | look | patch`.
3. **The drawing loop** (one paragraph; the method is Track C's): draw or convert → `sprite add`
   → `sprite show` + Read → fix → `sprite preview` + Read → fix → `sprite put` on the live game
   only when the preview is right. Sources: Claude's own text grid; the fox sheet via
   scripts/sprites.mjs; a Studio image (`$DECK_STUDIO gen` with the chroma-key prompt, then
   `sprite add --from <jpg> --key #ff00ff`).
4. **Safety rules** (verbatim from CLAUDE.md's Trainer rule and this track): never the ROM file,
   never a battery save or a save file; transient only (VRAM, palette RAM, battle-only WRAM copies,
   the LOADED ROM image through named patch sets); HEADLESS FIRST, the live game last and only with
   `put`; never `poke` wPartyMonNicks or anything an in-game SAVE keeps; `--dir` under the scratch
   folder; a user's photo-derived art stays in userData.
5. **Constraints per kind** (section 4's list) and the palette facts (BG 2 shared with the text
   box; BG 3 the enemy's; OBJ 0 Red's; colour 0 transparent for OBJ only).
6. **Troubleshooting** — "the picture flashes back to the real one" (a place's `when` was false:
   `sprite status` says why per place), "colours wrong during a move" (the species palette entry),
   "old gag text after load" (a state saved with patches: `sprite patch reconcile`).

## 6. The existing gag, taken apart

| piece today | becomes | notes |
|---|---|---|
| Notes front pic + BG pal 3 (sprites.mjs:956-967, 877-882) | place `enemyFront` = art `notes` (with its palette in the pack) | |
| species palette table entry, per battle (sprites.mjs:884-923) | the `speciesPalette` behaviour of `enemyFront` (a per-battle, self-reverting ROM write) — part of the place, not a patch set, because WHICH entry depends on the mon | the only place with ROM side effects |
| Village back pic (keeps the species palette) | place `playerBack` = `village` | |
| Foxtrot back in Red's slot + BG pal 2 (sprites.mjs:958-963, 870-876) | place `trainerBack` = `foxtrot` | |
| Foxtrot overworld + Pikachu blank + OBJ pal 0 (sprites.mjs:742-766) | places `player` = `foxtrot`, `follower` = `blank` | `follower` = `foxtrot` is then "Foxtrot where Pikachu is" for free |
| NOTES APP / VILLAGE names (sprites.mjs:938-954) | places `enemyName`, `playerName` (value = the name, not an art) | |
| battle-copy moves + PP (sprites.mjs:650-673) | place `battleMoves` (WRAM, battle-only) = a moveset name | depends on the `quiz:<set>` patch set being on |
| "A boring" text (sprites.mjs:196-218) | patch set `boring` | |
| donor moves, name table, BIRD→APP, charge line, fired line, stub, named lines (sprites.mjs:589-633) | patch set `quiz:<moveset>` | compiled per moveset (the name table is rebuilt, sprites.mjs:566-576) |
| trainer names / pics / losing line (sprites.mjs:298-517, 605-617) | patch set `bugCatchers` | PERMANENT-style picture repointing; the pattern Track B's trainer / player pic swaps will reuse |
| <PLAYER> → VILLAGER (sprites.mjs:266-274, 618-619) | patch set `playerName:<NAME>` | |

So the ROM text/move patches become an **"easter" group of patch sets**, separate from sprites in
the UI (checkboxes, not art pickers) and in the code (compiled by the CLI into `patchset` data;
reconciled by the runtime). "Village vs Notes" is a LOOK over both groups. What remains special:
`speciesPalette` (dynamic ROM write inside a place) and `battleMoves` (a WRAM place tied to a
patch set) — both get explicit dependencies in the registry (`requires: 'quiz:*'`).

## 7. Migration, each step leaving the app working

The rule throughout: the CLI stays the AUTHORING tool (art, compiling packs and patch sets, finding
tables in the cartridge, headless previews, and prototyping NEW place rules), the renderer becomes
the RUNTIME. Colin keeps iterating on the CLI at every step.

0. **Today.** `spriteGag` → child `sprite watch`. Unchanged.
1. **New door ops, old loop** (~+120 lines; S). Add `vram`, `oam`, `palette`, `info.ops` to both
   ends (shared gbcore.mjs). sprites.mjs's `readVram`/`pokeVram`/`setBgPalette`/`foxPalette`/`bgByte`
   use them when `info.ops` has them, else the old poke+retry. Fixes defects 1–3 at once; the watch
   gets ~3× fewer requests. SpriteGag also passes `--foxtrot` when a new `spriteGagFoxtrot` flag (or
   the look) says so (defect 6). Verify: headless battle + overworld screenshots identical to before.
2. **Patch sets** (~+120; M). `patchset` op + pristine ROM + reconcile on mount/load in both ends.
   `boring`/`quizPatch` register sets instead of raw `patch`; the 2s renewal (trainer.mjs:364-369)
   goes. Fixes defect 5 — including states ALREADY saved with patches, which reconcile cleans on
   load. The watch still does all VRAM work.
3. **Runtime with the overworld places** (~+200; M). gbcore.mjs runtime, `stepCore` in gameboy.ts,
   HeadlessDoor.step hook, `overlay` op, packs in userData/sprites/packs, `sprite put player foxtrot`.
   The watch skips a place the runtime reports as owned (`overlay status`). Start here because
   `player`/`follower` have the simplest `when` and the most visible win (no flicker while a
   trainer session walks — defect 4).
4. **Battle places** (~+250; L). Port `enemyFront` (+ speciesPalette), `playerBack`, `trainerBack`,
   names, `battleMoves`. PARITY TEST headless: the same wild and trainer battle script, once with
   the old watch polling a HeadlessDoor (headless `step` really steps) and once with the runtime,
   screenshots compared at fixed step counts. The watch's battle code goes quiet when owned.
5. **Settings, pane, menu** (~+150; M). `gbPlaces`/`gbPatches`/looks; main answers `sprite put/clear/
   look/patch` itself; the pane popover; the menu's looks; `spriteGag: true` migrates to the
   `village-vs-notes` look. SpriteGag (spritegag.ts) now spawns nothing — delete it and its three
   lines in index.ts:509-514, 775 (−130).
6. **Keep the CLI as the lab.** `sprite watch` stays, as a HEADLESS-FIRST prototyping loop for rules
   the runtime does not have yet: `sprite try <rules.mjs> --headless … --state wild-battle` loads a
   rule module with the runtime's place interface (`{ name, when(ctx), keep(ctx, art) }`) into
   HeadlessDoor's runtime and screenshots; `sprite watch --rules <file>` can still poll the live deck
   through the new ops for a rule under development (the old path, now cheap and bank-safe).
   Promotion = copying the rule into gbcore.mjs's registry. No session code ever runs in the renderer.

Total, steps 1–5: roughly +850 / −130 lines, the bulk in gbcore.mjs; each step independently
shippable and revertible.

## What this means for the skill

- Operations: `sprite status | places | arts | looks | add | show | preview | put | clear | look |
  patch [reconcile] | try | watch`; door ops `vram`, `oam` (read), `palette`, `patchset`, `overlay`,
  main-answered `art` and settings ops.
- Build order: step 1 (door ops) is small and pays off immediately even if the rest waits.
- The forced-mode write is the enabling trick: it makes writes deterministic, which is what makes a
  per-step keep table cheap (~30µs/step measured) and a headless preview exact.

HANDOFF
report: /private/tmp/claude-501/-Users-colin-deck/4e7784db-f436-4169-a265-0e013a5a8679/scratchpad/research/skill-design.md
verified: (headless only, scratch dir research/skill-design/hl, scripts exp.mjs / exp2.mjs / bench.mjs there)
  - STAT mode at step end over 2000 steps in the bedroom: 0/1/2/3 = 836/130/323/711 (35.5% mode 3)
  - naive 192-byte memoryWrite to $8000 landed whole 130/200; forced modeSTAT=0 write 200/200
  - per-step keep hook (tile map + wIsInBattle read + 2×192-byte compare/rewrite): ~30µs/step (99 → 129µs, node)
  - Foxtrot painted into Red's OBJ cells by a per-step hook while walking (keep-hook.png)
  - OBJ palette 0 set through updateGBCOBJPalette with OCPS untouched (palette-direct.png)
  - a save state carries the ROM image: a byte patched before `save` comes back on `load`
  - OAM read direct from memory[0xFE00]: Red = tiles 8–11, attr 0
read-only: door.mjs, gameboy.ts, spritegag.ts, trainer.mjs (sprite watch), sprites.mjs, index.ts
  (gameboyCall, hooks wiring, SpriteGag), hooks.ts, settings.ts, types.ts (DeckSettings), PokemonPane.tsx,
  menu.ts, serverboy core (VRAM/OAM/palette/VBK writers, saveState), pokeyellow vblank.asm,
  bg_map_attributes.asm, palettes.asm. The VBK-bank hazard, the BCPS mid-upload hazard and the
  gag-stalls-behind-trainer-holds effect are READ, not observed.
open:
  - Share one runtime module between plugin/ (.mjs) and the renderer (a first cross-import), or mirror it?
  - Settings shape: `gbPlaces` map + `gbPatches` list + shipped looks — confirm with Colin (and the key names).
  - Is it acceptable that `sprite put` on a place the deck's runtime lacks falls back to the CLI watch?
  - Pikachu's OBJ palette index and whether `follower` art needs its own palette (Track A).
  - Permanent places (dexEntry, trainer card, party icons, player pics) as patch sets: their pointer
    tables and free space are Track B's; the runtime only needs `patchset` for them.
  - Existing userData/pokemon/*.state files saved with the gag on carry its ROM patches today; step 2's
    reconcile fixes them on load — until then, loading one with the gag off shows gag text.
  - CLAUDE.md's default-moveset line ("the first set") disagrees with `spriteGagMoves: 'download'`.
