# deck

Seven Claude Code sessions in one Electron window. The focused session fills the left third;
the other six live in a grid on the right and stream live, with a plugin row (Wikipedia's
featured content, the lofi YouTube stream) beneath them. Click a tile to swap it into focus. The `+` in the grid
starts a new session. Built by Colin (Dosha Labs) for himself.

## What it is, in one paragraph

Each session is a real `claude` CLI process running inside its own tmux session on a
private tmux socket, with exactly one client attached: a node-pty in the Electron main
process, rendered by an xterm.js terminal in the renderer. Terminals are created once and
MOVED between the focus pane and grid cells (never rebuilt), so a swap is one `appendChild`
plus a fit/resize. tmux is there so sessions survive the app quitting. Nothing about the
Claude CLI is wrapped or replaced: skills, hooks, plugins, MCP and slash commands all work
because it is the unchanged CLI in a real PTY.

## Commands

```bash
npm run dev          # electron-vite dev --watch (profile deck-dev: own tmux socket, userData, hook port;
                     #   main/preload edits restart Electron, renderer edits hot-reload)
npm run typecheck    # tsc for main/preload (tsconfig.node.json) and renderer (tsconfig.web.json)
npm run build        # electron-vite build → out/
npm run smoke        # tmux + login-shell env + `claude agents --json` checks, no Electron
npm run rebuild      # electron-rebuild node-pty (postinstall does this already)
npm run tmux -- ls   # talk to the dev profile's tmux server (tmux -L deck-dev ...)
```

Verification before handing off = `npm run typecheck && npm run build && npm run smoke`.
Colin runs the app himself; do not drive it with screenshots or automation unless asked.

## Layout

```
src/shared/types.ts        CAP, SessionRecord/SessionView/DeckState, DeckCommand, DeckApi
src/main/index.ts          app boot: profile, single-instance lock, window, IPC, menu
src/main/sessions.ts       SessionManager: slots, spawn/attach/detach/kill/resume, state
src/main/tmux.ts           tmux wrapper (private socket, tmux.conf) + shq()
src/main/fleet.ts          polls `claude agents --json` (busy/idle/blocked + names)
src/main/hooks.ts          local HTTP server + the --settings hooks file for instant "needs you"
src/main/wiki.ts           fetches today's Wikipedia featured-content feed (cached 1h) for the tile
src/main/env.ts            resolves the login-shell env so claude/tmux are found from Finder
src/main/menu.ts           app menu = every keyboard shortcut
src/preload/index.ts       contextBridge → window.deck (DeckApi), window.deckErrors
src/renderer/src/App.tsx   state → FocusPane + Grid; disposes terminals that left `open`
src/renderer/src/lib/terminals.ts   persistent xterm per session, mount/unmount/mode, buffering
src/renderer/src/components/        FocusPane, Grid, Tile, PlusTile (+ menu), TermHost, StatusDot,
                                    WikiTile, YouTubeTile (<webview>), useDropTarget (file drops)
tmux.conf                  the deck tmux server config (status off, remain-on-exit failed, titles on)
scripts/smoke.mjs          the smoke test
```

## Rules the code enforces (keep them)

- **Cap = 7** (`CAP` in `src/shared/types.ts`). Slots 1..7 are sticky while open: a session keeps its
  number until parked/killed; a new session takes the lowest free slot. ⌘1–7 = focus slot.
  A saved record whose slot is above the cap is parked on load.
- **Focus + grid + plugins**: the grid shows cap−1 session cells, then a plugin row one grid row
  tall (`Grid.tsx`, `.grid-col` in styles.css). Sessions with `attention` sort first, then slot
  order (`App.tsx`). The first empty cell is the `+`; at cap the `+` disappears.
- **Plugins**: Wikipedia = cards from the featured feed (picture of the day, featured article,
  on this day, most read), only ones with an image, cycling every 20s; click opens the article
  via `deck:openExternal` (http(s) only). YouTube = the bare embed player for the lofi stream in
  a `<webview>` on partition `persist:youtube` (`webviewTag` is on in `index.ts`); play/pause and
  mute drive the embed's `<video>` through `executeJavaScript`. The renderer CSP allows no
  outbound requests (feeds are fetched in main) and whitelists only `*.wikimedia.org` images.
  Spotify was tried and dropped: its web player needs Widevine, which Electron does not ship.
- **File drops**: dragging files onto the focus pane or a tile pastes their shell-escaped paths
  into that session (a tile drop also focuses it). Paths come from `webUtils.getPathForFile`
  in the preload; the renderer never sees one otherwise.
- **Close = park, not kill.** ⌘W / "park" kills only the pty client; the tmux session and the
  Claude conversation stay. Parked sessions are listed under the `+` (right-click / long-press)
  and resume by tmux attach if alive, else `claude --resume <claudeSessionId>`.
- **One tmux client per session, ever.** tmux sizes to the smallest attached client. Never
  attach a second client to a `deck-*` session from a terminal while the app has it open.
- **Spawn command** (`SessionManager.claudeCommand`): `exec claude --settings <hooks.json>
  --session-id <uuid> [--worktree]`. `exec` so the pane's process IS claude. The UUID is
  ours (`randomUUID()`), which is how fleet rows and hook payloads are matched back to a tile.
  `--worktree` lets Claude create/clean the worktree itself under `<repo>/.claude/worktrees/`.
- **`--settings` merges** with the user's own settings (list keys combine), so Colin's global
  Notification/Stop hooks keep firing inside deck sessions. Our hooks file only adds POSTs to
  `127.0.0.1:<port>/{notification,stop,prompt}`; it must never block Claude (`; exit 0`).
- **Status** = fleet poll (truth) + hooks (instant). Notification → attention; Stop → attention
  + idle; UserPromptSubmit → clear + busy; any keystroke into the tile clears attention.
- **Profiles**: `deck` when packaged, `deck-dev` under `npm run dev`, or `DECK_PROFILE=x`.
  Profile = tmux socket name = userData folder name; hook port 47800 (deck) / 47801 (others).
  Two profiles never see each other's sessions, so a Claude session working ON deck can run
  `npm run dev` without colliding with the instance it is running inside.
- **Renderer**: grid tiles use xterm's DOM renderer; only the focus pane loads the WebGL addon
  (Chrome caps live WebGL contexts). Tile fonts 9px, focus 13px (`FONT_SIZE` in terminals.ts).
  `THEME.background` must equal `--panel` in styles.css or tiles show a seam.
- **⌘ shortcuts** live in `menu.ts` AND in `isDeckShortcut()` in terminals.ts (xterm must
  decline them). Add to both.

## State on disk

`~/Library/Application Support/<profile>/`
- `sessions.json` — records (`slot` sticky, null = parked) + `focusSlot`
- `claude-hooks.json` — the `--settings` file handed to every spawned session
- `config.json` (optional) — `{ "gridColumns": 2, "defaultCwd": "/Users/colin/slay" }`

Debugging a session outside the app: `tmux -L deck-dev ls`, and to peek WITHOUT stealing the
size use `tmux -L deck-dev capture-pane -p -t deck-<id>` rather than attaching.

## Gotchas already hit

- tmux 3.5a rejects the `=name` exact-match target for `display-message`/`list-panes`; use
  plain names (deck names can't prefix-collide).
- TypeScript 6 dropped `baseUrl`; `paths` are relative. Vite CSS side-effect imports need
  `src/renderer/src/vite-env.d.ts` (`/// <reference types="vite/client" />`).
- electron-vite 5 wants vite 7 + @vitejs/plugin-react 5 (plugin-react 6 needs vite 8).
- node-pty ships darwin-arm64 prebuilds; `postinstall` still rebuilds against Electron.
- Sessions started in VS Code/iTerm cannot be adopted (their PTYs belong to that app); they
  can only be resumed by id. `claude agents --json` lists them with `sessionId`.
