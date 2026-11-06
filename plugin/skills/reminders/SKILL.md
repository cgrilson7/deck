---
name: reminders
description: Write reminders, notes and accomplishments to the deck's Reminders tile, filed by project (directory), from any session in any repo. Use when the user says "remind me", "don't let me forget", "add a reminder", "todo for later", "make a note", "note that", "log this", "what's on my list", "what did I get done", "/deck:reminders", or asks you to mark a reminder complete. Also add one, unprompted, when something you find needs the USER to act later and it would otherwise be lost in this conversation, and say that you did. The CLI is `node "$DECK_REMINDERS" add|note|log|list|notes|history|done|undo|set|rm`. Works from any session inside the deck app while the deck is running.
---

# Reminders — the user's own list, by project

```bash
R="${DECK_REMINDERS:-$(dirname "$DECK_MOL")/reminders.mjs}"    # a session older than the door has no DECK_REMINDERS
node "$R" add "Rotate the Stripe test key" --priority high --due tomorrow
node "$R" add "Renew the domain" --project ~/slay --detail "Registrar is Vercel; auto-renew is off."
node "$R" note "The staging DB is a copy from Oct 3"
node "$R" log "Shipped the export button"
node "$R" list                 # this project's open reminders, most important first (--all = every project)
node "$R" notes                # this project's notes (--all)
node "$R" history --limit 20   # this project's running log, newest first (--all)
node "$R" done r_ab12cd        # undo r_ab12cd takes it back the same day
node "$R" set r_ab12cd --priority low --due none
```

Every command prints JSON, `{ "ok": true, … }` or `{ "ok": false, "error": … }`. The project defaults
to the repo your cwd is in (a worktree counts as its repo). Pass `--project DIR` when the reminder
belongs to another one. The tile records which session wrote each item.

**Priority:** `high` = has a deadline or a cost if missed soon; `normal` = the default; `low` =
worth keeping, no rush. Use the default unless you can say why. `--due` only for a real date.

**What goes where:** a reminder is something the USER has to do later. A note is something worth
knowing, not an action. The log is work that got DONE. Completing a reminder writes its log line
itself, so do not also `log` it.

**This is the user's list.** Write one clear sentence they can act on without this conversation.
Only `done`, `set` or `rm` an item when they ask, or when it is one you added and you have finished
it. Do not add your own in-progress steps. Say what you added, in a line. Do not paste secrets.
