# deck

Up to ten Claude Code sessions in one Electron window. The focused session fills the CENTER column
as a real terminal; everything else lives in two columns of tiles either side of it, four to a
column's height, each column scrolling on its own without end: the other sessions as conversation views (your
prompts, Claude's replies as markdown, a line per tool call, a prompt bar to talk to each), the
plugin tiles (Wikipedia, music: Spotify.app or the lofi stream, Studio, Pokemon, changes, vocabulary, translator, Molecule, Lesson),
the WEB APPS (Village first: any site registered by name + URL, a tile each, the page itself in the center column),
and any WOLFPACK — a Fable alpha's beta sessions, a tile each, and its Opus subagents together in
the alpha's PACK TILE, a roster of miniature gold foxes (working, paused, finished, cancelled), a
pause and a cancel-with-reason on every one. Click a tile to
swap it into focus (a subagent opens full size in the center); drag one by its grip to keep it somewhere.
The `+` in the grid opens a chooser for a new session (which folder, worktree or not, or resume a parked one); ⌘N starts one in the focused folder without asking. The same sessions are reachable from a phone (the `phone` button in the top bar: a QR code, over Tailscale). A personal tool, macOS only.

## What it is, in one paragraph

Each session is a real `claude` CLI process running inside its own tmux session on a
private tmux socket, with exactly one client attached: a node-pty in the Electron main
process, rendered by an xterm.js terminal in the renderer when it is the focused one. Terminals
are created once and kept (never rebuilt); a swap parks one and mounts the other, one
`appendChild` plus a fit/resize. Grid tiles do not show the terminal at all: main tails the
session's transcript file and the tile renders the conversation. tmux is there so sessions
survive the app quitting. Nothing about the
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
npm run ad           # renders the ad (ad/) to ad/out/: deck-ad-9x16.mp4 (1080×1920) + deck-ad-16x9.mp4, 60fps; `npm run ad:dev` previews it live (add ?wide)
npm run dist         # electron-vite build + electron-builder --mac → dist/ (needs `npm i -D electron-builder`;
                     #   the `build` block in package.json: productName Deck, build/icon.icns, tmux.conf as an extraResource)
```

Verification before handing off = `npm run typecheck && npm run build && npm run smoke`.
The user runs the app themselves; do not drive it with screenshots or automation unless asked.
Requirements on the machine: macOS, tmux, Node, and the `claude` CLI logged in.

## Layout

```
src/shared/gridorder.ts    the grid's two columns as ordered tile keys: arrange() / moved() / pruned(), the key test the settings sanitizer uses
src/shared/types.ts        CAP, SessionRecord/SessionView/DeckState, DeckCommand, DeckApi
src/main/index.ts          app boot: profile, single-instance lock, window, IPC, menu
src/main/sessions.ts       SessionManager: slots, spawn/attach/detach/kill/resume, state
src/main/tmux.ts           tmux wrapper (private socket, tmux.conf) + shq()
src/main/fleet.ts          polls `claude agents --json` (busy/idle/blocked + names)
src/main/hooks.ts          local HTTP server + the --settings hooks file for instant "needs you"; also POST /pack, the wolfpack's door,
                             and POST /studio, the Studio's,
                             and POST /gameboy + POST /mol, the doors to the renderer's Game Boy and molecule viewer (main/index.ts relays both),
                             and POST /lesson, the Lesson tile's door (`onLesson`, a FIELD set after construction like `onStatus`, never a constructor argument),
                             and POST /pretool, every tool call asking the leash (held while paused, refused with the reason when cancelled)
src/main/usage.ts          USAGE for the header: every session's status line POSTs the CLI's status JSON to /status → the account's 5-hour / weekly
                             windows + each session's context % (`usage:update`; windows kept in userData/usage.json)
src/main/agents.ts         subagents as tiles + THE LEASH: SubagentStart/Stop hooks → the list, names off the parent's Agent call, transcripts
                             handed to the tailer; pause / resume / cancel of any member (subagent or beta), the alpha told in its terminal
src/main/pack.ts           beta SESSIONS: an alpha (a session inside the deck) spawns / asks after / talks to / dismisses Opus sessions of its own
plugin/                    the deck's Claude Code plugin, `--plugin-dir` on every session it starts (extraResources when packaged):
                             .claude-plugin/plugin.json (name `deck`), skills/wolfpack/SKILL.md (the skill, `/deck:wolfpack`),
                             scripts/wolfpack.mjs (the alpha's CLI: spawn, status, wait, say, dismiss; its path is DECK_WOLFPACK in every session's env),
                             skills/studio/SKILL.md (`/deck:studio`: how to draft a Gemini image prompt and run it),
                             scripts/studio.mjs (the session's CLI: gen, list, models, info, comic; its path is DECK_STUDIO in every session's env),
                             skills/mol/SKILL.md (`/deck:mol`: show and annotate molecules while teaching),
                             scripts/mol.mjs (show, style, compare, select, highlight, measure, label, view, look, list, clear; DECK_MOL in every session's env),
                             skills/lesson/SKILL.md (`/deck:lesson`: teach from a lesson file, card by card; ALSO the lesson file format's authoring reference),
                             scripts/lesson.mjs (show, goto, mark, note, ask, look, home, reset, tiles, close, lint; DECK_LESSON in every session's env),
                             skills/trainer/SKILL.md (`/deck:trainer`: play Pokémon Yellow on the Game Boy, one command at a time),
                             scripts/trainer.mjs (look, press, advance, walk, goto, talk, fight, save / load, party, elite, warp, sprite…; DECK_TRAINER in every session's env),
                             scripts/lib/ (the trainer's: door.mjs = the emulator behind one small protocol, the deck's `POST /gameboy` or serverboy HEADLESS
                               in the CLI's own process; yellow.mjs = Yellow's WRAM layout, maps, the planner; drive.mjs = the routines; forge.mjs = party /
                               badges / money / warps written to WRAM; sprites.mjs = THE SPRITE GAG, see the Trainer rule),
                             data/yellow.json (GENERATED by scripts/yellow-data.mjs from the pret/pokeyellow disassembly: addresses, maps, species, moves, the charmap),
                             data/sprites/ (GENERATED by scripts/sprites.mjs: notes.png + village.png, 56×56, four greys)
src/main/remote.ts         the phone: HTTP + WebSocket server (tailnet/LAN only, token-gated) serving out/renderer/phone.html and relaying the IPC broadcasts
src/shared/remote.ts       the phone's wire: ports, the callable DeckApi subset, the frame types
src/main/transcript.ts     TranscriptWatcher: tails ~/.claude/projects/*/<claudeSessionId>.jsonl into ChatBlocks for the tiles
src/main/files.ts          reads a referenced path for the preview pane: text (capped), image / PDF bytes, a directory listing
src/main/git.ts            the changes tile's source: `git status` + numstat of a working tree, one file's diff (read-only, no index lock)
src/main/studio.ts         the Studio: Gemini image generation (prompt + reference images → a PNG in userData/studio), the gallery, `POST /studio`
src/main/mol.ts            the Molecule tile's disk + network side: a target → structure text (library, RCSB, AlphaFold DB, PubChem, a file), cached in userData/mol
src/shared/lesson.ts       THE LESSON FILE, pure (no DOM, no node): `parseLesson` (front matter, cards, the mol / fig / ask / dad blocks), `lintLesson`,
                             `molBody` (one line of a mol block → the Molecule door's body; MIRRORS plugin/scripts/mol.mjs's argv handling, keep them in step), `cleanCurriculum`
src/main/lesson.ts         the Lesson tile's disk side: a lesson's text (.md, 1MB), a figure's bytes (inside the lesson's folder tree), curriculum.json, `lint`, the watch on files that are up
src/main/data/molLibrary.ts  GENERATED (scripts/mollib.mjs): 16 small molecules, 3D coordinates + partial charges
src/main/pokemon.ts        Pokemon's disk side: the ROM list of `pokemonRomDir`, a ROM's bytes, battery saves + save states under userData/pokemon
src/main/foxtrot.ts        Foxtrot, the head: rules over session state + transcripts → a running log (userData/foxtrot.jsonl)
src/main/wiki.ts           Wikipedia for the tile: picture of the day (feed, cached 1h), search, page summaries
src/main/weather.ts        the weather under that tile's clock: Open-Meteo (no key), every `weatherPlaces` place in one call (cached 10 min) + its geocoder
src/main/translate.ts      Google Cloud Translation v2 detect + translate for the translator tile
src/main/dictionary.ts     Wiktionary (kaikki.org exports) + Datamuse lookups for the vocabulary tile
src/main/vocabwords.ts     vocabulary supply: data/esLemmas.ts (frequency lemmas) + languagelog's SQLite
src/main/store.ts          VocabStore: userData/vocab.db (node:sqlite) — translations + shown words, for flash cards
scripts/lemmas.py          regenerates data/esLemmas.ts from doozan/spanish_data frequency.csv
scripts/mollib.mjs         regenerates data/molLibrary.ts from PubChem's 3D conformers (+ three entries written by hand)
scripts/yellow-data.mjs    regenerates plugin/data/yellow.json from a pret/pokeyellow checkout
scripts/sprites.mjs        regenerates plugin/data/sprites/ from the real artwork (Village's app icon in ~/slay, the Notes icon in ~/Downloads); `--preview <dir>` writes 8× copies to look at
src/main/spotify.ts        the music tile's Spotify face: Spotify.app over AppleScript (poll, transport, play a URI), oEmbed names for the chips
src/main/spotifyauth.ts    a Spotify account: PKCE OAuth (loopback redirect, no secret), tokens in userData/spotify.json
src/main/spotifyapi.ts     the account's playlists, recent contexts and search over the Web API
src/main/youtube.ts        rewrites embed request headers on the persist:youtube partition
src/main/webapps.ts        the web apps' main side: the `persist:web` partition (plain-Chrome UA, a permission allowlist), every webview guarded
                             (no preload / node, http(s) only, popups to the browser, a context menu), `web:snap` = a tile's snapshot
src/main/settings.ts       SettingsStore: userData/config.json merged over DEFAULT_SETTINGS, sanitized, broadcast
src/shared/themes.ts       theme families (light + dark variant each): CSS chrome colors + xterm palette
src/main/env.ts            resolves the login-shell env so claude/tmux are found from Finder
src/main/menu.ts           app menu = every keyboard shortcut
src/preload/index.ts       contextBridge → window.deck (DeckApi), window.deckErrors
src/renderer/src/App.tsx   state → FocusPane + Grid; disposes terminals that left `open`
src/renderer/src/lib/terminals.ts   persistent xterm per session, mount/unmount/mode, buffering
src/renderer/src/lib/paste.ts       pasteText(): xterm's paste when a terminal exists for the id, else a bracketed paste straight to the pty (the phone)
src/renderer/phone.html + src/renderer/src/phone/   the phone page: api.ts (window.deck over the socket), Phone.tsx (chips, swipe pages, prompt bar, sheets),
                                    ScreenView.tsx (tmux's screen + the key strip), ansi.tsx (SGR → spans), palette.ts (--ansi-N from the theme)
src/renderer/src/lib/theme.ts       settings → CSS variables + xterm palettes; useSettings(), applied before first paint
src/renderer/src/lib/glass.ts       THE GLASS THEME's wall: the blurred picture of the day behind the window, the tint read off it, kept in localStorage for boot
src/renderer/src/lib/bus.ts         translator → vocabulary tile: window CustomEvent per finished translation
src/renderer/src/lib/studio.ts      openStudio()/closeStudio()/toggleStudio() (a window event; App owns the open state) + useStudioJobs(), the live gallery
src/renderer/src/lib/webapps.ts     openWebApp()/closeWebApp() (the same window event) + the tiles' snapshots (localStorage, useWebSnap())
src/renderer/src/lib/pokemon.ts     openPokemon()/closePokemon()/togglePokemon() (the same window event), the last ROM (localStorage), usePokemonRoms()
src/renderer/src/lib/gameboy.ts     THE GAME BOY: serverboy as a module singleton (the rAF loop, the screen to every attached canvas, WebAudio, keys, saves); useGameBoy()
src/renderer/src/serverboy.d.ts     serverboy ships no types
src/renderer/src/lib/mol.ts         THE MOLECULE VIEWER: 3Dmol.js as a module singleton (one viewer moved between tile and pane, the scene as state, every op of the door); useMol(), openMol()
src/renderer/src/lib/lesson.ts      THE LESSON TILE's state: a deck per tile (file, card, marks, note, ad-hoc asks, answers, mol runs), every op of the door (`drive`), live reload,
                                    `useLesson()`, `useCurriculum()`, `setMarks()` (the CSS Custom Highlight API), `openLesson()`
src/renderer/src/3dmol.d.ts         the slice of 3Dmol lib/mol.ts uses, for the minified ES build it imports by path
src/renderer/src/lib/markdown.tsx   tiny markdown → React elements (no HTML) for Claude's prose in the tiles
src/renderer/src/lib/paths.ts       finds file references in text (tiles + terminal) and the one channel that opens one
src/renderer/src/lib/filerefs.tsx   a file reference as a clickable element (and linkifying a run of text)
src/renderer/src/lib/foxlog.ts      useFoxLog(): Foxtrot's entries (loaded + live), for his log
src/renderer/src/lib/fox.ts         Foxtrot: the sprite sheet (assets/fox.png) + the xterm decoration that covers Claude Code's banner mascot
src/renderer/src/lib/bark.ts        Foxtrot's yip (WebAudio) + useBark, the edge detector behind a bark
src/renderer/src/lib/usage.ts       useUsage() (one store for the header's meters and the tiles' context badges), the 70 / 90 thresholds, left()
src/renderer/src/lib/leash.ts       the leash from the renderer: askLeash() raises the dialog (a window event), resumeLeash() goes straight to main
src/renderer/src/components/        FocusPane, Launcher (the empty focus pane, built out: see the launcher rule), SessionForm (its start-a-session + parked cards, shared with the + picker), Grid (two scrolling side columns + drag anywhere), Tile, ChatView (a tile's conversation), TilePrompt (its prompt bar), PlusTile (+ menu),
                                    PackTile (a session's subagents as one cell: a roster of miniature foxes), AgentPane (a subagent full size in the center column), AgentStatus (pip + word + clock),
                                    LeashButtons (⏸ ▶ ✕ on a member's head),
                                    LeashDialog (the reason for a cancel, a note for a pause),
                                    DocPane (the file preview over the grid), FoxHead (Foxtrot large in the top bar, posed for the whole deck; no bubble, no barks), FoxLog (his whole log),
                                    TermHost, FoxStatus (the fox as the status indicator),
                                    WikiTile (+ Weather: the strip under its clock and the places editor), MusicTile (SpotifyTile | YouTubeTile (<webview>), by the `music` setting), GitTile (the focused session's changes), TranslateTile, VocabTile, useDropTarget (file drops),
                                    StudioTile (the Studio as a plugin cell), StudioPane (the Studio over the center column: composer, viewer, gallery),
                                    PokemonTile (the Game Boy's screen as a plugin cell, silent), PokemonPane (the Game Boy in the center column: keys, saves, speed, sound),
                                    MolTile (the molecule viewer as a plugin cell), MolPane (it in the center column: style / colour / surface rows, picks, measurements, the sequence strip),
                                    LessonTile (a lesson's card as a plugin cell, or HOME: the curriculum), LessonPane (it at reading size in the center column: a rail of the cards, the sources),
                                    LessonCard (one card — prose, mol button, figure, ask, "for Dad", sources — shared by the two, and the home view),
                                    WebTile (a web app as a plugin cell: its last snapshot, a door), WebLayer (the ALWAYS-MOUNTED webviews in the center column),
                                    ThemeControls (top-bar theme popover + light/dark toggle), Fox (the sprite as a React element),
                                    PhonePair (the top-bar phone button: QR + link + the serve switch),
                                    HeaderStatus (the top bar's chips: working · need you · held · unattended, each a way to what it counts),
                                    UsageMeter (the top bar's 5h / 7d windows + the focused session's context), ContextBadge (a tile head's `ctx 78%`, from 50%)
ad/                        THE AD, a film of the deck made FROM the deck: its own Vite root that mounts the real `App` against a scripted fake
                             `window.deck` (src/world.ts, the phone's trick; src/tui.ts fakes Claude Code's TUI as bytes into the real xterm),
                             src/script.ts = the storyboard in seconds (sessions' beats, camera, Foxtrot-the-cursor, captions),
                             src/director.ts = the camera (one transform on a fixed-size window) + the fox cursor, which really clicks and types,
                             public/clock.js = a virtual clock under ?capture (timers, rAF, Date, CSS animations scrubbed), so
                             capture.mjs (offscreen Electron → capturePage → ffmpeg) is frame-exact; `--shots 3,9.5` writes stills,
                             `--eval` / `--dump` inspect the page. The app's build never sees any of it. assets/ are Studio-made images + 1UBQ.cif
tmux.conf                  the deck tmux server config (status off, remain-on-exit failed, titles on)
build/icon.png, icon.icns  the app icon (Foxtrot's alert pose on a cream tile): the Dock under `npm run dev`, the bundle under `npm run dist`
scripts/smoke.mjs          the smoke test
docs/casa.md               where the deck is headed: the house (casa) as a deck plugin, Foxtrot as the Mac mini
docs/foxtrot-portrait.md   Foxtrot as a voxel figure: image prompts for concept art
docs/comics/mapthletes/    a comic manifest for the Studio's `comic` command (sheet-01.json, nine panels) + what it is built on
```

## Where it is headed

The deck is the head of a larger thing: Foxtrot as an always-on Mac mini with the house (~/casa:
switches, cameras, threat recognition), a wearable mic (~/dictator) and the body (~/whoop) as his
senses, and Claude sessions as his hands. Casa arrives as a deck plugin in both senses this repo
has: grid tiles and a `plugin/` skill, plus a new sense for Foxtrot. `docs/casa.md` is the
direction note; keep it current when that work moves.

**The mini, and how to reach it.** From this laptop it is `ssh foxtrot` (an alias in
`~/.ssh/config`: user `colin`, key auth, host `foxtrot.local`; the `.local` name resolves over IPv6, the IPv4 address did not
answer). Apple M2, 8 GB, macOS 15.5. On it: Homebrew, Node 22, tmux, ffmpeg, Xcode, Claude Code
(npm global) and a clone of this repo at `~/deck` (`npm run smoke` passes there). A user launch
agent (`~/Library/LaunchAgents/com.casa.awake.plist`, `caffeinate -s -i`) keeps it awake. Claude
has NO sudo there: hostname, `pmset`, package installers and system services are Colin's, at its
screen. Installs and clones over SSH are fine unasked; deleting his files waits for a yes. The
one-tmux-client rule below holds there too: never attach to a `deck-*` session on the mini from
a terminal, peek with `capture-pane`. The house side of casa lives at `~/casa` (this laptop and
github.com/cgrilson7/casa, private) and will run on the mini.

## Rules the code enforces (keep them)

- **Cap = 10** (`CAP` in `src/shared/types.ts`). Slots 1..10 are sticky while open: a session keeps its
  number until parked/killed; a new session takes the lowest free slot. ⌘1–9 = focus slots 1–9,
  ⌘0 = slot 10. Plugin and wolfpack member tiles cost no slot: the columns scroll. A config.json from
  before the two-sided grid (no `gridRows`) has its `gridColumns` reset, since it meant the whole
  grid's columns then. A saved record whose slot
  is above the cap is parked on load. Betas (below) sit at `BETA_SLOT_BASE` (100) and up: sticky
  too, never in the ⌘ range, never counted.
- **THE COLUMNS HAVE JOBS** (`homeSide` in `shared/gridorder.ts`): the LEFT column is where work
  gets done in the background — every session, beta and pack, and NOTHING ELSE; the RIGHT column
  is entertainment — the mini apps (Changes included: it is a plugin cell) and the web apps; the
  CENTER is whatever you are on now, work or play. A key's column is a fact about the key, so
  this OVERRIDES what the grid rule below still says about tiles dragging to "either column",
  per-tile default sides (odd / even slots, a pack on its alpha's side, mini apps alternating)
  and a `+` that offers everything: a tile drags anywhere WITHIN its column (a drag carries a
  second MIME type naming its column, so the other one shows no drop bar and takes no drop),
  `arrange()` moves a key saved on the wrong side (an order from before this) to the foot of its
  own, `moved()` takes no side, the LEFT `+` opens the session form + parked list only and the
  RIGHT `+` the mini-app and web-app pills only.
- **THE LEFT COLUMN IS THE SESSION BROWSER and orders itself** (`byRecency` in `Grid.tsx`,
  `SessionRecord.activeAt`): the session active most recently is on top. `activeAt` is set in
  `main/sessions.ts` when a session starts or resumes, on every Notification / Stop /
  UserPromptSubmit hook, and on an `input()` that carries a `\r` (a submit — not a keystroke, not
  xterm answering a query) — NEVER on a transcript tick, or working sessions would trade places
  all day. With `attentionFirst` the ones needing you sit above that. Each alpha's betas and pack
  come right under where its tile is (or would be, while it is focused). So NOTHING IN THE LEFT
  COLUMN DRAGS (no grip) and `gridOrder.left` is written empty: the saved order, drag and Reset
  Layout are the RIGHT column's. This too overrides the grid rule below.
- **The preview pane and Foxtrot's log open in the CENTER** (`.doc` is `grid-area: 1 / 2 / 2 / 3`):
  what you are reading is what you are on now, so it covers the focus pane (which lives on
  underneath) and leaves both columns alone; ⤢ is still the whole window. This overrides every
  older line here that says they open "over the grid" / "over the RIGHT column" / "never the
  terminal". Because it covers the terminal, `DocPane` takes keyboard focus when it opens, so
  typing cannot land in a terminal you cannot see and Esc closes it.
- **The top bar beside Foxtrot** (`HeaderStatus`, `UsageMeter`, `lib/usage.ts`, `main/usage.ts`):
  ONE ROW that never wraps (`.topbar-tools` is `nowrap`; the chips clip first). The CHIPS are the
  deck in a few words — `3 working · 2 need you · 1 held · 2 unattended` — each only there above
  zero and each NAVIGATION ONLY: working / unattended step focus through the sessions they count,
  need-you is `jumpAttention` (it skips the focused session), held opens the held agent in the
  center; nothing in the header stops or kills. `unattended` = top-level sessions whose
  `permissionMode` is `risky` in `PERMISSION_MODES`. USAGE is Claude Code's own numbers, never an
  estimate of ours: the hooks `--settings` file carries a `statusLine` whose command is
  `userData/statusline.sh` (written at boot by `HooksServer.writeStatusScript`), which POSTs the
  CLI's status JSON to `/status` in the background and THEN RUNS THE USER'S OWN statusLine
  command (read from `<CLAUDE_CONFIG_DIR|~/.claude>/settings.json` at that moment; `statusLine`
  is one object, so ours replaces theirs rather than merging — hence the pass-through; a
  project-level statusLine is not seen) on the same stdin, so the line under the prompt is
  unchanged. `/status` is not logged (it arrives with every message) and reaches
  `hooks.onStatus`, a FIELD set after construction, not a constructor argument. `UsageTracker`
  keeps `rate_limits.five_hour / seven_day` (subscribers only, after a session's first reply;
  `used_percentage`, `resets_at` in epoch seconds) as ONE pair for the account — each session
  knows them only as of its own last response, so the later window wins and within a window the
  higher percentage — persisted to `userData/usage.json`, dropped once `resets_at` passes; and
  `context_window.used_percentage` per deck session, in memory. The meters show % USED and time
  LEFT ("⟳ 2h 14m"), a dash when nobody has reported; amber from 70, red from 90 (`USAGE_WARN` /
  `USAGE_HOT`), the level in the tooltip's words too. A tile's head shows `ctx n%` from 50%.
  Sessions started before this existed report nothing until restarted. Not on the phone.
- **The grid** (`Grid.tsx`, `shared/gridorder.ts`): TWO columns of tiles either side of the focus
  pane (`.main` is tiles · focus · tiles; `focusWidth` sets the center's share), EACH ITS OWN
  ENDLESS SCROLL — no pages, no arrows, no dots. `gridRows` (4) is how many tiles fill a column's
  height, so it sets the tile height (`.grid-scroll` is a size container; a row is
  `(100cqh − gaps) / --rows`), `gridColumns` (1) how many sit side by side in one; past that the
  column scrolls (scrollbar hidden, `scroll-snap` proximity to tile tops; a tile's own chat
  scrolls first and chains to the column at its end). EVERY TILE DRAGS ANYWHERE in either column
  by its grip (⠿, top right on hover; the whole tile is the drag image): a session, a beta, a
  pack, a mini app. It lands before / after the tile under the pointer by which half it is over
  (left / right halves when a column is two wide; an accent bar shows where) or at the foot of
  a column on its `+`. What rides under the pointer is `dragGhost()`, a small DETACHED copy of
  the tile's head — never the live cell, which Chromium snapshots with its neighbours inside a
  scroller. While a tile is dragged a column AUTOSCROLLS within `EDGE` (72px) of its top or
  bottom, faster the closer (a rAF loop fed by dragover; scroll-snap is off for the drag,
  `.is-dragging`, or each step snaps back), and the dropped tile is scrolled into view where it
  landed. The arrangement is the `gridOrder` setting, `{ left, right }` lists of
  tile keys (`slot:<n>`, `beta:<id>`, `pack:<alpha id>`, a plugin key, `mol:<n>` for a Molecule tile past the first), written WHOLE on every
  drop: `arrange()` keeps saved keys that are not showing in place (the focused session's tile
  is out of the grid while focused and comes back where it was; a mini app that is off), and
  `pruned()` drops only what cannot come back (a gone beta / pack). A tile the order has never
  seen takes a DEFAULT THAT DOES NOT DEPEND ON WHAT ELSE IS SHOWING, so a focus swap never
  reshuffles: a session by slot (odd left, even right), a beta or pack on its alpha's side —
  these go right after the last session / member of that column, ahead of the mini apps — and
  a mini app by its index in `PLUGIN_KEYS` (even left, odd right) at the foot. So `attentionFirst`
  only orders tiles nobody has placed. The key test in `main/settings.ts` (`isGridKey`) is BUILT
  FROM `PLUGIN_KEYS`: the old hand-written regex never learned `pokemon`, which is why that tile
  could not be dragged. View ▸ Grid ▸ Reset Layout (and the launcher) empties `gridOrder`. Each
  column ends in a `+` (`PlusTile`) that opens the PICKER, a modal over the window: a pill row
  of the mini apps (turned on if off, moved to the foot of THAT column either way; one already
  showing says "move here"), and below the cap THE LAUNCHER'S OWN SESSION FORM and parked list
  (`StartCard` / `ParkedCard` from `SessionForm.tsx`, the one module both draw them from: the
  focused folder leads the pills there, and starting or resuming closes the picker). A tile that
  needs you (attention / blocked, a pack with a held agent) and is scrolled out of sight raises
  a chip at that edge of its column ("↓ 1 needs you"; click scrolls to it). A mini app's ×
  (beside the grip) turns its setting off. Plugin tiles wear an accent-tinted frame
  (`.tile-plugin`) so they never pass for a session. The preview pane and Foxtrot's log
  open over the RIGHT column (`.doc`, grid column 3; ⤢ = the whole window); the agent pane takes the CENTER.
- **Wolfpack** (`plugin/skills/wolfpack/`, `main/agents.ts`, `PackTile`, `AgentPane`, `AgentStatus`, `LeashButtons`,
  `LeashDialog`, `lib/leash.ts`, `lib/agents.ts`): a session (the ALPHA, Fable as a rule) and the Opus agents
  doing its typing, in the grid right after the sessions, grouped by alpha in slot order: its
  betas needing you first, a cell each, then ITS PACK TILE, one cell for all its subagents (key
  `pack:<alpha id>`, so a pack never mixes two sessions'; part of the unpinnable block). The
  PACK TILE is what ties agents to their session: the head is `α<slot>` + the session's name
  (click = focus it), the tally ("2 working · 1 finished") and "clear n" for the finished; the
  body is a ROSTER, a row per agent as it started — a MINIATURE gold fox in its pose (runs while
  working, looks around while pausing, sits up alert when held, asleep once finished, down when
  cancelled), name, type · model, the line it is on NOW (`useLastBlock`: its transcript's last
  block, live; what it said last once finished; the reason when cancelled), the leash (on row
  hover, always while paused) and `AgentStatus` (a pulsing pip + the running clock; `✓ 3m 12s`
  when finished). A pack of ONE has room for the full thing: its conversation runs under the
  row; five or more (`DENSE_FROM`) go to one line each and the roster scrolls. A held agent
  makes the tile `needy` (the page arrow lights). `lib/agents.ts` holds state / pose / clock
  / the last block and `openAgentPane(id)`, the window event App listens to. The
  skill reaches every session as `/deck:wolfpack` because the deck starts each one with
  `--plugin-dir <plugin/>` (beside `--settings`), so no repo and no user needs a copy of it;
  outside the deck it does not exist, which is right — it can do nothing there. Two kinds of
  member, one tile treatment (β, gold fox, gold border) and ONE LEASH (below):
  - **Subagents** (`main/agents.ts`; the canonical pack): whatever the session runs through
    the Agent tool or a Workflow, at the root or inside one. The CLI's `SubagentStart` /
    `SubagentStop` hooks (payload: `agent_id`, `agent_type`; the stop adds
    `agent_transcript_path` + `last_assistant_message` — NO description or task, whatever
    older notes said) are in our `--settings` hooks file and POST to the hooks server; the
    tracker keeps the list and hands each agent's transcript (the same JSONL as a session's —
    its lines are all `isSidechain`, which the tailer accepts for these) to the
    TranscriptWatcher under `agent:<id>`, so `ChatView` shows it unchanged. WHERE IT IS DEPENDS
    ON WHO STARTED IT, under `<projects>/<cwd>/<sessionId>/subagents/`: `agent-<id>.jsonl` for
    an Agent-tool subagent, `workflows/wf_<runId>/agent-<id>.jsonl` for a Workflow's (type
    `workflow-subagent`), each with an `agent-<id>.meta.json` sidecar (`agentType`,
    `description`, `model`, and a Workflow's `workflowPhase`). Neither the file nor the run's
    folder need exist at SubagentStart, so NOTHING IS GUESSED: an agent's `path` is null until
    `resolve()` has seen the file (looked for every `RESOLVE_MS` and on its every tool call,
    `RESOLVE_DEPTH` folders down), `syncAgents` takes a null path and restarts a tail whose
    path moved, and the stop hook's `agent_transcript_path` wins whenever it names a file that
    exists (hooks.log keeps it on the stop's line). A guessed path is what left Workflow tiles
    on "starting…" forever. NAMES: the
    parent's own `PreToolUse` for the `Agent` tool carries `description`, `prompt`, `model`
    and `run_in_background`; the tracker queues those per session and matches the next
    `SubagentStart` of the same type to the oldest (the CLI starts them in order), so the tile
    is named by the Agent call's description; a Workflow's agents (no Agent call) take the
    sidecar's `description` — the script's `label` — with `AgentView.phase` from
    `workflowPhase` and the model (`agentKind()` writes "workflow · Build" where a type would
    go; the agent pane adds a phase badge); failing both a tile takes the prompt's first line
    once the transcript shows it (a Workflow agent's is the harness's preamble), else the type. A stop (or a tool call)
    for an agent never seen to start still makes a tile. No terminal, nothing to type into:
    it is the parent's. A roster row (or a solo pack tile) = the AGENT PANE in the CENTER
    column, the way the Studio takes it (`.focus.agent-pane`; it, the Studio and the Game Boy
    take turns; the focused session shows as a grid tile meanwhile; a session tile, a focus
    change, the head's `α<slot> name` badge, close or Esc gives the center back, and a
    dismissed agent closes it): a hero — the gold fox at 3× in its pose, the name, `AgentStatus`
    with the running clock, type / model / background, and the leash as labelled buttons —
    then a pause / cancel banner, the brief (one line, click to unfold), a RAIL of the pack as
    chips with miniature foxes (click, or ← →, steps between them; the open one's roster row
    is lit), and the whole conversation. The preview and Foxtrot's log still open over the
    right column beside it. Broadcast as `agents:update` (`DeckApi.agents` / `onAgents`; the
    phone gets the frame and shows each one as a gold β chip and a swipe page after its
    parent, the leash under ⋯). THE AUTO-KILLER (`useAutoDismiss` in `lib/agents.ts`, mounted once in
    App; renderer state, so not the phone's): a finished agent's row counts down 15s
    (`AUTO_DISMISS_MS`) where its state was and is then dismissed; the count is a button that
    HOLDS it ("kept"; clicking again lets it go, from 15), opening an agent in the center keeps
    it too, its × is always showing, and the head's "clear n" takes every finished one, a pack
    of one included. Failing all that, a finished agent stays until the parent's next TYPED
    prompt — the CLI also fires `UserPromptSubmit` when a background agent's result comes back
    as a `<task-notification>` turn, and that one must not clear the pack — or 30 min, 12 per
    parent, or its × (`agentDismiss`). `userData/hooks.log` has one line per hook that
    arrived (capped at 1MB at boot; tool calls are logged only when refused).
  - **Beta sessions** (`main/pack.ts`, `plugin/scripts/wolfpack.mjs`): for a track that needs its own
    terminal, permission mode, or a life beyond the alpha's. The alpha spawns up to
    `PACK_MAX` (8) of them — Opus by default — as deck sessions of their own, each
  `claude --name <task> --model opus [--permission-mode m] [--worktree] "<prompt>"` (the prompt is
  the CLI's positional first prompt, so nothing races the TUI). A beta's record carries
  `pack: { alpha, task }`; it is open (attached, transcript tailed, hooks, fleet) but it is not a
  top-level session: never focused by ⌘, the focus stays on the alpha when it spawns, and it
  takes no slot in the ⌘ range (`BETA_SLOT_BASE`). It shows a `β` and the GOLD fox (`Fox
  coat="gold"`: the sheet with slay's yellow ramp swapped in for the two coat colors, generated
  on a canvas at boot, `--fox-sheet-gold`) in its head and a gold border, in a cell of its own
  (a real `Tile`: conversation, prompt bar, click = focus its terminal; the focus pane's head
  says `pack of <slot>`, click = the alpha). Cascades: parking the alpha (⌘W, or its Claude
  exiting) parks the betas; killing it kills them; resuming it resumes the betas still alive in
  tmux; a beta resumed on its own after its alpha is gone becomes an ordinary session. The
  alpha talks to the deck over the hooks server: `POST 127.0.0.1:<hook port>/pack` with
  `{ op, alpha: <CLAUDE_CODE_SESSION_ID>, pane: <$TMUX_PANE> }` — `spawn` (a manifest of betas),
  `status` (status, attention, transcript path, last prose / tool line, and its own subagents,
  per beta, plus the alpha's subagents with their leash state), `say` (paste + ⏎ into one),
  `dismiss` (kill, or `park`); the settings file now also sets `DECK_HOOK_PORT` / `DECK_PROFILE`
  / `DECK_WOLFPACK` (the script's absolute path, repo tree or app Resources) in every session's
  env, and the script falls back to the tmux socket's name for the port. Only an open,
  top-level session may spawn (a beta cannot). Foxtrot names a beta `beta “task”`.
  - **The leash** (`main/agents.ts`, the `PreToolUse` hook in `main/hooks.ts`; commands
    `leashPause` / `leashResume` / `leashCancel` with a subagent's id or a beta's deck id):
    EVERY tool call of EVERY deck session POSTs `/pretool` first (the hook's command is
    `curl -m 3600` with `timeout: 3600`, and whatever the server answers is the hook's
    stdout; no deck listening = curl fails at once = the call goes through; the payload
    carries `agent_id` when the call is a subagent's, verified). Normally the answer is a 204
    at once. PAUSE (⏸ on the head; the dialog takes an optional note) holds the member's next
    tool call: the response waits until ▶ resume (`held` on the view says it has bitten; the
    fox sits up alert), at most the hour. CANCEL (✕; the dialog REQUIRES a reason) refuses the
    member's tool calls from then on with a PreToolUse `deny` decision carrying the reason,
    which the agent reads as its tool result and returns early on (verified end to end: the
    parent gets "I was cancelled: <reason>"); a beta is killed a beat later. Both are TOLD TO
    THE ALPHA by typing into its terminal (`manager.paste`: a message typed while Claude works
    is delivered at the next tool boundary within the same turn — documented): a pause only
    with a note (and then the resume too), a cancel always, as `[deck] The user cancelled your
    subagent “name” … Reason: … fix its brief and relaunch it, fold the track into another
    agent, or drop it — and say which`. The skill tells the alpha how to take these. A
    finished agent's ✕ only dismisses its tile. The dialog is one component (`LeashDialog`,
    the picker's frame) raised through `lib/leash.ts` (a window event, like a path opening the
    preview) from a tile head, the agent pane, or a beta's focus pane; the phone uses a plain
    prompt. A paused beta shows `paused` on its view (`SessionView.paused`, set by
    `manager.setPaused`).
- **Plugins**: Wikipedia = the picture of the day (the featured feed's `image`), full bleed,
  click opens its file page via `deck:openExternal` (http(s) only). It rotates: every 2 minutes
  (`CYCLE_MS` in `WikiTile`) a random day's picture from the archive (2016 on, the feed is empty
  before; `wikiPicture('past')` tries 4 days then falls back to today's), and every third one is
  today's again; the caption carries the day for archive pictures. ‹ › on the caption's tag line (on hover)
  step by hand: ‹ back through the pictures shown since the tile mounted, › forward and then on to a new
  one; a manual step starts the 2-minute clock over. Main caches past days for
  good, today's for 1h. A clock (`.wiki-clock`, local zone, ticking each second) sits top left;
  THE WEATHER sits under it (`Weather.tsx`, `main/weather.ts`; the two are `.wiki-corner`): the first
  place of the `weatherPlaces` setting large (glyph, temperature, the word for the WMO code, then
  its name with today's high / low; feels-like and wind in the tooltip), every other place a line
  (with its own time when its zone is not this machine's). Portland, Maine in °F by default
  (`WEATHER_PLACE_DEFAULT`, `weatherUnit`), `WEATHER_PLACES_MAX` (6). A click on it lays the PLACES
  EDITOR over the darkened picture (the `places` overlay, the results panel's frame): ↑ makes a
  place the first, × removes it, °F / °C, and a line that finds a place by name — Open-Meteo's
  geocoder matches the name alone, so "Portland, Maine" searches "Portland" and ranks the hits
  whose state / country match the rest; ⏎ adds the first hit. No places = a faint "+ weather".
  Data is Open-Meteo (no key), one forecast call for all the places, cached 10 min in main; the
  tile asks every 5 min and when the places or the unit change. Hidden while a search shows.
  a transparent search box sits top right over it (`.wiki-search`: no chrome until hover/focus). Typing (350ms pause, or ⏎)
  searches English Wikipedia (`/w/rest.php/v1/search/page`) and the hits take over the tile over
  the darkened picture; a hit loads its lead section (`/api/rest_v1/page/summary`) in place, its
  title opens the browser. Esc / × brings the picture back. Search thumbnails are re-requested at
  250px (the API's are 60px). The renderer CSP allows no outbound requests (feeds are fetched in
  main) and whitelists only `*.wikimedia.org` and `i.scdn.co` (Spotify artwork) images.
- **Music** (`MusicTile`, the last plugin cell; `showMusic` shows it, `music` picks the face; View ▸
  Music has both, and each face carries a switch to the other, bottom right). ONLY ONE FACE IS
  MOUNTED. Spotify is the default: `SpotifyTile` + `main/spotify.ts` drive SPOTIFY.APP over
  AppleScript (the web player needs Widevine, which Electron does not ship, so it was never an
  option), which costs the deck no bandwidth: now playing (artwork, track, artist, a progress bar
  ticked locally between polls), ⇄ shuffle ⏮ ⏯ ⏭, and a row of chips for `spotifyPlaylists`
  (playlist / album / artist / track URIs or open.spotify.com links, edited in config.json; five
  Spotify editorial playlists by default) that `play track <uri>` in Spotify.app, launching it if
  it must. Names come from Spotify's public oEmbed endpoint, cached in main. Main polls the app
  every 2s only while this face is showing (`System Events` first, so a poll never launches
  Spotify); only changes are broadcast (`spotify:state`). Not running = "open Spotify" + the chips.
  A SPOTIFY ACCOUNT can be connected (`main/spotifyauth.ts`): set `spotifyClientId` (a Spotify
  app's client id, developer.spotify.com; 32 hex) in config.json, then the "connect account" chip
  or View ▸ Music ▸ Connect Spotify Account… opens the consent page in the browser; main catches
  the redirect on `http://127.0.0.1:47820/callback` (`deck`) / `47821` (other profiles) — both
  must be registered on the Spotify app, literal 127.0.0.1, Spotify no longer takes localhost.
  It is the PKCE flow: NO CLIENT SECRET anywhere. Tokens go to `userData/spotify.json` (0600);
  the refresh token renews and rotates; a revoked grant disconnects. Scopes: playlist-read-private,
  playlist-read-collaborative, user-read-recently-played. Connected, the chips become the
  contexts played lately (the last 50 plays' distinct playlist/album/artist, named), then every
  playlist in the library, then the setting's; a search line above them (350ms pause; ⏎ plays
  the first hit; Esc clears) swaps the row for tracks / playlists / albums / artists with a kind
  glyph. `main/spotifyapi.ts` caches the library 5 min (a play invalidates it). Playback is
  STILL Spotify.app over AppleScript — the Web API's player endpoints need Premium and are not
  used, so this works on any plan. Disconnect: the menu item, or delete spotify.json.
  The lofi stream (`YouTubeTile`) is behind the switch and NEVER PLAYS UNTIL ASKED: the bare embed
  player (`autoplay=0`, sound on) in a `<webview>` on partition `persist:youtube` (`webviewTag` is
  on in `index.ts`) shows its poster until ▶; pausing stops the download, and switching back to
  Spotify unmounts the webview. Play/pause and mute call the embed's player object
  (`#movie_player`) through `executeJavaScript`, never the `<video>` element (the player
  re-applies its own mute state to it). Not on the phone.
- **Studio** (`main/studio.ts`, `StudioTile`, `StudioPane`, `lib/studio.ts`, `plugin/skills/studio/`,
  `plugin/scripts/studio.mjs`): Gemini image generation inside the deck, ONE service with THREE
  DOORS and one gallery. The TILE (a plugin cell, `showStudio`) is the newest image full bleed
  with a prompt bar under it and the last few thumbnails over its bottom edge; the PANE (⌘⇧I,
  View ▸ Studio ▸ Open Studio, or the tile's ⤢) takes the CENTER column — it REPLACES the focus
  pane, the focused session showing as a grid tile meanwhile, and a click on any session tile,
  ⌘1–9 or a focus change closes it — and holds the composer (prompt, model / ratio / size / tag,
  reference chips), the viewer of the selected job and the gallery; and a SESSION asks over
  `POST 127.0.0.1:<hook port>/studio` (`{ op: 'gen' | 'list' | 'models' | 'info', … }`, the hooks
  server, like `/pack`), which is `plugin/scripts/studio.mjs` — `DECK_STUDIO` in every session's
  env, `gen` / `list` / `models` / `info` / `comic <manifest.json>` — driven by the `/deck:studio`
  skill, so the model that is good at language writes the request for the model that is good at
  pictures. The pane's "Ask Claude for help" STARTS A NEW SESSION for it (`DeckApi.newSession`:
  the `new` command with the record back, plus `name`, a positional first `prompt` and
  `focus: false`, so the Studio keeps the center; named "studio", the focused session's folder,
  the default model, no worktree) whose first prompt is the composer's notes as a message
  starting `[deck studio]`, and shows that session's conversation INSIDE THE PANE, under the
  composer (`.studio-chat`: a tile's `ChatView` + `TilePrompt`, a file dropped on it pasted into
  that session; "send notes" pastes the composer's current state as a new turn, "terminal"
  focuses it, which closes the Studio, × sends it back to the grid, "New chat" starts another).
  It is an ordinary session otherwise (a ⌘ slot, a grid tile while the Studio is closed or it is
  not the Studio's chat; App keeps its id in localStorage as `studioChat` and hides it from the
  grid while the pane shows it). It never pastes into the focused session. The message OPENS A
  CONVERSATION the skill answers: it asks what is wanted, drafts the prompt in a code block,
  refines it with the user (a file path dropped into the chat is a reference), and generates
  only when told to go.
  Every door lands in the SAME gallery: `userData/studio/`, a JPEG (the mime's extension) per job and `jobs.json` beside
  it (the last 400, newest first), broadcast whole as `studio:update` on every change, so the
  tile and the pane only draw the list; a job is `running` in the list before the call goes out
  and `done` (with `image`, the absolute path) or `error` when it comes back, and `generate()`
  never throws on a refusal — the reason is on the job. A delete takes the PNG with it.
  The call is the Generative Language API's `generateContent` (v1beta, `x-goog-api-key`,
  references inline as base64, `responseModalities` TEXT + IMAGE); the KEY is `geminiApiKey` in
  config.json, else the login shell's `$GEMINI_API_KEY`, and without one every job fails saying
  so (`studioInfo()` reports which). The MODEL is the request's, else the `studioModel` setting
  (`STUDIO_MODEL_DEFAULT`, `gemini-3.1-flash-image`); `STUDIO_RATIOS` and `STUDIO_SIZES` are what
  the API takes and `STUDIO_REFS_MAX` (10) the references one request may carry. A generation
  takes 10–120s, so nothing that calls it may have a short timeout. Not on the phone
  (`phone/api.ts` answers empty / rejects).
- **Pokemon** (`lib/gameboy.ts`, `PokemonTile`, `PokemonPane`, `lib/pokemon.ts`, `main/pokemon.ts`; the
  `showPokemon` setting, off by default; `pokemonRomDir`, `~/Downloads`): a Game Boy Color inside
  the deck. The emulator is **serverboy** (npm, GPL-2: pure JS, no DOM, the gameboy-online core)
  running IN THE RENDERER as ONE MACHINE for the whole window (`gameboy()`, made on first use):
  a rAF loop steps the core (`doFrame()` is ONE ITERATION, 8ms of Game Boy time — settings[6] —
  not a video frame, so real time is 125 a second; a tick runs however many 8ms fell due, at
  most 6, times the speed), reads the screen straight off the core's `canvasBuffer` (its
  `graphicsBlit`, which rebuilds a 92160-entry JS array per step for `doFrame`'s return value,
  is stubbed out) into every canvas attached (`attach(canvas)`, 160×144, CSS-scaled with
  `image-rendering: pixelated`), and taps the core's `outputAudio` for the sound (353 stereo
  pairs per iteration = 44150 Hz, the rate the AudioContext is opened at; each tick's samples are
  one AudioBuffer queued a little ahead of now). serverboy names its private slot off
  `process.hrtime()` at module load: `lib/gameboy.ts` stands up a `process` for the dynamic
  import and takes it away again. The TILE is the screen, silent, click = the PANE; the pane
  (⌘⇧G, View ▸ Pokemon ▸ Play Pokemon, the tile, the launcher's button) takes the CENTER column
  the way the Studio does (it and the Studio take turns; a focus change closes it), and is the
  only place sound plays and keys work: ← ↑ ↓ → pad, Z = A, X = B, ⏎ Start, ⇧ Select (not while
  typing in a field; Esc closes), pressed per iteration from a `held` set since the core lets go
  of every key at the end of each. The bar: the battery save now, three SAVE-STATE slots (the
  core's `saveState()` as JSON, ~4MB, via `saving()`), 1× / 2× / 4× (faster is silent), pause,
  reset (a reload with the battery save), sound / mute (kept in localStorage). ROMs are the
  `.gb` / `.gbc` files of `pokemonRomDir` (pills in the empty pane, a select in the bar); the
  last one played is kept in localStorage and `autoload()`ed by whichever view mounts first, so
  the tile boots straight into the game. Bytes cross IPC as typed arrays (a Buffer arrives as a
  Uint8Array). BATTERY RAM (`getSaveData()`) goes to `userData/pokemon/<name>.sav` every 30s
  while running, on pause, on a cartridge swap, when the last view unmounts (the tile turned off
  with the pane closed stops the loop: the game waits) and on `pagehide` (⌘R reloads the
  renderer, so the game restarts from that save); states are `<name>.state0..2`. Not on the phone.
- **Trainer** (`plugin/scripts/trainer.mjs`, `plugin/scripts/lib/`, `plugin/skills/trainer/`, `POST /gameboy` → `gameboyCall` in
  `main/index.ts` → `GameBoy.drive` in `lib/gameboy.ts`): a session plays Pokémon Yellow on the deck's Game Boy through a CLI whose every
  command ends by printing the state. THE DOOR is one small protocol with two ends (`lib/door.mjs`): the deck's emulator, or
  `--headless <rom> --dir <d>` = serverboy in the CLI's process with the state carried between calls as `<d>/session.state` — which is
  how anything new is tried FIRST, never on the live game. Ops: info, ram, poke, hold, settle, screen, save / load, speed, pause, rom;
  reads and writes go through the core's `memoryRead` / `memoryWrite` (Yellow runs in GBC mode; D000–DFFF is banked).
  THE SPRITE GAG (`lib/sprites.mjs`, `trainer.mjs sprite [watch]`): in a battle the enemy MON's front picture becomes the Notes icon
  named NOTES APP, the mon YOU SEND OUT's back picture the Village logo named VILLAGE, and "Wild X appeared!" reads "A boring X
  appeared!". TRANSIENT POKES ONLY — VRAM, the tile map's HUD cells, `wEnemyMonNick` / `wBattleMonNick` (the battle-only copies), and
  the LOADED ROM IMAGE for the text (the door's `patch` op: `core.ROM[]` by file offset, a state load — which carries the ROM — undoes
  it, so the watch renews it as each battle starts); NEVER `wPartyMonNicks` or anything else an in-game SAVE includes, never the ROM
  file, never a save file. The text: bank $27's "Wild @ … appeared!" at $9fb65 is reached by a text_far at $f40c7; "A boring @" is
  longer, so it is written into the bank's zero padding at $9fb97 and the pointer turned to it — hence a front name of NINE characters
  at most (`FRONT_NAME_MAX`: nine + "A boring " fill the line). THE MOVESET (`quizPatch` / `quizMoves`; `plugin/data/sprites/movesets.json`,
  `--moves <name>`, the first set by default): your FIRST party mon's four moves read e.g. NOTES, WITH, FRIENDS, VERSION 2.0 — each
  HYPER BEAM'S ANIMATION AND POWER ON SOLAR BEAM'S CHARGE EFFECT (record 63 39 150 6 255 10: never misses), of the unused BIRD type
  renamed APP (the box says TYPE/ APP; BIRD is in no type-chart row, so nothing resists it), 10/10 PP ("VILLAGE is updating!" for a turn — Solar Beam's charge line rewritten in place — the enemy's turn, then the beam) — and the enemy's
  mon knows only SPLASH. Four DONOR moves nobody carries (BIDE, CONSTRICT, BARRAGE, SUBSTITUTE; never Splash) get that record in the
  loaded ROM's move table (found in the cartridge FILE by POUND's record; the first byte is the animation and the charge-line selector,
  whose `cp SOLARBEAM` byte in the battle bank is turned to HYPER_BEAM so "took in sunlight!" — rewritten "is updating!" — still prints) and THE WHOLE NAME TABLE
  REBUILT with the donors' names swapped (an @-terminated name per move, so a longer name shifts every name after it; 2.5K of zero
  padding follows the table and takes the growth); 13 letters is the move box's width (`MOVE_NAME_MAX`). THE FIRED LINE is always "VILLAGE used THE POWER OF
  FRIENDSHIP!": the used text's asm in the battle bank loads the PLAYER's move then `jr z` past the enemy's (8 bytes after
  `text_far _MonName1Text; text_asm; ldh a,[hWhoseTurn]; and a`), and those become `jr nz,+4; ld hl,STUB; ret` — the enemy's turn as
  before, the player's returning a 5-byte home-bank text (the home bank's last 17 bytes are zero) whose text_far prints "used THE POWER
  OF" <SCROLL> "FRIENDSHIP!" from the bank $27 padding after the boring text. (A long NAME cannot do it: a 23-letter move name
  overruns the game's name buffer — party moves and level went to garbage in the simulation — and the menu draws before any swap.)
  FOXTROT IS RED — ONLY WITH `--foxtrot` (off by default: Red and Pikachu stay themselves). In a battle's intro he stands in Red's back slot (`fox` in `apply`, `backFrames`; `data/sprites/fox-back.png`,
  the idle frames with rows at 3× and the 22 columns over the 56, on the floor) wagging at 280ms while the block is Red's (whole,
  no HUD of yours), IN HIS OWN COLOURS — Red's block is BG palette 2 (white, yellow, red, dark; the text box shares it but uses only
  white and dark), read through BCPS/BCPD ($FF68/$FF69) and replaced with his coat once the fade-in has left Red's finished red in
  it (a poke mid-fade would be overwritten, so it waits); the game restores its own at the send-out — and Village takes the slot. IN THE OVERWORLD (`overworld`, `foxFrames`; `fox-idle.png` / `fox-run.png`, strips of 16×16 frames from the
  deck's own sheet, rows at 1:1 and the 22 columns SQUEEZED into 16 by a vote per cell — the whole fox, tail tip and all; shrinking
  both ways was unreadable and a 1:1 crop lost the tail — mirrored to face left) he is Red's walking sprite, which CANNOT BE BIGGER without the game's code: four 8×8 hardware sprites the game re-lays
  every frame (8×16 mode doubles the same column; extra OAM entries are wiped; Pikachu's four trail a step behind): Red is four 8×8 hardware sprites, row-major tiles, standing
  frames at OBJ $00–$0B (down, up, left; right = left flipped) and walking at $80–$8B, Pikachu the same shape right after. The game
  alternates the two frames as you step, so BOTH are kept equal to the CURRENT frame of Foxtrot's own animation — the run cycle
  (8 frames, 69ms) while `wWalkCounter` runs, the idle tail-wag (5, 280ms) otherwise, every direction the same side view — and
  Pikachu's 24 tiles are blanked (he follows, unseen). A map change reloads the tiles; the watch repaints when they are not ours.
  Never in a battle ($8000 is the battle's sprites then). HIS COAT is OBJ palette 0 (Red's) in the CGB palette RAM, written through
  OCPS/OCPD ($FF6A/$FF6B: white, Village's orange, the outline) with every paint and once a second, since map loads and fades
  rewrite it. A converter cell with no source pixels under it is CLEAR (it once voted outline: a black bar over his head).
  YOUR NAME: the home bank's <PLAYER> handler (`push de; ld de,wPlayerName; jr`) has its operand turned to "VILLAGE USER@" written into
  the RST vectors ($0010; the ROM's first 64 bytes are zero, Yellow uses no rst), so every "<PLAYER> …" line says VILLAGE USER while
  wPlayerName, which a SAVE keeps, is never written (the start menu and trainer card print it directly and keep the real name).
  THE LINES THAT NAME YOUR MON FROM THE PARTY — "gained … EXP. Points!", "grew to level",
  "fainted!" — print a scratch buffer (text_ram wcd6d) the game fills from wPartyMonNicks, which is never written: their pointers
  are turned to wBattleMonNick, so they say VILLAGE (any party mon's, while the watch runs). Then wBattleMon / wEnemyMon
  get the moves at each send-out and the PP topped up every poll (10/10; a PP field is six bits, 63 at most; PP is at +$19 of
  the battle struct — +$1c was a bug that wrote into wTrainerClass and the enemy's base stats) — the
  BATTLE-ONLY copies the menu and the AI read; the party keeps its real moves (the game copies PP back per slot, nothing else), so an in-game
  SAVE never sees it. The map (read off `wTileMap`, Yellow UE): front pic = tiles $00–$30 at tile map columns 12–18 rows 0–6 →
  VRAM $9000; back pic = tiles $31–$61 at columns 1–7 rows 5–11 → VRAM $9310; both a full 7×7 laid COLUMN-major (id = first + col × 7
  + row; 784 bytes of 2bpp), so the back picture takes true 56×56 art too; HUD names at (1,0) and (10,7), ten cells, $7F-padded.
  A picture is painted ONLY while the tile map shows its 7×7 block whole (never over a menu, the party screen, a send-out animation
  or a hit blink) AND IT IS A MON'S: the back block holds RED's back from the fade-in until you send out (your HUD frame is drawn only
  then), the front block holds the TRAINER's face through "wants to fight!" with no HUD and his mon's picture ~50 steps before its
  HUD, while "sent out" is in the text box — so yours paints with your HUD up, the enemy's in a wild battle, with its HUD up, or with
  "sent out" showing; `wEnemyMonNick` is STALE from the last battle until a trainer sends out and says nothing. A name goes in
  whenever its slot's nick holds one, the HUD only while its frame tiles are up. The watch polls every 20ms (a read of the door is
  under a millisecond; a name is printed ~20 core steps after the game sets it, so at 1× ours is in before the first letter). The game re-decompresses its
  pictures at every send-out and after the party / bag screens, and the move list restores a saved copy of the screen (old names
  and all) — hence `sprite watch`, every 250ms. THE CATCH: this core drops VRAM writes and reads $FF while STAT is in mode 3, and a
  poke lands wherever the last 8ms step ended — so an all-$FF read is retried a keyless step later and a write is read back and
  retried (24 tries), all through the existing ops: `lib/gameboy.ts` needed no change. Village wears the PALETTE OF THE SPECIES in your slot
  (the dithered disc in Pikachu's yellow→orange, Nidoqueen's blues — Colin's choice, after a round in the icon's own yellow and
  salmon); NOTES WEARS ITS OWN: the enemy's picture is BG palette 3 (the HUD is 1, the text box 2), read and written through
  BCPS/BCPD ($FF68/$FF69) — paper, yellow, brownish-yellow rules, outline — once the fade-in has brought colour 0 up to white, and
  again whenever a flash or a send-out puts the species' palette back. The art is CONVERTED, never redrawn (`scripts/sprites.mjs`): Village = the white strokes of the app icon (coverage of
  min(r,g,b)-white pixels per cell) as shade 0 over a disc dithered shade 1 → 2 (the icon's own gradient), one cell of shade 3 outside
  the ring; Notes = boxed down, header 1, rules and perforation 2, paper 0, a shade-3 outline where opaque meets transparent.
- **Molecule** (`lib/mol.ts`, `MolTile`, `MolPane`, `main/mol.ts`, `main/data/molLibrary.ts`, `plugin/skills/mol/`,
  `plugin/scripts/mol.mjs`; the `showMol` setting, off by default): a 3D molecular viewer a TEACHING SESSION
  DRIVES while it explains (the grail lessons: chemistry up to protein folding), built on the Game Boy's
  plan — the state lives in the renderer and a door reaches it. THERE CAN BE SEVERAL MOLECULE TILES (the
  `molTiles` setting: tile numbers, `[1]` by default, `MOL_TILES_MAX` = 8 because each viewer holds a WebGL
  context and Chromium caps those), a viewer and a scene each — the one mini app that is more than one cell.
  Grid keys are `molKey(n)`: `mol` for tile 1, `mol:<n>` past it (`isPluginKey` / `molTileOf` in
  `shared/types.ts`; `isGridKey` takes them), sides taken in turn. A tile's head `+` opens another, the `+`
  picker's Molecule pill says "another here" while one shows, and a cell's × CLOSES one of several (its
  scene goes with it) but only puts the last one away (`showMol` off). `App` calls `syncMolTiles` on every
  `molTiles` change: a viewer whose tile is gone is disposed (`WEBGL_lose_context`), and the pane closes if
  it was showing it. A tile's scene (targets + looks) is kept in localStorage (`mol:scene:<n>`) and
  `restore()`d when its viewer is made, so tiles survive ⌘R; any other op calls a restore off. The viewer is **3Dmol.js** (npm `3dmol`,
  BSD-3), a dynamic import of its minified ES build BY PATH (`3dmol/build/3Dmol.es6-min.js`, typed by
  `3dmol.d.ts`; the package's `main` is 5MB with an inline source map). Pure JS + WebGL, so the CSP is
  untouched — EXCEPT that its surfaces are computed in workers made from a blob: URL, which `script-src
  'self'` refuses, so `setSyncSurface(true)` runs them on the renderer's thread (a protein's surface blocks
  for a second or two; `molCall`'s 45s budget is for that). ONE VIEWER PER TILE (`mol(n)`, made on first use): it lives
  in a host element of its own that `mount(el, name, rank)` moves to the highest-ranked view showing — the
  pane (1) over its tile (0), a fixed off-screen `.mol-staging` box when neither is mounted — so the two
  always show the same scene and `look` has a frame even before the tile was ever scrolled to. THE SCENE
  IS STATE (models, style, colour, surface, labels, selection, highlight, measurements, callouts, picks)
  and `redraw()` repaints all of it from scratch after every op; ops run one at a time (a queue). The UI
  and the door call the SAME `drive(body)`. THE DOOR: `POST /mol` (hooks server) → `molCall` in
  `main/index.ts`, which answers `list` itself, refuses AT ONCE with "turn on the Molecule tile" when
  `showMol` is off, RESOLVES ANY STRUCTURE FIRST (`show`: `structures[0]`, `compare`: two) and only then
  sends `mol:req` WITH THE TILE IT IS FOR — main picks it: `tile` (`--tile n`; an unknown one is refused
  with the list), `new` (`show|compare --new`: the first EMPTY tile per the renderer's `tiles` op, else
  `nextMolTile` added to `molTiles`; `molClaimed` keeps parallel `--new`s off one tile), else the tile the
  door used last (`molLast`). Every answer carries `tile`. `tiles` lists them (+ `current`), `close` removes
  one (the last is only emptied); the renderer answers on `mol:reply`. `installMol()` runs at boot in App when the tile
  is on. ALL FETCHING IS MAIN'S (`Mol.resolve`): a library name / formula / alias → `data/molLibrary.ts`
  (16 molecules, H₂ to a Gly-Ala dipeptide, offline, with per-atom partial charges: PubChem's MMFF94 ones,
  and three entries by hand — H₂, the NaCl ion pair with FORMAL ±1, the hydrogen-bonded water dimer — each
  entry's `method` says which; regenerate with `scripts/mollib.mjs`); a 4-character PDB id → RCSB mmCIF;
  `AF-<uniprot>` → AlphaFold DB, the file's URL taken from its API because the version suffix moves (v6 in
  Sept 2026); any other name, `smiles:<…>` (POSTed; cached under its hash) or `cid:<n>` → PubChem's 3D
  conformer SDF, whose `PUBCHEM_MMFF94_PARTIAL_CHARGES` field is parsed into charges; an absolute path
  (the CLI makes paths absolute; `~/` for the tile's input) → `.pdb .cif .sdf .mol .mol2 .xyz .cube`, 60MB
  at most. Everything fetched is kept in `userData/mol/cache/`, so a second `show 1UBQ` never leaves the
  machine. Proteins (20+ standard residues) get 3Dmol's Amber-style charges (`applyPartialCharges`); a
  small molecule shows ball-and-stick in element colours, a protein as a cartoon by chain with ligands as
  sticks and waters hidden. COLOUR IS ONE FUNCTION (`colorOf`) for atoms, cartoon, surface AND the sequence
  strip: element, charge (red δ− / blue δ+), hydrophobicity (Kyte–Doolittle), residue (side-chain class),
  chain, secondary, plddt (AlphaFold's bands, from the B-factor), bfactor, model. `--surface electrostatic`
  is the VDW surface coloured by partial charge, NOT a computed potential (a `.cube` from xtb is the way
  to a real one later), and the skill says so. SELECTIONS are the deck's own little language compiled to
  a predicate (`resi 14,87`, `chain A and resn HIS`, `within 5 of (…)`, `byres`, `picked`…; never 3Dmol's
  selection objects — atoms go to 3Dmol as `{model, index}`). ATOM NUMBERS are index + 1 within the model
  (`12`, or `2.12` with several models); `p1`…`p4` are the picks. `highlight --hbonds` is geometric (with
  hydrogens: H···A ≤ 2.5 Å, angle ≥ 120°; without: N/O pairs ≤ 3.5 Å two residues apart) and says so in its
  answer; `--contacts <Å>` is the selection against the rest. `compare` lays B on A — Cα pairs from an
  end-gap-free sequence alignment (so 1UBQ finds the FIRST copy inside polyubiquitin AF-P0CG48), Horn's
  quaternion fit refitted on the pairs within 3 Å — and reports RMSD over all pairs and over that core.
  `look` is the session's eye: the scene as JSON (a small molecule's atoms in full), THE ATOMS THE USER
  CLICKED (a click toggles a pick, the last four kept), and a PNG at `userData/mol/look.png` (`look-<n>.png` for tile n > 1). The TILE is
  the scene + the last pick's readout + an input line (a PDB id or a name = `show`), the library as formula
  chips while empty; the PANE (⌘⇧A, View ▸ Molecule, the tile's ⤢) takes the CENTER like the Studio and the
  Game Boy (the four of them with the agent pane take turns; a focus change closes it; `openMol(tile)` says WHICH
  tile's viewer it takes, ⌘⇧A the first, and with several a RAIL of chips — or ← → — steps between them) and adds the style
  / colour / surface / label rows, spin, reset, H-bonds, a select line, the picks with "measure
  distance|angle|dihedral" between them, the measurements, and for a protein the SEQUENCE STRIP: one-letter
  residues in the active colours, hover ↔ the residue named in 3D, click = pick its Cα, double-click zooms
  — the "1D string becomes a 3D shape" device, in place of a sequence tile. Background and labels are the
  theme's (`--panel`, `--ink`, `--accent`), repainted on a theme change (`retheme()`); the data palettes
  (charge, hydropathy, pLDDT…) are constants in `lib/mol.ts`, not theme colours. A PINCH over the viewer zooms the molecule;
  a two-finger SCROLL is the COLUMN'S, so the grid still scrolls under the tile. Both are ours,
  not 3Dmol's: a capture-phase `wheel` on the host stops propagation on every event, so 3Dmol's
  handler (which zooms on both, by a fixed ~30% of the remaining camera distance PER EVENT — a
  trackpad's momentum events swallow the molecule) never sees one, while the browser's default
  scroll is left alone. A pinch arrives as a ctrlKey wheel: that one is `preventDefault`ed and
  zooms by `exp(−deltaY × ZOOM_PER_DELTA)`, capped per event, so the same gesture always zooms
  the same amount and spreading the fingers draws the molecule nearer. Not on the phone.
- **Lesson** (`shared/lesson.ts`, `lib/lesson.ts`, `LessonTile`, `LessonPane`, `LessonCard`, `main/lesson.ts`, `plugin/skills/lesson/`,
  `plugin/scripts/lesson.mjs`; the `showLesson` setting, off by default): THE OTHER HALF OF THE TEACHER. A teaching session
  (~/grail) drives the Molecule tiles AND points at the lesson itself: a card with the idea, its cited source, a figure, a
  button that puts the right molecule up, and a question answered IN the tile, which the session then `look`s at. Built on
  the Molecule tile's plan throughout. LESSONS ARE MARKDOWN FILES IN THE LEARNER'S REPO (`~/grail/lessons/*.md`); the tile
  renders them and NEVER WRITES THERE. THE FORMAT (`parseLesson`, pure; the skill is its authoring reference): a front
  matter that is a YAML subset read by hand (`key: value` scalars + one list of maps, `sources`: id / cite / url; unknown
  keys kept), `## ` headings cut the file into CARDS (never inside a fence; text before the first is the intro card, id
  `intro`; a card's id is `{#id}` at the end of the heading, else a slug), `[^id]` is a numbered footnote mark to a source,
  and FOUR FENCES are taken over by language — `mol` (a ▶ button: `label:`, optional `tile:` / `new:`, every other line ONE
  mol.mjs command as its argv), `fig` (`src:` relative to the lesson file and INSIDE its folder tree — a symlink out is
  refused — png jpg jpeg gif webp svg, read by main/files.ts, shown as a blob: URL; `caption:`), `ask` (`id:`, `q:`, `- `
  options with `- * ` on the right one(s) — several right = tick-boxes and a check button; none = a free-text box, which
  nobody marks — `why:` shown after the answer), `dad` (a "for Dad" callout: accent rule, a small label). Everything else
  is `lib/markdown.tsx`, which grew ONE hook for it (`MarkdownExt.foot`; without it `[^id]` stays text); the fences are cut
  by the parser, not the renderer, because `lint` and `look` need them too. SOURCES ARE NOT DECORATION: a card's footer
  lists what it cites, else all of the file's, and with neither a quiet "unsourced" tag. A MOL BUTTON goes renderer →
  `lesson:mol` → main, which turns each line into a body (`molBody`, the mirror of mol.mjs) and calls `molCall` — THE SAME
  PATH as `POST /mol` — in order, stopping at the first refusal; a file target is relative to the lesson; a `--new` button
  REMEMBERS the tile it opened (by file + card + block + line, in main's memory) so pressing it twice does not open two.
  With `showMol` off the button says so and its click turns the tile on. It works with no session involved. HOME (no
  lesson up) is `<cwd>/curriculum.json` of the FOCUSED session (`lesson:curriculum`: the pane's own cwd, like the changes
  tile; polled every 3s while showing, re-rendered when the JSON changed), falling back to the folder it was last found in
  (localStorage `lesson:home`) so focusing another session does not blank it; blocks with status, the active one unfolded
  to its items (a title opens its `lesson`, an item with a `card` opens it there), the questions for Dad under them; every
  field optional (`cleanCurriculum`); no file = `.plugin-empty`. SEVERAL LESSON TILES, copied from `molTiles`
  (`lessonTiles`, `[1]`, `LESSON_TILES_MAX` = 4; keys `lessonKey(n)`: `lesson`, `lesson:<n>`; the picker's pill says
  "another here"; × closes one of several, puts the last away). STATE IS THE RENDERER'S (`lesson(n)`, a deck per tile:
  file, card, marks, note, ad-hoc asks, answers, mol runs, an event log for `look`'s `since`), and the UI and the door call
  the same `drive(body)`. Kept in localStorage: `lesson:scene:<n>` (`{ file, card id, ad-hoc asks }`, restored at boot by
  `syncLessonTiles` — every tile has its deck before it is scrolled to, so tiles survive ⌘R) and
  `lesson:answers:<absolute file>` (`{ [askId]: { chosen, text, correct, at } }`, shared by every tile showing that file;
  the door's `reset` clears it; an answered ask is locked). LIVE RELOAD: the renderer tells main which files are up
  (`lesson:watch`), main watches each file's FOLDER filtered to its name (an editor's rename-over-save would orphan a watch
  on the file), settles 120ms, and re-sends the text (`lesson:changed`); the card is kept BY ID, and with it the marks and
  the note. THE DOOR: `POST /lesson` → `lessonCall` in `main/index.ts` (10s budget) — `lint` is main's own and needs NO
  TILE (the parser plus what needs the disk: do the figures resolve); the rest refuse AT ONCE with "turn on the Lesson
  tile" when `showLesson` is off; `show` READS THE FILE FIRST (absolute `.md`, 1MB) and its text rides along; main picks
  the tile — `tile`, `new` (the first tile at HOME, else `nextLessonTile`), else the last used — and every answer carries
  `tile`. Ops: show (the same file again keeps the card up; a card that does not exist refuses the whole load), goto
  (n | id | next | prev), mark (a phrase that must be ON the card as worded — checked against `cardText`; painted with the
  CSS Custom Highlight API, `::highlight(lesson-mark)`, so no DOM changes under React, and the first one scrolled to),
  note (a markdown callout pinned over the card), ask (an ad-hoc question on the card), look (the card up, every card's
  asks with the learner's answers IN THE OPTION'S WORDS, marks, note, the mol buttons pressed, `since`), home, reset,
  tiles, close (the last tile only goes home). Marks and the note go when the card changes; none of the ad-hoc three
  touch the file. The TILE: head (GraduationCap, the title, `3 / 9`, home, +, ⤢), the card scrolling, ‹ › and card dots
  (an answered card's dot is green). The PANE (⌘⇧E, View ▸ Lesson, the tile's ⤢) takes the CENTER like the Molecule viewer
  (they all take turns; a focus change or Esc closes it; ← → page the cards): the card at reading size, a left rail of the
  cards (answered asks ticked), the file's sources, and with several tiles Molecule's rail of chips. `DECK_LESSON` is
  derived from the mol script's folder in `hooks.ts` (no constructor change); a session started before the tile existed
  has no `DECK_LESSON`, which is why the skill falls back to `$(dirname "$DECK_MOL")/lesson.mjs`. Not on the phone.
- **Web apps** (`shared/types.ts` `WebApp`, `main/webapps.ts`, `WebLayer`, `WebTile`, `lib/webapps.ts`; the `webApps`
  setting): ANY SITE AS A MINI APP — registered by a name + URL (`{ id, name, url, show }`, `WEB_APPS_MAX` 12;
  Village, `https://villagenotes.app/dream`, is the default entry; the `+` picker's "Web app" row registers
  another: "maptap.gg" → `cleanWebUrl` adds https, http(s) only, http for localhost), a grid cell each (`web:<id>`,
  `webKey` / `webAppOf`; `isPluginKey` and `isGridKey` take them, sides in turn after the mini apps; × sets `show`
  false, the registration stays). The page is an Electron `<webview>` on ONE partition, `persist:web`, so a sign-in
  survives quitting (Village signs in by OTP, no OAuth popup; `X-Frame-Options: DENY` does not touch a webview, which
  is a top-level context). THE LAYER IS ALWAYS MOUNTED: a webview that leaves the DOM loses its page, so `WebLayer`
  sits in `.main` for good (the center's grid area), makes an app's webview the FIRST time it is opened (a process
  each) and from then on only HIDES it — `visibility: hidden` (`.web-off`), never `display: none` — while anything
  else has the center; App renders nothing in the center while one shows (`openWeb`), and it takes turns with the
  Studio / Game Boy / Molecule / agent panes like they do (a tile click, a focus change, Esc FROM THE DECK'S CHROME
  — inside the page Esc is the page's — or × gives the center back). Hidden = muted (`setAudioMuted`). ⌘R reloads
  the renderer and with it the pages (still signed in). There is ONE webview per app, so THE TILE IS A DOOR, not a
  second copy: its face is the page's last SNAPSHOT — main's `web:snap` (`capturePage` of that webContents id, only
  ever a webview of the web partition, 560px JPEG data: URL) taken 1.2s after each load and every 15s while in view,
  kept in localStorage (`deck.web.snap.<id>`). The pane's head: back / forward / reload-stop / home, the current
  URL, ↗ the browser, a two-click remove, ×; a rail of chips with more than one app. MAIN KEEPS GUESTS IN A BOX
  (`guardWebviews`, for EVERY webview incl. YouTube's: preload stripped, no node; for the web partition: http(s)
  only, `window.open` → the browser, a context menu since Electron gives guests none — spelling, cut/copy/paste,
  a link's way out) and the partition answers permission requests from an allowlist (clipboard, fullscreen,
  notifications; camera / mic / geolocation refused) with a plain-Chrome user agent (some sites refuse "Electron/").
  ⌘⇧B / View ▸ Web Apps opens the first (`toggleWeb`); the launcher has a button and a checkbox per app. Not on the phone.
- **Changes** (`GitTile`, a plugin tile; `main/git.ts`):
  the FOCUSED session's working tree as git sees it. Main resolves the tree from the session's
  pane (`tmux #{pane_current_path}`, so a `--worktree` session reads its worktree; the record's
  cwd, then `defaultCwd`, as fallbacks) and runs `rev-parse --show-toplevel`, `branch
  --show-current` (a short sha when detached), `status --porcelain=v1 -z --untracked-files=all`
  and `diff HEAD --numstat -z -M`; untracked files are line-counted by hand (60 per poll, 2MB
  each, a NUL in the first 8k = binary). Everything runs with `GIT_OPTIONAL_LOCKS=0` so a poll
  never fights Claude for the index lock. The tile polls every 2s while the window is visible and
  300ms after any transcript update of that session (a tool call landing), and only re-renders
  when the JSON changed. Head: branch · repo name · totals; a row per path: status letter (M amber,
  A/? green, D red, R blue, U = conflict; an inset ring = some of it is staged), the path with
  its folder dimmed (rtl-ellipsized so the tail shows), `+n −m`, and ↗ which opens the file in the
  preview pane. Clicking a row unfolds its diff (`git diff HEAD -M -- path`; an untracked file is
  `diff --no-index /dev/null path`) as +/− rows, the preamble dropped, cut off at 300k; unfolded
  diffs are re-read when the row's counts change and dropped when the path is gone. Nothing
  focused = the fox and a hint; not a repo = says so with the folder; clean = the fox asleep.
  Diff colors are `--green` / `--red`, the theme's terminal palette, set by `lib/theme.ts`.
  Not on the phone (`gitChanges` / `gitDiff` reject there).
- **Translator** (`TranslateTile`, last grid cell): languagelog (~/languagelog) boiled down to two
  boxes, English over Spanish. Typing into either box translates after a 700ms pause or ⏎ (⇧⏎ =
  newline); the API's detected language decides which box the text belongs in, so Spanish typed
  into the English box is moved down and its English put on top. Reset / Esc / 5 idle minutes
  empty both boxes; the last pair stays as placeholders (localStorage). Backend is Google Cloud
  Translation v2 in `main/translate.ts` (one call, a second only when the text was already in
  the target language), keyed by `translateApiKey` in config.json, else `$GOOGLE_CLOUD_API_KEY`.
  A finished translation is announced on `lib/bus.ts`.
- **Vocabulary builder** (`VocabTile`, the cell left of the translator): THREE FACES, cycled by
  the stats chip in the search row (the counts that used to sit in the search placeholder):
  dictionary → flash cards → review list → dictionary. Each turn re-keys `.vb-stage`, which is
  what flips the card (`vb-flip`); the first paint stays flat. Only the DICTIONARY cycles and
  only it shows the countdown line — cards and the list are read at your own pace, and ‹ ⏸ › are
  hidden on them.
  - Dictionary: a new Spanish word every `vocabCycleSeconds` (30) as TWO COLUMNS, a language
    each — Spanish left (it is the word being learned), English right behind a hairline. Each
    column carries its own headword + IPA, part of speech, definitions, example, synonyms and
    etymology, and scrolls on its own, so the two etymologies are distinct and both reachable.
    Spanish definitions come from es.wiktionary (`native`); the English glosses of the Spanish
    entry are the English column when there is no English entry ("gustar" → "to like"), and fill
    in for missing es.wiktionary definitions otherwise — never printed in both columns. A side
    with no headword at all drops out and the other spans the tile (`.vb-cols.one`). The ♥ sits
    at the end of the English column's head line. ‹ › step, ⏸ holds (persisted), the search line
    or a one-or-two-word translation next door shows that word now and restarts the clock.
  - Flash cards: dealt by `store.deck()` from words already stored, so a card never waits on a
    lookup (the entry is in the row). Spanish shows first; tap the card (or space/⏎ once it has
    focus) to reveal the English headword, a gloss or two, the Spanish definition and an example,
    then grade again / hard / good / easy (1–4) — SM-2 in `store.gradeWord`. The ♥ works here too;
    the footer counts the position in the deck, and running out offers "deal again".
  - Review list: everything stored, soonest due first (never-graded words lead), with a filter
    line, each row's due-in label ("new", "due", "3d", "2mo", "known") and its ♥. A row opens
    that word back in the dictionary.
  Supply (`main/vocabwords.ts`): `data/esLemmas.ts`, ~3000 SAT-level Spanish content
  words: every lemma in English Wiktionary's Spanish entries (doozan/spanish_data `es-en.data`)
  whose gloss is an SAT word (freevocabulary.com's 5000 minus everyday English per
  google-10000-english, plus majortests.com's list), attested in doozan's subtitle frequency
  list at content-word rank 4000+, ordered by that rank; each row carries the SAT word it
  matched, which the tile passes to the lookup as the English headword ("perspicaz" ↔
  "perspicacious", not the translator's "insightful"). Regenerate with `scripts/lemmas.py`
  (its docstring lists the downloads). Plus the Spanish side of every ≤3-word row in
  languagelog's SQLite file (`languagelogDb`, read with the `sqlite3` CLI, read-only; missing
  = skipped). The renderer keeps a shuffled queue in localStorage (every word once per pass;
  your own words first, then list order blurred: position × 0.5–1.5; queued words the supply
  no longer has are dropped on load) and prefetches the next word.
  Definitions come from `main/dictionary.ts`: Wiktionary via kaikki.org's per-word JSONL
  exports (`/dictionary/English|Spanish/meaning/<c>/<cc>/<word>.jsonl`, case-sensitive, so it
  retries lowercased) for English glosses, IPA, etymology (the "Etymology tree" preamble is
  stripped), examples and sense synonyms of both languages; Spanish Wiktionary
  (`/eswiktionary/Español/...`) for Spanish-language definitions and fuller Spanish synonyms;
  Datamuse (`rel_syn`, WordNet-based, no key) tops up English synonyms. The counterpart word
  comes from the translator when a key is set, else whichever Wiktionary has the word. Pure
  inflections ("corría") are followed to their lemma (one hop) and the lemma is what gets
  translated. Results are cached in main.
- **Vocabulary store** (`main/store.ts`, `userData/vocab.db`, `node:sqlite` so nothing to rebuild):
  the raw material for flash cards. `translations` gets every translation the translator
  settles on: single words at once; phrases 4s after the last edit, on ⏎, on blur, or on reset.
  Because the translator fires on typing pauses, the tile remembers the row its current edit
  produced and passes it as `supersede`, so "where is" is rewritten into "where is the library"
  rather than kept (a pair that already exists absorbs the fragment). Unique on (en, es) with a
  `seen` count. `words` gets every word the vocabulary tile actually shows (never prefetches)
  with the full `VocabResult` as JSON, `translation_id` when it came from the translator, and
  SM-2 columns (`due`, `interval`, `ease`, `reps`, `lapses`, `known`), which the tile's flash
  cards drive: `deck()` deals what is due (a never-graded word is due now) and then whatever
  comes soonest, so there is always something to review; `gradeWord(id, grade)` is textbook SM-2
  — a miss (grade < 3) resets `reps`, counts a lapse, drops the ease and comes back in ten
  minutes, a pass steps 1 → 6 → interval × ease, and past `KNOWN_DAYS` (120) the word sets
  `known` and leaves the deck. Every grade appends to `reviews`, the per-grade history.
  `list()` is the review list. Unique on (es, en). The ♥ on the card sets
  `liked` (added by a guarded `alter table` in `MIGRATIONS`); liked words are merged into the
  vocabulary supply as if they were the user's own, so they lead every pass. Counts show in the
  vocab tile's stats chip, which is also how you get to the cards. Inspect: `sqlite3 ~/Library/Application\ Support/deck/vocab.db`.
- **Foxtrot** (`lib/fox.ts`, `components/Fox.tsx`, `.fox*` in styles.css): slay's Village fox (Elthen's
  "2D Pixel Art Fox Sprites", the same 14×7 sheet as slay's `/dream-fox.png`, copied to
  `src/renderer/src/assets/fox.png`; terms in `assets/LICENSE-fox.md`: credit Elthen, recolors are fine in-product, don't ship it standalone). It IS
  the status indicator: every pane head shows a 22×18 fox (`FoxStatus`) in place of a dot, running
  while Claude works, asleep while it waits, sitting up alert when it needs you, looking around while
  starting, lying down when the pane died. It barks the way slay's fox does, SILENTLY: a hop and
  three comic bursts ("YIP!" "ARF!" "CHRRP!", Press Start 2P, bundled in assets/, 280ms apart,
  620ms each; `lib/bark.ts`; off = `foxBark` false / View ▸ Fox Barks) on the TRANSITION into needing you and
  when a turn finishes (busy → idle); never on mount, so a boot full of waiting sessions is quiet, and
  a hook plus the fleet poll agreeing within 3s is one bark. It also sits in the empty focus pane, is
  the app icon (`build/icon.png`), and stands over Claude Code's startup banner, where it
  REPLACES the CLI's pixel mascot. The CLI is untouched: `watchClaudeBanner` scans the viewport on
  every xterm render for the banner's first two rows (`▐▛█…` / `▝▜█…`), registers a marker + decoration
  (3 rows × the logo width) that xterm scrolls, hides and disposes with the line, paints it `--panel`,
  and stands the fox on it. The pose follows the pane's classes: busy runs, idle sleeps, blocked /
  attention sits up alert, dead lies down, else the tail wags. `.fox` elements are the ART box of a
  frame (22×18 sheet px × `--fox-scale`), animated by stepping `background-position-x` one frame
  (32px × scale) at a time; row / frame count / duration are CSS variables (`.fox-idle`, `.fox-run`,
  …); the sheet is a `--fox-sheet` data: URL set at boot (`installFoxSheet`, CSP allows `img-src data:`).
- **Foxtrot is also the head** (`main/foxtrot.ts`, `FoxHead`, `FoxLog`): one watcher over every
  session, keeping a running log. PHASE ONE IS SENSES ONLY, rules and no model. Main feeds him every
  state broadcast and every transcript update; he writes `note`s (a session opened / was parked /
  closed, you prompted it, it finished a turn of 20s+) and, rarely, `bark`s — the things that want
  you: a permission prompt unanswered 4 min, a session waiting on you 15 min that you have not
  focused since (both skip the focused session, and ones crossing together are told as one), two
  open sessions editing the same absolute path within 45 min (so worktrees never collide), three
  tool errors in a row, a Claude that exited. Each bark fires once per episode. He wakes 6s after
  boot (sessions settle first) and takes transcript history from before he was born in silently.
  Entries append to `userData/foxtrot.jsonl` (compacted to the last 2000 past 5000; 1000 kept in
  memory), pushed as `fox:entry`, fetched with `fox:log`.
  The top bar is TALL for him (88px, 52px compact; main's `lightsAt()` centers the traffic lights
  to match): the fox at 4× (2× compact) AND NOTHING ELSE — no speech bubble, and the big fox NEVER
  BARKS or sits up alert: he is not a voice addressing the user, only the sessions' foxes summed
  up (`FoxHead`). Any session busy = he trots (`run`); every open session resting (idle, no
  attention) or none open = asleep; anything else (starting, needing you, dead) = he stands
  looking back and forth (`look`). What needs you is told by that session's own fox. Then
  `.topbar-tools` on the right, a wrapping row that is where new buttons and dropdowns go. The
  fox or ⌘J (View ▸ Foxtrot's Log) opens the whole log in the `.doc` pane over the grid —
  a day at a time, "barks only" toggle, session chips that focus, path chips that preview. The log
  and the file preview are one pane at a time.
- **Tiles are conversations, not terminals** (`ChatView`, `main/transcript.ts`): a grid tile
  shows the session's transcript, tailed by main from
  `<CLAUDE_CONFIG_DIR|~/.claude>/projects/*/<claudeSessionId>.jsonl` (found by our UUID across
  project folders, polled every 400ms from the last offset; the file appears at the first prompt).
  Lines become `ChatBlock`s: `user` (typed text; slash commands unwrapped, injected tags
  stripped, sidechains and meta skipped), `text` (assistant prose, adjacent pieces run together,
  rendered by `lib/markdown.tsx`, elements only, never HTML), `tool` (one line: name + a label
  from its input, `toolLabel`; ticked by its tool_result, red on error). Main keeps the last
  `TRANSCRIPT_KEEP` (80) and pushes `transcript:update`; the view pins to the end unless you
  scrolled up. A busy session shows three dots under the last block; attention / blocked shows a
  "needs you in the terminal" note, since permission prompts only exist in the TUI. A tile with
  nothing yet shows Foxtrot. Clicking a tile still focuses it, unless text is selected. The
  session's xterm is only mounted in the focus pane, so its size is whatever the focus pane last
  set (SPAWN 120×40 before that).
- **A referenced path is a link, and it opens over the grid** (`lib/paths.ts` finds them,
  `lib/filerefs.tsx` draws them, `components/DocPane.tsx` shows them, `main/files.ts` reads them):
  everywhere a session's text appears — a tile's tool line (Read / Edit / Write / MultiEdit /
  NotebookEdit put the file on the ChatBlock as `path`, Grep / Glob their search folder), Claude's
  prose (a path alone in a code span, or bare in a sentence), your own prompts (a dropped file
  pastes one), and the focus pane's TERMINAL (an xterm link provider, one buffer line at a time) —
  a path is clickable. `pathRefs` matches three shapes, plus a `:42`: rooted at `/ ~/ ./ ../`, a
  name (nested or not) ending in a known extension, or a folder written with a trailing slash. A
  URL is not one (the lookbehind refuses a match after `:`), and a wrong guess costs nothing: the
  pane says "no such file". Relative paths resolve against the session's cwd — the tile hands it
  to ChatView, `setTerminalCwd` hands it to the terminal.
  The pane itself is `grid-area: 1 / 2 / 2 / 3`, THE GRID COLUMN AND NEVER THE TERMINAL, so the
  session stays in view while you read; ⤢ takes the whole window (kept in localStorage), the scrim
  or Esc closes it — but not an Esc from inside an xterm, where Esc is Claude's. Text gets a line
  gutter (one plain block past 4000 lines) and scrolls to the `:42`; markdown renders, with a
  `source` toggle; an image and a PDF are a blob URL of the bytes main read (hence `plugins: true`
  on the window, which is Chromium's PDF viewer, and `frame-src 'self' blob: chrome-extension:` +
  `img-src blob:` in the CSP); a folder is a list you can walk into, with a back button. Anything
  else — binary, missing, over the caps (1.5MB of text, 40MB of bytes) — says so and offers the
  header's buttons, which hand the path to macOS: open (Preview, for a PDF), reveal in Finder, copy.
- **Tile prompts** (`TilePrompt`, the bar along the bottom of every grid session tile): an
  always-visible rounded outline, no label, that pastes what you type into THAT session and
  submits it (⏎; ⇧⏎ = newline, Esc empties) without swapping it into focus. Clicks in the bar
  are stopped so the tile does not take focus. It goes through `pasteText` (bracketed paste)
  then a `\r` a beat later, so main's `input()` also clears the tile's attention. The bar sits
  in the conversation view's bottom padding (`--tile-prompt-height` + gaps on `.tile-body`).
- **File drops**: dragging files onto the focus pane or a tile pastes their shell-escaped paths
  into that session (a tile drop also focuses it). Paths come from `webUtils.getPathForFile`
  in the preload; the renderer never sees one otherwise. Every path goes through `drop:keep`
  (`main/drops.ts`): a path that will stay put is returned as is; one under a temp dir is COPIED
  to `userData/drops/` (pruned after 30 days) and the copy is pasted. That is what makes the
  macOS screenshot thumbnail work: it is a file promise Chromium fulfils into a temp dir, sometimes
  a beat after the drop (main waits up to 5s for the size to settle), and dragging it cancels the
  Desktop save, so the temp file is the only copy. A File with no path at all (an image dragged out
  of a page) ships its bytes over IPC and is written the same way.
  While a drag hovers, the pane claims a drop effect the SOURCE allows (`dropEffectFor`): Finder
  allows all of them, the screenshot thumbnail offers copy only, and claiming 'link' against it
  turns the effect to 'none', so no drop event fires and the thumbnail springs back.
- **The launcher** (`Launcher.tsx`; `FocusPane` renders it when no session is focused): the
  empty focus pane is the deck's welcome page, VS Code style — the center column has the room,
  so everything the `+` picker, the Session menu and the View menu offer is on it as a form,
  in cards that reflow to the column's width (`.launcher-cards`, auto-fit; the wide ones span).
  START A SESSION: "in a folder" (recents + the default as pills, a folder dialog, or a typed
  path; `~` expands in main) or a NEW PROJECT (a parent — `~`, the folders the recents sit in,
  the default, or a picked one — plus a name; main `mkdir -p`s it and `git init`s unless the
  toggle is off or it is already inside a repo; `create` / `gitInit` on `NewSessionRequest`, so
  the worktree toggle is off there: a fresh repo has nothing to branch from), then the
  worktree toggle, the model row and the PERMISSION MODE row (`PermissionPick`, `--permission-mode`
  from `PERMISSION_MODES` in `shared/models.ts`: ask / acceptEdits / plan / auto / dontAsk /
  bypassPermissions, the last three tinted as a warning; the record keeps `permissionMode`, the
  head shows it as a badge, and a dead resume repeats it, like the model), an optional `--name`
  and an optional FIRST PROMPT (the CLI's positional argument);
  ⌘⏎ (or ⏎ in a one-line field) starts through `DeckApi.newSession`, so a refusal (the cap, a
  missing folder) shows on the form. Then: the PARKED sessions as rows (resume / forget); the
  STUDIO's composer in short (prompt, model, ratio, size — the pane's own localStorage draft, so
  it carries over; Generate opens the Studio, which follows the cooking job; the newest image as
  its thumbnail; a no-key note); the MINI APPS as checkboxes (+ the music face, reset layout);
  DECK settings (theme, appearance, center width, grid shape, default folder + picker, default
  model, and the toggles: worktree by default, attention first, confirm kill, compact, fox barks,
  phone); TERMINAL settings (font, sizes, cursor, scrollback); KEYS & SERVICES (Gemini, Studio
  model, Translation, Spotify client id, languagelog db, the vocabulary cycle; text fields commit
  on blur / ⏎, keys as password fields); and the SHORTCUTS. Settings patch straight through
  `patchSettings`. The folder dialogs that only answer are `DeckApi.chooseDir(title)` (the phone
  resolves ''). It has no state worth keeping: a focused session replaces it. The session and
  parked cards live in `SessionForm.tsx` (with the model and permission rows) because the `+`
  picker shows the same two under its mini-app row.
- **Recent folders**: `sessions.json` keeps `recentCwds`, the last 10 folders sessions were started
  or resumed in, most recent first (`touchRecent` in `sessions.ts`); it outlives the sessions, and a
  file without it is seeded from the records. `DeckState.recent` = the first 6 (`RECENT_SHOW`) that
  still exist. They are offered as the "Where" pills of the session form (the launcher, and the
  `+` picker, where the focused folder leads) and under Session ▸ New Session in Recent Folder
  (the menu is rebuilt when the list changes).
- **Model** (`shared/models.ts`, `SessionRecord.model`): a new session can pick what goes after
  `--model`: the CLI's aliases (fable, opus, sonnet, haiku, opusplan, opus[1m], sonnet[1m]) or a
  pinned id (Opus 4.6 = `claude-opus-4-6`), or anything typed by hand ("other…" in the chooser;
  `cleanModel` allows only the characters an id can have). '' = no flag, so the CLI's own default
  applies. The `+` chooser has a Model row (last pick kept in localStorage, first from the
  `defaultModel` setting), the phone's new-session sheet a select, Session ▸ New Session with
  Model is one-shot, Session ▸ Default Model for New Sessions sets `defaultModel` (what ⌘N uses).
  The record keeps it and a dead resume repeats it (`--resume` alone would fall back to the CLI's
  default); the pane head shows it as a badge next to the worktree one.
- **Close = park, not kill.** ⌘W / "park" kills only the pty client; the tmux session and the
  Claude conversation stay. Parked sessions are listed at the bottom of the `+` chooser
  and resume by tmux attach if alive, else `claude --resume <claudeSessionId>`.
- **One tmux client per session, ever.** tmux sizes to the smallest attached client. Never
  attach a second client to a `deck-*` session from a terminal while the app has it open.
- **Spawn command** (`SessionManager.claudeCommand`): `exec claude --settings <hooks.json>
  --session-id <uuid> [--worktree] [--model <alias|id>] [--permission-mode <mode>] [--name <n>] [<first prompt>]`. `exec` so the pane's process IS claude. The UUID is
  ours (`randomUUID()`), which is how fleet rows and hook payloads are matched back to a tile.
  `--worktree` lets Claude create/clean the worktree itself under `<repo>/.claude/worktrees/`.
- **`--settings` merges** with the user's own settings (list keys combine), so any global
  Notification/Stop hooks the user has keep firing inside deck sessions. Our hooks file adds POSTs to
  `127.0.0.1:<port>/{notification,stop,prompt,subagent-start,subagent-stop}` that never block
  Claude (`-m 2`, `; exit 0`), and ONE that may, on purpose: `PreToolUse` → `/pretool`, the
  leash (see Wolfpack), whose stdout is the server's answer and which waits only while the
  user has that member paused.
- **Status** = fleet poll (truth) + hooks (instant). Notification → attention; Stop → attention
  + idle; UserPromptSubmit → clear + busy; any keystroke into the tile clears attention. Shown by
  Foxtrot's pose in the pane head (see Foxtrot), not a dot.
- **Profiles**: `deck` when packaged, `deck-dev` under `npm run dev`, or `DECK_PROFILE=x`.
  Profile = tmux socket name = userData folder name; hook port 47800 (deck) / 47801 (others).
  Two profiles never see each other's sessions, so a Claude session working ON deck can run
  `npm run dev` without colliding with the instance it is running inside.
- **Renderer**: only the focus pane mounts a terminal, and only the mounted (focused) terminal
  holds a WebGL context — `mount('focus')` creates it, `unmount` disposes it (Chrome caps live
  contexts, and a parked terminal in staging is never seen, so cycling focus must not pile them
  up; context loss falls back to the DOM renderer and repaints the buffer so the pane never
  blanks). Sizing is our own measure (`fitBox`, no fit addon: that reserves 14px for a scrollbar
  xterm 6 draws as a fading overlay): cols/rows from the renderer's cell size, and the height
  left below the last row goes ABOVE the first as padding on the xterm element, so Claude's
  prompt bar sits flush with the bottom of the pane. It runs through `fitStable`: it fits, then re-fits on later frames until the
  proposed cols/rows stop changing, skipping zero-size frames, so a mount mid-layout can't leave
  the TUI a row/column off. Fonts, cursor and scrollback come from settings
  (`applyTerminalSettings` in terminals.ts).
- **Themes**: `shared/themes.ts` is the catalog; every family has a light and a dark variant and
  `appearance` (light / dark / system) picks one. The renderer writes the variant's colors into
  CSS variables on `<html>` and the palette into every xterm (`lib/theme.ts`); main uses the same
  resolver for the window background and `nativeTheme.themeSource`. A variant's `panel` IS the
  xterm background (`variant()` enforces it) or tiles show a seam. Never hard-code a color in
  styles.css; use the variables (`color-mix` for tints). A BACKGROUND SAYS WHAT IT IS FOR:
  `--surface` (a pane or tile's own face), `--fill` (what an inset shade is mixed into:
  `color-mix(in srgb, var(--ink) 8%, var(--fill))`; also what sits INSIDE a surface, like
  `.termhost`), `--overlay` (a popover or modal). All three are `var(--panel)` except under
  glass; `--panel` itself is always a solid color, for text (`color: var(--panel)` on an accent
  button), shadows and JS. New CSS uses these three, never `background: var(--panel)`.
- **Glass** (the `glass` family, `GLASS_ID`; `glassVariant` in `shared/themes.ts`, `lib/glass.ts`,
  the glass block at the end of styles.css, `wikiBackdrop` in `main/wiki.ts`): a Wikipedia
  picture of the day BLURRED behind the whole window, the chrome colors read off it, every pane
  a tinted sheet over it. The picture is the 250px thumbnail, the smallest Wikimedia serves (it
  is only seen blurred), fetched by main as a data: URL (the renderer must read its pixels) and
  kept for good in `userData/glass/<date>.json`; offline, today's falls back to the newest kept.
  WHICH picture is the `glassDate` setting: '' = today's (asked again every 30 min, so the wall
  follows the day), a date = pinned — the Wikipedia tile's caption has a button (beside ‹ ›)
  that hangs the picture it is showing and switches to glass; the theme popover says which is
  up and offers "follow today's". `.glass-wall` (fixed, z-index −1, two layers that crossfade)
  is blurred ONCE by CSS, so panes carry no backdrop-filter (only `--overlay` things do). The
  TINT (`tintOf`: a 40×40 copy; the saturation-weighted mean hue, and the fullest of 24 hue
  bins weighted by vividness for the accent) → `glassVariant(dark, tint)`: panel / ink / muted /
  line in the picture's hue at FIXED lightnesses, the accent in its most vivid hue, the status
  colors and ANSI palette Cream's (they mean something), the xterm background clear
  (`<panel>00`; `allowTransparency` is therefore always on). CONTRAST is arithmetic, not hope:
  the wall wears a veil of `panel` (50% dark / 55% light) and a surface is `panel` at 58% / 68%,
  so under a pure-white (dark) or pure-black (light) picture a pane is still ~0.29 / ~0.82 sRGB:
  ink ≥ 7:1, muted ≥ 4.5:1 — change the alphas and the lightnesses together. "Glass" is a lit
  top edge (`--glass-edge`), a hairline and a drop shadow on `.focus` / `.tile`, at ONE class's
  weight (`:where()`), so attention / drop-over / hover borders still win. `--bg` under glass is
  see-through ink (every use of it is an inset or a hover). `liveVariant` is the one resolver
  in the renderer; a new picture re-applies the theme and fires the `deck:glass` window event
  (the molecule viewers retheme: clear background under glass, a solid one for `look`'s PNG).
  The last picture + tint live in localStorage (`glass:last`), so boot paints glass before main
  answers. Main only ever needs the catalog's neutral glass variants (the window color). On
  the phone `wikiBackdrop` rejects and the wall is the plain panel color.
- **Refresh UI** (⌘R, top bar): reloads the renderer, then main kills every pty client so
  `handlePtyExit` reattaches and tmux repaints. Sessions and conversations are untouched; a plain
  reload without the reattach leaves the terminals blank until something redraws.
- **The phone** (`main/remote.ts`, `shared/remote.ts`, `renderer/src/phone/`, `PhonePair`): the
  deck on a phone is a SECOND RENDERER of the same main process, served by main itself. Main runs
  an HTTP + WebSocket server on port 47810 (`deck`) / 47811 (others; `REMOTE_PORT`) bound to every
  interface but answering ONLY private addresses (`isPrivate`: loopback, Tailscale's 100.64/10 and
  fd7a:115c:a1e0::/48, RFC 1918), and every socket must carry the token from `userData/remote.json`
  (24 random bytes, made once; delete the file to rotate). Reach is Tailscale's: the pairing
  popover (the `phone` button in `.topbar-tools`) asks the Tailscale app (`Tailscale status --json`)
  for this Mac's MagicDNS name, falls back to its tailnet IP, then a LAN IP, and shows a QR of
  `http://<host>:<port>/#t=<token>`. The token STAYS in the page URL's fragment (and localStorage):
  an iOS home-screen app has storage of its own, and without a manifest `start_url` the URL Safari
  saves is the one with the hash. `remote: false` in settings stops the server (the popover's switch).
  `send()` in index.ts relays deck:state / transcript:update / settings:changed / fox:entry /
  deck:error to every phone as frames; the phone calls `REMOTE_METHODS` by name (getState, command,
  getTranscript, getSettings, setSettings, readDoc, foxLog, screen, openPath) and sends keystrokes
  as `input` frames; it NEVER resizes a pty (the desktop owns the size). A FileDoc's bytes ride as
  base64 (`bytesB64`). The page is a second Vite entry (`phone.html`, electron.vite.config.ts
  `rollupOptions.input`); in production main serves `out/renderer/phone.html` + `/assets/*` (one
  folder deep, hashed) + `/icon.png` with a CSP header (no meta CSP in phone.html: Vite's dev page
  needs inline scripts); under `npm run dev` `/` 302s to the Vite dev server on the request's host
  (`server.host: true`), so the page still comes from Vite with HMR, and the socket goes to the dev
  port (`import.meta.env.DEV`). `phone/api.ts` installs `window.deck` (a DeckApi over the socket:
  desktop-only methods are no-ops or reject) so `ChatView`, `TilePrompt`, `FoxStatus`, `DocPane`,
  `Fox` and the theme are the desktop's own components unchanged. That is why `lib/theme.ts` and
  `lib/paste.ts` take REGISTRATIONS from `lib/terminals.ts` (`setTerminalApplier`, `setPaster`)
  instead of importing it: nothing the phone loads may pull xterm in. The page: a chip row (slot +
  Foxtrot's pose + name, `+` for the new/resume sheet), the open sessions as snap-scrolled pages of
  `ChatView`, a prompt bar (`TilePrompt`, textarea at 16px so iOS does not zoom), ⌨ a strip of the
  keys a TUI needs, ▤ the SCREEN VIEW: `tmux capture-pane -e` of the session's pane (`Tmux.screen`,
  never attaching, so the size is untouched) polled every 700ms while shown, SGR rendered by
  `ansi.tsx` with the theme's xterm palette as `--ansi-N`, the font shrunk so the desktop's columns
  fit the phone's width; that is where permission prompts are answered. ⋯ focuses / parks / kills
  the session on the Mac. The layout sizes to `--vvh` (the visual viewport) so the keyboard pushes
  the bar up. A dropped socket reconnects with backoff; `/auth?t=` tells "server down" (keep
  trying) from "wrong token" (the unpaired page, with "forget this pairing"). Safari's "Add to Home
  Screen" makes it an app.
- **⌘ shortcuts** live in `menu.ts` AND in `isDeckShortcut()` in terminals.ts (xterm must
  decline them). Add to both. Taken with ⇧: N M L I G A B E. View ▸ Grid holds the columns-per-side / rows radios and Reset Layout.

## State on disk

`~/Library/Application Support/<profile>/`
- `sessions.json` — records (`slot` sticky, null = parked, 101+ = a beta; `pack: { alpha, task }` on a beta; `model` / `permissionMode` as handed to the CLI) + `focusSlot` + `recentCwds` (last 10 start folders)
- `claude-hooks.json` — the `--settings` file handed to every spawned session
- `vocab.db` — the vocabulary store (translations, words with entries, reviews); see the store rule above
- `foxtrot.jsonl` — Foxtrot's log, one entry per line (see the head rule above)
- `studio/` — the Studio's gallery: `jobs.json` (the last 400 generations, newest first) and a PNG per done job; see the Studio rule above
- `mol/` — the Molecule tile: `cache/` (every structure fetched: `1UBQ.cif`, `AF-P0CG48.cif`, `name_caffeine.sdf`, `smiles_<hash>.sdf`, `cid_<n>.sdf`; delete freely) and `look.png` / `look-<n>.png`, each tile's last `look` snapshot
- `Partitions/web/` — Electron's own store for the web apps' partition (cookies, localStorage: the sign-ins); delete it to sign everything out
- `pokemon/` — the Game Boy's battery saves (`<rom>.sav`) and save states (`<rom>.state0..2`); see the Pokemon rule above
- `glass/` — the glass theme's backdrops, a `<date>.json` (a 250px picture as a data: URL) per day ever shown; delete freely
- `drops/` — copies of dropped files that had no lasting path (screenshot thumbnails, images out of pages); pruned after 30 days
- `usage.json` — the account's rate-limit windows as last reported (see the top bar rule); delete freely
- `statusline.sh` — the status-line command of every deck session, rewritten at each boot (posts to `/status`, then runs the user's own)
- `hooks.log` — one line per hook request the hooks server got (event, session, agent; a tool call only when the leash refused it); starts over past 1MB
- `remote.json` — the phone's pairing token (see the phone rule); delete it to rotate
- `spotify.json` — the connected Spotify account's tokens (see the music rule); delete it to disconnect
- `config.json` — `DeckSettings` (theme, appearance, glassDate, gridColumns, gridRows, gridOrder, focusWidth, fonts, plugins, defaultCwd, defaultModel,
  weatherPlaces, weatherUnit,
  translateApiKey, showGit, showVocab, vocabCycleSeconds, languagelogDb, showTranslate, showMusic, music, spotifyPlaylists, spotifyClientId,
  showStudio, geminiApiKey, studioModel, showMol, molTiles, showLesson, lessonTiles, webApps, showPokemon, pokemonRomDir, foxBark, remote…);
  `showYouTube` in an older file is read as `showMusic`
  written by the app on every change, hand edits are sanitized on load (`main/settings.ts`)

Debugging a session outside the app: `tmux -L deck-dev ls`, and to peek WITHOUT stealing the
size use `tmux -L deck-dev capture-pane -p -t deck-<id>` rather than attaching.

## Gotchas already hit

- tmux 3.5a rejects the `=name` exact-match target for `display-message`/`list-panes`; use
  plain names (deck names can't prefix-collide).
- TypeScript 6 dropped `baseUrl`; `paths` are relative. Vite CSS side-effect imports need
  `src/renderer/src/vite-env.d.ts` (`/// <reference types="vite/client" />`).
- electron-vite 5 wants vite 7 + @vitejs/plugin-react 5 (plugin-react 6 needs vite 8).
- node-pty ships darwin-arm64 prebuilds; `postinstall` still rebuilds against Electron.
- YouTube's embed player errors (153, then 152-4) unless the request carries a Referer AND
  `Sec-Fetch-Site: cross-site` + `Sec-Fetch-Dest: iframe`; a top-level <webview> navigation
  sends neither. `main/youtube.ts` rewrites them. Wikimedia thumbnails come only in fixed
  widths (250/330/500/960/1280/1920); others are HTTP 400.
- Claude Code 2.1.2xx draws its TUI on the alternate screen (`tmux display -p '#{alternate_on}'`
  = 1), and xterm hides every decoration while the alternate buffer is active
  (`BufferDecorationRenderer`), so `watchClaudeBanner` cannot cover the banner there: the CLI's
  own mascot shows in the focus pane. Accepted; the fox covers banners in the normal buffer only.
- Sessions started in VS Code/iTerm cannot be adopted (their PTYs belong to that app); they
  can only be resumed by id. `claude agents --json` lists them with `sessionId`.
- A browser's `fetch` cannot set `Host` and normalizes `..` before sending, so the phone server's
  address / traversal checks are tested with raw sockets, not fetch. Node's `URL` normalizes `..`
  too, so `/assets/../../etc/passwd` becomes `/etc/passwd` and 404s by the route list, not by a
  path check.
