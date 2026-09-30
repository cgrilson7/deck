# Broadcast: a gamecast tile for the deck (handoff)

Goal: a new mini app, **Broadcast**, in the RIGHT column: a live MLB gamecast for one game, first
Red Sox @ Yankees, ALWC Game 1 (Tue 9/29/2026, ESPN event `401907924`). Click the tile and the
full gamecast opens in the center column, or leave that for v2.

## What already exists

- **Working prototype**: `~/broadcast/index.html`, one HTML file checked against the live game.
  Port its `render()` logic and field mapping; don't reinvent them. It has the score, count,
  bases, pitcher and batter, the current at-bat on a strike zone, win probability, the line score,
  the last 12 at-bat results, and a "Listen on ESPN Radio" link.
- **Data**: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=<id>` has no
  key, sends `access-control-allow-origin: *`, and returns ~200 plays per game. Fields used:
  - `header.competitions[0]`: `status.type.{state: pre|in|post, shortDetail}`, `competitors[]`
    (`homeAway`, `score`, `hits`, `errors`, `linescores[].displayValue`, `record[0].displayValue`,
    `team.{abbreviation, color, alternateColor, logos[]}`). Pick logos by `rel`: `full,default`
    and `full,dark`.
  - `situation`: `balls`, `strikes`, `outs`, `pitcher.playerId`, `batter.playerId`.
  - `plays[]`: `summaryType` `P` is a pitch (`type.type` `ball*` / `strike*` / `foul-ball` / in
    play, `pitchType.abbreviation`, `pitchVelocity`, `pitchCoordinate{x,y}`, `atBatId`,
    `atBatPitchNumber`); `type.type === 'play-result'` is the at-bat's line (`text`,
    `scoringPlay`, `period.{type,number}`). **Base runners are on the LAST play**: `onFirst`,
    `onSecond`, `onThird` (present means occupied). `situation` has no runners.
  - `winprobability[-1].homeWinPercentage`.
  - Player names: build an id → `shortName` map from `boxscore.players[].statistics[].athletes[]`
    **and** `rosters[].roster[]`. Rosters alone miss in-game arrivals: tonight's starter
    Schlittler was only in the boxscore.
- **Strike-zone box** in `pitchCoordinate` space, calibrated from tonight's called pitches:
  x 83–150, y 142–196. It's approximate, so label it as such.
- User agent: Akamai in front of ESPN returns 403 for Electron's default user agent AND for a
  borrowed Chrome one. An honest app name (`deck/1.0 (+…)`) passes. (Corrected: this note used to
  say to send a Chrome user agent, which caused the first 403.)

## Decisions already made

- **No embedded audio.** The ESPN Radio page has the raw HLS stream
  (`live.amperwave.net/.../espn-sidechannel2-cloud.m3u8`). Playing it in our own tile would
  rebroadcast licensed MLB audio. Instead the tile has a button that calls `openExternal`
  with `https://www.espn.com/radio/play/_/s/mlb2`. Revisit only if there's a rights agreement.
- Data is fetched in **main**. The renderer's CSP has no `connect-src`, so it falls back to
  `'self'`, and every other network tile (wiki, weather) already works this way.
- Pull model like weather: `both('broadcast:game', 'broadcast', …)`, which registers IPC plus
  the phone call. Main caches for ~5 s; the tile polls every 10 s while `in`, every 60 s while
  `pre`, and stops at `post`.

## Build steps (deck conventions, per CLAUDE.md "Rules" + the grid section)

1. `src/shared/types.ts`
   - `PLUGIN_KEYS`: add `'broadcast'`. `isGridKey` / `isPluginKey` are built from this list.
   - `pluginCells()`: add `'showBroadcast'` to the `Pick` and `if (s.showBroadcast) out.push('broadcast')`.
   - `DeckSettings`: `showBroadcast: boolean` (default `false`), `broadcastEvent: string`
     (default `'401907924'`), both in the defaults object.
   - A normalized `Gamecast` type: send the renderer a small shape, not ESPN's ~1 MB summary.
   - `DeckApi`: `broadcast(): Promise<Gamecast | null>`.
2. `src/main/broadcast.ts` (new, modeled on `main/weather.ts`): `gamecast(eventId)` fetches,
   normalizes and caches, using `AbortSignal.timeout`. Throw on HTTP errors the way weather does.
3. `src/main/settings.ts` `sanitize()`: add `showBroadcast` (bool) and `broadcastEvent`
   (digits only, ≤ 12 characters, else the default).
4. `src/main/index.ts`: `both('broadcast:game', 'broadcast', () => gamecast(settings!.get().broadcastEvent))`
   next to the weather lines. `src/shared/remote.ts`: add `'broadcast'` to the method list.
5. `src/preload/index.ts`: `broadcast: () => ipcRenderer.invoke('broadcast:game')`.
   `src/renderer/src/phone/api.ts`: `broadcast: () => remote.call('broadcast')`.
6. `src/renderer/src/components/BroadcastTile.tsx` (new): `div.tile.tile-plugin.broadcast` with
   a `header.pane-head` (a `Radio` icon, "Broadcast", an inning badge, a LIVE dot, `<CellTools />`
   last in the head), modeled on `PokemonTile.tsx`. The tile is only a quarter of a column
   high, so the score row, count, bases and batter/pitcher go on top; everything else scrolls
   inside the tile. Use the theme variables (`--ink`, `--muted`, `--line`, `--accent`,
   `--surface`), never hard-coded colors, except team colors: `color` in light themes and
   `alternateColor` in dark ones (navy disappears on dark).
7. `src/renderer/src/components/Grid.tsx` `plugin()` switch: `case 'broadcast': return <BroadcastTile />`.
8. `src/renderer/src/components/PlusTile.tsx` `PLUGINS[]`: key `broadcast`, label `Broadcast`,
   hint "A live MLB gamecast: score, count, bases, pitches and play-by-play; listen on ESPN
   Radio", icon `Radio`, a hue that isn't taken (`sky` or `orange`), setting `showBroadcast`.
9. `src/main/menu.ts`: a View ▸ "Show Broadcast Tile" checkbox, like Space's.
10. `src/renderer/index.html` CSP: add `https://a.espncdn.com` to `img-src` for logos. Or ship
    logos as data URLs from main, and then the CSP doesn't change.
11. `src/renderer/src/styles.css`: a `.broadcast` block beside the other plugin blocks.
12. `CLAUDE.md`: add Broadcast to the plugin tile list in the opening paragraph, and a
    `- **Broadcast**` entry in the plugins section (the files, the data source, the no-audio rule).

## Optional, v2

- A center-column pane on click (`toggleBroadcast` UiEvent, like `togglePokemon`) holding the
  prototype's full layout.
- Foxtrot barks on a scoring play: `foxtrot?.external('broadcast', text)`; add
  `'broadcast'` to `FoxKind`.
- Choosing the game: pull today's `.../mlb/scoreboard`, show it as a picker in the tile, and
  save the pick to `broadcastEvent`.

## Watch out

- **Space is in flight, uncommitted.** Session `space-10` has edits in `types.ts`,
  `settings.ts`, `Grid.tsx`, `App.tsx`, `PlusTile.tsx`, `menu.ts`, `index.ts`, preload, phone
  api and `styles.css` (as of 9/29, ~21:20). Wait until it's committed, or make only additive
  edits and don't sweep its changes into a Broadcast commit.
- The ESPN endpoint is undocumented and could change. MLB's `statsapi.mlb.com` live feed is the
  fallback.

## Verify

`npm run dev`, then turn the tile on from the right `+` picker. During the game, check the
score, count and bases against espn.com, and that the tile drags within the right column, that
× turns it off, and that it shows on the phone.
