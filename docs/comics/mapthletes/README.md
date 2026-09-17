# Mapthletes — sheet 01

A nine-panel comic about a group chat that plays MapTap every morning:
Roland, up before dawn with a book about the oil industry; Jack, a Nazgûl in a Mets cap whose
scores are suspiciously good; Colin, who will not play until the third Celsius. It is the deck's
Studio taken for a walk — the manifest is the same `comic` manifest the `/deck:studio` skill
documents, and every panel lands in the Studio gallery under the tag `mapthletes-01`.

## Running it

```bash
node plugin/scripts/studio.mjs comic docs/comics/mapthletes/sheet-01.json
```

From inside a deck session `node "$DECK_STUDIO" comic …` is the same thing. Panels run in order
— `chain: 1` sends the last finished panel back in as a reference, which is what keeps Jack's
cap and Colin's can from drifting between frames — and land in `docs/comics/mapthletes/out/`
(git-ignored), with `out/contact.html` as the whole sheet on one page. A panel already there is
kept; `--only 3,07-mouth-of-sauron` redoes named panels, `--force` redoes the lot. Nine panels at
1K is a few minutes and nine generations against the key.

**A photograph beats every adjective.** The CAST block describes the CELSIUS RETRO VIBE can in a
paragraph because there was no picture to hand; drop a real photo of one in beside the manifest
and put it in `refs` —

```json
"refs": ["refs/retro-vibe-can.jpeg"],
```

— and the label, the wordmark and the sherbet swirl come back right instead of approximately.
The same goes for the Mets cap and for anyone whose face should be their own. Manifest `refs` go
out with every panel, a panel's own `refs` only with that one; both are relative to this folder.

## The facts it is built on

Checked, because the clippings on Jack's wall are readable and a comic that misquotes a
standings line is a comic about nothing:

- The Mets were eliminated on **Monday, September 14, 2026**, losing **2–1 to the Orioles**,
  which put them at **69–81**.
- They lost **12 straight in April**. Two seasons, no October.
- **MapTap** is the game: five places tied to the events of a given date, placed on a 3D globe,
  each pin scored out of 100 with a badge, and a "Final score" out of 500 underneath.
- **CELSIUS RETRO VIBE** is real: a 12 fl oz slim can, February 2025, "Sparkling Sherbet Slush",
  raspberry / orange / lime, artwork like a 90s roller-rink carpet.

Panel `02-jack` prints the clipping as "FALL TO 69-83" — the line as it was drafted, kept
verbatim; fix it in the manifest if the wall should match the record.

## Threads left open

- **The conclusion of the day.** Panel 9 promises one and does not deliver it: Jack said he would
  explain why the Maryland pin was gettable, and the room is empty. Sheet 02.
- **Is Jack playing?** Panel 3 says a larger hand guides the gauntlet; panel 7 says the words are
  the Mouth of Sauron's. Nobody has accused him to his hood yet.
- **Colin has not played.** Every panel he is in is pre-game. His actual score — after three
  Retro Vibes — is the joke that has not landed.
- **Roland went home with the ball** and is presumably back tomorrow at 4:40 AM, which is its own
  running gag.
- **The Celsius ad** (panel 5) wants a sibling: a 30-second fake spot as a 16:9 strip, or the
  same panel at 2K for anyone who wants to read the legal type.
