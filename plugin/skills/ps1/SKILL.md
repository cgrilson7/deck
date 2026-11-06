---
name: ps1
description: Read and change a running PlayStation game on the deck's PS1 tile — its RAM (read, write, find, a value scanner, freezes), its buttons, save states and screenshots — through `node "$DECK_PS1" …`. Use for "/deck:ps1", "play the PS1", "find my running back's speed", "give him 99 speed", "freeze the clock", "what's on the PS1 screen", tuning or cheating in a PS1 game (Madden NFL 2005 is the usual disc), or any message starting `[deck ps1]`. Only meaningful from a session inside the deck app with the PS1 tile on and a disc running.
---

# The PS1: a game you can open up

The deck's PS1 tile runs a real PlayStation (RetroArch's pcsx_rearmed core in wasm, Colin's own BIOS and
discs). The door reaches straight into its 2 MB of RAM while Colin plays, so "upgrading" a game is
finding where it keeps a number and changing or freezing it.

```bash
P="${DECK_PS1:-$(dirname "$DECK_MOL")/ps1.mjs}"   # a session older than the door has no DECK_PS1
node "$P" status                 # disc, RAM found?, freezes, the scan
node "$P" shot                   # a PNG path: Read it to see the screen
node "$P" read 0x800A1234 32     # bytes as hex
node "$P" write 0x800A1234 63 --size 1
node "$P" freeze 0x800A1234 99 --size 1     # held every frame until `unfreeze`
```

## Finding a value: the scanner

The DuckStation memory-scanner loop, one step per command. Ask Colin to make the value change in the game
between steps (or press buttons yourself and `shot` to check).

```bash
node "$P" scan start --size 1 --value 87    # a value you can see on screen (a rating, a score)
# …the value changes in the game (another player selected, a down played)…
node "$P" scan eq 74                        # keep what now reads 74
node "$P" scan list                         # a handful left: try writing one, `shot`, see if the screen agrees
```

For a value you cannot see, scan by movement: `scan start --size 2`, then `changed` / `unchanged` /
`inc` / `dec` as it moves. Stats in sports games are usually one byte; clocks and scores two or four.

## Rules

- **Save a state before writing** (`state save before-edit`): a bad poke can crash the game, and the
  memory card only holds what the game itself saved. `state load before-edit` puts it back.
- Writes are live and lost on reset or disc load; **freezes** last until `unfreeze` or a new disc.
  When a change should stick, say which address and value it was so it can be applied again.
- Don't swap discs or reset while Colin is mid-game without asking.
- Buttons: `press cross`, `press up,cross --ms 300`; names are up down left right cross circle square
  triangle l1 r1 l2 r2 start select.
