# deck

Nine Claude Code sessions in one window. One in focus on the left third, eight streaming live in a grid on the right. Click a tile to swap it in. `+` starts a session.

```bash
npm install
npm run dev
```

| Key | Action |
| --- | --- |
| ⌘N | New session (in the focused session's folder) |
| ⌘⇧N | New session in a git worktree |
| ⌘O | New session in a folder… |
| ⌘1–9 | Focus slot |
| ⌘] / ⌘[ | Next / previous session |
| ⌘↩ | Jump to the session that needs you |
| ⌘W | Park the focused session (tile closes, session lives on) |
| right-click / hold `+` | Menu: folder picker, parked sessions to resume |

Sessions run inside tmux on a private socket, so quitting deck never kills a conversation. See `CLAUDE.md` for how it works.
