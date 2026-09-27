# Sprites — handoff (27 Sept 2026, end of the session that built steps 1–3)

Read `docs/sprites.md` first (the direction note: facts, framework, build order, Colin's decisions), then
this. CLAUDE.md's Pokemon / Trainer rules and layout describe everything that landed.

## Done since (27 Sept, the next session)
- FOXTROT IS EEVEE: `foxtrot.mjs` takes the species (`foxtrotWrites(rom, species)`, `sprite.mjs foxtrot on [species]`,
  default `eevee`; internal id from yellow.json by dex number; the dex entry is rewritten whole with its text_end).
  Verified headless as Eevee (727 bytes; wild battle, party icon, dex page, back, off = byte-equal) and Vulpix (720, as before).
- The party icon redrawn (pass 5: a 12-wide head, ears and eyes pulled in); pass 4 is in the git history of none — it was never committed.
- Live deck: the set is on as Eevee, the follower re-put, and a wild L5 FOXTROT battle started on Route 8 with the
  battle copy's catch rate 255 and HP at half (a sure Great Ball catch). Party was 5, so he lands in slot 6 — SAVE after.

- `trainer.mjs encounter <name|foxtrot> [--next] [--level N] [--easy]` (forge.mjs `encounter` / `nextEncounter`): instant
  wild battle (verified headless: Foxtrot, Snorlax, levels, refusals) or `--next` = the next GRASS encounter (fills
  wGrassMons, re-fills after map loads, restores after; re-applies the `foxtrot` set) — `--next` is NOT YET TESTED: the
  headless walk was stopped as too slow; try it live on Route 8 (grass x 32–37, y 8–13). `--easy` = catch rate 255 + HP a third.
- yellow.json gained wGrassRate / wGrassMons / wWaterRate / wWaterMons (and yellow-data.mjs asks for them).
- Follower pack cleared on Colin's ask: Pikachu follows until Foxtrot is CAUGHT, then `sprite.mjs put follower foxtrot`.
- PENDING: rename the player to "VILLAGER 0" (Colin chose the 10-letter name knowing the start menu / trainer card allow 7).
  wPlayerName + the OT name of every own mon (OT id matches, OT name = old) in party and current box — Yellow's
  starter-Pikachu check compares the OT NAME (engine/pikachu/pikachu_status.asm), obedience only the OT id.
  Planned as `trainer.mjs name <NEW>`.

## State of the tree

**UNCOMMITTED** on `main` after `775fcf9` (Colin has not said commit for these yet — ask, then commit + push
as one commit in the repo's voice):
- `plugin/scripts/lib/gbplaces.mjs` + `.d.mts`, `packs.mjs`, `plugin/scripts/sprite.mjs` — the overlay runtime
  (step 3: `player` / `follower` places, `overlay` door op, `sprite.mjs put|clear|status|list|foxtrot on|off`)
- `plugin/scripts/lib/foxtrot.mjs`, `pic.mjs`, `plugin/data/sprites/foxtrot-*.{txt,png}`, `scripts/sprites.mjs` —
  the FOXTROT kit (Vulpix relabelled as the patch set `foxtrot`; drawn 28×28 back; drawn party icon; full-block
  front from the sheet; dex page 1'08" 9.5 lb; coat PAL_0F = white, #D67941, #9D5021, #2F2F2E)
- `plugin/scripts/lib/forge.mjs`, `trainer.mjs`, `plugin/skills/trainer/SKILL.md` — `gift <species> [--level] [--nick] [--party]`
- `door.mjs`, `gbcore.mjs/.d.mts`, `src/renderer/src/lib/gameboy.ts` — 'overlay' in OPS, stepCore, the op
- `CLAUDE.md` — layout + Trainer rule updated for all of it
Last full verification (`npm run typecheck && npm run build && npm run smoke`) passed on this tree BEFORE the
final two edits (scripts/sprites.mjs `foxFrontShade` / `foxtrotFront`; foxtrot.mjs `COAT`), which were
re-verified headless (`…/scratchpad/build2/foxtrot/verify.mjs` → on 720 bytes, dex page right, off → 0 diffs).
Run the three again before committing.

## State of Colin's live deck (deck-dev, hook port 47801) as last seen
- Yellow loaded, the save on Route 8. Party slot 6 = a level-1 VULPIX renamed FOXTROT (nickname poked at
  `wPartyMonNicks` + 5×11 = $D2EB) — NOT yet SAVEd in game unless Colin did; a renderer reload restarts the
  game from the last in-game SAVE and loses un-SAVEd pokes.
- Patch set `foxtrot` is ON (installed by `node plugin/scripts/sprite.mjs foxtrot on`).
- The overlay packs are GONE (`sprite.mjs status` → "no packs"): they live in the renderer's memory only and
  a reload dropped them. THAT is why Pikachu, not Foxtrot, is following him. Re-put with
  `node plugin/scripts/sprite.mjs put follower foxtrot` — and the real fix is step 5 (packs in settings,
  re-applied at boot).

## The two things Colin asked for last

1. **FOXTROT should be EEVEE, not Vulpix** ("one unique foxtrot": Eevee exists once, the Celadon gift, so no
   wild Foxtrots). Make the species a PARAMETER of `foxtrot.mjs` (dex number → internal id from
   `PokedexOrder`; the rest is already computed from the cartridge): dex 133, internal $66, SAME pic bank ($0B)
   as Vulpix, back 4×4 like all, our "FOX" species line is shorter than Eevee's "EVOLUTION" so the in-place
   dex entry fits; loosen the Vulpix-specific asserts to "matches THIS species' known bytes". Re-run
   `build2/foxtrot/verify.mjs` with the species (it forces a wild encounter by poking `wCurOpponent` $D058 —
   use $66 — and pokes a mon into the party with `writeParty`). Then on the live deck: `sprite.mjs foxtrot off`
   (the Vulpix set), `foxtrot on` (Eevee), and replace his party mon: the Vulpix in slot 6 becomes a plain
   VULPIX again — remove or leave it, and `trainer.mjs gift eevee --nick FOXTROT --party` needs a free slot
   (party is 6/6 now: Colin deposits one, or ask). Evolutions are untouched (Eevee-Foxtrot + a stone = an
   eeveelution); say so.
2. **The follower**: re-put (above) now; persist in step 5.

## Gotchas learned this session (do not relearn)
- Under `npm run dev`, ANY edit to `src/renderer/**` reloads the window → the game restarts from the last
  in-game SAVE and the in-memory overlay packs vanish. Never run a renderer-editing agent while Colin has
  un-SAVEd pokes; gift, then let him SAVE.
- The dex page MIRRORS every front picture (vanilla Vulpix faces right there, left in battle). Colin decided:
  leave it. Foxtrot's stored front faces left (toward the player).
- Front pics: whites must be shade 0 (`foxFrontShade` in scripts/sprites.mjs), or they wear the coat's
  colour 1. `foxShade` (shade 1 = white) is for OBJ places whose palette has white at 1.
- No icon slot is free: the kit copies the 30-entry icon table to bank $1C's tail with two entries for class
  $B. Free space the kit uses: bank $10 from $41F7A (~250 B), bank $1C from $73EB3 (192 B); the gag's: bank
  $27 $9FB97, bank $2F $BC60F, home $3FEF, RST $0010.
- The `dex HT/WT ?` was a screenshot taken too early: the numbers print ~90 steps after "HT", and only if OWNED.
- A research/framework ask = reports only; never brief an agent to "try" the deliverable (Colin objected).

## Next steps after those two (docs/sprites.md build order)
4. Battle places in the runtime (`enemyFront`, `playerBack`, `trainerBack`, names, `battleMoves`) with a
   headless parity test against the old watch; 5. settings `gbPlaces` / `gbPatches` + looks, the pane
   popover, View ▸ Pokemon ▸ Sprites, migrate `spriteGag: true`, delete `src/main/spritegag.ts`; 6. the CLI as
   the lab. Also: a DRAWN 3/4 front for Foxtrot (the stretched sheet fox stands in), and Colin's likeness
   (his photo → Gemini via the Studio → post-process → cleanup; consented).

## Where the scratch evidence is (session-specific, may vanish)
`/private/tmp/claude-501/-Users-colin-deck/4e7784db-f436-4169-a265-0e013a5a8679/scratchpad/`: `research/`
(the four tracks' scripts, fixtures `formats/run/*.state`, `pokeyellow.sym`), `pokeyellow/` (a shallow clone),
`build/` and `build2/` (the build tracks' verifiers: `build2/foxtrot/verify.mjs` + `vanilla.mjs`,
`build2/runtime/verify.mjs`, `build2/gift/`). The durable copies are under `docs/sprites/`.
