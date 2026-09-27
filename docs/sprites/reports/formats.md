# Track A — how Pokémon Yellow stores and draws every picture we might replace

Scope: the hardware/format layer and the catalogue of places. Sources: the pret/pokeyellow
disassembly in the scratchpad (paths below are relative to `scratchpad/pokeyellow/`), pret's
published symbol file for the same build (`research/formats/pokeyellow.sym`, fetched from the
`symbols` branch), the UE ROM, and headless runs of serverboy through the deck's own
`HeadlessDoor` (scripts under `research/formats/`, pictures under `research/formats/run/`).

**The ROM is the pret build, byte for byte**: `shasum` of `Pokemon - Yellow Version (UE) [C][!].gbc`
= `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1` = `roms.sha1`'s `pokeyellow.gbc`. So every label in
`pokeyellow.sym` is a true address in Colin's cartridge: file offset = `bank × $4000 + (addr − $4000)`
(bank 0: the address itself). `research/formats/lib.mjs` does that (`symOff('RedPicBack')` → `$f43b1`).
This makes "find it by content" unnecessary for research; the CLI should still verify by content
(a few signature bytes) before patching, as sprites.mjs does, but it can start from these offsets.

Legend: VERIFIED = I ran it (headless or a script over the ROM) and looked. READ = from the
disassembly only.

## 1. The tile layer: formats, palettes, and what "transparent" means

**Tiles.** Every picture on screen is 8×8 tiles of 2bpp: 16 bytes per tile, two bytes per row —
byte 0 = the low bit of each of the 8 pixels (bit 7 = leftmost), byte 1 = the high bit. A pixel's
*colour index* 0–3 = low | high<<1. Index 0 is "white" only by convention: what colour an index
shows is the palette's business (below). Nothing in the game is a PNG, nothing carries an alpha
channel; a PNG is only our authoring format. VRAM tile data is $8000–$97FF (384 tiles) in bank 0.

**BG vs OBJ.** A tile shown through the BG/window tile map has NO transparency: index 0 draws
palette colour 0. A tile shown as an OBJ (hardware sprite, OAM entry) has index 0 TRANSPARENT,
always, whatever the palette says. So the precise answer to "are they transparent PNGs?":
- **battle pictures, trainer pictures, the player's pictures, the Pokédex picture, the trainer
  card, the title screen, Pikachu's portrait** are BG tiles: *opaque*. "Transparent" there means
  index 0, which every palette the game uses paints as the screen's white paper, so it *looks*
  transparent because the screen behind is white too. Author them with a white (or alpha)
  background and map it to index 0.
- **overworld people and Pikachu, emote bubbles, party-menu icons, the ball/throw animations,
  the send-out animation, the top three rows of the player's back picture while it slides in**
  are OBJs: index 0 is truly see-through (the map shows through).

**One trap for battle art (VERIFIED, `run/sheet-b.png`, frames 1–3).** In the battle intro both
pictures slide in as silhouettes: the game sets the BG palette so indices 1–3 are black and index 0
stays white. So a battle picture's white *interior* (eyes, a highlight, Village's letters) shows as
a HOLE in the silhouette if it is index 0, and as solid black if it is index 1. Red's own pic has
white holes (his ball). For a clean silhouette, paint enclosed "white" as index 1 in a palette where
index 1 is near-white, or accept the holes (the originals do).

**OBJ size.** Yellow runs 8×8 OBJ mode everywhere: `LCDC_DEFAULT` = `LCDC_ON | LCDC_WIN_9C00 |
LCDC_WIN_ON | LCDC_BLOCK21 | LCDC_BG_9800 | LCDC_OBJ_8 | LCDC_OBJ_ON | LCDC_BG_ON`
(`constants/ram_constants.asm:167`); `LCDC_OBJ_16` is never written (grep of home/ engine/);
headless LCDC reads $E3 in the overworld and in battle (VERIFIED). So a 16×16 overworld figure is
four 8×8 OAM entries, a 56×56 OBJ figure would be 49.

**OAM attribute byte** (byte 3 of each entry; Pan Docs "OAM"): bit 7 = BG-over-OBJ priority, bit 6
= Y flip, bit 5 = X flip, bit 4 = DMG palette (OBP0/OBP1), bit 3 = CGB VRAM bank, bits 0–2 = CGB
palette. How Yellow fills it (`engine/gfx/sprite_oam.asm:115–126`, PrepareOAMData): the facing
table's attribute (`data/sprites/facings.asm`) is masked to its high nibble, bit 7 is added
from the sprite's grass flag for the bottom row (`UNDER_GRASS`: the lower half of a person in tall
grass sits *behind* the grass's non-white pixels), and a DMG-OBP1 sprite gets CGB palette 4
(`OAM_HIGH_PALS`, `constants/oam_constants.asm:10`), else palette 0. **Bank bit 3 is never set:**
VRAM bank 1 holds no tile data at all (VERIFIED: 0 nonzero bytes in $8000–$97FF of bank 1, in the
overworld and mid-battle). Right-facing and the second walking frame are made by X-flip of the
left/down tiles (`facings.asm` `.StandingRight`, `.WalkingDown2`), so art for those is not stored.

**CGB palettes — how Yellow colours a DMG-style game** (READ `engine/gfx/palettes.asm`, VERIFIED
by reading the palette RAM headless). The game still thinks in Super Game Boy terms: a screen
names FOUR palette ids (a PAL packet: `SetPal_Battle`, `SetPal_Overworld`, …, `palettes.asm:28–196`)
and a BLK packet saying which screen rectangles use which of the four. On CGB, `InitCGBPalettes`
(`palettes.asm:736`) turns each id into a pointer into `CGBBasePalettes` (8 bytes = four BGR555
colours per id; `GetCGBBasePalAddress`, `:780`), keeps the pointers in `wCGBBasePalPointers`, and
writes:
- BG palette *k* = base[*k*] permuted through `rBGP`,
- OBJ palette *k* = base[*k*] through `rOBP0`, OBJ palette *k*+4 = base[*k*] through `rOBP1`
(`DMGPalToCGBPal`, `:799`). Every fade/flash only changes rBGP/rOBPx and calls
`_UpdateCGBPal_BGP`/`_OBP` (`:976`, `:991`), which RE-READ THE COLOURS FROM THE ROM through the
saved pointers. That is the mechanism behind the gag's finding that a flash repaints palette 3
from the cartridge: to recolour a picture durably, patch its base palette in the loaded ROM
(`CGBBasePalettes`), or keep re-poking BCPD after every rBGP change.
The BLK packet becomes the **BG attribute map** (VRAM bank 1 at $9800) through
`TranslatePalPacketToBGMapAttributes` → `LoadBGMapAttributes` (`palettes.asm:1017`,
`engine/gfx/bg_map_attributes.asm`): an HDMA of a precomputed attribute map. Only bits 0–2 (palette)
are ever non-zero there (VERIFIED: every attribute byte seen was $00–$03) — no flips, no bank 1, no
BG priority. So on CGB a picture's colours come from the screen RECTANGLE it sits in, never from
the tile.

VERIFIED palette state (headless, `inspect.mjs`; dumps in the run logs quoted here):
- **Overworld** (Lavender Town): BGP $E4, OBP0 **$D0**, OBP1 $E0. BG attr map all $00 → one BG
  palette. All 12 visible OAM entries (Red, Pikachu, an NPC) use CGB OBJ palette **0**.
  OBJ palette 0 = [base0, base0, base1, base3]: **OBJ index 1 is drawn in the same white as index
  0 would be if it were opaque** — overworld sprites have effectively three visible shades
  (white, the town's light colour, near-black) plus transparent. Red, Pikachu and every NPC share
  that one palette; recolouring OBJ palette 0 recolours all of them (the gag's Foxtrot coat does).
- **Battle**: BGP $E4; BG attribute rectangles (20×18 cells, VERIFIED):
  ```
  01111111111333333333   rows 0–3: enemy HUD = pal 1, enemy pic = pal 3 (cols 11–19, rows 0–6)
  22222222200333333333   rows 4–11: your pic = pal 2 (cols 0–8), your HUD = pal 0
  22222222200000000000
  22222222222222222222   rows 12–17: the text box = pal 2 (shared with your pic)
  ```
  Palette ids come from `SetPal_Battle` (`palettes.asm:28`): slot 0 = your HP-bar colour, 1 =
  enemy HP-bar colour, 2 = your mon's `MonsterPalettes` entry, 3 = the enemy's. Before a mon is
  out, the species read is 0, so slots 2/3 are `MonsterPalettes[0]` = PAL_MEWMON (below).
  VERIFIED: in the intro of a trainer battle BG palettes 2 and 3 are both `PAL_MEWMON`
  (white, #ffff00, #ff0808, #181818): with no mon out, `DeterminePaletteID` gets species 0 and
  `MonsterPalettes[0]` = `PAL_MEWMON`. **Every trainer picture and Red's back picture are drawn in
  PAL_MEWMON**, the game's default red-and-yellow (also `PalPacket_Generic`, the trainer card's
  slot 0, the title screen's, the party menu's OBJ palette — `data/sgb/sgb_packets.asm:140–147`).
  Patching PAL_MEWMON's colours is therefore global; recolour a trainer/Red slot by poking BCPD
  palette 2/3 during the intro instead (what the gag does for Foxtrot in Red's slot).

## 2. Battle pictures: storage, compression, placement

**Pointers** (READ `home/pics.asm:1–41`, `data/pokemon/base_stats/*.asm`; VERIFIED over the ROM with
`basestats.mjs`): `BaseStats` = file `$383de`, 151 entries of 28 bytes in DEX order (Mew
included, unlike R/B). Byte 10 = `BASE_PIC_SIZE` (the front pic's first byte, `$55/$66/$77`),
bytes 11–12 = front pic pointer, 13–14 = back pic pointer, both 16-bit addresses in a bank the
table does NOT store: `UncompressMonSprite` picks it from the INTERNAL species id —
`FOSSIL_KABUTOPS` → $0B; id < $1F → $09; < $4A → $0A; < $74 → $0B; < $99 → $0C; else $0D (the
"Pics 1–5" sections; `home/pics.asm:11–39`). So a repointed pic must stay in its species' bank
(Track B's problem). Front sizes over all 151: 47 × 5×5, 46 × 6×6, 58 × 7×7; **every back pic is
4×4** (header `$44`, 151/151). Examples: Pikachu (dex 25, internal $54) bank $0B, front `$2cd55`
(5×5, Yellow's own art), back `$2ce49`; Mewtwo front `$3192c` (7×7).

**The compression** (READ `home/uncompress.asm`; VERIFIED by a JS port, `research/formats/pic.mjs`,
that decodes 10 pics from the ROM pixel-identical to the disassembly's PNGs — `t5.mjs`, zero
differing pixels each: RedPicBack/Front, Pikachu front/back, BugCatcher, Mewtwo, Ghost, Shrink1,
ProfOakPicBack, FossilKabutops). The format:
1. byte 0: width (high nibble) × height (low nibble) in tiles.
2. then a bitstream (MSB first): 1 bit = which buffer gets the first plane;
   plane A; a 1–2 bit MODE (`0` → 0, `10` → 1, `11` → 2); plane B.
3. a plane is a 1bpp image walked as 2-pixel-wide COLUMNS top to bottom, left to right, one
   bit-PAIR at a time. It alternates packets: a data packet (bit-pairs until a `00` pair) and an
   RLE packet of zero pairs, whose count is Elias-gamma-like: *n* 1-bits, a 0, then *n*+1 bits of
   value *v*; count = *v* + 2^(*n*+1) − 1 (`LengthEncodingOffsetList`). The first bit of a plane
   says which packet kind starts.
4. post-processing: each row is XOR-prefix ("differential") decoded left to right — mode 0: both
   planes; mode 1: plane A, then B ^= A; mode 2: both, then B ^= A (`UnpackSprite`,
   `XorSpriteChunks`, `UnpackSpriteMode2`). Buffer 1 = the LOW bitplane, buffer 2 = the HIGH one
   (they are interleaved into GB 2bpp by `InterlaceMergeSpriteBuffers`, `home/pics.asm:148`).
5. `wSpriteFlipped` mirrors the result (flipped decode tables + nibble swaps) — used by the Pokédex
   and Oak's intro.
Measured sizes (bytes, compressed vs raw 2bpp): RedPicFront 255 vs 784, BugCatcher 314 vs 784,
Mewtwo 494 vs 784, the 47 trainer pics average 346 vs 784, a back pic 109–144 vs 256, Pikachu
front 244 vs 400. There is no "stored raw" mode: an uncompressed-looking pic must still be encoded
(a trivial encoder that emits only data packets and never RLE is valid and ~2 bits/pixel-pair +
terminators, i.e. slightly larger than raw — Track B owns the encoder).

**Placement in the 7×7 block** (READ `home/pics.asm:58–104` `LoadUncompressedSpriteData`): the w×h
pic is bottom-aligned and horizontally centred (rounded right) in a 7×7 buffer:
column offset `(8−w)/2` (integer), row offset `7−h`; then the 49 tiles go to VRAM COLUMN-MAJOR
(tile = first + col × 7 + row) because the sprite buffer is column-major. A 5×5 front therefore
occupies block columns 1–5, rows 2–6; 6×6 → columns 1–6, rows 1–6. When poking VRAM we can ignore
this and always write a full 56×56 (what the gag does); when patching a pic in the ROM, a 7×7
source is the only size that fills the block.

**Back pics are scaled ×2** (READ `engine/battle/scale_sprites.asm:1–4`, `init_battle.asm:160–179`,
`core.asm:6384–6427`): the 4×4 (32×32) source's rightmost 4 columns and bottom 4 rows are DROPPED
and the remaining **28×28 pixels are doubled to 56×56** (`ScaleSpriteByTwo`). So a back picture
patched into the ROM has an effective resolution of 28×28 with 2×2 pixels; a VRAM poke can carry
full 56×56 detail (the gag's Village and Foxtrot backs do), but it is gone at the next reload.
Same for Red's back (`RedPicBack` `$f43b1`), `OldManPicBack` (the catching tutorial) and
`ProfOakPicBack` (`$f44d2`, the opening Pikachu battle) — all in bank $3D, loaded by
`LoadPlayerBackPic` (`core.asm:6384`), which ALSO copies the 49 tiles to `vSprites` ($8000) and
builds OAM for the top 3 rows × 7 columns (palette attr 2) — VERIFIED (`t11.mjs`,
`run/slide2.png`): during the slide-in Red's head is 15–21 OBJ entries using tiles $00–$1E at $8000,
CGB OBJ palette 2. **To replace Red's back for the whole intro, write both $9310 (BG) and the same
tiles at $8000 (OBJ)**, or the head slides in as Red. `LoadMonBackPic` (`init_battle.asm:160`) also
copies your mon's back pic to $8000.

**Where the picture sits at runtime** (VERIFIED, consistent with sprites.mjs's header): BG uses
the $8800 signed tile area (`LCDC_BLOCK21`), so tile ids $00–$30 = `vFrontPic` $9000–$930F and
$31–$61 = `vBackPic` $9310–$961F (`ram/vram.asm`, the "battle/menu" union). Enemy block = tile map
cols 12–18 rows 0–6, yours = cols 1–7 rows 5–11. The game's working copy of the screen is
`wTileMap` (WRAM); the displayed map is $9C00 (the window, WX 7 WY 0) in menus/battle.

**Pikachu is special in Yellow only in the overworld** (and its portrait, §4): its battle pics are
ordinary base-stats pics (5×5 front, Yellow's own drawing, bank $0B).

## 3. Overworld sprites, the follower Pikachu, OAM

**Storage** (READ `data/sprites/sprites.asm`, `gfx/sprites.asm`; VERIFIED table over the ROM,
`t10.mjs`): `SpriteSheetPointerTable` = file `$142a9`, 4 bytes per `SPRITE_*` id: `dw` pointer,
`db` byte count of ONE half ($C0 = 12 tiles for people, $40 = 4 tiles for still objects),
`db` bank. Sheets are **uncompressed 2bpp**, 16×96 for a person = 24 tiles = six 16×16 frames:
standing down / up / left (tiles 0–11), walking down / up / left (tiles 12–23). Right = left
X-flipped and walking frame 2 = walking frame 1 X-flipped (`data/sprites/facings.asm`), so there
is no art for them. Tiles within a frame are row-major (TL, TR, BL, BR). Examples: `RedSprite`
`$14571` bank 5, `PikachuSprite` `$fe7ef` bank $3F (outside the NPC banks, loaded by its own
code), `SeelSprite` `$17ab1` (Red surfing), `RedBikeSprite` `$143f1`, `SurfingPikachuSprite`
`$fedef`; `PokeBallSprite` `$134e5` (4 tiles). The table is 82 entries; SPRITE_RED appears
four times (ids 1, $1F, $32, $36 all point at RedSprite).

**VRAM** (READ `engine/overworld/map_sprites.asm`, `home/overworld.asm:1737–1789`): the player's
sheet (Red / bike / Seel / surfing Pikachu, chosen by `LoadPlayerSpriteGraphics`) goes to $8000
(standing, tiles $00–$0B) and $8800 (walking, +$C0 bytes of the sheet; tiles $80–$8B); Pikachu to
$80C0 / $88C0 (tiles $0C–$17 / $8C–$97, `LoadPikachuSpriteIntoVRAM`,
`engine/pikachu/pikachu_movement.asm:952`); the map's NPCs to `SpriteVRAMAddresses` =
$8000 + 12·k tiles for k = 2..9 (each with walking frames $800 higher), and two 4-tile still
objects at tiles $78/$7C. Walking frames get re-loaded after every text box
(`ReloadWalkingTilePatterns`: the font overwrites $8800–), and every map load reloads all of them
— hence the gag's repaint loop. Exception: in a Pokémon Center, Pikachu's walking frames are put
$40 tiles higher and every OAM tile ≥ $80 gets `hPikachuSpriteVRAMOffset` ($40) added
(`sprite_oam.asm:106–111`, `pikachu_emotions.asm:415`), so a follower overlay must follow that
offset there.

**OAM** (VERIFIED in Lavender Town, `run/world.state`): Red = entries 0–3 at tiles $00–$03, a
16×16 at screen (72,76) OAM coords; Pikachu = 4 entries, tiles $0C–$0F standing down, CGB palette
0, no flip; an NPC = tiles $38–$3B X-flipped (facing right). All attr bytes $00/$20 (+$80 in
grass). OAM is rebuilt from `wSpriteStateData1/2` every frame by `PrepareOAMData`
(`engine/gfx/sprite_oam.asm:1`) into `wShadowOAM` and DMA'd — so POKE TILE DATA, not OAM: an OAM
write lasts one frame. Pikachu is sprite slot 15 (`wSpritePikachuStateData*`), image base offset 2
(`LoadMapSpritesImageBaseOffset`); its movement is its own engine (`engine/pikachu/`), but it is
DRAWN like any person from the same facing table (VERIFIED: its OAM is the standard 4-entry
`.StandingDown`). `facings.asm` ends in a `.SpecialCase` 9-entry 3×3 layout (READ; I did not see
it used).

**Colour**: every overworld OBJ uses CGB palette 0 (or 4 for OBP1 users, none seen): [white,
white, town colour 1, near-black] — see §1. One palette for Red, Pikachu and all NPCs; the
overworld Pikachu is NOT yellow on CGB (it wears the town's colour; `run/w5.png`).

**Emotion bubbles** (READ `engine/overworld/emotion_bubbles.asm`): `EmotionBubbles` `$411e5`,
64 bytes (4 tiles, 16×16, uncompressed) per bubble (8: shock, question, happy, … `gfx/emotes/`),
copied to $8F80 (tiles $F8–$FB) and shown as a 4-entry OAM block above a sprite for 60 frames.
OBJ, palette 0, index 0 transparent.

**The follower is also the party-menu icon.** See §4: `ICON_PIKACHU` is built from
`PikachuSprite`'s tiles, so a ROM patch of Pikachu's overworld sheet changes the party menu too.

## 4. The other pictures: trainers, the player, the Pokédex, icons, the portrait, the title

**Trainer pictures** (READ `data/trainers/pic_pointers_money.asm:6`,
`engine/battle/init_battle.asm:143–152`; VERIFIED table + all 47 decoded, `t10.mjs`):
`TrainerPicAndMoneyPointers` = file `$39893`, 5 bytes per class (dw pic, 3 BCD money), 47 classes,
ALL pics 7×7, all in bank $13 ("Trainer Pics", file `$4c000`–; Youngster `$4c000`, Bug Catcher
`$4c0c6`, Lance `$4fb1f`), average 346 bytes compressed. Loaded to $9000 (the enemy block) like a
mon's front, drawn in `PAL_MEWMON` (§1). `ProfOakPic`, `Rival1/2/3Pic`, `JessieJamesPic` are in
the same table/bank; Oak's intro uses `ProfOakPic` and `Rival1Pic` directly
(`engine/movie/oak_speech/oak_speech.asm:75,103`). A LINK battle loads `RedPicFront` as the
opponent (`init_battle.asm:150–152`).

**The player** (READ; `gfx/player.asm`, `gfx/pics.asm:380`):
- `RedPicFront` `$11a97` (bank 4, 7×7, 255 B): Oak's intro "this is you" twice
  (`oak_speech.asm:94,113`), the trainer card (`start_sub_menus.asm:497`), the Hall of Fame
  (`hall_of_fame.asm:200`), the link-battle opponent. VERIFIED on the trainer card
  (`run/card.png` + `wTileMap`): it is drawn at tile map cols 15–18, rows 1–6, i.e. ONLY block
  columns 0–3 and rows 0–5 (x 0–31, y 0–47) show; Red's own figure spans x 13–38, y 2–55 and is
  cropped a little. A "Colin" front must keep the face in that window. Card palettes
  (`PalPacket_TrainerCard`): the whole top panel incl. the pic is BG pal 0 = PAL_MEWMON (VERIFIED:
  attr all 0 in rows 0–9).
- `ShrinkPic1` / `ShrinkPic2` `$11b96`– (bank 4, 7×7): the two frames of Red shrinking into the
  overworld at the end of the intro (`oak_speech.asm:139,144`).
- `RedPicBack` `$f43b1` (bank $3D, 4×4 → 56×56 by ×2): every battle intro + Hall of Fame.
- The overworld: `RedSprite` / `RedBikeSprite` / `SeelSprite` (surf) / `SurfingPikachuSprite`,
  §3; fishing uses 2-tile overlays `gfx/overworld/red_fish_*.png`.
- The title screen's Red is `PlayerCharacterTitleGraphics` (`gfx/title/player.png`, 40×56,
  uncompressed, `gfx/font.asm:32`) — but Yellow's title (`engine/movie/title_yellow.asm`) shows
  Pikachu (`TitlePikachuBGGraphics`, 128×32 = 64 tiles, BG, laid out by a 12×9 tilemap
  `gfx/title/pikachu.tilemap`, plus `TitlePikachuOBGraphics` 12 OBJ tiles for the eyes/blink)
  and the logo; the R/B player graphic is not on Yellow's title. (READ only.)

**The Pokédex entry** (READ `engine/menus/pokedex.asm` `ShowPokedexDataInternal`; VERIFIED
`run/dex.png` + `wTileMap`): the species' FRONT pic, **mirrored**, at tile map cols 1–7 rows 1–7
(`LoadFlippedFrontSpriteByMonIndex`, `home/pokemon.asm:94`), tiles $00–$30 at $9000. The mirror is
done twice over: the decoder mirrors the pixels inside every tile, and `CopyUncompressedPicToHL`
(`init_battle.asm:251`) lays the tile COLUMNS right to left (VERIFIED: screen col 1 = tiles
$2A–$30, col 7 = $00–$06). So a VRAM poke into the dex must write block column k = the art's
column 6−k with pixels NOT mirrored (or mirrored, to face right like the game's own). The
picture box is BG palette 1 = the species' `MonsterPalettes` entry (cols 1–8 rows 1–8), the rest
pal 0 = PAL_BROWNMON. **No footprint** in Yellow: `grep -i footprint` over the disassembly finds
nothing; the screen is pic, name, species text, HT/WT, number, 3 pages of description.
Text: `PokedexEntryPointers` `$4050b` (bank $10) → e.g. `PikachuDexEntry` 10:4806: `"MOUSE@"`,
feet, inches, `dw` weight in tenths of a pound, `text_far _PikachuDexEntry` (bank $2E). All
changeable in the loaded ROM (Track B), none in VRAM.

**Party-menu icons** (READ `engine/gfx/mon_icons.asm`, `data/icon_pointers.asm`,
`engine/items/town_map.asm:503`; VERIFIED `run/party.png` + OAM): 16×16 OBJ, two animation frames
($40 tiles apart), ONE ICON PER CLASS, not per species: `MonPartyData` `$719ba` (a nybble per dex
number → `ICON_*`: MON, BALL, HELIX, FAIRY, BIRD, WATER, BUG, GRASS, SNAKE, QUADRUPED, PIKACHU).
`MonPartySpritePointers` `$7184d` names the tiles: most classes REUSE overworld sheets
(Monster, Fairy, Bird, Seel, PokeBall, **Pikachu** — `PikachuSprite` tiles 0–3 and 12–15), four use
the 8×32 icon strips in `gfx/icons/`. **Every icon but the Helix is drawn SYMMETRIC**: only the
left column of tiles is shown, the right is the same tiles X-flipped (`WriteSymmetricMonPartySpriteOAM`;
VERIFIED: each row = tile t at x16 attr $00, tile t at x24 attr $20). So a Foxtrot icon must be a
left-right symmetric front view drawn as its LEFT HALF (8×16 per frame); a side-view fox would
come out two-headed. Loaded into $8000 (tile `ICON_x << 2`, and +$40 for frame 2); CGB OBJ palette 0
(party menu packet slot 0 = PAL_MEWMON through OBP0 → white, white, yellow, near-black).

**Pikachu's portrait** (talking to Pikachu; READ `engine/pikachu/pikachu_pic_animation.asm`;
VERIFIED `run/sheet-pk.png`, `pk12` state): a 5×5-tile BG picture in a text box at tile map
(7,6)–(11,10), tiles $80–$98 column-major (= $8800–$898F, over the overworld walking frames, which
is why the sprites vanish while it shows), BG palette 1 = `PAL_PIKACHU_PORTRAIT`. It is ANIMATED:
a base pic (compressed, 5×5, e.g. `Pic_e4000`) plus overlay graphics (`GFX_e40cc`…, raw 2bpp)
swapped by scripts per mood/happiness — 61 graphics in `gfx/pikachu.asm`
(`PikaPicAnimationScriptPointerLookupTable`). Replacing it convincingly = a whole face set; a
static replacement = poke $8800–$898F while it shows.

**Other pics** (READ): the ghost (`GhostPic`, 6×6, Pokémon Tower), fossils
(`FossilKabutopsPic`, `FossilAerodactylPic`), the send-out/ball animations (`gfx/battle/balls.png`,
OBJ), move animations (`move_anim_*.png`, OBJ), the evolution screen (front pic, whole-screen
palette, `SetPal_PokemonWholeScreen`), the Hall of Fame (front pics + Red front/back).

## 5. Palettes: hardware RAM vs the game's copies

(Mechanism in §1.) WRAM, from the sym file: `wCGBBasePalPointers` $DEE1 (4 × `dw`, pointers into
`CGBBasePalettes` for the four ids of the current screen), `wCGBPal` $DEE9 (8 bytes: ONE palette
being converted — a scratch buffer, rebuilt from the ROM before every transfer, which is why the gag
found forcing it useless), `wLastBGP` $DEF1 / `wLastOBP0` $DEF2, `wBGPPalsBuffer` $DEF5 (4 BG
palettes staged for `TransferBGPPals`), `wPalPacket` $CF2C (the current PAL packet: ids at +1,
+3, +5, +7), `wDefaultPaletteCommand` $CF1B. Hardware palette RAM is reached only through
BCPS/BCPD ($FF68/9) and OCPS/OCPD ($FF6A/B); serverboy mirrors it in `core.gbcBGRawPalette` /
`core.gbcOBJRawPalette` (64 bytes each), which is how `inspect.mjs` reads it.

`CGBBasePalettes` = file `$72af9`, 40 ids × 8 bytes (dumped with `t6.mjs`; the SGB set
`SuperPalettes` `$729b9` is separate and paler). Species → id: `MonsterPalettes` `$72921` (152 bytes,
index 0 = "no mon" = PAL_MEWMON, then dex order; Pikachu = PAL_YELLOWMON $18). There is NO
per-trainer palette: trainers use index 0. Every `PAL_*MON` has colour 0 = white and colour 3 =
#181818, only colours 1–2 differ — so art authored in 4 greys maps predictably onto any species'
pair of colours.

**An untested transient idea for the alpha/Track D**: `wCGBBasePalPointers` are plain 16-bit
addresses dereferenced with bank $1C paged in; a pointer into WRAM ($C000–$DFFF) is unaffected by
the bank. Pointing slot 3 at 8 bytes of our own colours in unused WRAM would make the game's own
fades and flashes produce OUR colours with no ROM patch, until the next palette command rewrites
the pointers (screen change). I did not verify it (needs a flash on cue and a known-free WRAM
spot); the ROM-entry patch the gag uses is the verified route.

## 6. The catalogue

Offsets are UE file offsets (VERIFIED against the sym file + decoded where it says "decoded").
"Transient" = VRAM/WRAM pokes through the door (gone at the next reload of that graphic);
"permanent" = a `patch` of the loaded ROM image (lasts until a state load or reset). Difficulty
is for a CLI that already has the gag's machinery (mode-3 retry, BCPD writes).

| Place | Drawn by | Bytes (ROM / runtime) | Size | Colour · transparency | Transient hook | Permanent hook | Difficulty |
|---|---|---|---|---|---|---|---|
| Enemy mon, battle | BG, `LoadMonFrontSprite` | base stats `$383de`+28·(dex−1) → pic in bank $09–$0D by internal id (decoded); VRAM $9000–$930F, tiles $00–$30, map cols 12–18 rows 0–6 | 5×5/6×6/7×7 source, bottom-centred in 7×7 | BG pal 3 = species `MonsterPalettes` entry; opaque, idx 0 = white | poke $9000 (the gag) | re-encode pic, repoint in base stats, same bank; or patch palette entry `$72af9`+8·id | done / medium |
| Your mon, battle (back) | BG, `LoadMonBackPic` + ×2 scale | base stats back ptr, 4×4 pics (decoded); $9310–$961F tiles $31–$61, map cols 1–7 rows 5–11; also a copy at $8000 | 32×32 source, only 28×28 used, doubled → 56×56 | BG pal 2 (shared with the text box); opaque | poke $9310 (full 56×56 detail) | 4×4 pic, 28×28 effective, chunky | done / medium |
| Trainer (enemy slot) | BG, `_LoadTrainerPic` | `TrainerPicAndMoneyPointers` `$39893` → bank $13 (47 pics, all 7×7, decoded) ; $9000 | 7×7 | BG pal 3 = PAL_MEWMON; opaque; silhouette during slide (idx 0 = holes) | poke $9000 while "wants to fight" (front block has no HUD) | re-encode into bank $13 + repoint (gag already repoints all classes to Bug Catcher's) | easy / medium |
| Red's back (intro) | BG + 21 OBJ (head rows) | `RedPicBack` `$f43b1` bank $3D (decoded); $9310 AND $8000 (OBJ, pal 2) | 4×4 → 56×56 | BG pal 2 = PAL_MEWMON; OBJ copy for the slide-in | poke $9310 + BCPD pal 2 after the slide (the gag's Foxtrot); + $8000 to cover the slide-in too (the gag does not: Red's silhouetted head is OBJ for ~0.5 s, OAM is empty again once the pics stop — VERIFIED frame 5 has 0 OBJs) | repoint `LoadPlayerBackPic`'s `ld de, RedPicBack` (`core.asm:6392`) or overwrite in place if the new pic ≤ 144 B | medium |
| Old man / Oak back | same | `OldManPicBack`, `ProfOakPicBack` `$f44d2` | 4×4 | same | same | same | medium |
| Player front (card, intro, HoF, link) | BG | `RedPicFront` `$11a97` bank 4, 255 B (decoded) | 7×7; card shows only x 0–31, y 0–47 | card: BG pal 0 = PAL_MEWMON; intro: generic | poke $9000 on each screen (4 different screens) | re-encode + repoint the 5 `ld de, RedPicFront` sites or overwrite in place (≤255 B) | medium (one patch covers all) |
| Intro shrink frames | BG | `ShrinkPic1/2` `$11b96`– bank 4 | 7×7 | generic | n/a (1 s) | overwrite | low value |
| Oak, rival pics | BG | trainer table (Prof Oak, Rival1–3) bank $13 | 7×7 | PAL_MEWMON | poke $9000 | as trainers | easy/medium |
| Red overworld | 4 OBJ ×(3 stand + 3 walk frames) | `RedSprite` `$14571` bank 5 (raw 2bpp, 384 B); $8000–$80BF + $8800–$88BF | 16×16 frames; right = X-flipped left | OBJ pal 0 (shared by ALL sprites); idx 0 transparent; idx 1 renders white | poke $8000/$8800 after every map load/text box (the gag) | overwrite `RedSprite` in place (raw, same size — trivial) | done / easy |
| Red on bike / surfing | same | `RedBikeSprite` `$143f1`, `SeelSprite` `$17ab1` / `SurfingPikachuSprite` `$fedef` | same | same | same | overwrite in place | easy |
| Follower Pikachu | 4 OBJ, sprite slot 15 | `PikachuSprite` `$fe7ef` bank $3F (raw 384 B); $80C0–$817F + $88C0–$897F (walking at +$40 tiles in Pokémon Centers) | 16×16 | OBJ pal 0 (the town colour, NOT yellow); transparent idx 0 | poke $80C0/$88C0 (the gag blanks it) | overwrite in place — ALSO changes the party icon | easy |
| NPCs | OBJ | `SpriteSheetPointerTable` `$142a9` (82 × 4 B) → raw sheets banks 4/5 | 16×16 ×6 | OBJ pal 0 | poke their VRAM slot ($8000 + 12k tiles) | overwrite sheet / repoint table | easy |
| Party icons | 2–4 OBJ, symmetric | `MonPartySpritePointers` `$7184d`, `MonPartyData` `$719ba`; tiles at $8000 (`ICON<<2`, +$40) | 8×16 left half per frame, mirrored | OBJ pal 0 (PAL_MEWMON via OBP0); transparent | poke while the menu is up | overwrite the sheet it borrows (Pikachu's = the follower) | easy, but must be symmetric |
| Pokédex entry pic | BG, mirrored | species front pic (same bytes as battle); $9000, map cols 1–7 rows 1–7, COLUMNS REVERSED | 7×7 | BG pal 1 = species palette; opaque | poke $9000 in the reversed layout | same as the enemy front | easy |
| Pokédex text | text | `PokedexEntryPointers` `$4050b` → name, ft, in, lb×10, `text_far` (bank $2E) | — | — | none (not VRAM) | patch (Track B) | medium |
| Emotion bubbles | 4 OBJ | `EmotionBubbles` `$411e5`, 64 B each; $8F80 tiles $F8–$FB | 16×16 | OBJ pal 0; transparent | poke while shown (60 frames) | overwrite in place | easy |
| Pikachu portrait | BG, animated | `gfx/pikachu.asm`: base pics (compressed 5×5) + 2bpp overlays in banks $39 and $3C (the labels ARE file offsets: `Pic_e4000`…`GFX_e7d13`, `…_f0abf`–`f0d82`) ; $8800–$898F, map (7,6)–(11,10) | 40×40 + overlays | BG pal 1 = PAL_PIKACHU_PORTRAIT | poke $8800 while shown | many assets | hard |
| Title-screen Pikachu | BG 12×9 + 12 OBJ | `TitlePikachuBGGraphics` / `OBGraphics` (raw) + `pikachu.tilemap` | 96×72 | title palettes | poke on the title | overwrite raw tiles | medium |
| Ghost / fossils | BG | `GhostPic` `$36920` (6×6), fossil pics | 6×6 | species/ghost pal | poke $9000 | re-encode | easy |

## 7. What this means for the skill

Concrete operations the CLI should offer (all verified mechanisms unless marked):
1. **`pic encode/decode`** — the Gen-1 pic codec in JS. The decoder exists and is exact
   (`research/formats/pic.mjs`, 70 lines); the encoder is Track B's. Every "show me what is there
   now" and every ROM patch of a battle/trainer/player pic needs it.
2. **Art → tiles, per place**, one function with a place argument, because the layouts differ:
   battle/trainer/dex = 7×7 COLUMN-major (dex additionally column-reversed); overworld = 16×16
   frames, 4 tiles ROW-major, 3 standing + 3 walking frames, right and walk-2 by flip; party icon =
   the left 8×16 half of a symmetric figure, two frames; back pic for ROM = 28×28 doubled.
   Alpha < 128 → index 0 everywhere; for BG places warn that index 0 is white paper, for OBJ places
   that index 1 renders white in the overworld (OBP0 = $D0), so overworld art has 3 usable shades.
3. **Place-aware "when"**: each overlay needs its trigger (what screen is up) and its VRAM
   target(s): e.g. Red's back must go to $9310 AND $8000; the follower's walking frames sit $40
   tiles higher in Pokémon Centers; overworld sprites are reloaded on every map load and after
   every text box; the dex writes $9000 in reversed column order.
4. **Palette ops**: set BG pal *n* / OBJ pal *n* through BCPD/OCPD (transient), and patch a
   `CGBBasePalettes` entry (permanent-until-reload) — with the warning that PAL_MEWMON is global
   (trainers, Red, party menu, generic screens) and OBJ palette 0 recolours every overworld sprite.
5. **Silhouette check** for battle art: count enclosed index-0 pixels and show the silhouette
   (indices 1–3 black) so the author sees the holes before the game does.
6. **Inspect** (what `inspect.mjs` does headless): palettes, OAM, the attribute rectangles, and
   the tile map — the ground truth for deciding where a new overlay goes.

Open questions:
- The WRAM-pointer palette trick (§5) — worth one headless test by whoever builds the palette op.
- Pokédex: a custom entry for Foxtrot means species data + text + pic (Track B). On screen, the
  dex pic is the only picture; there is no footprint to draw.
- The trainer card crops the player's front to 32×48; a portrait of Colin must be framed for that
  window, which differs from the intro and Hall of Fame (full 56×56).
- Overworld art has one shared palette with every NPC and Pikachu; a Foxtrot in his own colours
  while NPCs keep theirs is impossible without moving him to OBJ palette 1–3 or 4–7 (needs a
  per-frame OAM attribute rewrite, since PrepareOAMData rebuilds OAM every frame) — or a code patch
  in `PrepareOAMData` (e.g. force palette 1 for sprite slot 0 / 15), plus an OCPD write of palette 1 each time the screen's palettes are rebuilt (in the overworld palettes 1–3 are the packet's unused slots, i.e. PAL_ROUTE). Not tried.

## Evidence files (all under `scratchpad/research/formats/`)

- `pokeyellow.sym` — pret's symbol file for this exact ROM; `lib.mjs` — ROM + sym → file offsets.
- `pic.mjs` — the pic decompressor (exact); `render.mjs` — shades → PNG; `t5.mjs` — the 10-pic
  check; `run/pic-*.png` — those pics decoded from Colin's ROM.
- `basestats.mjs` — pic pointers/banks/sizes for all 151; `t10.mjs` — trainer table, sprite
  sheet table, icon/bubble/dex offsets; `t6.mjs` — the 40 CGB base palettes.
- `hl.mjs`, `inspect.mjs` (OAM, CGB palette RAM, attribute map, VRAM bank 1), `t8.mjs`
  (`wTileMap` + attributes) — headless tools on the deck's own `HeadlessDoor`, with a COPY of the
  deck-dev battery save (`run/copy.sav`; the original was only read).
- Screens: `run/w5.png` (overworld, Lavender, Pikachu following), `run/sheet-b.png` (a trainer
  battle intro in 16 steps: silhouettes, Lass, send-outs), `run/slide2.png` (Red's head as OBJ
  during the slide-in), `run/party.png`, `run/dex.png`, `run/card.png`, `run/sheet-pk.png`
  (Pikachu's portrait). States: `run/world.state`, `run/battle0.state`, `run/bf5|17.state`,
  `run/party|dex|card|pk12.state` — loadable by `HeadlessDoor`'s `load` for the other tracks.

```
HANDOFF
report: /private/tmp/claude-501/-Users-colin-deck/4e7784db-f436-4169-a265-0e013a5a8679/scratchpad/research/formats.md
verified: ROM sha1 = pret build (so pokeyellow.sym offsets are exact); a JS pic decompressor
  decoding 10 pics from the ROM pixel-identical to the disassembly PNGs; base-stats pic pointers,
  banks and sizes for all 151 (47×5×5, 46×6×6, 58×7×7 fronts, all backs 4×4); all 47 trainer pics
  7×7 in bank $13, avg 346 B; SpriteSheetPointerTable/Red/Pikachu/bike/surf offsets; the 40
  CGBBasePalettes and MonsterPalettes; headless (serverboy, HeadlessDoor, save COPY): overworld
  OAM/palettes (all sprites CGB OBJ pal 0, OBP0 $D0 → index 1 white, VRAM bank 1 unused, BG attr
  all 0), battle BG attribute rectangles (enemy pal 3, you pal 2 + text box, HUDs 1/0), trainer
  intro in PAL_MEWMON, Red's head as 15–21 OBJ from $8000 during the slide-in, party icons
  symmetric OBJ pal 0, Pokédex pic mirrored with reversed tile columns at cols 1–7, trainer card
  crop (block x 0–31, y 0–47), Pikachu portrait = BG tiles $80–$98 in PAL_PIKACHU_PORTRAIT;
  LCDC $E3 (8×8 OBJ) throughout.
read-only: the decompression/placement/×2 scaling code paths (home/pics.asm, uncompress.asm,
  scale_sprites.asm), palette engine (engine/gfx/palettes.asm), map sprite loading and the
  Pokémon Center +$40 follower offset, emotion bubbles, Pikachu portrait scripts, title screen,
  Oak's intro/Hall of Fame/link uses of RedPicFront, dex entry text format, no footprints (grep).
open: (1) WRAM wCGBBasePalPointers → a WRAM palette as a transient recolour that survives
  flashes (untested); (2) giving Foxtrot his own overworld palette needs an OAM-attribute code
  patch in PrepareOAMData or per-frame OAM rewrites — alpha decides if worth it; (3) the encoder
  and free-space/bank constraints for permanent pics (Track B); (4) back pics patched into the ROM
  are 28×28 effective — accept chunky, or keep backs transient at full 56×56; (5) the trainer card
  crops the player's front, so a "Colin" front needs framing for 32×48 there and 56×56 elsewhere.
```
