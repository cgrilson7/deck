# Track B — making art PERMANENT in the loaded ROM image

Scratch: `research/rom-patching/` (scripts, pret's `.sym`/`.map`, headless dir `hl/` with every screenshot named below).
Nothing under /Users/colin/deck was edited; the ROM file was only read; no POST /gameboy.

## 0. Ground truth used

- The ROM `/Users/colin/Downloads/Pokemon - Yellow Version (UE) [C][!].gbc` has SHA-1
  `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1` = pret's `pokeyellow.gbc` (`pokeyellow/roms.sha1:1`). It is
  byte-identical to pret's build, so pret's linker outputs from the repo's `symbols` branch
  (`rom-patching/pokeyellow.sym`, `rom-patching/pokeyellow.map`) name every label and every free byte of
  THIS cartridge. File offset = `bank × $4000 + (addr − $4000)` (bank 0: `addr`). Every offset below
  was read from the .sym AND checked against the cartridge bytes; each table also has a content
  signature (verified unique in the ROM by `sigs.mjs`) so the CLI never needs the .sym.
- Disassembly: `scratchpad/pokeyellow/` (e89ead1). `rgbds` is not installed; `cc` is.

## 1. Headline findings

1. **The pic codec is solved.** `rom-patching/pic.mjs` is a 236-line JS port of `tools/pkmncompress.c`
   (compressor + decompressor). VERIFIED: all 357 pics in the ROM (every INCBIN of a `.pic` in
   `gfx/pics.asm` + `gfx/player.asm`) decompress and recompress **byte-identical** to the ROM, and
   identical to pret's own C tool compiled here (`roundtrip.mjs`: `{ ok: 357, jsbad: 0, cbad: 0 }`).
   Decode+encode of all 357 takes ~0.3 s in node. There is NO raw mode (§3).
2. **Every picture kind is repointable in the loaded ROM, and I verified six kinds headless**
   (trainer front, Red's back, Red's front on the trainer card, a species' front + back + dims,
   a species' NAME + a whole new POKéDEX ENTRY + its own palette, the overworld sheets of Red AND the
   follower Pikachu) — screenshots in §6. No VRAM poke, no watch loop: the game draws our art itself.
3. **The binding constraint is free space in the right bank**, because pic banks are fixed by code:
   species pics by internal-id range (5 banks with 197–683 free bytes), trainer pics in bank $13
   (230 free), and Red's pics by immediate operands. A 7×7 pic compresses to 50–599 bytes (median
   439); dithered art is worst (Village: 501). Solved for trainers by a **verified 20-byte hook +
   47-byte per-class bank table** (§4.2): any trainer picture of any size in any bank.
4. **"Foxtrot in the Pokédex": relabel VULPIX (dex 37), don't add a species.** Verified end to end
   headless: "Wild FOXTROT appeared!", his front/back pics, the Pokédex page (FOXTROT / FOX / 1'08" /
   9.5 lb / our text), and his OWN palette via the unused `PAL_0F`. A 152nd species is not reachable by
   loaded-ROM patches without moving tables, and it would poison battery saves (§7).
5. **State loads carry the ROM image — both ways** (verified; serverboy `saveState()` element 0 is
   `fromTypedArray(this.ROM)`, `node_modules/serverboy/src/gameboy_core/saveState.js:3`). A state saved
   AFTER a patch brings the patch back even if the overlay has since been turned off. The deck's
   comment "a state load brings the original back" (`src/renderer/src/lib/gameboy.ts:519`,
   `door.mjs` header) is only true for states saved before patching — a latent bug for the existing
   sprite gag too (§8).

## 2. Free space (the linker's own list, checked)

`mapfree.mjs` reads every `EMPTY:` line of pret's `pokeyellow.map` and checks each byte is $00 in the
cartridge: **60 runs, 160,828 bytes, all $00, none disagree** (pret links retail with `-p 0x00`,
`Makefile:137`). Runs ≥ 256 bytes (bank · bank address · file offset · bytes):

| bank | addr | file | bytes | | bank | addr | file | bytes |
|---|---|---|---|---|---|---|---|---|
| $01 | $7af0 | $07af0 | 1296 | | $21 | $69e8 | $869e8 | 5656 |
| $02 | $7ec7 | $0bec7 | 313 | | $22 | $6ffe | $8affe | 4098 |
| $03 | $7ad8 | $0fad8 | 1320 | | $23 | $7e0e | $8fe0e | 498 |
| $04 | $7a22 | $13a22 | 1502 | | $24 | $6826 | $92826 | 6106 |
| $05 | $7de3 | $17de3 | 541 | | $25 | $6d1c | $96d1c | 4836 |
| $06 | $68a3 | $1a8a3 | 5981 | | $26 | $7acb | $9bacb | 1333 |
| $07 | $6698 | $1e698 | 6504 | | $27 | $7b97 | $9fb97 | 1129 ⚠ gag |
| $08 | $77bd | $237bd | 2115 | | $28 | $7c44 | $a3c44 | 956 |
| $0a | $7e0d | $2be0d | 499 | | $29 | $7728 | $a7728 | 2264 |
| $0b | $7e30 | $2fe30 | 464 | | $2a | $7b86 | $abb86 | 1146 |
| $0c | $7d55 | $33d55 | 683 | | $2b | $7a02 | $afa02 | 1534 |
| $0e | $7bab | $3bbab | 1109 | | $2c | $78f0 | $b38f0 | 1808 |
| $0f | $7bab | $3fbab | 1109 | | $2d | $719e | $b719e | 3682 |
| $10 | $5f7a | $41f7a | 8326 | | $2e | $79a2 | $bb9a2 | 1630 |
| $11 | $6c12 | $46c12 | 5102 | | $2f | $460f | $bc60f | 2545 ⚠ gag |
| $12 | $6540 | $4a540 | 6848 | | $2f | $7585 | $bf585 | 2683 |
| $14 | $69a2 | $529a2 | 5726 | | $31 | $7cc6 | $c7cc6 | 826 |
| $15 | $6997 | $56997 | 5737 | | $34 | $6576 | $d2576 | 6794 |
| $16 | $6556 | $5a556 | 6826 | | $35 | $7602 | $d7602 | 2558 |
| $17 | $5f60 | $5df60 | 8352 | | $38 | $7ef8 | $e3ef8 | 264 |
| $18 | $6702 | $62702 | 6398 | | $39 | $7ea3 | $e7ea3 | 349 |
| $1c | $7eb3 | $73eb3 | 333 | | $3a | $6a24 | $eaa24 | 5596 |
| $1d | $6177 | $76177 | 7817 | | $3c | $6db8 | $f2db8 | 4680 |
| $1f | $7860 | $7f860 | 1952 | | $3d | $6946 | $f6946 | 5818 |
| | | | | | $3e | $7d76 | $fbd76 | 650 |
| | | | | | $3f | $726f | $ff26f | 3473 |

Small runs that matter because they are PIC banks: $09 `$7f3b+197`, $0a 499, $0b 464, $0c 683,
$0d `$7f2c+212`, $13 (Trainer Pics) `$7f1a+230` (file $4ff1a). Bank 0: `$00fc+4`, `$3fef+17`.
(`free.json` has all 60.) Already TAKEN by the sprite gag (sprites.mjs): bank $27 from $9fb97 (boring
/ fired / bug texts), bank $2f from $bc60f (move-name table growth; `MoveNames` = $2f:4000), home
`$3fef` tail (5-byte stub), RST `$0010` (player name). A future allocator must know these.

A second, cruder map (`freespace.mjs`: any run of $00/$FF ≥ 256, "TAIL" when past the bank's last
label) found 111 runs / 207 KB — i.e. ~46 KB of zero runs that are real data (blank tiles, tables).
**Use the linker list, not zero-scanning.** The CLI can ship `free.json` (60 rows) as data, each
row re-checked all-zero against the cartridge before use.

## 3. The pic format and the compressor

- Format (`home/uncompress.asm:23-55`, `tools/pkmncompress.c`): byte 0 = width<<4 | height in tiles,
  then a bitstream: which plane first (1 bit); plane A as alternating RLE-of-zero-pairs / data
  packets of 2-bit groups (column-major, 4 rows of pixels per 8-px byte column); the mode (1–2 bits:
  0 = both planes delta-coded, 1/2 = plane B XORed with A); plane B the same way. Each plane is
  Gray-code delta coded before the RLE (`compress_plane`, `pkmncompress.c:61`).
- **No raw/uncompressed mode exists.** The decompressor always runs the RLE+delta machine. Worst case
  (7×7 random noise) compresses to **893 bytes > 784 raw**; blank 7×7 = 7 bytes. So "uncompressed"
  would mean new code; not worth it now that the codec is ported and verified.
- Measured sizes of the 357 ROM pics (`pic-sizes.json`): 4×4 (all back pics) min 57 / median 127 /
  max 198 (raw 256); 5×5 158/242/302 (raw 400); 6×6 246/382/473 (raw 576); 7×7 50/439/599 (raw 784).
  Deck art: notes.png 7×7 → **127 B**; village.png 7×7 → **501 B** (its dithered disc); the
  sheet's standing fox at 2× on 56×56 → **162 B**; fox-back frame 0 as a 4×4 back pic → **92 B**.
  Clean pixel art with flat fills and white background is cheap; dithering is expensive.
- Pics are SQUARE in `pkmncompress` (`get_width`, `pkmncompress.c:187`); every Yellow pic is square.
  Max 7×7: the SRAM sprite buffers are 7×7×8 = 392 bytes a plane (`sSpriteBuffer0/1/2` at $a000,
  $a188, $a310). pret's `-u` flag = the decompressor, also ported.
- The port must mirror a C quirk: `index` is not reset between the two planes
  (`pkmncompress.c:133-164`); `pic.mjs` keeps it, which is why the round trip is exact.
- The dims byte a species uses for CENTERING is its base-stats byte, not the pic's header
  (`home/pics.asm:44-89`): both must agree when a pic's size changes (I patched Pidgey 5×5 → $77).

## 4. The tables, per picture kind (all offsets file offsets; "sig" = unique content signature)

### 4.1 Pokémon front / back pics
- `BaseStats` $0e:43de = **$383de**, 28 bytes per DEX number (all 151, Mew included). +0 dex, +10 dims
  byte, **+11 front pointer, +13 back pointer** (`data/pokemon/base_stats/pikachu.asm:10-11`).
  sig `01 2d 31 31 2d 41 16 03 2d 40 55` (Bulbasaur's head, 1 hit).
- The pointer is 2 bytes; the BANK is chosen in code by INTERNAL id, `UncompressMonSprite`
  (`home/pics.asm:18-41`, $01407): FOSSIL_KABUTOPS ($b6) → $0b; <$1f → $09; <$4a → $0a; <$74 → $0b;
  <$99 → $0c; else $0d. sig `fe b6 3e 0b 28 1e 78 fe 1f 3e 09 38 17 78 fe 4a 3e 0a 38 10 78 fe 74 3e 0b
  38 09 78 fe 99 3e 0c 38 02 3e 0d` at $01417. So a new pic must go in the species' pic bank (free
  197/499/464/683/212) or over the species' own old pic in place when it is no bigger.
  Escape hatch (NOT verified): the Kabutops-fossil special case is a ready-made "this one species
  from another bank" branch — turning `fe b6` / `3e 0b` into our species / a roomy bank moves one
  species' pics anywhere, at the cost of the Pewter Museum's fossil picture.
- BACK PICS ARE 4×4 (32×32) and are pixel-doubled by `ScaleSpriteByTwo`
  (`engine/battle/scale_sprites.asm:1-18`, called from `LoadMonBackPic`, `engine/battle/init_battle.asm:
  160-178`); the right and bottom 4 px are dropped, so the usable back art is **28×28, shown 2×**.
  A permanent back pic is therefore chunkier than the gag's 56×56 VRAM poke — this is the Gen 1 look.
- Palette: `MonsterPalettes` $1c:6921 = **$72921**, one PAL id per dex number (index 0 = MissingNo),
  sig `10 16 16 16 12 12 12 13`. Colours: `CGBBasePalettes` $1c:6af9 = **$72af9**, 8 bytes (4 × BGR555)
  per PAL id (so the gag's $72b79 = PAL_MEWMON's entry). **`PAL_0F` is unused** (it appears only in the
  two palette tables, `data/sgb/sgb_palettes.asm:19,64`; no reference in engine/, home/, data/): a
  species can get colours of its own by pointing its MonsterPalettes byte at $0F and writing $72b71.
  Verified (§6, shot 5/6).

### 4.2 Trainer pics
- `TrainerPicAndMoneyPointers` $0e:5893 = **$39893**, 5 bytes per class (dw pic, 3 BCD money), sig
  `00 40 00 15 00 c6 40 00 10 00` — sprites.mjs's `picMoney()` already finds it by its reader.
- Bank: HARD-CODED in `_LoadTrainerPic` ($3d:615a = $f615a, `engine/battle/init_battle.asm:143-158`):
  `ld a,[wLinkState]; and a; ld a,BANK("Trainer Pics") ($13); jr z; ld a,BANK(RedPicFront) ($04)`,
  then `ld c,$77; jp LoadUncompressedSpriteData` — **trainer pics must be 7×7**. Bank $13 has 230
  free bytes and the Trainer Pics section fills $4000–$7e78 (`pokeyellow.map`), so it cannot move.
- **The hook (VERIFIED, `hook.mjs`, shot `7-giovanni-hook.png`)**: the 10 bytes at **$f6162**
  (`fa 2a d1 a7 3e 13 28 02 3e 04`) become `cd <TrainerPicBank> 00×7`, and in bank $3d's free run:
  ```
  TrainerPicBank: ld a,[wLinkState] ; fa 2a d1   and a ; a7   ld a,$04 ; 3e 04   ret nz ; c0
                  push hl ; e5   ld a,[wTrainerClass] ; fa 30 d0   ld hl,Table-1 ; 21 lo hi
                  add l ; 85   ld l,a ; 6f   jr nc,+1 ; 30 01   inc h ; 24   ld a,[hl] ; 7e   pop hl ; e1   ret ; c9
  Table:          47 bytes, one bank per class, default $13
  ```
  (21 bytes of code + 47.) With it, class 29 (GIOVANNI) wore the 501-byte Village pic from bank $3d
  while YOUNGSTER still loaded from $13 (`7-youngster-default.png`). This is the general answer for
  "make the trainer X / make every Rocket Colin".
- Without the hook: repoint within $13 if ≤ 230 B (verified: Notes, 127 B, as YOUNGSTER), or overwrite a
  class's pic in place when the new one is no bigger (Youngster 198 B … Lance/Giovanni ~500 B).

### 4.3 The player's pics (Red)
- `RedPicFront` $04:5a97 = $11a97 (7×7, 255 B). Loaded through IMMEDIATES (`ld de,$5a97`, bank $04 in
  the next operand), at: **$03597** (GetTrainerInformation.linkBattle — a link opponent), **$05efa**
  (OakSpeech+117), **$05f30** (OakSpeech.skipSpeech+6), **$0670f** (ChoosePlayerName.customName+23),
  **$1204c** (DrawTrainerInfo — the trainer card), **$70390** (HoFLoadPlayerPics). Found by searching
  `11 97 5a` (`sites.mjs`). Bank $04 has 1502 free bytes, so a new Red front goes there and only the 2-byte
  operands change. VERIFIED on the trainer card (Village, 501 B at $13a22; `1-trainer-card.png`).
- `ShrinkPic1` $11b96 / `ShrinkPic2` $11bf0 (the intro's shrinking Red): sites $05f66, $05f74.
- `RedPicBack` $3d:43b1 = $f43b1 (4×4, 144 B): sites **$3ee29** (LoadPlayerBackPic+17,
  `engine/battle/core.asm:6392`) and **$703b2** (HoFLoadPlayerPics+34). Siblings on the same branch:
  `OldManPicBack` $3ee1b, `ProfOakPicBack` $3ee22 (the first Pikachu battle). Bank $3d: 5818 free.
  VERIFIED: fox-back frame 0 halved to 28×28 → 92 B at $f6946, operand at $3ee2a → Red is Foxtrot from
  behind in every battle intro (`2-trainer-a/b.png`, `3-wild-b/c.png`).
- "A sprite of Colin" = these three: front 7×7 at up to 1502 B in bank 4, back 28×28 in bank $3d,
  plus the overworld sheet (§4.4). Red's rival pics are ordinary trainer classes (Rival1/2/3) → §4.2.

### 4.4 Overworld sprite sheets (Red, the follower Pikachu, NPCs)
- **Raw 2bpp, not compressed**: a sheet is 16×96 = six 16×16 frames = 24 tiles = **384 bytes**, tiles
  row-major per frame (TL TR BL BR — the same order sprites.mjs's `foxFrames` writes): stand down,
  stand up, stand left, walk down, walk up, walk left (right = left x-flipped by OAM). PNGs are 2-bit
  grey (`gfx/sprites/red.png`, colour type 0); colour 0 is transparent (OBJ).
- `SpriteSheetPointerTable` $05:42a9 = **$142a9**, 4 bytes per sprite id: dw gfx, db $c0 (12 tiles ×
  16 — the first half; the walk half follows at +$c0), **db bank** (`data/sprites/sprites.asm:7`,
  `macros` `overworld_sprite`). sig `71 45 c0 05 f1 46 c0 05`. Because the bank is in the entry, an NPC's
  sheet can be moved to ANY bank. SPRITE_PIKACHU is id $3d.
- Hard-coded loaders (operands to patch if a sheet moves instead of being overwritten):
  RedSprite $05:4571 = **$14571**: `LoadWalkingPlayerSpriteGraphics` $00d64, OakSpeech $05f5c,
  FishingAnim $70823. RedBikeSprite $143f1: $00d8c. SeelSprite (surf) $17ab1: $00d85.
  PikachuSprite $3f:67ef = **$fe7ef**: `LoadPikachuSpriteIntoVRAM` $fd8ab (`ld de,$67ef; lb bc,$3f,$0c`,
  then `ld de,$68af` twice for the walk half — `engine/pikachu/pikachu_movement.asm:953-971`);
  SurfingPikachuSprite $fedef: $00d7e.
- VERIFIED IN PLACE (`ow.mjs`): 384 bytes over RedSprite and over PikachuSprite (fox idle frame 0 for the
  stands, run frame 3 for the walks). The bedroom kept Red (`4-bedroom-before-reload.png`: tiles are
  only read at a map load); after the stairs warp both the PLAYER and the FOLLOWER were Foxtrot
  (`4-walking-fox.png`: the player mid-screen, the follower on the stairs behind). Two limits: a ROM sheet gets the game's own
  2-frame walk only (no tail-wag idle — that needs the VRAM watch), and its COLOURS are not the sheet's
  to choose: in Yellow's CGB mode OBJ palettes are derived from the four active SGB palettes
  (`_UpdateCGBPal_OBP`, `engine/gfx/palettes.asm:991-1015`), i.e. the MAP's palette — the fox came out in
  Red's-house purple. A permanent coat needs a code patch there (bank $1c, 333 B free; not tried) or
  the existing OCPD poke.
- Emotes, Pikachu's "pikapic" mood pictures (`gfx/pikachu/*.pic`, `data/pikachu/pikachu_pic_animation.asm`)
  are more compressed pics and one more `PikachuSprite` user (`pikapic_loadgfx PikachuSprite`, line 27):
  overwriting PikachuSprite reaches them too. Not tested.

### 4.5 Party menu icons
- `MonPartyData` $1c:59ba = **$719ba**: a NYBBLE per dex number (icon class), sig `77 70 00 55 56 66 66 64`.
- `MonPartySpritePointers` $1c:584d = **$7184d**: $1e entries × 6 bytes (dw gfx, db tiles, **db bank**,
  dw VRAM) (`data/icon_pointers.asm`); ICON_PIKACHU (entry 13 = `ef 67 04 3f 80 82`) is **PikachuSprite
  tiles 0–3** (and entry 28: tiles 12–15) — so the follower sheet IS the Pikachu/Raichu party icon.
  VERIFIED: after the in-place sheet patch, VRAM $8280 held exactly the patched ROM bytes at the party
  menu. BUT icons are drawn SYMMETRIC — only the left 8×16 column, mirrored
  (`WriteSymmetricMonPartySpriteOAM`, `engine/gfx/mon_icons.asm:246-263`; only ICON_HELIX is
  asymmetric), so a side-view fox shows as a two-eared face (`4-party-icon.png`). An icon should be
  drawn face-on, or the `cp ICON_HELIX<<2` at that line retargeted.
- To give FOXTROT (Vulpix, ICON_QUADRUPED) the fox icon: set his nybble to ICON_PIKACHU ($a) — one
  nybble at $719ba + 18 (dex 37, odd → high nybble; `GetPartyMonSpriteID`, mon_icons.asm:272).

### 4.6 The Pokédex
- `MonsterNames` $3a:4000 = **$e8000**, 10 bytes per INTERNAL id, @-padded; sig = "RHYDON@@@@KA".
- `PokedexEntryPointers` $10:450b = **$4050b**, dw per INTERNAL id (190), sig `be 4d e8 4d 79 48`.
  Entry (`data/pokemon/dex_entries.asm:368-373`): species text @, feet, inches, dw weight (0.1 lb),
  `text_far` (17 lo hi bank), `text_end` (50). Text: `text` 00 … `<NEXT>` 4e, `<PAGE>` 49, `<DEXEND>` 5f @.
  Bank $10 has **8326 free bytes**, so whole new entries + texts fit beside the table.
- `PokedexOrder` $10:50b1 = $410b1 (internal → dex), sig `70 73 20 23 15 64 22 50`. `CryData` $0e:5462 =
  **$39462**, 3 bytes per internal id (base cry, pitch, length). `EvosMovesPointerTable` $3b1e5.
- The dex picture IS the species' front pic (mirrored), and its palette the species' — nothing extra.

## 5. A new species vs relabelling one

What a species is, by table: name (MonsterNames, internal), base stats incl. dims + pic pointers
(BaseStats, dex), pics (bank by internal id), dex entry (internal), dex order (internal→dex), palette
(dex), icon (dex nybble), cry (internal), evos/moves (internal), plus the save's own bit arrays.

- **A 152nd species cannot be done by loaded-ROM patches alone.** BaseStats' 152nd entry would start at
  $0e:5462 — exactly where `CryData` begins; `NUM_POKEMON` bounds the dex loops; the unused internal
  ids are MissingNo slots with dex 0 (`PokedexOrder`), and `GetMonHeader` would read garbage stats.
- **It would also break saves:** the party/boxes/Hall of Fame store the INTERNAL id. A caught custom
  species in a battery save becomes a MissingNo glitch mon the moment the patch is not applied (a
  fresh ROM load, the phone, another emulator) — and MissingNo corrupts item/Hall of Fame data.
- **Relabel VULPIX (dex 37, internal $52)**: a fox, whose dex species line is already "FOX", fire-type
  red-orange; pic bank $0b (464 free), back pic 101 B in place. A caught FOXTROT stored in a save is a
  Vulpix nicknamed "FOXTROT" to an unpatched ROM — harmless. Cost: every Vulpix in Kanto (Route 7/8
  wild slots, trainers) is Foxtrot while on — which is the joke. Ninetales stays itself.
  VERIFIED headless (`vulpix.mjs`): name 10 B at $e8000+$51×10, front pic (162 B) in $0b's free run +
  dims $77 + pointer, back pic in place over Vulpix's (92 ≤ 101), a new dex entry + text in bank $10
  (FOX, 1'08", 9.5 lb, "The deck's fox. He runs while Claude works and sleeps while it waits. He barks at
  a bad posture"), PAL_0F coat. 380 bytes changed in all. Shots: `5-wild-foxtrot.png`,
  `6-dex-data.png`, `6-dex-page2.png`.
- Eevee (dex 133) is the other fox-ish option; Vulpix wins on the "FOX" line and the colours.

## 6. What I ran (all headless, serverboy in node, `--dir` under scratch)

Base state: `trainer.mjs --headless <rom> --dir hl intro` then `party "Pikachu 10"` → `hl/base.state`.
Battles were forced by poking `wCurOpponent` ($d058; 200+class for a trainer, `wTrainerNo` $d05c = 1;
a species id + `wCurEnemyLevel` $d126 for a wild one) in the overworld — the overworld loop starts
the battle itself (`home/overworld.asm:65-67`), a cheap generic test harness.

| script | patch (loaded ROM only) | result | screenshot(s) in `rom-patching/hl/` |
|---|---|---|---|
| verify.mjs | Notes 7×7 (127 B) → $4ff1a, YOUNGSTER entry → $7f1a | trainer intro shows Notes | 2-trainer-a, 2-trainer-b |
| verify.mjs | fox-back 28×28 (92 B) → $f6946, $3ee2a → $6946 | Red's back = Foxtrot, trainer + wild | 2-trainer-*, 3-wild-b/c |
| verify.mjs | Village 7×7 (501 B) → $13a22, $1204d → $7a22 | trainer card shows Village | 1-trainer-card |
| verify.mjs | Notes → $2be0d, Pidgey dims $55→$77, front ptr | "Wild PIDGEY" wears Notes | 3-wild-c |
| ow.mjs | 384 B over RedSprite $14571 and PikachuSprite $fe7ef | player + follower are foxes after a map load | 4-bedroom-before-reload, 4-walking-fox, 4-party-icon |
| vulpix.mjs | FOXTROT: name, pics, dims, dex entry, PAL_0F | wild battle + full dex page | 5-wild-foxtrot, 6-dex-data, 6-dex-page2 |
| hook.mjs | trainer-pic bank hook + table + Village in $3d | GIOVANNI = Village, YOUNGSTER normal | 7-giovanni-hook, 7-youngster-default |

State behaviour (verify.mjs, last lines): after patching, `load base` (saved before) → YOUNGSTER pointer
back to `$4000`; `load patched` (saved after) → `$7f1a` again: **the state carries the patch.**

## 7. What survives what

| event | loaded-ROM patches | notes |
|---|---|---|
| nothing (game runs on) | stay | take effect at the NEXT decompress/load: next battle, next dex view, next map load (sheets), next party menu (icons); `wTrainerPicPointer` is copied at battle start |
| ROM (re)load: picking a cartridge, reset, ⌘R (renderer restarts from the .sav) | **gone** | fresh image from the file |
| save-state LOAD | **the ROM as it was when the state was SAVED** | state[0] = the whole 1 MB ROM (that is why a state is ~4 MB JSON). A state made with overlays on re-applies them on load, even with the overlay now off |
| battery save (.sav, SRAM) | never contains ROM | but DERIVED data does: a nickname given at catch time ("FOXTROT"), dex seen/owned bits (by dex no.), the species id. SRAM bank 0 also holds the sprite decompression buffers ($a000–$a497), so the last decompressed pic's bytes sit in the .sav as scratch — meaningless to the game |
| the ROM file | never written | |

**Renewal cadence** (the rule the runtime should follow): patches are idempotent, so write the WHOLE
desired image of every overlay range — patched bytes for overlays that are on, the FILE's original
bytes for overlays that are off — (1) after every ROM load / reset / autoload, (2) after EVERY state
load (this is what cleans a state saved with overlays on), (3) when a toggle changes. No clock is
needed if the renderer calls it on those events; the gag's 2 s `ROM_RENEW` poll is only a fallback
for a door that cannot hear them. The one timing rule: patch BEFORE the thing is loaded (before the
battle for pics, before the map load for sheets); a patch mid-scene shows next time.

## 8. What this means for the skill

Operations the future CLI should offer (all into the LOADED image, via the existing `patch` op; the
file and saves never touched; every table found by the signatures above, every free run re-checked
all-zero; the allocator knows the gag's reserved runs):

- `pic encode <png> [--back]` → shades → 2bpp → `pic.mjs compress`; report bytes; `--back` = 28×28 art
  in a 32×32 box (4×4), warns that it is shown 2×. `pic decode <label|offset>` → PNG (for "show me
  Brock's pic", and to round-trip-check).
- `pic mon <species> --front <png> [--back <png>]`: in place when it fits, else the species' pic bank's
  free run; sets the dims byte; refuses with the byte counts when neither fits.
- `pic trainer <class> <png>`: installs the bank hook once (§4.2), then any size, any bank ($3d, $10…).
- `pic player --front <png> --back <png>` (+ `--shrink`): bank 4 / bank $3d, six + two operands.
- `sheet <sprite|player|follower> <png 16×96>`: 384 B in place (or repoint the table entry / loader
  operands); warns about colours (map palette) and that tiles change at the next map load.
- `icon <species> <png 16×16>`: via ICON_PIKACHU's sheet tiles or a repointed icon entry; warns "drawn
  mirrored".
- `species <dex> --name --species-text --height --weight --text --palette <4 colours>`: the relabel
  kit (MonsterNames, a new entry in bank $10 + repoint, MonsterPalettes → PAL_0F + CGBBasePalettes).
- `overlay list | on | off`, with each overlay = { writes: [[offset, patched, original]] } computed
  once from the cartridge FILE, re-asserted on ROM/state load (§7).
- Headless first: every op should run on HeadlessDoor with the wCurOpponent battle harness and dump a
  screenshot, before it touches the live game.

Open questions for the alpha:
- Should overlays re-assert on state load inside the renderer (lib/gameboy.ts knows when `saving()`
  runs) — the only fix for "a state saved with the gag on keeps the gag"? That also applies to the
  existing sprite gag's text/move/trainer patches today (unverified in the live app, but it follows
  from `saveState.js:3`).
- Relabel Vulpix (recommended) vs Eevee; and whether FOXTROT's party icon should be the
  follower sheet's frame (shared with Pikachu) or a new icon entry.
- Permanent overworld COLOURS: a code patch in `_UpdateCGBPal_OBP` (bank $1c) vs keeping the OCPD poke.
- Back pics: accept 28×28@2× for permanence, or keep the 56×56 VRAM poke for the back slot only.
- Track A should confirm the trainer-pic palette (the intro showed Notes in the trainer's palette;
  Village on the card in the card's red) and whether Yellow's per-trainer CGB palettes (if any) can be
  repointed like MonsterPalettes.

```
HANDOFF
report: /private/tmp/claude-501/-Users-colin-deck/4e7784db-f436-4169-a265-0e013a5a8679/scratchpad/research/rom-patching.md
verified: ROM sha1 = pret's pokeyellow.gbc; JS port of pkmncompress (rom-patching/pic.mjs) round-trips all 357 ROM pics byte-identical, same as pret's C tool compiled locally; pic size stats; free-space list from pret's .map, all 60 runs checked all-$00; every table offset + content signature checked unique (sigs.mjs, sites.mjs); headless loaded-ROM patches with screenshots: trainer pic repoint (YOUNGSTER→Notes), Red's back (Foxtrot 28×28), Red's front on the trainer card (Village), a species' front pic + dims (Pidgey→Notes), Red + follower Pikachu overworld sheets in place, party icon = PikachuSprite tiles (VRAM read back), Vulpix→FOXTROT (name, pics, dex entry + text, PAL_0F palette), a 21-byte trainer-pic bank hook + table (GIOVANNI→Village from bank $3d); save-state load restores the ROM as of the state's save (both directions).
read-only: pic bank rule and back-pic scaling (home/pics.asm, scale_sprites.asm); why a 152nd species collides with CryData and poisons saves; PAL_0F unused (grep); OBJ palettes derived from the map's (palettes.asm); symmetric party icons (mon_icons.asm); Kabutops-fossil bank escape hatch; pikapic users of PikachuSprite; live-deck behaviour of states saved with the gag on (inferred from serverboy saveState.js, not run in the app).
open: re-assert overlays on every state load in the renderer (fixes the gag too)?; Vulpix vs Eevee for FOXTROT, and his icon; permanent overworld colours by code patch vs OCPD poke; 28×28@2× permanent back pic vs 56×56 VRAM poke; trainer CGB palettes (Track A); where the allocator's reservations live (the gag's runs in $27/$2f/home/RST).
```
