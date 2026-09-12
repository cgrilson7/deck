# deck

Seven Claude Code sessions in one Electron window (four with every plugin tile on). The focused session fills the left third
as a real terminal; the others live in a grid on the right as conversation views (your prompts,
Claude's replies as markdown, a line per tool call, a prompt bar to talk to each), with a
plugin row (Wikipedia's featured content, a lofi YouTube stream) beneath them. Click a tile to
swap it into focus.
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
npm run dist         # electron-vite build + electron-builder --mac → dist/ (needs `npm i -D electron-builder`;
                     #   the `build` block in package.json: productName Deck, build/icon.icns, tmux.conf as an extraResource)
```

Verification before handing off = `npm run typecheck && npm run build && npm run smoke`.
The user runs the app themselves; do not drive it with screenshots or automation unless asked.
Requirements on the machine: macOS, tmux, Node, and the `claude` CLI logged in.

## Layout

```
src/shared/types.ts        CAP, SessionRecord/SessionView/DeckState, DeckCommand, DeckApi
src/main/index.ts          app boot: profile, single-instance lock, window, IPC, menu
src/main/sessions.ts       SessionManager: slots, spawn/attach/detach/kill/resume, state
src/main/tmux.ts           tmux wrapper (private socket, tmux.conf) + shq()
src/main/fleet.ts          polls `claude agents --json` (busy/idle/blocked + names)
src/main/hooks.ts          local HTTP server + the --settings hooks file for instant "needs you"
src/main/remote.ts         the phone: HTTP + WebSocket server (tailnet/LAN only, token-gated) serving out/renderer/phone.html and relaying the IPC broadcasts
src/shared/remote.ts       the phone's wire: ports, the callable DeckApi subset, the frame types
src/main/transcript.ts     TranscriptWatcher: tails ~/.claude/projects/*/<claudeSessionId>.jsonl into ChatBlocks for the tiles
src/main/files.ts          reads a referenced path for the preview pane: text (capped), image / PDF bytes, a directory listing
src/main/git.ts            the changes tile's source: `git status` + numstat of a working tree, one file's diff (read-only, no index lock)
src/main/foxtrot.ts        Foxtrot, the head: rules over session state + transcripts → a running log (userData/foxtrot.jsonl)
src/main/wiki.ts           Wikipedia for the tile: picture of the day (feed, cached 1h), search, page summaries
src/main/translate.ts      Google Cloud Translation v2 detect + translate for the translator tile
src/main/dictionary.ts     Wiktionary (kaikki.org exports) + Datamuse lookups for the vocabulary tile
src/main/vocabwords.ts     vocabulary supply: data/esLemmas.ts (frequency lemmas) + languagelog's SQLite
src/main/store.ts          VocabStore: userData/vocab.db (node:sqlite) — translations + shown words, for flash cards
scripts/lemmas.py          regenerates data/esLemmas.ts from doozan/spanish_data frequency.csv
src/main/youtube.ts        rewrites embed request headers on the persist:youtube partition
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
src/renderer/src/lib/bus.ts         translator → vocabulary tile: window CustomEvent per finished translation
src/renderer/src/lib/markdown.tsx   tiny markdown → React elements (no HTML) for Claude's prose in the tiles
src/renderer/src/lib/paths.ts       finds file references in text (tiles + terminal) and the one channel that opens one
src/renderer/src/lib/filerefs.tsx   a file reference as a clickable element (and linkifying a run of text)
src/renderer/src/lib/foxlog.ts      useFoxLog(): Foxtrot's entries (loaded + live) and the newest live one, which makes him bark
src/renderer/src/lib/fox.ts         Foxtrot: the sprite sheet (assets/fox.png) + the xterm decoration that covers Claude Code's banner mascot
src/renderer/src/lib/bark.ts        Foxtrot's yip (WebAudio) + useBark, the edge detector behind a bark
src/renderer/src/components/        FocusPane, Grid, Tile, ChatView (a tile's conversation), TilePrompt (its prompt bar), PlusTile (+ menu),
                                    DocPane (the file preview over the grid), FoxHead (Foxtrot + his last barks, top bar), FoxLog (his whole log),
                                    TermHost, FoxStatus (the fox as the status indicator),
                                    WikiTile, YouTubeTile (<webview>), GitTile (the focused session's changes), TranslateTile, VocabTile, useDropTarget (file drops),
                                    ThemeControls (top-bar theme popover + light/dark toggle), Fox (the sprite as a React element),
                                    PhonePair (the top-bar phone button: QR + link + the serve switch)
tmux.conf                  the deck tmux server config (status off, remain-on-exit failed, titles on)
build/icon.png, icon.icns  the app icon (Foxtrot's alert pose on a cream tile): the Dock under `npm run dev`, the bundle under `npm run dist`
scripts/smoke.mjs          the smoke test
```

## Rules the code enforces (keep them)

- **Cap = 7** (`CAP` in `src/shared/types.ts`). Slots 1..7 are sticky while open: a session keeps its
  number until parked/killed; a new session takes the lowest free slot. ⌘1–7 = focus slot.
  The live cap is `SessionManagerOptions.cap()` = CAP minus one per grid-cell plugin tile that
  is on (`showGit`, `showVocab`, `showTranslate`; all on by default, so 4). Turning one on with every
  slot open leaves the top slot open (and the grid a cell over) until that session is parked.
  A saved record whose slot is above the cap is parked on load.
- **Focus + grid + plugins**: the grid shows cap−1 session cells, then a plugin row one grid row
  tall (`Grid.tsx`, `.grid-col` in styles.css). Sessions with `attention` sort first, then slot
  order (`App.tsx`). The first empty cell is the `+`; at cap the `+` disappears.
- **Plugins**: Wikipedia = the picture of the day (the featured feed's `image`), full bleed,
  click opens its file page via `deck:openExternal` (http(s) only). It rotates: every 2 minutes
  (`CYCLE_MS` in `WikiTile`) a random day's picture from the archive (2016 on, the feed is empty
  before; `wikiPicture('past')` tries 4 days then falls back to today's), and every third one is
  today's again; the caption carries the day for archive pictures. Main caches past days for
  good, today's for 1h. A clock (`.wiki-clock`, local zone, ticking each second) sits top left;
  a transparent search box sits top right over it (`.wiki-search`: no chrome until hover/focus). Typing (350ms pause, or ⏎)
  searches English Wikipedia (`/w/rest.php/v1/search/page`) and the hits take over the tile over
  the darkened picture; a hit loads its lead section (`/api/rest_v1/page/summary`) in place, its
  title opens the browser. Esc / × brings the picture back. Search thumbnails are re-requested at
  250px (the API's are 60px). YouTube = the bare embed player for the lofi stream in
  a `<webview>` on partition `persist:youtube` (`webviewTag` is on in `index.ts`); play/pause and
  mute call the embed's player object (`#movie_player`) through `executeJavaScript`, never the
  `<video>` element (the player re-applies its own mute state to it). The renderer CSP allows no
  outbound requests (feeds are fetched in main) and whitelists only `*.wikimedia.org` images.
  Spotify was tried and dropped: its web player needs Widevine, which Electron does not ship.
- **Changes** (`GitTile`, the cell before the vocabulary tile, i.e. where slot 5 sat; `main/git.ts`):
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
  to match): the fox at 4× (2× compact), posed for the whole deck (alert when something is blocked
  or for a minute after a bark, looking around while any session works, asleep with none open,
  else the tail wag), a speech bubble with his last THREE barks (newest on top, "4m" ages, faded
  past 30 min), and `.topbar-tools` on the right, a wrapping row that is where new buttons and
  dropdowns go. A bark that arrives live makes him bark (`foxBark`); loaded ones never do. The fox,
  the bubble, or ⌘J (View ▸ Foxtrot's Log) opens the whole log in the `.doc` pane over the grid —
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
- **Recent folders**: `sessions.json` keeps `recentCwds`, the last 10 folders sessions were started
  or resumed in, most recent first (`touchRecent` in `sessions.ts`); it outlives the sessions, and a
  file without it is seeded from the records. `DeckState.recent` = the first 3 that still exist. They
  are offered in the `+` chooser ("Start in": the focused folder, then recents, then the picker; a
  worktree checkbox applies to whichever is picked, ⌥-click flips it once), in the empty focus pane,
  and under Session ▸ New Session in Recent Folder (the menu is rebuilt when the list changes).
- **Close = park, not kill.** ⌘W / "park" kills only the pty client; the tmux session and the
  Claude conversation stay. Parked sessions are listed at the bottom of the `+` chooser
  and resume by tmux attach if alive, else `claude --resume <claudeSessionId>`.
- **One tmux client per session, ever.** tmux sizes to the smallest attached client. Never
  attach a second client to a `deck-*` session from a terminal while the app has it open.
- **Spawn command** (`SessionManager.claudeCommand`): `exec claude --settings <hooks.json>
  --session-id <uuid> [--worktree]`. `exec` so the pane's process IS claude. The UUID is
  ours (`randomUUID()`), which is how fleet rows and hook payloads are matched back to a tile.
  `--worktree` lets Claude create/clean the worktree itself under `<repo>/.claude/worktrees/`.
- **`--settings` merges** with the user's own settings (list keys combine), so any global
  Notification/Stop hooks the user has keep firing inside deck sessions. Our hooks file only adds POSTs to
  `127.0.0.1:<port>/{notification,stop,prompt}`; it must never block Claude (`; exit 0`).
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
  styles.css; use the variables (`color-mix` for tints).
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
  decline them). Add to both.

## State on disk

`~/Library/Application Support/<profile>/`
- `sessions.json` — records (`slot` sticky, null = parked) + `focusSlot` + `recentCwds` (last 10 start folders)
- `claude-hooks.json` — the `--settings` file handed to every spawned session
- `vocab.db` — the vocabulary store (translations, words with entries, reviews); see the store rule above
- `foxtrot.jsonl` — Foxtrot's log, one entry per line (see the head rule above)
- `drops/` — copies of dropped files that had no lasting path (screenshot thumbnails, images out of pages); pruned after 30 days
- `remote.json` — the phone's pairing token (see the phone rule); delete it to rotate
- `config.json` — `DeckSettings` (theme, appearance, gridColumns, focusWidth, fonts, plugins, defaultCwd,
  translateApiKey, showGit, showVocab, vocabCycleSeconds, languagelogDb, showTranslate, foxBark, remote…);
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
