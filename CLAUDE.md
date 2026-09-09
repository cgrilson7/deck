# deck

Seven Claude Code sessions in one Electron window. The focused session fills the left third;
the other six live in a grid on the right and stream live, with a plugin row (Wikipedia's
featured content, a lofi YouTube stream) beneath them. Click a tile to swap it into focus.
The `+` in the grid starts a new session. A personal tool, macOS only.

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
src/main/wiki.ts           fetches today's Wikipedia featured-content feed (cached 1h) for the tile
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
src/renderer/src/lib/theme.ts       settings → CSS variables + xterm palettes; useSettings(), applied before first paint
src/renderer/src/lib/bus.ts         translator → vocabulary tile: window CustomEvent per finished translation
src/renderer/src/lib/fox.ts         Foxtrot: the sprite sheet (assets/fox.png) + the xterm decoration that covers Claude Code's banner mascot
src/renderer/src/lib/bark.ts        Foxtrot's yip (WebAudio) + useBark, the edge detector behind a bark
src/renderer/src/components/        FocusPane, Grid, Tile, PlusTile (+ menu), TermHost, FoxStatus (the fox as the status indicator),
                                    WikiTile, YouTubeTile (<webview>), TranslateTile, VocabTile, useDropTarget (file drops),
                                    ThemeControls (top-bar theme popover + light/dark toggle), Fox (the sprite as a React element)
tmux.conf                  the deck tmux server config (status off, remain-on-exit failed, titles on)
build/icon.png, icon.icns  the app icon (Foxtrot's alert pose on a cream tile): the Dock under `npm run dev`, the bundle under `npm run dist`
scripts/smoke.mjs          the smoke test
```

## Rules the code enforces (keep them)

- **Cap = 7** (`CAP` in `src/shared/types.ts`). Slots 1..7 are sticky while open: a session keeps its
  number until parked/killed; a new session takes the lowest free slot. ⌘1–7 = focus slot.
  The live cap is `SessionManagerOptions.cap()` = CAP minus one per grid-cell plugin tile that
  is on (`showVocab`, `showTranslate`; both on by default, so 5). Turning one on with every
  slot open leaves the top slot open (and the grid a cell over) until that session is parked.
  A saved record whose slot is above the cap is parked on load.
- **Focus + grid + plugins**: the grid shows cap−1 session cells, then a plugin row one grid row
  tall (`Grid.tsx`, `.grid-col` in styles.css). Sessions with `attention` sort first, then slot
  order (`App.tsx`). The first empty cell is the `+`; at cap the `+` disappears.
- **Plugins**: Wikipedia = cards from the featured feed (picture of the day, featured article,
  on this day, most read), only ones with an image, cycling every 20s; click opens the article
  via `deck:openExternal` (http(s) only). YouTube = the bare embed player for the lofi stream in
  a `<webview>` on partition `persist:youtube` (`webviewTag` is on in `index.ts`); play/pause and
  mute call the embed's player object (`#movie_player`) through `executeJavaScript`, never the
  `<video>` element (the player re-applies its own mute state to it). The renderer CSP allows no
  outbound requests (feeds are fetched in main) and whitelists only `*.wikimedia.org` images.
  Spotify was tried and dropped: its web player needs Widevine, which Electron does not ship.
- **Translator** (`TranslateTile`, last grid cell): languagelog (~/languagelog) boiled down to two
  boxes, English over Spanish. Typing into either box translates after a 700ms pause or ⏎ (⇧⏎ =
  newline); the API's detected language decides which box the text belongs in, so Spanish typed
  into the English box is moved down and its English put on top. Reset / Esc / 5 idle minutes
  empty both boxes; the last pair stays as placeholders (localStorage). Backend is Google Cloud
  Translation v2 in `main/translate.ts` (one call, a second only when the text was already in
  the target language), keyed by `translateApiKey` in config.json, else `$GOOGLE_CLOUD_API_KEY`.
  A finished translation is announced on `lib/bus.ts`.
- **Vocabulary builder** (`VocabTile`, the cell left of the translator): a new Spanish word every
  `vocabCycleSeconds` (30), shown as ONE merged bilingual entry: both headwords with IPA, then
  the English and Spanish definitions interleaved, synonyms interleaved, etymologies run
  together, one example sentence. Redundancy is deliberate. ‹ › step, ⏸ holds (persisted), the
  search line or a one-or-two-word translation next door shows that word now and restarts the
  clock. Supply (`main/vocabwords.ts`): `data/esLemmas.ts`, ~3000 SAT-level Spanish content
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
  SM-2 columns (`due`, `interval`, `ease`, `reps`, `lapses`, `known`) that nothing drives yet;
  `reviews` is the per-grade history for later. Unique on (es, en). The ♥ on the card sets
  `liked` (added by a guarded `alter table` in `MIGRATIONS`); liked words are merged into the
  vocabulary supply as if they were the user's own, so they lead every pass. Counts show in the vocab
  tile's search placeholder. Inspect: `sqlite3 ~/Library/Application\ Support/deck/vocab.db`.
- **Foxtrot** (`lib/fox.ts`, `components/Fox.tsx`, `.fox*` in styles.css): slay's Village fox (Elthen's
  "2D Pixel Art Fox Sprites", the same 14×7 sheet as slay's `/dream-fox.png`, copied to
  `src/renderer/src/assets/fox.png`; recolors are fine in-product, don't ship it standalone). It IS
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
- **Renderer**: grid tiles use xterm's DOM renderer; only the focus pane loads the WebGL addon
  (Chrome caps live WebGL contexts). Fonts, cursor and scrollback come from settings
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
- **⌘ shortcuts** live in `menu.ts` AND in `isDeckShortcut()` in terminals.ts (xterm must
  decline them). Add to both.

## State on disk

`~/Library/Application Support/<profile>/`
- `sessions.json` — records (`slot` sticky, null = parked) + `focusSlot`
- `claude-hooks.json` — the `--settings` file handed to every spawned session
- `vocab.db` — the vocabulary store (translations, words with entries, reviews); see the store rule above
- `config.json` — `DeckSettings` (theme, appearance, gridColumns, focusWidth, fonts, plugins, defaultCwd,
  translateApiKey, showVocab, vocabCycleSeconds, languagelogDb, showTranslate, foxBark…);
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
- Sessions started in VS Code/iTerm cannot be adopted (their PTYs belong to that app); they
  can only be resumed by id. `claude agents --json` lists them with `sessionId`.
