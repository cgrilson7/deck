---
name: doc
description: Open a file in the deck's preview pane — the center column, where markdown renders, `- [ ]` task lists are clickable checkboxes that save to disk, and an `edit` toggle makes any text or markdown file editable in place (⌘S saves). Use INSTEAD OF macOS `open` (which hands the file to RStudio, Xcode or whatever owns the type) whenever the user should read, tick off or edit a file: "open the checklist", "show me the notes", "let me edit that", "/deck:doc", or after you write a plan / checklist / notes file they will work through. The CLI is `node "$DECK_DOC" open <path> [--line N]`. Only meaningful from a session running inside the deck app (it sets DECK_DOC and DECK_HOOK_PORT in every session's env).
---

# Doc — put the file in front of them, in the deck

```bash
D="${DECK_DOC:-$(dirname "$DECK_MOL")/doc.mjs}"    # a session older than the door has no DECK_DOC
node "$D" open notes/checklist-2026-09-25.md          # relative to your cwd; ~/ and absolute work too
node "$D" open src/main/index.ts --line 120           # scrolled to (and marking) line 120; `path:120` works too
```

It prints JSON: `{ "ok": true, "path": …, "kind": "markdown", "editable": true }` means it is up.
`{ "ok": false, "error": … }` says why (no such file, no deck listening).

**Use this, not `open`, for a file the user should read or edit.** `open` sends a `.md` to
whatever app macOS picked — away from the deck. The preview pane is where they already are.

What they get there:
- Markdown rendered; `source` shows it as written.
- `- [ ]` / `- [x]` items (any bullet, numbered, nested) are CHECKBOXES: a click rewrites that
  one character on disk and nothing else. So a checklist you write is one they can tick off.
- `edit` (markdown and text files up to 1.5MB) swaps in a plain editor; ⌘S saves.
- If the file changed on disk since they opened it, a save is refused and they are offered a
  reload — so do not rewrite a file they have open for editing without telling them; if you
  must change it, say so, and they reload.

Images, PDFs and folders open too (read-only). Still use `open` for things the pane cannot
show (a `.docx`, an app bundle) or when they ask for a specific app.
