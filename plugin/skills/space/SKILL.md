---
name: space
description: The Mac's disk space, through Colin's ~/space pathways and the deck's Space tile. Use for "what's eating my disk", "how much space do I have", "clean up", "free up space", "show the Space tile", "/deck:space", or any question about disk usage, caches, node_modules, Downloads or iCloud archiving. The CLI is `node "$DECK_SPACE" open` (show the pane) and `node "$DECK_SPACE" status|list|rules|scan` (read-only, passed to ~/space/bin/space.mjs). Nothing is deleted or moved by you. Colin decides in the tile.
---

# Space: the disk, by category, decided by Colin

~/space sorts everything that eats the disk into CATEGORIES, and each category has a PATHWAY:
`delete`, `cloud` (iCloud Drive › Space Archive), `keep`, `review` (decided item by item) or
`manual` (an app's own data, with a note saying what to do in the app). A daily launch agent
scans. When something needs Colin, the deck turns the Space tile on and Foxtrot barks.

```bash
S="${DECK_SPACE:-$(dirname "$DECK_MOL")/space.mjs}"   # a session older than the door has no DECK_SPACE
node "$S" open                    # the Space pane in the center column: every category and item
node "$S" status                  # free space, what waits, per category (add --json for data)
node "$S" list --category stale-build-artifacts
node "$S" rules                   # the categories, their pathways, which have standing approval
node "$S" scan                    # rescan (read-only; about a minute)
```

## The rule: you look, Colin decides

- **Never run `approve`, `run`, `keep` or `pathway` yourself** unless Colin asked for that exact
  thing in this conversation ("delete the npm cache", "archive the old Downloads PDFs").
  When he asks for a decision, prefer `node "$S" open` and let him click. The pane asks twice
  before anything is deleted.
- **Never flip standing approval** (`pathway <cat> --standing`) unless he explicitly says to
  handle that category automatically from now on.
- Never `rm`, `mv` or `trash` his files directly to "help". The space repo's executor has the
  guards: protected folders, Trash for his own files, and iCloud never given node_modules or .git.
- To add a new kind of file, edit `~/space/rules.json` (a category: `id`, `label`, `why`,
  `pathway`, `standing: false`, `find` { type … }; the finder types are in
  `~/space/lib/finders.mjs`). Then run `scan` and show him. New categories always start
  without standing approval.

Answering "what's eating my disk": run `status`, then `list` for the big categories. Say what is
regenerable (caches, build output), what is his (Downloads, Desktop, big files) and what
belongs to an app (the `manual` notes). Then `open` the pane so he can act.
