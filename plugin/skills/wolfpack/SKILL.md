---
name: wolfpack
description: Run a wolfpack in the deck — you (Fable, the ALPHA) have already settled the path, the fixes, or the feature; now cut it into disjoint tracks and run each as an OPUS beta. The canonical pack is the Agent tool / a Workflow from THIS session — every subagent becomes a live tile under your pack tile (gold fox, its own transcript) through Claude Code's SubagentStart/SubagentStop hooks, nothing extra to run. A beta can instead be a deck session of its own (`node "$DECK_WOLFPACK"`, the CLI the deck ships) when it needs its own terminal or permissions. Use for "run a wolfpack", "/wolfpack", "/deck:wolfpack", "send in the betas", "wolfpack this plan", or whenever a decided plan has 2–6 independent tracks and you should not spend Fable on the typing. Only meaningful from a session running inside the deck app (the deck loads this plugin into every session it starts and sets DECK_HOOK_PORT / DECK_WOLFPACK in its env). Not for research or review — that is a read-only review pack, not this.
---

# Wolfpack — one Fable alpha, up to N Opus betas, every one a tile

The point is to stop spending Fable on work that is already decided. You are the **alpha**:
you did the reading, you chose the path. The **betas** are Opus agents that do the typing,
one track each, and the deck shows each of them as a tile under your pack tile: a β and a
gold fox in the head, its own conversation in the body, so the user watches the pack work.

## Two kinds of beta

| | Subagent (canonical) | Beta session |
|---|---|---|
| How | the Agent tool (`model: "opus"`, `run_in_background`), or a Workflow | `node "$DECK_WOLFPACK" spawn <manifest>` |
| Runs | inside this session; its result comes back to you | as a `claude` process of its own in a deck tmux session |
| Tile | automatic: Claude Code's `SubagentStart` / `SubagentStop` hooks (documented: `agent_id`, `agent_type`, `agent_description`, `task_description`, `last_assistant_message`) tell the deck; the tile tails `<session>/subagents/agent-<id>.jsonl` (documented, same JSONL as a session's) | automatic: a real session tile, gold, nested under yours |
| The user can | watch | watch, prompt it from its tile, focus its terminal, answer its permission prompts |
| Permissions | yours (a subagent runs under your session's mode) | its own (`permissionMode` in the manifest) |
| Ends | when it returns (the tile stays until your next prompt) | when you `dismiss` it |

Default to SUBAGENTS: no extra process, the results land in your context, and the tiles are
the deck reading the CLI's own signals. Use beta SESSIONS when a track needs its own
permission mode, must survive your session, or the user should be able to talk to it directly.

## When

- A path is decided (a plan section, a list of fixes, a feature broken into parts) and there
  are **2–6 tracks that do not share files**.
- Not for: research or review (use a review pack), one file (do it yourself), work whose
  design is still open (decide first — the pack executes, it does not think for you).

## Procedure

### 1. Cut the tracks (you, before anything is spawned)

Write `wolfpack_contract.md` in your scratchpad — every beta reads it first:

- The decided plan, verbatim or tightly summarized, with file:line references.
- **File ownership** per track: the exact files a beta may create or edit. Two tracks
  never share a file; if the plan forces it, split the file or fold the two tracks into one.
  Files owned by nobody are read-only for everyone.
- **Interfaces across tracks**, typed and final: exported names, signatures, types, ids.
  A beta codes to the contract, never to another beta's work in progress.
- The rulings that bind: no commits, no pushes, no DB writes, no deploys, verification
  commands that exist in this repo, what "done" means.
- The handoff shape every beta ends with:

```
HANDOFF
files: <created/edited paths>
exports: <what other tracks may import>
verify: <command> → <pass/fail>
deviations: <where the contract was wrong and what was done instead>
wiring: <what the alpha must connect>
```

### 2a. Subagent betas (the default)

One Agent call per track, all in ONE message so they run at once:

- `subagent_type: "general-purpose"` (or a repo agent that fits), `model: "opus"`,
  `run_in_background: true`, `description` = the track's name (it is the tile's name).
- The prompt: the contract path, the track, the owned files, the verify command, the
  handoff block, and that nothing else may be touched. It is a fresh context: everything it
  needs goes in.
- For more than three tracks, or when tracks have stages, use the Workflow tool with a
  `parallel()` of `agent()` calls (load `workflow-authoring` first); every `agent()` is a
  tile too.

The pack tile appears in the grid as the first agent starts. Do the parts of the work that
are yours while they run; the task notifications bring each result back.

### 2b. Beta sessions (when a track needs its own terminal)

`wolfpack.json` in your scratchpad:

```json
{ "betas": [ { "task": "engine hooks", "prompt": "You are a beta in a wolfpack. Read /path/to/wolfpack_contract.md first. Your track: engine hooks. You own ONLY src/main/foo.ts. … End with the HANDOFF block.", "cwd": "/path/to/repo", "worktree": false, "model": "opus", "permissionMode": "acceptEdits" } ] }
```

`$DECK_WOLFPACK` is the CLI's absolute path — the deck puts it in every session's env
(`plugin/scripts/wolfpack.mjs` in the deck's own tree; inside the packaged app's Resources).

```bash
node "$DECK_WOLFPACK" spawn <scratchpad>/wolfpack.json   # the tiles appear at once
node "$DECK_WOLFPACK" wait --timeout 540                  # until none is working (exit 2 = still going; call again)
node "$DECK_WOLFPACK" status                              # status, attention, transcript path, last words, its own subagents
node "$DECK_WOLFPACK" say "engine hooks" "…"              # a correction, pasted + ⏎
node "$DECK_WOLFPACK" dismiss [--park] [task…]            # kill (or park) when integrated
```

`task` ≤ 60 chars, distinct (the tile's name and the session's `--name`); the prompt is the
session's first prompt, passed on the command line. A beta `blocked` is waiting on a
permission prompt — the user's, not yours; say so once. Always dismiss (or park) beta sessions
before you finish; parking your own session parks them, killing it kills them.

### 3. Integrate (you, inline)

Read every handoff and the files themselves. Wire the seams, fix contract drift at the seam,
run the repo's real verification (whatever its CLAUDE.md or package.json names: typecheck,
lint, build, tests — never a command you made up), and fix what fails. Do not spawn a second pack for polish.

### 4. Report

To the user: which tracks ran, what each handed off, what you wired, the verification result,
and anything left for them. Lead with the verification result.

## Rules

- The alpha decides; the pack types. Never spawn to explore a question.
- Disjoint files, or no pack. Two betas in one file means worktrees and merges — a different tool.
- Betas are `opus`. A Fable beta defeats the purpose; say why if you ever set one.
- Never paste your reasoning for a design into a beta's prompt as something to revisit —
  the contract is settled.
- No beta commits, pushes, deploys, migrates or writes to a database. You commit only on
  the user's word.
