# Sprites — handoff (27 Sept 2026)

Read `docs/sprites.md` first (the direction note: facts, framework, build order, Colin's decisions), then
this. CLAUDE.md's Pokemon / Trainer rules and layout describe everything that landed.

## Where it stands (27 Sept 2026, late)

Steps 1–3, FOXTROT-as-Eevee, `gift` and `encounter` are COMMITTED (`d11ba58`). The live game is DONE for now:
- Foxtrot is CAUGHT: party slot 6 = FOXTROT (Eevee) L5, patch set `foxtrot` on (Eevee). Evolutions are untouched
  (a stone makes an eeveelution).
- The follower overlay is on (`sprite.mjs status` → `follower · kept`): Foxtrot follows, not Pikachu. It lives in the
  renderer's memory, so a ⌘R or any `src/renderer/**` edit under `npm run dev` drops it again. Re-put it with
  `node plugin/scripts/sprite.mjs put follower foxtrot`. The fix is step 5.
- The player is VILLAGER 0: wPlayerName and all six party OT names (checked live). Whether Colin SAVEd in the game
  since is unknown. Ask before anything reloads the renderer.

Committed after `d11ba58` (the catch fix, the auto-follower, `name`):
- `forge.mjs` `settleEnemy`: waits for THIS battle's enemy copy (species, level and a max HP the species can have at
  that level; the copy is the last battle's until then). `--easy` also pokes `wEnemyMonActualCatchRate`, the byte the
  ball actually reads. Poking only the struct's +7 left the species' own rate in charge. HP is `sureHp(maxHp)`, the
  highest HP ≤ a third where a Poké Ball is sure (checked for max HP 12–400).
- `forge.mjs` `owned` / `battleOver`. In trainer.mjs, `encounter foxtrot` waits out the battle and, if one more
  Foxtrot is owned, installs the follower overlay (FOXTROT CAUGHT = FOXTROT FOLLOWS).
- `forge.mjs` `rename` + `trainer.mjs name <NEW>`: wPlayerName and the OT name of his own mons (OT id matches, OT name
  = old) in party and current box. Pikachu's starter check compares the OT NAME. `encounter --next --name NEW` keeps
  the rename applied across a reload while it waits.
- `yellow.json` / `yellow-data.mjs`: `wEnemyMonActualCatchRate`.
- `encounter --next` has run live (that is how he was caught). It has not been run headless.

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

## Next steps (docs/sprites.md build order)
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
