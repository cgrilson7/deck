# Track C — a framework for Claude to draw and test Game Boy sprites

Rewritten after the coordinator's correction: this is a FRAMEWORK report. A few drawings were made before the
correction; they are kept only as evidence for the framework (§0). No more art was made after the stop, no drawing was
iterated after it, and `studio.mjs gen` was never run. Everything is in `research/drawing/` (called `D/` below).

## 0. Evidence already on disk (what worked, what did not)

Helpers (small, throwaway, reusable as the seed of the CLI):
- `D/grid.mjs`: text grid (`.:+#` or `0-3`) → grey PNG + 8× grey + 8× palette preview (`PAL=fox` = the gag's OBJ coat, pale green = transparent).
- `D/rle.py`: mirrored run-length rows (the left 28 columns as `12. # 4+ …` tokens, mirrored to 56) → grid.
- `D/shapes.mjs`: ellipses/polygons → 56×56 shades, then an automatic 1-px outline.
- `D/photo.mjs`: photo → 56×56 five ways (fixed / quantile / Floyd–Steinberg / Bayer / cartoon).
- `D/hlshot.mjs`: the headless battle loop (ROM + battle state → `sprites.mjs apply()` into the front/back slots → 3× screenshot; a 28×28 PNG is doubled first).
- `D/owshot.mjs`: the headless overworld loop (16×16 down/up/walk frames → Red's OBJ tiles $8000/$8040/$8800/$8840 + OBJ palette 0 → shots facing down, up, after a walk).
- `D/look.mjs` (crop + zoom), `D/sheet.mjs` (contact sheet), `D/stats.mjs` (shade statistics of a folder of pics).
- Fixtures: `D/hl/session.state` (a trainer battle in Viridian Forest, COPIED from another session's scratch
  `…/82d48708…/scratchpad/t/session.state`; it already carries that session's ROM text patches), `D/ow/session.state`
  (made here by `trainer.mjs --headless … intro`: Red's bedroom, 1.3 s).

Art made before the stop (one line each):
- `D/foxback-v1..v4` (+`-8x`, `-8x-color`), in game `D/hl-foxback-v4.png` — Foxtrot from behind, 28×28 doubled. v1 read as a
  cat; v2 (big black-tipped ears) as a fox; v3/v4 (pear body, tail wrapped round the feet) good — indistinguishable in
  kind from Gen-1 back sprites. WORKED, 4 passes.
- `D/ow-down-v1`, `ow-up-v1/v2`, `ow-down-walk-v1`, `ow-up-walk-v1`; sheets `ow-v1-color.png`, `ow-v2-color.png`; in game
  `D/hl-ow-v2-all.png`, `D/hl-ow-v2-zoom.png` — 16×16 overworld Foxtrot. Down: WORKED first try (reads as a fox at 1×).
  Up: v1 an orange blob, v2 fair (fox-or-cat from behind).
- `D/colin-v1..v3` (`.rle`, `.txt`, `.png`, `-8x`), in game `D/hl-colin-v3.png` — generic bearded man with glasses, 56×56
  bust. v1 had a white chin/chest (the mirror left the centre empty); v2 a white notch from a TOKEN MISCOUNT; v3 WORKED
  (reads as a bearded man with glasses in the enemy slot, in Notes' palette).
- `D/foxback-shapes-v1` (+`-8x`) — the shapes → raster route, one pass: clean symmetric silhouette, but stiff clip-art;
  auto-outline good on the silhouette, wrong at internal seams. PARTLY worked.
- `D/photo/ulises-all-6x.png` (+ the five single PNGs; `ulises-nomask-*` without a mask) — a Gemini-made photoreal
  bearded man from the Studio gallery (not a real person) through `photo.mjs`: quantile and Floyd–Steinberg read as a
  PHOTO of a man, not as Game Boy trainer art; fixed thresholds too dark; cartoon (posterize + Sobel edges + rim) muddy.
  DID NOT reach the trainer-pic style. Source: `D/photo/show-me-ulises-400.png`.
- References: `D/ref-trainers-6x.png` (Youngster, Gentleman, Scientist, Super Nerd), `D/ref-backs-8x.png` (Red, Pikachu,
  Bulbasaur, Eevee backs), `D/ref-eeveeb-12x.png`, `D/ref-vulpixb-12x.png`, `D/ref-ow-red-8x.png`, `D/ref-ow-pikachu-8x.png`,
  `D/src-fox-r0f0-16x.png` (the standing fox), `D/src-foxsheet-3x.png`, `D/src-foxback-f0-8x.png` (the shipped `fox-back.png`
  frame 0 — note it is a SIDE view blown up, not a view from behind), `D/ref8/` (every trainer/player pic as 8-bit PNG).
- Loop timing shots: `D/hl-baseline.png`, `D/hl-timing.png`.

## 1. Facts the framework rests on (read in the disassembly, verified in the emulator where marked)

- **Back pics are HALF resolution.** Every mon back and Red's back is a 32×32 PNG of which the top-left 28×28 is used,
  doubled to 56×56 at load: `engine/battle/scale_sprites.asm:1-4` ("assumes that input sprite chunks are 4x4 tiles,
  and the rightmost and bottommost 4 pixels will be ignored resulting in a 7*7 tile output"), `LoadMonBackPic`
  `engine/battle/init_battle.asm:160-170` (UncompressMonSprite → `predef ScaleSpriteByTwo` → VRAM), Red's intro back
  `engine/battle/core.asm:6385-6398`. So the authentic back look is 28×28 art in 2×2 blocks. VERIFIED: a 28×28
  drawing doubled and poked at $9310 sits exactly like a native back (`D/hl-foxback-v4.png`). Art is bottom-anchored
  (Eevee's back uses rows 9–27 of 28).
- **Front/trainer pics are 1:1**: all 47 `gfx/trainers/*.png` and `gfx/player/red.png` are 56×56; mon fronts 40/48/56.
- **Overworld sprites are 16×16 = four 8×8 OBJ tiles, shade 0 TRANSPARENT**, so three visible shades; white inside
  the sprite needs an OBJ palette whose colour 1 is white (the gag's `FOX_COAT`, `plugin/scripts/lib/sprites.mjs:827`).
  `gfx/sprites/red.png` is 16×96: down, up, left standing, then down, up, left walking (right = left flipped by the
  game). The chibi proportions: head = top 9–10 rows, body 5, feet 1, a 1-px outline all round.
- **The palette is the place's, not the drawing's.** A drawing is four SHADES; the colours come from the slot: the back
  slot wears the species' palette (VERIFIED: the fox back came out Pikachu-yellow), the enemy slot BG palette 3, the
  overworld OBJ palette 0. A drawing must therefore carry a PALETTE REQUEST with it (4 RGB colours), applied by the
  overlay (`slotPalette` / `notesPalette` / `foxPalette` in sprites.mjs are today's three).

## 2. The authoring representation

What I saw drawing three subjects at three sizes:

| Representation | Tried on | Result | Failure mode |
|---|---|---|---|
| **Text grid** of `.:+#` (= 0–3), one line per row, fixed width | 28×28 back, 16×16 overworld | best for ≤ 28×28: every pixel is a deliberate choice, the Read-tool preview maps 1:1 to lines I can edit; 2–4 passes to good | row-length slips (a missing char shifts the rest of the row; my converter padded silently — must REJECT instead); hard past ~32 wide |
| **Mirrored run-length rows** (left half as `n<char>` tokens, mirrored, then per-pixel overrides) | 56×56 bust | 3 passes to good; a symmetric subject at a quarter of the typing | token miscounts (the white notch in `colin-v2`); a mirror leaves the centre line to chance; asymmetry needs overrides |
| **Shapes → raster** (ellipses, polygons, painter's order) + auto outline | 56×56 fox back | fastest to a clean silhouette (1 pass), perfect symmetry | stiff clip-art look; 1-px features (eyes, nostrils, fur tufts) cannot be expressed; seams between shapes outline wrongly |
| **Per-tile rows** (8×8 blocks) | not authored | — | the mind's shape spans tile borders; useless to author in, but the natural STORAGE / DIFF unit (VRAM is tiles) |

**Recommended canonical format** — one file per frame, a text grid with a header:
```
; sprite foxtrot-back   place: back   size: 28x28   shade0: white   palette: #FFFFFF #F8B070 #D67941 #2F2F2E
; legend . 0  : 1  + 2  # 3
............................
.........#..........#.......
…
```
- The grid is the source of truth (diffable, reviewable, editable with Edit). The CLI VALIDATES: exact width and
  height for the place, legal characters only, and prints a ruler (column tens/units) + row numbers when it rejects.
- Input sugar, compiled to the same grid: `mirror` (left half + overrides), run-length tokens, and a `shapes` layer
  for BLOCKING at 56×56 that the session then refines pixel by pixel. Author back pics at 28×28 always.
- Display: the 8× preview in greys AND in the place's palette, with a faint 8-px tile grid (the per-tile view is how
  the art will be cut, so show it), and a 1× in-game shot (§4).

## 3. Conversion pipelines — specs (no runs beyond the evidence in §0)

### 3a. From the fox sheet (exists: `scripts/sprites.mjs`)
- Input: `src/renderer/src/assets/fox.png`, 14×7 frames of 32 px, art at x 4–25, y 14–31; row 0 idle (5), row 2 run (8);
  row 4 NEVER (Colin's rule).
- Steps (as shipped): per target cell, the source pixels VOTE (outline 3, oranges 2, white/light grey 1, clear 0;
  outline wins ties); overworld = rows 1:1, 22 columns squeezed to 16, mirrored to face left; `fox-back.png` = rows 3×,
  columns 2.5×.
- Limits: only SIDE views exist. A view from behind, from the front (down), or up cannot be derived — there is no
  depth to rotate; `fox-back.png` is a side view scaled up (see `D/src-foxback-f0-8x.png`). Those views are drawn
  (§2) or generated (§3d), using the sheet only as the colour/marking reference (black ear tips and legs, white muzzle,
  chest and tail tip, two oranges).
- Failure modes: non-integer scale factors (2.5×) make uneven pixel widths; the vote loses 1-px features.

### 3b. From a photo (Colin's portrait)
- Input: a photo, a crop box (head + shoulders) and a SUBJECT MASK. Local tools cannot segment a person; the mask
  comes from the user (a rough polygon), from Gemini (§3d: "same person, plain white background"), or macOS Vision
  via a small Swift helper (not tried).
- Steps: area-average to 56×56 (a 28×28 pass for a back view); quantize over the SUBJECT only with per-image
  quantiles (brightest ~20 % → 0, next ~35 % → 1, next ~30 % → 2, darkest ~15 % → 3); force a black 1-px rim on the
  silhouette; background = shade 0.
- Evidence (`D/photo/ulises-all-6x.png`): quantile / Floyd–Steinberg give a recognisable PHOTO; fixed luminance
  thresholds go dark; Sobel edges as outline are noise at 56 px. None matches the trainer-pic style (line art, flat
  fills). Verdict: direct photo quantization is a PREVIEW, not the pipeline. The pipeline for a likeness is photo →
  Gemini stylization (reference image) → §3d post-process → a Claude cleanup pass against the checklist (§5).
- Failure modes: busy backgrounds leak without a mask; glasses and beards alias into noise; dithering fights the
  style (trainer pics use little).

### 3c. From an icon (exists: village.png / notes.png)
- Input: an app icon PNG with alpha. Steps: the per-cell coverage of chosen colour classes (stroke = min(r,g,b) high,
  etc.), boxed to 48 and centred in 56, a shade-3 border where opaque meets transparent. Works because icons are flat
  colour already. Failure mode: gradients need a dither decision (Village's disc).

### 3d. Gemini via the Studio + background keying
- Conditions for running it later: a deck on the hook port (47801 = deck-dev was up; a key is set in deck-dev's
  `config.json`, value not read), the live Game Boy not involved (Studio never touches it). NOT RUN here.
- Request: `studio.mjs gen --size 512 --ratio 1:1 [--ref <fox sheet crop | photo>] --out <scratch>/x.jpg "<prompt>"`.
  512 is the smallest `imageSize` (Flash only: `STUDIO_SIZES` in `src/shared/types.ts:909`), so the image is always
  downscaled by us; the reply is JPEG (`src/main/studio.ts:12`), no alpha.
- Prompt template (to be tested):
  > Original Game Boy (1998) sprite of {subject}, {view: from behind / facing the viewer / 3/4 front}, in the style of
  > Pokémon Red/Yellow {trainer pictures | back sprites | overworld sprites}. Exactly {56×56 | 28×28 | 16×16} square
  > pixels, each pixel a hard-edged solid square, drawn large and centred, filling the frame, bottom-anchored.
  > Only four flat greys: white, light grey, dark grey, black. A 1-pixel black outline around the figure. No
  > anti-aliasing, no gradients, no dithering except tiny checker texture in hair, no shadow on the ground, no text.
  > Background: one flat solid {pure white | #00FF00} filling everything outside the figure.
- Background choice: for BG places (battle pics, trainer pics, dex) use WHITE — shade 0 is white on screen anyway —
  and separate the figure by FLOOD-FILLING near-white from the border (the closed black outline stops the fill, so
  white inside the figure survives). For OBJ places (overworld) use a key colour opposite the subject's hues (GREEN for
  an orange fox; magenta for a green subject), because there shade 0 is transparent and interior white must become
  shade 1.
- Post-process: (1) key: RGB distance to the key colour ≤ ~80 plus the border flood fill; erode the mask 1 source px
  (JPEG 4:2:0 chroma blurs edges ~2 px). (2) crop to the mask's bbox, pad to square, bottom-anchor. (3) find the
  model's pixel pitch (histogram of run lengths of equal colour along rows/columns; the mode ≈ pitch); if none
  (the model painted smoothly) fall back to area-average. (4) downsample to the grid by MAJORITY per cell (mode, not
  mean: means make greys out of black lines). (5) snap to shades by luminance with 3 thresholds from the figure's own
  histogram (or k-means into 3 + background). (6) enforce the rim: every figure pixel touching background → 3.
  (7) emit the §2 text grid, so the session can clean it up by hand.
- Failure modes to expect: pitch not integral or drifting (model ignores the grid); soft glow / drop shadow around
  the figure (keyed as figure); key-colour spill into fur; four greys ignored (colour art) — handled by (5); a
  different subject pose than asked; likeness requests of a real person may be refused or drift.

## 4. The test loop — spec, with measured timings

`draw (grid) → PNG → headless poke/patch → settle → screenshot → crop+zoom → look → fix → … → apply live`

Measured here (Apple Silicon, serverboy in-process, `D/hlshot.mjs`): load ROM 35 ms, load a 4 MB state +27 ms, paint
(both battle slots through `apply()`) +14–40 ms, 8 steps + 3× screenshot +8 ms; **0.20 s wall-clock per iteration
including node start-up** (`/usr/bin/time`). The overworld loop with three shots and turning/walking: 99 ms in-process.
The bottleneck is the model LOOKING (a Read of the PNG), not the emulator. `trainer.mjs look --shot` alone: 0.24 s.

The CLI should offer:
- `sprites fixture <battle-back|battle-front|trainer-intro|overworld|dex|party>`: a named headless save state per place
  under the scratch/userData dir, built once by driving the game (overworld: `intro`, 1.3 s; battles: a scripted walk
  into grass or a forged encounter — today the only battle state I had was copied from another session).
- `sprites try <place> <grid|png> [--palette …]`: validate → PNG → load fixture → paint through the same code the
  runtime uses → settle N steps → screenshot → ALSO a crop of the place's box at 6–8× (I needed zooms to judge
  1× results) → print the paths. Never touches the live Game Boy.
- `sprites apply <place> <name>`: only after `try`, to the live game, as an overlay (Track D).

Observed pitfalls the loop must handle (all seen here):
1. After a state load the game may still be (re)loading tiles: my first overworld paint was overwritten and the shot
   showed Red (`D/hl-ow-v2-all.png`, left). Paint AFTER a settle, and repaint before the shot if the bytes changed.
2. Palette writes are undone by the game's fades (the fox coat did not stick; the fox wore Red's red). Renew the
   palette immediately before the screenshot, and in the runtime on a clock (as the gag does).
3. Mode-3 dropped VRAM writes: 1 retry in 8 pokes here; the read-back-and-retry must stay (or move into the tick).
4. The battle fixture carried another session's ROM patches (NOTES APP, VILLAGE names): fixtures must be made from a
   clean ROM image or say what they carry.

## 5. Style checklist for a drawing pass (from `gfx/`, measured with `D/stats.mjs` over all 47 trainer pics + Red)

Battle / trainer pics (BG, 56×56; back pics 28×28 doubled):
- [ ] Background is shade 0 = white and covers the rest of the square (trainers: 51–87 %, median ~72 %).
- [ ] The figure is bottom-anchored: it touches the bottom row (all 47 trainer pics: bbox bottom y = 54–55), full
      length for trainers (head near the top), and for a back pic sits on the floor of the 28×28.
- [ ] Black (3) is the LINE, ~6–31 % of the square (median ~13 %); the greys are FILLS, ~4–12 % each.
- [ ] Outline is 1 px, black, but may break where a light area meets the white (only ~40–75 % of trainer edge pixels
      are black) — do not force a heavy uniform rim on everything.
- [ ] Light grey (1) is the main body fill; dark grey (2) for hair, shadow side, dark clothing.
- [ ] Dithering: SPARING — 2×2 checker texture exists (15–160 checker cells per trainer pic; Hiker 160, Giovanni 4)
      for hair, fabric, beard; never as a gradient over large areas.
- [ ] Features at 1 px (eyes, nostrils), no anti-aliasing, no isolated single grey pixels as "smoothing".
- [ ] Back pics: drawn at 28×28 so the 2×2 blocks match the game; 3/4 rear view facing up-right toward the enemy.
- [ ] Reads at 1× on the real screen (check the in-game shot, not only the 8× preview) in the place's palette.

Overworld (OBJ, 16×16, frames down / up / left + walking):
- [ ] Shade 0 only outside the figure (it is transparent); white inside = shade 1 with a white palette colour 1.
- [ ] Closed 1-px outline; chibi proportions (head ≈ top 9–10 rows); both feet on row 15.
- [ ] Walking frame = standing frame with one foot lifted (the game mirrors for the other step).

## 6. Verdict per place (candid)

| Place | Claude alone? | Notes |
|---|---|---|
| Battle back slot (Foxtrot as your mon, or in Red's slot), 28×28 doubled | **Yes, good** | 4 passes to a sprite of Gen-1 quality. The best-suited place: small, and the doubling forgives. |
| Overworld 16×16, down / up / walking (follower or player) | **Yes, good (down) / fair (up)** | Side views already come from the sheet by conversion; down/up must be drawn (or generated). Easiest size to hand-place. |
| Party-menu icon (16×16, 2 frames; Track A has the format) | **Yes** (by extension of the above) | Not tried. |
| Generic person / trainer-style bust or figure, 56×56 | **Yes, fair→good** | 3 passes for a bust; a full-length 56×56 trainer figure is more work (not tried) and wants the shapes-blocking + pixel-refine route. |
| Foxtrot front pic (enemy / Pokédex), 56×56 | **Probably yes, fair** (not tried) | Needs a front or 3/4 view the sheet does not have; Gemini + §3d would give richer fur and pose, then a cleanup pass. |
| A LIKENESS of Colin (trainer, player back, trainer card) | **No** | Needs his photo → Gemini stylization → §3d → Claude cleanup against §5. Direct photo quantization (evidence §0) does not reach the style. |
| Large pictures (title screen, intro Oak, anything beyond 7×7 tiles) | **No** | Gemini + conversion or the user's art; out of proportion for hand-placing. |

## 7. What this means for the skill

Operations: `sprites new <name> --place <p>` (writes a blank grid with the header and legend for that place's size),
`sprites check <grid>` (size, characters, shade budget, outline and §5 checks as warnings, a ruler on error),
`sprites preview <grid>` (8× grey + palette + tile grid), `sprites mirror|shapes` (input sugar → grid),
`sprites convert sheet|photo|icon|gemini <src> --place <p>` (→ a grid, never straight into the game),
`sprites fixture <place>`, `sprites try <place> <grid>` (headless screenshot + zoom), `sprites apply` (live, via the
overlay machinery of Track D). Store art as grids (+ generated PNGs) in `plugin/data/sprites/` (shipped) and
`userData/sprites/` (made in sessions, e.g. Colin's).

Open questions: which Gemini prompt actually yields a detectable pixel pitch (needs 2–3 real gens when Colin allows);
where the battle fixtures come from (forge an encounter headless vs ship a state — shipping a state ships a ROM image
inside it, 4 MB, and the ROM is not ours to ship); whether to author front pics at 56×56 directly or at 28×28 doubled
then refined; how the palette request is stored per sprite vs per place.

```
HANDOFF
report: /private/tmp/claude-501/-Users-colin-deck/4e7784db-f436-4169-a265-0e013a5a8679/scratchpad/research/drawing.md
verified: drew (before the stop) a 28×28 Foxtrot back (4 passes), 16×16 overworld down/up/walk frames (2 passes) and a
  56×56 bust (3 passes) as text grids / mirrored RLE, plus one shapes→raster pass; painted them into the real game
  headless (battle back + front slots via sprites.mjs apply(); overworld OBJ tiles $8000/$8040/$8800/$8840) and looked
  at the screenshots; one photo→56×56 run with five quantizers; measured the loop (0.20 s wall per iteration; ROM 35 ms,
  state +27 ms, paint +14–40 ms, shot +8 ms; overworld 99 ms; `intro` fixture 1.3 s); shade statistics over all 47
  trainer pics + Red; observed tile reload after state load, palette overwritten by fades, 1 mode-3 retry in 8 pokes.
read-only: scale_sprites.asm / init_battle.asm / core.asm (back pics 28×28 doubled), gfx/sprites/red.png frame layout,
  sprites.mjs (apply, foxFrames, FOX_COAT), door.mjs, trainer.mjs, scripts/sprites.mjs, studio.mjs / studio.ts /
  types.ts (sizes 512–4K, JPEG replies). studio.mjs gen was NOT run; nothing under /Users/colin/deck was edited; the
  live Game Boy was never touched.
open: the Gemini prompt + pitch detection need real test gens (with Colin's go); battle fixtures (forge vs ship);
  56×56 direct vs 28×28-doubled for front pics; per-sprite palette requests; a likeness of Colin needs his photo and
  his consent to send it to Gemini.
```
