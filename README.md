# deck

Seven Claude Code sessions in one window. One in focus on the left third as a terminal, the rest in a grid on the right as live conversation views (Claude's replies as markdown, a prompt bar on each), and a row beneath them with Wikipedia's picture of the day (with a search box over it) and a lofi stream. The last two grid cells are a Spanish vocabulary builder (a new SAT-level word every 30s, paired with the SAT word it translates and defined in both languages at once from Wiktionary, with synonyms and etymology) and an English ⇄ Spanish translator. Click a tile to swap it in. `+` asks where to start a session; ⌘N starts one in the focused folder without asking.

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
| click `+` | Chooser: the focused folder, the 3 most recent, a folder picker, a worktree toggle, parked sessions to resume |
| drop a file on a pane | Pastes its path into that session |

Sessions run inside tmux on a private socket, so quitting deck never kills a conversation. Optional settings live in `~/Library/Application Support/deck/config.json`:

```json
{ "theme": "cream", "appearance": "system", "gridColumns": 2, "defaultCwd": "/path/to/your/projects" }
```

See `CLAUDE.md` for how it works inside.

## Data credits

- Vocabulary word list: Spanish lemmas and glosses from [doozan/spanish_data](https://github.com/doozan/spanish_data) (`es-en.data`, English Wiktionary's Spanish entries, CC BY-SA; `frequency.csv`, CC-BY-4.0, built on [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords), OpenSubtitles 2018), matched against the SAT lists in [lrojas94/SAT-Words](https://github.com/lrojas94/SAT-Words) (freevocabulary.com, majortests.com) and filtered with [first20hours/google-10000-english](https://github.com/first20hours/google-10000-english).
- The fox, Foxtrot: ["2D Pixel Art Fox Sprites" by Elthen](https://elthen.itch.io/2d-pixel-art-fox-sprites), the sheet slay's Village uses; it is every session's status indicator (running, asleep, sitting up when Claude needs you, with a bark on the way in), the app icon, stands in for Claude Code's banner mascot and keeps the empty focus pane company. See the terms below.
- The bark's font: ["Press Start 2P" by CodeMan38](https://fonts.google.com/specimen/Press+Start+2P), SIL Open Font License 1.1.
- Definitions, synonyms, etymology: [Wiktionary](https://www.wiktionary.org) (CC BY-SA) via [kaikki.org](https://kaikki.org) exports; extra English synonyms from [Datamuse](https://www.datamuse.com/api/).

## Foxtrot is Elthen's: attribution required

The sprite sheet (`src/renderer/src/assets/fox.png`) and the app icon drawn from it (`build/icon.png`, `icon.icns`) are **not ours to give away**. They are Elthen's ["2D Pixel Art Fox Sprites"](https://elthen.itch.io/2d-pixel-art-fox-sprites), used under [Elthen's terms](https://www.patreon.com/posts/licensing-27430241): CC BY-NC 4.0 plus a supplemental permission for commercial use, with **no blockchain-related projects** (play-to-earn, NFTs, web3). If you fork this repo, build on it, or lift the fox for anything else:

- **Credit Elthen** and link to the itch.io page above. That is a condition of use, not a courtesy.
- **Do not redistribute the sheet on its own**, recolored or otherwise; point people at Elthen's page.
- Consider tipping Elthen on itch.io.

The full notice ships next to the sheet in [`src/renderer/src/assets/LICENSE-fox.md`](src/renderer/src/assets/LICENSE-fox.md). Elthen's Patreon post is the authoritative text.
