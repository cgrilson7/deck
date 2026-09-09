# deck

Seven Claude Code sessions in one window. One in focus on the left third, six streaming live in a grid on the right, and a row beneath them with Wikipedia's featured content and a lofi stream. Click a tile to swap it in. `+` starts a session.

## Requirements

macOS, [tmux](https://github.com/tmux/tmux), Node 20+, and the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in. deck runs the unchanged `claude` CLI in a real terminal, so your skills, hooks, MCP servers and slash commands all work as they do in a terminal.

```bash
npm install     # also rebuilds node-pty for Electron
npm run smoke   # checks tmux and claude are reachable
npm run dev
```

| Key | Action |
| --- | --- |
| ⌘N | New session (in the focused session's folder) |
| ⌘⇧N | New session in a git worktree |
| ⌘O | New session in a folder… |
| ⌘1–7 | Focus slot |
| ⌘] / ⌘[ | Next / previous session |
| ⌘↩ | Jump to the session that needs you |
| ⌘W | Park the focused session (tile closes, session lives on) |
| right-click / hold `+` | Menu: folder picker, parked sessions to resume |
| drop a file on a pane | Pastes its path into that session |

Sessions run inside tmux on a private socket, so quitting deck never kills a conversation. Optional settings live in `~/Library/Application Support/deck/config.json`:

```json
{ "gridColumns": 2, "defaultCwd": "/path/to/your/projects" }
```

See `CLAUDE.md` for how it works inside.
