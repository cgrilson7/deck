---
name: lesson
description: Teach from a LESSON FILE on the deck's Lesson tile — a markdown file of the learner's repo cut into cards (the idea in a few lines, its cited source, a figure, a button that puts the right molecule up, and a question the learner answers IN the tile), one card up at a time — and SEE what they answered. Use for "show the lesson", "start the lesson", "next card", "go back a card", "quiz me", "ask me something", "what did I answer", "write a lesson on …", "/deck:lesson", any work on `lessons/*.md` or `curriculum.json`, and THROUGHOUT a teaching session in a learning repo (e.g. ~/grail: protein folding from the chemistry up), beside /deck:mol — the Molecule tile shows the molecule, this shows the idea. The CLI is `node "$DECK_LESSON" show|goto|mark|note|ask|look|home|reset|tiles|close|lint`; `look` returns the card that is up AND THE LEARNER'S ANSWERS, which is what you teach to. This skill is also the AUTHORING REFERENCE for the lesson file format. Only meaningful from a session running inside the deck app (it sets DECK_LESSON and DECK_HOOK_PORT in every session's env) with the Lesson tile on; `lint` alone needs no tile.
---

# Lesson — the card is the lesson, the terminal is the margin

The learner reads the TILE, not your terminal. A lesson is a markdown file in THEIR repo
(`lessons/*.md`, version-controlled, written by you, citing real sources); the deck's Lesson tile
renders it as cards and never writes to the repo. You put a card up, point at it, let them answer
its question in the tile, `look` at what they chose, and teach to THAT.

```bash
L="${DECK_LESSON:-$(dirname "$DECK_MOL")/lesson.mjs}"    # a session older than the Lesson tile has no DECK_LESSON
node "$L" lint lessons/01-atoms-and-bonds.md && node "$L" show lessons/01-atoms-and-bonds.md
```

Every command prints JSON. `{ "ok": true, "tile": 1, … }` means it is on screen.
`{ "ok": false, "error": … }` says what to fix — read it, it is written for you.

## Rules

- **`$DECK_LESSON` is the only door.** Do not print the lesson into the terminal, do not build an
  HTML page, do not open the file in the preview pane as a substitute: the tile exists and the
  learner's eyes are on it.
- **Outside the deck, say so.** If neither `$DECK_LESSON` nor `$DECK_MOL` is set, tell the user
  this needs a session started by the deck app, and teach in words. `lint` needs the deck too (the
  parser lives there, so the linter and the tile can never disagree).
- **Tile off?** The error says "turn on the Lesson tile": pass that on (the right column's `+`
  picker, or View ▸ Lesson ▸ Show Lesson Tile), then run the command again.
- **Every card cites a source.** A real one you have actually consulted (a textbook section, a
  paper, a PDB entry), in the front matter, cited with `[^id]` on the sentence it supports. A card
  that cites nothing falls back to the file's list; a file with none shows "unsourced". Never
  invent a citation: no source = say so and find one.
- **One idea per card.** A heading, a few lines, at most one table, one `mol` button, one `ask`.
  If you need "and also", that is the next card.
- **Never put an answer's explanation in the terminal before they have answered.** The `why:`
  shows in the tile after they answer. You speak after `look`.
- **The fix belongs in the lesson.** When an explanation did not land and you found a better one,
  EDIT THE FILE (the tile reloads it live, keeping the card) — not only the chat.
- **Two sentences in the terminal, no more**, per card. The card carries the content.

## The teaching loop

1. **Write or open the lesson file**, `lint` it, `show` it. (`show` answers with the card ids.)
2. **One card at a time.** `goto <id>`; run its molecule yourself with `/deck:mol`, or point at the
   card's ▶ button and let them press it; say the idea in two sentences.
3. **Let them answer the card's `ask` IN THE TILE.** Then `look`: `cards[].asks[].answered` has
   their answer in the option's own words and whether it was right; `since.events` is what
   happened since your last look (answers, buttons pressed, cards they paged to on their own).
   Teach to the answer they gave — a wrong answer is the most useful thing on the screen.
4. **Point.** `mark "bent"` lights a phrase on the card and scrolls to it (it must be worded as
   the card words it; `mark --clear`). `note "look at the **angle** in Molecule 2"` pins a callout
   over the card. `ask --q … --opt … --right n` adds a question on the spot. Marks and the note
   go when the card changes; none of the three touch the file.
5. **Record progress** in `curriculum.json` (below): tick the item, set the block's status, and
   append any question worth taking to Dad. The tile's home view re-reads it within seconds.

## Commands

```
show <file.md> [--card <n|id>] [--new | --tile <n>]   put a lesson up (.md, ≤ 1MB). The same file again keeps the card that is up.
goto <n|id|next|prev>
mark "<phrase>" | mark --clear            several marks may be up; `mark "<phrase>" --clear` takes one away
note "<markdown>" | note --clear
ask --q "<question>" [--opt "<text>"]… [--right <n>]… [--why "<text>"] [--id <id>]
                                          no --opt = a free-text answer (nobody marks it: read it with look)
look                                      file, title, card {n,id,heading}, of, cards[{n,id,heading,asks[{id,q,answered}]}],
                                          marks, note, molRuns[{label,card,ok,tile,at}], since{first,events[]}
home                                      back to the curriculum
reset <file.md>                           forget that file's answers (to run the lesson again)
tiles | close [--tile <n>]
lint <file.md>                            no tile needed; ok:false lists `problems` [{line, card, message}]
```

Up to 4 Lesson tiles. `--tile <n>` on anything; without it, the tile the door used last (every
answer carries `tile`). `show … --new` takes the first tile that is showing the curriculum, else
opens one more. One lesson at a time is the rule; a second tile is for a reference card you want
to keep up (a table of electronegativities) while the lesson moves on.

## The lesson file

Plain markdown with a small front matter. `## ` headings cut it into CARDS; text before the first
`## ` is the intro card (id `intro`, titled by `title`). A card's id is `{#id}` at the end of its
heading, else a slug of the heading — give every card an explicit `{#id}`: `goto`, the
curriculum's `card`, and the learner's kept place all use it.

````markdown
---
title: Atoms and bonds
block: 1
sources:
  - id: covalent
    cite: OpenStax, Chemistry 2e, §7.2 Covalent Bonding
    url: https://openstax.org/books/chemistry-2e/pages/7-2-covalent-bonding
---

Two or three sentences of why this lesson exists.

## Polar covalent: water {#water}

Oxygen pulls the shared electrons harder than hydrogen does… [^covalent]

```mol
label: Water — charges and the angle
show water --labels charges
measure 2 1 3
```

```fig
src: figures/electronegativity.png
caption: Pauling electronegativity across the first three rows
```

```ask
id: water-linear
q: If water were linear, what would its net dipole be?
- The same, 1.85 D
- * Zero — the two bond dipoles would cancel
- Twice as large
why: Dipoles add as vectors. 180° apart, equal and opposite, they sum to zero.
```

```dad
Did you ever trust partial charges from a force field, or only their trends?
```
````

- **Front matter** is a YAML subset: `key: value` lines, and ONE list of maps, `sources`
  (`id`, `cite`, optional `url` — http(s), opens in the browser). Unknown keys are kept and ignored.
- **`[^id]`** in prose is a numbered footnote mark for that source; the card's footer lists what
  it cites.
- **` ```mol `** — a ▶ button. `label:` is its text; every other line is ONE `mol.mjs` command,
  written exactly as its argv (`show water --labels charges`, `measure 2 1 3`,
  `highlight --hbonds`, `label "elem O" "pulls harder"`), run in order through the same door
  `$DECK_MOL` uses. A `show … --new` puts it in a Molecule tile of its own (pressing the button
  again reuses that tile); bare lines after it follow it there. Optional `tile: <n>` sends every
  line to one tile; `new: true` is `--new` on the first show. A structure file is relative to the
  lesson file. It works with no session involved — the learner can page through alone.
- **` ```fig `** — `src:` an image (png jpg jpeg gif webp svg) relative to the lesson file and
  INSIDE its folder (`lessons/figures/…`), `caption:`. Only real figures you made or may use.
- **` ```ask `** — `q:`, then `- ` options with `- * ` on the right one(s) (several right =
  tick-boxes), `why:` shown after they answer, `id:` (give one: answers are kept by id, per
  file, across reloads). No options = a free-text box. A good ask tests the idea of THIS card
  with wrong options that are real misconceptions.
- **` ```dad `** — a "for Dad" callout: a question worth bringing to the learner's father
  (Chuck, a protein crystallographer). Also append it to `curriculum.json`'s `questions`.
- Anything else is ordinary markdown (tables, lists, bold, code); any other fence is a code block.

`lint` checks all of it: duplicate card / ask ids, an ask with options and no right one, a
`[^id]` with no source, an unsourced card, a fig that does not resolve, a mol line that is not a
`mol.mjs` command. Lint before every `show` of a file you edited; a clean lint is `"ok": true`
with `"problems": []`.

## curriculum.json — the tile's home view

A Lesson tile with no lesson up shows `<folder of the focused session>/curriculum.json`,
read-only, re-read every few seconds. YOU keep it current; the tile never writes it.

```json
{ "title": "Protein folding — building blocks",
  "blocks": [
    { "id": 1, "title": "Atoms and bonds", "status": "active",
      "lesson": "lessons/01-atoms-and-bonds.md",
      "items": [ { "text": "The covalent bond (H₂)", "done": true, "card": "h2" } ] } ],
  "questions": [ { "text": "…", "block": 8, "asked": false } ] }
```

`status` is `todo` / `active` / `done`; a block's title opens its `lesson` (a path relative to the
curriculum), an item with a `card` opens it at that card; `questions` is the running list for Dad
(`asked: true` strikes one through). Every field is optional.
