---
name: studio
description: Draft and run a Gemini image generation from inside the deck — you write the hyper-specific prompt, the deck's Studio makes the image and keeps it in the gallery (the Studio tile, the Studio pane, userData/studio). Use for "generate an image", "make me a picture of…", "/deck:studio", "another take, but…", "a comic panel", "a whole sheet of panels", concept art for this repo, an icon or a mock-up, and ALWAYS when a message arrives starting `[deck studio]` (the Studio pane's "Ask Claude for help" button, which starts a session for it and shows the chat inside the Studio: the user wants to work the image out WITH you — questions, drafts, images dropped into the chat — and you generate only when they say go). The CLI is `node "$DECK_STUDIO" gen …` and, for a series, `comic <manifest.json>`. Only meaningful from a session running inside the deck app (it sets DECK_STUDIO and DECK_HOOK_PORT in every session's env); outside it there is nothing listening and nowhere for the image to land.
---

# Studio — you write the prompt, the deck makes the picture

The point is that the model that is good at *language* writes the request for the model that is
good at *pictures*. The user gives you a wish ("Foxtrot on a ridge", "panel 3, but at night").
You turn it into a paragraph that leaves the image model nothing to guess, run it, and hand back
the path plus one line on what to tweak next.

## The Studio, in one paragraph

One service (`src/main/studio.ts`) with three doors: the **Studio tile** in the grid (a prompt
bar and the newest image), the **Studio pane** in the center column (⌘⇧I: composer, viewer,
gallery), and **you** — `POST /studio` on the deck's hooks server, which is what
`plugin/scripts/studio.mjs` speaks. Everything anyone generates lands in the SAME gallery:
`~/Library/Application Support/<profile>/studio/`, a PNG per job and `jobs.json` beside it, newest
first, shown in the tile and the pane the moment it is done. So an image you make appears on the
user's screen without you telling them where to look — but tell them anyway, with the path.

The key is `geminiApiKey` in the deck's `config.json`, else `$GEMINI_API_KEY`. No key = every
generation fails with a message saying so; run `info` first if you are not sure.

## Draft the prompt before you run anything

A Gemini image prompt is a *description of a finished image*, not an instruction to an artist.
Write prose, not keywords. Long is fine (up to ~12,000 characters); vague is not. Order:

1. **Subject and action first.** Who or what, doing what, in what state. Name everything that
   must be in frame; anything unnamed is the model's invention.
2. **Composition and camera.** Close-up / medium / wide, eye level or low angle, what is in the
   foreground and what is behind, where the empty space is (leave room for the caption box).
3. **Style and medium.** "painterly comic-book illustration, inked outlines", "1990s VHS
   commercial with scanlines", "voxel render, hard cube edges, no smoothing". Name the medium,
   not an artist.
4. **Lighting and palette.** One light source beats three adjectives: "one lamp in a dark
   kitchen before dawn". Give the palette by name (raspberry, tangerine, lime) if it matters.
5. **Text, in quotes, verbatim, short.** Image models render the letters you quote and misspell
   the ones you paraphrase. `A caption box top-left reading "8:25 AM. Jack checks in."` Keep it
   to a handful of short strings per image; a wall of small type will come back as gibberish.
6. **What NOT to change.** In a series this is the load-bearing sentence: "Keep the cap, the
   fanny pack and the can exactly as in the reference images."

Say what you want, not what you don't ("an empty desk", not "no people"). Negatives are weakly
followed.

### References earn more than adjectives

A reference image beats any paragraph about how something looks. Attach up to **10** with
`--ref` (a photo, a logo, a sprite sheet, an earlier panel), and in the prompt say what each one
is FOR, by what it shows: "the can in the reference photo is the exact label — keep the wordmark,
the sherbet swirl and the proportions". Without that sentence the model treats a reference as
mood, not as truth.

### Ratio, size, model

- `--ratio`: `1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9 21:9`. Comic panels 1:1, a banner 16:9, a
  phone shot 9:16. Pick it up front: re-cropping later loses the composition.
- `--size`: `512 1K 2K 4K`. `1K` for anything you may redo (most things), `2K` when it is the
  final and will be looked at closely, `4K` only when it must print — it is slow (a minute or
  two) and costs the most. `512` is for thumbnails and only Flash takes it.
- `--model`: leave it off and the deck's `studioModel` setting decides (`gemini-3.1-flash-image`).
  Use **flash** for iteration and for a single subject; reach for the **pro** image model when
  the panel is text-heavy, has several named characters that must all stay themselves, or has
  failed twice on flash. `node "$DECK_STUDIO" models` lists what the key can actually see.

## The CLI

`$DECK_STUDIO` is the script's absolute path — the deck puts it in every session's env.

```bash
node "$DECK_STUDIO" info                       # key set? where do images land? which model?
node "$DECK_STUDIO" models                     # the image models this key can see
node "$DECK_STUDIO" list --limit 10            # the gallery, newest first
node "$DECK_STUDIO" gen --ratio 16:9 --size 1K --tag foxtrot --name ridge \
  --ref src/renderer/src/assets/fox.png "Foxtrot, a voxel fox built from chunky cubes, …"
node "$DECK_STUDIO" gen --prompt-file /tmp/panel.txt --out ./art/panel.png "…"
```

- The prompt is the positional argument; a long one is easier as `--prompt-file FILE` or on
  stdin (pass `-`), which saves you escaping quotes in a shell.
- `--ref` repeats, takes absolute, `~/` or cwd-relative paths, and every one is checked to exist
  before the call goes out.
- `--tag` groups a series in the gallery (the pane filters by it); `--name` names the file.
- `--out PATH` also copies the finished image where you want it (a file, or a folder).
- It prints the job as JSON and exits 1 with the error if the model refused or failed — read
  `error` and `text`, they say why. A call can take 10–120s; do not wrap it in a short timeout.

## A series: the comic manifest

One image at a time drifts — the character changes shirt between panels. The `comic` command
fixes the drift two ways: a **style** and a **cast** block prefixed onto every panel, and
**chaining**, which sends the last N finished panels back in as reference images.

```json
{ "title": "Mapthletes", "tag": "mapthletes-01", "model": "", "ratio": "1:1", "size": "1K",
  "style": "square 1:1 comic panel, painterly comic-book illustration, inked outlines, …",
  "cast": "JACK: … COLIN: … ROLAND: …",
  "refs": ["can.jpg"],
  "chain": 1,
  "panels": [ { "name": "01-roland", "prompt": "Dark kitchen before dawn, …", "refs": [] } ] }
```

Each panel's request is `style` + `cast` + `PANEL: <prompt>`, and when any reference is attached
a final line, `Keep every recurring character exactly as in the reference images.` Panel `refs`
are relative to the manifest's folder, like the manifest's own.

```bash
node "$DECK_STUDIO" comic docs/comics/mapthletes/sheet-01.json
node "$DECK_STUDIO" comic sheet-01.json --only 3,07-mouth-of-sauron   # redo two panels
node "$DECK_STUDIO" comic sheet-01.json --force                       # redo the lot
```

Panels run **in order** (chaining needs the earlier ones), a panel whose image is already in
`--out` (default `<manifest dir>/out`) is kept unless `--force` or named in `--only`, and the run
writes `<out>/contact.html`: the whole sheet on one page. It prints a line per panel and a
summary; a failed panel does not stop the rest.

Writing a sheet: keep the CAST block identical every time (copy it, do not re-word it), put the
scene and the beat in the panel, and the dialogue in quotes. `chain: 1` is usually enough;
`chain: 2` helps when two characters alternate panels. Nine panels at 1K is a few minutes.

## When a `[deck studio]` message arrives

The Studio pane's **Ask Claude for help** button starts a NEW session for the purpose (you are
it: named "studio", in the folder of the session that was focused) and shows your conversation
inside the Studio pane, under the composer, with a prompt bar of its own — the user talks to you
there, not in a terminal. Its first prompt is a message like:

```
[deck studio] Help me make an image. Read /deck:studio first.
What I have so far: a moody shot of the fox on the Mac mini
References so far: /Users/colin/deck/src/renderer/src/assets/fox.png
Settings so far: model default, ratio 16:9, size 1K
Work it out with me here: ask what you need to know, draft the hyper-specific prompt, refine it
with me, take any image path I drop into this chat as a reference. Generate with
`node "$DECK_STUDIO" gen …` only when I say go; it lands in the Studio gallery.
```

This is the START OF A CONVERSATION, not an order. The user came to you because a text box was
not enough: they want to think it through with someone who writes well. So:

1. **Ask before you draft — briefly.** With nothing written ("I have nothing written yet"), ask
   what they want to make: one message, two or three pointed questions at most (what is in it,
   what it is for, any picture it should match). With notes, ask only what the notes leave open
   that would change the image (a style? the text to render? whose face?). Never a questionnaire.
2. **Draft the prompt** by the rules above and **show it in one code block**, with a line under
   it saying what you assumed and the settings you would use (ratio, size, model, references).
3. **Refine with them.** Every reply of theirs is an edit: fold it into the block and show the
   block again, whole, so the current draft is always the last block in the conversation. A path
   they drop into the chat (the deck pastes a dropped file's path) is a reference: say what it
   will contribute and add it to the `--ref` list. Keep the settings line current.
4. **Generate only when they say go** ("go", "run it", "make it", "do it") — one image, the
   current block, the current settings. Then **report** in two or three lines: the path, what the
   model said if anything, and the one or two things you would change on a second pass ("the
   caption came out as 'JAKC'; shorter text, or 2K"). Offer the redo; don't run it unasked.
5. **After the first image, stay in the loop**: "again, but at night" is an edit to the block
   and a new run; "use that as the reference" means `--ref <the path you just reported>`.

If it fails: read the error. A refusal names a policy (rewrite the subject, don't argue with it);
"no image in the answer" usually means the prompt asked for too much text or the reference was
doing all the work; a 429 means wait a moment and run it again.

## Rules

- One image per ask. Never fire a batch of variations to see what sticks — each costs money and
  the user is watching the gallery fill.
- Never invent an API key, never call the Gemini API directly with `curl`, never write your own
  image script: the deck holds the key and the gallery, and `$DECK_STUDIO` is the only door.
- Put the real path in your answer. The user's next move is usually to open it.
- Outside the deck (`$DECK_STUDIO` unset) this skill does nothing. Say so rather than improvising.
