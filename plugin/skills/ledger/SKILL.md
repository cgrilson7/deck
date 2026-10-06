---
name: ledger
description: Log what a piece of Claude Code work cost — tokens, list-price dollars, active time — as one line in the project's own ledger (`docs/costs/ledger.jsonl`), so the deck's Spend tile can say what each project's work was FOR, not only what it cost. Use when a piece of work is done in a project that keeps a ledger (before reporting it or committing it), for "log this", "what has this session cost", "how much did that cost", "start a ledger here", "/deck:ledger". The CLI is `node "$DECK_LEDGER" init|log|show|where`. Works from any session inside the deck app (DECK_LEDGER is in every session's env).
---

# Ledger — what the work cost, and what it was for

```bash
L="${DECK_LEDGER:-$(dirname "$DECK_MOL")/ledger.mjs}"   # a session older than the ledger has no DECK_LEDGER
node "$L" where                                          # this project's ledger, or "not created"
node "$L" show                                           # this session so far: calls, tokens, $ (writes nothing)
node "$L" log --tag reveal-camera --kind feature --summary "Reveal rebuilt as a flight along a measuring tape"
node "$L" init                                           # opt a project in — ONLY when the user asks
```

**When a piece of work is done** in a project with a ledger (`where` names an existing file), log
it before you report it or commit it. One entry covers everything since THIS session's last
entry, so nothing is counted twice; log separate pieces of work as separate entries.

- `--summary`: what was done, one line, concrete ("Fixed the stale-path bug in the agent tile", not
  "worked on tiles").
- `--tag`: what the work belongs to inside the project — a feature, a game, an area. Free text;
  reuse the tags the ledger already has (read its last lines) so they add up.
- `--kind`: `feature`, `fix`, `research`, `admin` (pushes, docs, config, coordinating sessions),
  `mixed`. A project may name its own kinds in its CLAUDE.md (the fridge does, with `--game`); its
  words win.

A project with no ledger is NOT logged to — `log` refuses. Never `init` one unasked: a ledger is
a file in their repo. The deck's Spend tile shows every project's spend whether or not it keeps a
ledger; the ledger adds the labels.

Costs are API LIST prices, subagents and Workflow agents included (`plugin/scripts/lib/spend.mjs`
holds the table). On a subscription that is what the work would cost on the API, not a bill —
say so if you quote a number. Active time adds up gaps under 5 minutes between transcript events.
