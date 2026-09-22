---
name: trainer
description: Play Pokémon Yellow on the deck's Game Boy (the Pokemon tile) through the trainer CLI — `node "$DECK_TRAINER" look|press|advance|walk|goto|talk|fight|save|load` — toward one goal, the three Kanto starters (Bulbasaur, Charmander, Squirtle). Use for "/deck:trainer", "play Pokemon", "get the starters", "keep playing", "where are we in the game", or any message starting `[deck trainer]`. Only meaningful from a session inside the deck app (DECK_TRAINER and DECK_HOOK_PORT are in its env) with the Pokemon tile on and a Yellow ROM loaded; outside it nothing listens.
---

# Trainer — you are playing Pokémon Yellow, one command at a time

You drive a real Game Boy Color running Pokémon Yellow. The user watches it on the deck's Pokemon
tile beside your session. The CLI reads the game's memory, so you always know exactly where you
are, what your party is, and what the screen says; a screenshot is there when you want one.

**The goal: collect the three Kanto starters.** In Yellow they are gifts:

1. **Charmander** — a trainer on Route 24, just past the top of Nugget Bridge (`talk charmander-man`, say YES). Needs a free party slot.
2. **Bulbasaur** — Melanie, in the small house beside Cerulean's Pokémon Center (`goto melanies-house`, then `talk melanie`). She gives it only if **Pikachu's happiness is 147 or more**; `look` shows the number. Happiness rises by walking around with Pikachu, levelling it, healing it, and winning; it drops when Pikachu faints. If she refuses, go level Pikachu and come back.
3. **Squirtle** — Officer Jenny in Vermilion City (`talk officer-jenny`), only once you hold the **Thunder Badge** (beat Lt. Surge).

So the road is: Pallet → Viridian → Pewter (beat Brock, Boulder Badge) → Mt. Moon → Cerulean → Nugget Bridge → Charmander → Bill's house on Route 25 (you must meet Bill for the S.S. Anne ticket) → Melanie (Bulbasaur, when Pikachu is happy) → Misty is optional → Route 5 → the underground path → Route 6 → Vermilion → the S.S. Anne (beat your rival, get **HM01 Cut** from the captain) → teach Cut to Bulbasaur or Charmander → cut the tree in front of Vermilion Gym → beat Lt. Surge → Officer Jenny → Squirtle.

## The loop

```
node "$DECK_TRAINER" look          # where am I, what does the screen say, the map around me, my party
<one command>                      # goto / talk / press / advance / walk / fight
```

Every command ends by printing the same state, so you rarely need a separate `look`. Read the
`screen:` line before pressing anything: it is the dialogue or menu on screen, exactly. `waiting:`
tells you what the game wants:

- `text` — a text box is up. `advance` presses A through it until there is a choice.
- `menu` — a cursor ▶ is on screen: a YES/NO, a shop, the start menu, the battle menu. Use `press UP/DOWN` and `press A`; `press B` backs out.
- `free` — you can walk. Use `goto`.
- `busy` / `walking` — a fade or a script is running; `look` again in a moment.

Run `node "$DECK_TRAINER" speed 4` once at the start: the tile plays four times faster and your commands return sooner.

## Moving

- `goto <landmark>` walks there by itself, across maps, doors and stairs, and stops when something happens: **battle** (a wild Pokémon or a trainer who spotted you), **script** (someone started talking: `advance`), **blocked** (a person in the way: `look`, then `goto` again), **no path**. Then deal with it and `goto` again; it re-plans from wherever you are.
- `where` lists the landmarks; `where <landmark>` says how far.
- `goto MAP_CONST@x,y` for any square; `door:VIRIDIAN_MART` for a door on the current map; a bare `VIRIDIAN_CITY` for a map.
- `walk right 3` for small moves (it stops at walls, and says so).
- The map drawing: `@` you, `#` wall, `.` floor, `"` tall grass (wild Pokémon), `~` water, `_` a ledge you can only jump DOWN or sideways off, `T` a tree Cut can clear, `D` a door / stairs / cave mouth, `P` a person, `p` Pikachu, `S` a sign. Coordinates count from the map's top-left; y grows DOWNWARD. `exits:` names each door and which edge leads where.
- `talk <landmark>` goes to stand before a person, faces them, presses A, and advances the text.

## Battles

`look` in a battle shows the enemy's species, level, HP and types, your active Pokémon's moves
with PP, and `best:` — the strongest move by type. Then `fight <slot>` uses it and plays the turn
out; `look` again. When something else comes up (a Pokémon fainted, "use next Pokémon?", a new
move to learn) the screen line says so: answer with `press` and `advance`.

- Wild fights: fight the best move; to run, `press B` (the battle menu), `press DOWN`, `press RIGHT`, `press A` — RUN is the bottom-right choice.
- Keep Pikachu alive for Bulbasaur's sake: switch it out when low (PkMN is the top-right choice of the battle menu).
- Heal at a Pokémon Center whenever anyone is under half HP before a gym or a cave: `goto <town>-pokecenter`, `walk up` to the counter, `press A`, `advance`, `press A` (YES), `advance`.
- Brock: Rock/Ground; Pikachu's Electric moves do nothing to Geodude/Onix — use Mankey / Nidoran / Butterfree's Confusion, or Bulbasaur's Vine Whip if you already have it (you will not, yet). Catch a Mankey on Route 22 or a Nidoran on Route 22 and level it. Misty: Water — Pikachu's Thunder Shock. Surge: Electric — a Ground type (Sandshrew from Route 4 / Diglett's Cave) or just levels; his gym's door needs Cut, and the trash cans hide two switches.
- Blacked out (all fainted)? You wake at the last Pokémon Center with half your money gone. Better: `load` your last checkpoint.

## The sprite gag (only when asked)

`node "$DECK_TRAINER" sprite` repaints the battle on screen: the enemy MON's picture becomes the
Notes app icon and is called NOTES APP, the mon YOU SEND OUT becomes the Village logo and is called
VILLAGE (the text too: "A boring NOTES APP appeared!", "Go! VILLAGE!", "Enemy NOTES APP used
TACKLE!"), while Red's back and a trainer's face stay their own. It is paint, not data: tiles in
VRAM, the two battle-only name copies, and the wild-encounter text in the LOADED ROM image, so the
party, the ROM file and every save are untouched; the game redraws its own pictures at every
send-out and after the party / bag screens. `sprite watch` keeps repainting (every 20ms, until ^C)
and is what the user runs in a terminal of their own; outside a battle both do nothing. THE MOVESET: your FIRST party mon's four moves come from `plugin/data/sprites/movesets.json`
(`--moves <name>`; the first set, "update", is NOTES, WITH, FRIENDS, VERSION 2.0; four names of up to 13
letters each) — every one Hyper Beam's animation and power on Solar Beam's charge, TYPE/ APP, 10/10 PP, never
missing ("VILLAGE is updating!", the enemy's turn, then "VILLAGE used THE POWER OF FRIENDSHIP!" and the
beam, whatever the move was called) — and the enemy's mon knows only SPLASH ("No
effect!"). The EXP, level-up and fainted lines say VILLAGE too, and the
game's lines call you VILLAGE USER (`--name`; seven letters fit every line, more run off some). With `--foxtrot` (off by default) Red is FOXTROT: on
the map (wagging his tail standing, trotting as you walk; Pikachu follows unseen) and in a battle's intro,
where he stands in Red's back slot wagging until VILLAGE is sent out. Battle copies only: the party screen shows the
real moves, and `look` in a battle lists the quiz ones. `--front
<png>` / `--back <png>` (56×56, four greys) and `--front-name` (nine characters, "A boring " goes
before it) / `--back-name` (ten) swap the art. `look` and `fight` read the names from the same
battle copies, so they say NOTES APP / VILLAGE meanwhile.

## Checkpoints and notes

- `save <name>` after every milestone (`save pewter-badge`, `save got-charmander`); `load <name>` undoes a disaster. Names are free-form.
- Keep `trainer-notes.md` in your working folder: the goal, what is done, the current plan, what you learned (a trainer you keep walking into, a ledge, where an item is). Rewrite it when things change and re-read it after a compaction. It is your memory.
- Say what you are doing in one line before each command, so the user can follow on the tile. Ask nothing; play. If you are truly stuck for ten commands in a row, say what you tried and what you think is wrong.

## Things that catch people out

- Oak stops you at Pallet's north edge the first time: `advance`, follow him into the lab, take Pikachu, beat your rival, then he sends you to Viridian Mart for a parcel (the clerk hands it over when you walk in: `advance`), bring it back to Oak for the Pokédex.
- Viridian Forest and Mt. Moon are mazes: trust `goto`; it knows the layout. Trainers stand in corridors and battle you on sight; that is a `battle` stop, not an error.
- A person standing where you need to walk makes `goto` say blocked: wait a moment (`look`) and try again; they wander.
- The S.S. Anne leaves after you get Cut; you can never board again. Get HM01 first, then leave.
- Cut: START → POKéMON → the one that knows CUT → CUT, while facing the tree. Then `goto` again.
- Never `press A` blindly at a shop or the start menu: read the `screen:` line, move the cursor with UP/DOWN, then A.
- A new move: YES to learn it if it has more power than the weakest move shown; you then pick which to forget.
