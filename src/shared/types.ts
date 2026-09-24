// Types shared by main, preload and renderer. Keep this file dependency-free (themes.ts is ours).

import type { Appearance } from './themes'
import type { GridOrder } from './gridorder'
import type { Curriculum } from './lesson'

/**
 * Hard cap on open top-level sessions: the focus pane + the grid. Slots 1..CAP are sticky; ⌘1–9
 * focus the first nine and ⌘0 the tenth. The live cap is lower: `liveCap()` below.
 */
export const CAP = 10

/**
 * A wolfpack's betas take slots from here up: never in the ⌘ range, never counted against the
 * cap; each is a grid cell of its own after the sessions, like a subagent. See `PackRef`.
 */
export const BETA_SLOT_BASE = 100

/** The most betas one alpha may run at once (`POST /pack` refuses more). */
export const PACK_MAX = 8

/** The keys a grid cell can hold, besides `slot:<n>` (a session), `beta:<id>` and `agent:<id>` (a wolfpack's members). */
export const PLUGIN_KEYS = ['wiki', 'music', 'studio', 'pokemon', 'git', 'vocab', 'translate', 'quixote', 'mol', 'lesson'] as const
export type PluginKey = (typeof PLUGIN_KEYS)[number]

/** The most Molecule tiles at once: each viewer holds a WebGL context, and Chromium caps those (16) for the whole window. */
export const MOL_TILES_MAX = 8
/** Molecule tile `n`'s grid key: the first keeps the plugin's own (`mol`), the others are `mol:<n>`. */
export const molKey = (n: number): string => (n === 1 ? 'mol' : `mol:${n}`)
/** The tile number of a grid key, or null when it is not a Molecule tile's. */
export const molTileOf = (key: string): number | null => (key === 'mol' ? 1 : /^mol:([1-9]\d?)$/.test(key) ? Number(key.slice(4)) : null)
/** The number a new Molecule tile takes (the lowest free), or null at the cap. */
export function nextMolTile(tiles: number[]): number | null {
  if (tiles.length >= MOL_TILES_MAX) return null
  let n = 1
  while (tiles.includes(n)) n++
  return n
}
/** The Lesson tiles, the Molecule tiles' way: `lesson` for tile 1, `lesson:<n>` past it (a lesson, a card and its state each). */
export const LESSON_TILES_MAX = 4
export const lessonKey = (n: number): string => (n === 1 ? 'lesson' : `lesson:${n}`)
/** The tile number of a grid key, or null when it is not a Lesson tile's. */
export const lessonTileOf = (key: string): number | null => (key === 'lesson' ? 1 : /^lesson:([1-9]\d?)$/.test(key) ? Number(key.slice(7)) : null)
/** The number a new Lesson tile takes (the lowest free), or null at the cap. */
export function nextLessonTile(tiles: number[]): number | null {
  if (tiles.length >= LESSON_TILES_MAX) return null
  let n = 1
  while (tiles.includes(n)) n++
  return n
}
/**
 * A WEB APP: a site registered by name + URL that gets a grid tile of its own (`web:<id>`) and
 * opens in the CENTER column as a kept-alive <webview> (partition `persist:web`, so a sign-in
 * lasts). Village is the first; anything that runs in a browser can be another.
 */
export interface WebApp {
  /** A slug, unique among the apps: the grid key's tail and the snapshot's name. */
  id: string
  name: string
  /** http(s) only; where the webview starts and what "home" goes back to. */
  url: string
  /** Whether its tile is in the grid (× puts it away; the registration stays). */
  show: boolean
}
/** Each opened app is a renderer process of its own, kept until the window reloads. */
export const WEB_APPS_MAX = 12
export const WEB_APPS_DEFAULT: WebApp[] = [{ id: 'village', name: 'Village', url: 'https://villagenotes.app/dream', show: true }]
const WEB_ID = /^[a-z0-9][a-z0-9-]{0,23}$/
export const isWebAppId = (id: unknown): id is string => typeof id === 'string' && WEB_ID.test(id)
export const webKey = (id: string): string => `web:${id}`
/** The app id of a grid key, or null when it is not a web app's. */
export const webAppOf = (key: string): string | null => (key.startsWith('web:') && isWebAppId(key.slice(4)) ? key.slice(4) : null)
/** What was typed as a URL ("maptap.gg"), as one a webview may load: https:// when no scheme, http(s) only. */
export function cleanWebUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const t = raw.trim()
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `${/^(localhost|127\.0\.0\.1)(:|\/|$)/.test(t) ? 'http' : 'https'}://${t}`)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname ? u.href : null
  } catch {
    return null
  }
}
/** A free id for an app of this name. */
export function webAppId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'app'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/** A grid key that belongs to a mini app: a plugin's own, one more Molecule tile's, or a web app's. */
export const isPluginKey = (k: string): boolean => (PLUGIN_KEYS as readonly string[]).includes(k) || molTileOf(k) !== null || lessonTileOf(k) !== null || webAppOf(k) !== null

/** Which plugin tiles hold a grid cell under these settings (compact mode drops the two fun ones). */
export function pluginCells(s: Pick<DeckSettings, 'compact' | 'showWiki' | 'showMusic' | 'showStudio' | 'showPokemon' | 'showGit' | 'showVocab' | 'showTranslate' | 'showQuixote' | 'showMol' | 'showLesson'>): PluginKey[] {
  const out: PluginKey[] = []
  if (s.showWiki && !s.compact) out.push('wiki')
  if (s.showMusic && !s.compact) out.push('music')
  if (s.showStudio) out.push('studio')
  if (s.showPokemon) out.push('pokemon')
  if (s.showGit) out.push('git')
  if (s.showVocab) out.push('vocab')
  if (s.showTranslate) out.push('translate')
  if (s.showQuixote) out.push('quixote')
  if (s.showMol) out.push('mol')
  if (s.showLesson) out.push('lesson')
  return out
}

/** A session's place in a wolfpack: a beta carries its alpha's deck id and its task's name. */
export interface PackRef {
  /** Deck id of the alpha (the session that spawned it). */
  alpha: string
  /** The track it was given ("engine hooks"), the tile's name until Claude titles it. */
  task: string
}

/**
 * A subagent a session spawned (the Agent tool, a Workflow), as the CLI's SubagentStart /
 * SubagentStop hooks report it, with what the deck has done to it (main/agents.ts). Its tile
 * tails `<projects>/<cwd>/<sessionId>/subagents/agent-<id>.jsonl` (the documented place; same
 * JSONL as a session's transcript) under the id `agent:<id>`. Every one is a grid cell of its
 * own, after the sessions.
 */
export interface AgentView {
  id: string
  /** Deck id of the session that spawned it. */
  parent: string
  /** The agent type (`Explore`, `general-purpose`, a custom one). */
  type: string
  /** The tile's name: the Agent tool's short description, or a Workflow agent's `label` (from its meta.json sidecar); '' when none was seen. */
  description: string
  /** The task it was given: the prompt's first line, '' until the transcript shows it. */
  task: string
  /** What the Agent call (or the Workflow script, per the sidecar) asked for as `model`, '' when unsaid. */
  model: string
  /** A Workflow agent's phase (the sidecar's `workflowPhase`), '' for any other agent. */
  phase: string
  /** Started with `run_in_background` (the parent goes on working; a cancel can also TaskStop it). */
  background: boolean
  startedAt: number
  /** Null while it runs. */
  endedAt: number | null
  /** What it said last, from the stop hook; null while it runs. */
  lastText: string | null
  /** Paused from the deck: its next tool call is held in the hooks server until resumed (or cancelled). */
  paused: boolean
  /** True while a tool call of a paused agent is actually being held (it has bitten). */
  held: boolean
  /** Cancelled from the deck: the reason, which its tool calls are refused with and the alpha was told. Null otherwise. */
  cancelled: { reason: string; at: number } | null
}

/** How an agent is named in a head or a sentence: the Agent call's description, else the task's first line, else its type. */
export function agentName(a: Pick<AgentView, 'description' | 'task' | 'type'>): string {
  return a.description || a.task || a.type || 'agent'
}

/** What kind of agent it is, for the line under its name: the type, or for a Workflow's agent (whose type says nothing) its phase. */
export function agentKind(a: Pick<AgentView, 'type' | 'phase'>): string {
  return a.phase ? `workflow · ${a.phase}` : a.type
}

/** Session status as best we know it: fleet poll (`claude agents --json`) + hook events. */
export type SessionStatus = 'starting' | 'busy' | 'idle' | 'blocked' | 'dead' | 'unknown'

/** What we persist per session (userData/sessions.json). */
export interface SessionRecord {
  /** deck id, short hex. Also the tmux session name suffix and the pty key. */
  id: string
  /** tmux session name on the deck socket: `deck-<id>`. */
  tmuxName: string
  /** UUID handed to `claude --session-id` at spawn; used for `--resume` and hook matching. */
  claudeSessionId: string
  cwd: string
  /** Spawned with `--worktree` (Claude makes the worktree itself under .claude/worktrees/). */
  worktree: boolean
  /** What was handed to `--model` (an alias or a full id; see shared/models.ts). Absent / '' = the CLI's default. */
  model?: string
  /** What was handed to `--permission-mode` (see PERMISSION_MODES in shared/models.ts). Absent / '' = the CLI's default. Repeated on a dead resume, like the model. */
  permissionMode?: string
  createdAt: number
  /**
   * When it last DID something worth a place at the top of the session browser (ms): started or
   * resumed, prompted (typed or from a tile), finished a turn, asked for you. Never a transcript
   * tick, or the working sessions would trade places all day. Absent in an older record = createdAt.
   */
  activeAt?: number
  /** 1..CAP while open (BETA_SLOT_BASE+ for a beta), null while parked (detached or exited). Sticky while open. */
  slot: number | null
  /** Last known name: fleet listing name, else terminal title, else a placeholder. */
  name: string
  /** Set on a wolfpack's beta: whose it is and what it was given. Absent = an ordinary session. */
  pack?: PackRef
}

/** Live view of a session = record + runtime state. */
export interface SessionView extends SessionRecord {
  status: SessionStatus
  /** Needs you: set by Notification/Stop hooks (or a bell), cleared on input / UserPromptSubmit. */
  attention: boolean
  /** A pty is attached to its tmux session right now. */
  attached: boolean
  /** The tmux session exists (a parked session may be resumable via tmux or via --resume). */
  tmuxAlive: boolean
  /** A beta paused from the deck: its next tool call is held (see `leashPause`). */
  paused: boolean
}

/** What `DeckApi.newSession` takes: the `new` command's options plus a first prompt, a name, and whether to focus it. */
export interface NewSessionRequest {
  cwd?: string
  worktree?: boolean
  /** An alias or full id for `--model`; '' = none; absent = the `defaultModel` setting. */
  model?: string
  /** The CLI's `--name` (what the fleet listing, and so the tile, calls it). */
  name?: string
  /** The first prompt, handed to the CLI as its positional argument so nothing races the TUI. */
  prompt?: string
  /** `--permission-mode`, one of PERMISSION_MODES (shared/models.ts); '' / absent = the CLI's default. */
  permissionMode?: string
  /** A NEW PROJECT (the launcher): make `cwd` (and its parents) if it does not exist yet. `~/` is expanded. */
  create?: boolean
  /** With `create`: `git init` the fresh folder (skipped when it is already inside a repository). */
  gitInit?: boolean
  /** False = spawn it without taking the focus (the Studio's chat: the pane stays where it is). Default true. */
  focus?: boolean
}

export interface DeckState {
  cap: number
  focusSlot: number | null
  open: SessionView[]
  parked: SessionView[]
  /** The last few folders sessions were started in (most recent first, only ones that still exist). */
  recent: string[]
  /** Which tmux socket / profile this instance runs on (deck or deck-dev). */
  profile: string
}

export type DeckCommand =
  /** `model`: an alias or full id for `--model`; '' = none; absent = the `defaultModel` setting. */
  | { type: 'new'; worktree?: boolean; cwd?: string; model?: string; permissionMode?: string }
  | { type: 'chooseFolder'; worktree?: boolean; model?: string; permissionMode?: string }
  | { type: 'resume'; id: string }
  | { type: 'focus'; slot: number }
  | { type: 'cycle'; dir: 1 | -1 }
  | { type: 'jumpAttention' }
  | { type: 'detach'; slot: number }
  | { type: 'kill'; id: string }
  | { type: 'forget'; id: string }
  /** Reload the renderer and reattach every tmux client so the terminals redraw. Sessions keep running. */
  | { type: 'refreshUi' }
  /** End an alpha's wolfpack: kill every beta (or park them, keeping their conversations). */
  | { type: 'dismissPack'; alpha: string; park?: boolean }
  /**
   * The leash on one pack member (main/agents.ts): `id` is a subagent's id or a beta session's deck id.
   * pause = its next tool call is held in the hooks server (a `note` is also typed into the alpha);
   * resume = let go; cancel = its tool calls are refused with `reason` (a beta is killed) and the alpha
   * is told the reason so it can tweak and relaunch; dismiss = a finished agent's tile goes.
   */
  | { type: 'leashPause'; id: string; note?: string }
  | { type: 'leashResume'; id: string }
  | { type: 'leashCancel'; id: string; reason: string }
  | { type: 'agentDismiss'; id: string; force?: boolean }

/** A Wikipedia picture of the day (today's, or one from the archive), from the featured-content feed. */
/** The glass theme's backdrop (main/wiki.ts `wikiBackdrop`): a picture of the day, small, as a data: URL. */
export interface WikiBackdrop {
  date: string
  title: string
  dataUrl: string
}

export interface WikiPicture {
  /** The day it was picture of the day, YYYY-MM-DD in local time. */
  date: string
  /** True when it is today's. */
  today: boolean
  title: string
  /** "Photo: …" credit line, '' when the feed has none. */
  credit: string
  imageUrl: string
  /** The same picture at viewer size: the tile's copy would be upscaled full screen. */
  largeUrl: string
  /** The file page on Commons. */
  url: string
}

/** A place the Wikipedia tile shows the weather for. */
export interface WeatherPlace {
  name: string
  /** "Maine, US": what tells two Portlands apart. '' when unknown. */
  region: string
  lat: number
  lon: number
}

export type TempUnit = 'F' | 'C'

/** How many places the tile lists under its clock. */
export const WEATHER_PLACES_MAX = 6

/** Portland, Maine: the weather the tile shows until told otherwise. */
export const WEATHER_PLACE_DEFAULT: WeatherPlace = { name: 'Portland', region: 'Maine, US', lat: 43.6591, lon: -70.2568 }

/** The weather at one place now (Open-Meteo). Numbers are rounded, null when the answer had none. */
export interface WeatherNow {
  place: WeatherPlace
  unit: TempUnit
  temp: number | null
  feels: number | null
  /** Today's high and low. */
  high: number | null
  low: number | null
  /** mph with °F, km/h with °C. */
  wind: number | null
  /** WMO weather code, -1 when unknown. */
  code: number
  /** False after dark there. */
  day: boolean
  /** IANA zone of the place, and its offset from UTC in seconds. */
  timezone: string
  utcOffset: number
}

/** One result of a Wikipedia search. */
export interface WikiHit {
  /** Page key (title with underscores), the argument to `wikiSummary`. */
  key: string
  title: string
  /** Wikidata's one-liner ("Species of mammal"), '' when none. */
  description: string
  /** The matching snippet, tags stripped. */
  excerpt: string
  imageUrl: string | null
  url: string
}

/** The summary of one Wikipedia page, shown inside the tile when a result is picked. */
export interface WikiSummary {
  title: string
  description: string
  /** The lead section as plain text. */
  extract: string
  imageUrl: string | null
  url: string
}

export type Lang = 'en' | 'es'

/** One round trip of the translator tile: the text as typed, which language it turned out to be, and the other side. */
export interface TranslateResult {
  source: Lang
  text: string
  translated: string
}

/** One part of speech of a dictionary entry with its glosses, most common first. */
export interface VocabSenses {
  pos: string
  glosses: string[]
}

/** A word in one language, reduced from Wiktionary (kaikki.org exports) for the vocabulary tile. */
export interface VocabEntry {
  word: string
  ipa: string | null
  /** Set when `word` was an inflection and the entry shown is its lemma ("corre" → "correr"). */
  formOf: string | null
  /** Glosses in English (English Wiktionary: its English or Spanish section). */
  senses: VocabSenses[]
  /** Glosses in Spanish (Spanish Wiktionary), only for Spanish words. */
  native: VocabSenses[]
  synonyms: string[]
  etymology: string | null
  /** One usage example from Wiktionary, with its translation when the entry has one. */
  example: { text: string; translation: string | null } | null
  /** The Wiktionary page, for a click. */
  url: string
}

/** One word in the vocabulary builder's supply. */
export interface VocabWord {
  word: string
  /** n / v / adj / adv for the frequency list; '' for words from languagelog. */
  pos: string
  /** Frequency rank in the bundled list (0 = most common); -1 for languagelog words. */
  rank: number
  /** The SAT word this lemma glosses (the bundled list); shown as the English headword. */
  en?: string
  /** From the user's own languagelog history. */
  mine: boolean
}

export interface VocabResult {
  /** Which side the looked-up word was on. */
  source: Lang
  en: VocabEntry | null
  es: VocabEntry | null
}

/** Row counts from the vocabulary store (userData/vocab.db). */
export interface VocabStats {
  words: number
  translations: number
  /** Words with the ♥ on. */
  liked: number
  /** Words not marked known whose review is due (all of them until flash cards schedule any). */
  due: number
}

/** What the store hands back for a word it just recorded. */
export interface SavedWord {
  id: number
  liked: boolean
}

/**
 * A word as the store keeps it: the pair, the entry the vocabulary tile showed, and its SM-2
 * schedule. This is what a flash card is made of — the entry is already there, so a card
 * never waits on a lookup.
 */
export interface StoredWord {
  id: number
  es: string
  en: string
  /** The merged entry as it was when the word was last shown; null if the JSON went bad. */
  entry: VocabResult | null
  liked: boolean
  /** Retired: the interval grew past the point of asking again. */
  known: boolean
  /** How many times the vocabulary tile has shown it. */
  seen: number
  /** ISO, null for a word never graded (due now). */
  due: string | null
  /** Days until the next review, as of the last grade. */
  interval: number
  ease: number
  reps: number
  lapses: number
  /** The sentence it was met in, when it was saved from reading (the reader tile). */
  context: string | null
  /** Where that sentence is ("Don Quijote I·8"). */
  origin: string | null
}

/** What a save can carry besides the entry: where the word was met, and a ♥ (a word saved on purpose is one worth learning). */
export interface WordExtra {
  context?: string | null
  origin?: string | null
  liked?: boolean
}

/** Main's word that the vocabulary store changed, from whichever tile: `liked` when the set of liked words may have moved. */
export interface VocabChange {
  kind: 'word' | 'translation' | 'liked' | 'grade'
  liked: boolean
}

/** A form the reader marks in the text: a liked word, or the inflection it was saved from. */
export interface SavedForm {
  form: string
  id: number
  en: string
}

/** One paragraph of the book: prose (joined) or verse (its line breaks kept). */
export interface QuixotePara {
  text: string
  verse: boolean
}
/** A part's preliminaries (n = 0) or one of its chapters. */
export interface QuixoteSection {
  i: number
  part: 1 | 2
  n: number
  /** "Capítulo VIII", "Preliminares". */
  label: string
  /** The chapter's own title ("Del buen suceso que el valeroso don Quijote tuvo…"); '' for preliminaries. */
  title: string
  paras: QuixotePara[]
}
export type QuixoteSectionInfo = Omit<QuixoteSection, 'paras'> & { words: number }
export interface QuixoteIndex {
  source: string
  sections: QuixoteSectionInfo[]
}

/** Where one graded card landed. */
export interface WordSchedule {
  id: number
  due: string | null
  interval: number
  known: boolean
}

export type MusicSource = 'spotify' | 'youtube'

/** Spotify.app as AppleScript reports it (main/spotify.ts), polled while the tile shows it. */
export interface SpotifyState {
  /** false = Spotify.app is not running. */
  running: boolean
  state: 'playing' | 'paused' | 'stopped'
  track: string
  artist: string
  album: string
  /** https://i.scdn.co/... (the renderer CSP allows it). */
  artworkUrl: string
  /** seconds */
  position: number
  /** seconds */
  duration: number
  trackId: string
  /** 0..100 */
  volume: number
  shuffling: boolean
}

export type SpotifyCommand = 'playpause' | 'next' | 'previous' | 'open' | 'shuffle'

/** One chip on the Spotify face: something Spotify.app can be told to play, with its name. */
export interface SpotifyItem {
  uri: string
  name: string
  kind: 'playlist' | 'album' | 'artist' | 'track' | 'show' | 'episode'
  /** The artist (track, album) or owner (playlist), for the chip's tooltip. */
  by?: string
}

/** The connected Spotify account (main/spotifyauth.ts), or the reason there is none. */
export interface SpotifyAccount {
  connected: boolean
  /** Display name, when connected. */
  user: string
  /** false = `spotifyClientId` is not set, so connecting is not possible yet. */
  clientId: boolean
  /** What the Spotify app must have registered (the port follows the profile). */
  redirectUri: string
}

/** The account's side of the chips: contexts played lately, then every playlist in the library. */
export interface SpotifyLibrary {
  recent: SpotifyItem[]
  playlists: SpotifyItem[]
}

/** Everything the user can change from the settings panel. Persisted in userData/config.json. */
export interface DeckSettings {
  /** Theme family id (see shared/themes.ts). */
  theme: string
  /** Light, dark, or follow macOS. */
  appearance: Appearance
  /** The glass theme's backdrop: the day (YYYY-MM-DD) whose picture of the day is pinned, '' = today's. */
  glassDate: string
  /** Compact mode: tighter chrome, smaller headers, plugin row hidden. */
  compact: boolean
  /**
   * The grid's shape: two side columns around the focus pane, each `gridColumns` (1..2) wide
   * and `gridRows` (2..6) tall; that many tiles make a page, and the rest page on (hover an
   * outer edge for the arrows).
   */
  gridColumns: number
  gridRows: number
  /**
   * Where tiles were dragged to: each side column's tile keys, top to bottom (`shared/gridorder.ts`).
   * Written whole on every drag; a tile it does not name takes its default place.
   */
  gridOrder: GridOrder
  /** How wide the focus column is. */
  focusWidth: 'third' | 'twoFifths' | 'half'
  /** Sessions needing you jump to the front of the grid. */
  attentionFirst: boolean
  /** Ask before killing a session. */
  confirmKill: boolean
  /** Where new sessions start when there is no focused session to inherit from. */
  defaultCwd: string
  /** New sessions get --worktree unless told otherwise (⌥-click / menu still flip it). */
  worktreeByDefault: boolean
  /** What ⌘N hands to `--model` and what the chooser starts on: an alias or a full id; '' = no flag (the CLI's own default). */
  defaultModel: string
  /** Terminal font. */
  fontFamily: string
  focusFontSize: number
  tileFontSize: number
  cursorBlink: boolean
  cursorStyle: 'bar' | 'block' | 'underline'
  scrollback: number
  /** Plugin row. */
  showWiki: boolean
  /** The places the Wikipedia tile shows the weather for, the first one large. Edited in the tile; none = no weather. */
  weatherPlaces: WeatherPlace[]
  weatherUnit: TempUnit
  /** The music tile (Spotify.app now playing, or the lofi YouTube stream behind a click). */
  showMusic: boolean
  /** Which face the music tile shows. Spotify by default; the stream never plays until asked. */
  music: MusicSource
  /**
   * What the Spotify face offers to play: playlist / album / artist / track URIs or open.spotify.com
   * links, shown as chips named by Spotify's oEmbed endpoint. Edit in config.json.
   */
  spotifyPlaylists: string[]
  /** The client id of a Spotify app (developer.spotify.com) for connecting an account; '' = no connecting. */
  spotifyClientId: string
  /** The English ⇄ Spanish translator takes the last grid cell (and one session slot). */
  showTranslate: boolean
  /** The reader: Don Quijote in Spanish, select to translate, save to the vocabulary store. */
  showQuixote: boolean
  /** The Studio tile (Gemini image generation: a prompt, references, a gallery; click = the center pane). */
  showStudio: boolean
  /** A Gemini API key (aistudio.google.com) for the Studio. Falls back to $GEMINI_API_KEY. */
  geminiApiKey: string
  /** The Gemini image model the Studio generates with unless a request names one (`STUDIO_MODEL_DEFAULT`). */
  studioModel: string
  /** Google Cloud API key with the Cloud Translation API enabled. Falls back to $GOOGLE_CLOUD_API_KEY. */
  translateApiKey: string
  /** The vocabulary tile (Wiktionary: definitions, synonyms, etymology) takes the grid cell left of the translator. */
  showVocab: boolean
  /** Seconds each vocabulary word stays before the next one. */
  vocabCycleSeconds: number
  /** The Molecule tile (a 3D molecular viewer: 3Dmol.js), which sessions drive through `$DECK_MOL`. */
  showMol: boolean
  /** The Molecule tiles that exist, by number (a viewer and a scene each; `molKey(n)` in the grid). A session adds one with `show … --new`. Never empty. */
  molTiles: number[]
  /** The Lesson tile (a lesson file of the learner's repo as cards), which a teaching session drives through `$DECK_LESSON`. */
  showLesson: boolean
  /** The Lesson tiles that exist, by number (`lessonKey(n)` in the grid). A session adds one with `show … --new`. Never empty. */
  lessonTiles: number[]
  /** The registered web apps (Village, …): a tile each while `show`, the center column on click. */
  webApps: WebApp[]
  /** The Pokemon tile (Game Boy Color emulator: serverboy). */
  showPokemon: boolean
  /** Where to look for .gbc/.gb ROMs. */
  pokemonRomDir: string
  /** The sprite gag (Village vs Notes): main runs `trainer.mjs sprite watch` as a child of its own, repainting every battle. */
  spriteGag: boolean
  /** Which moveset the sprite gag gives Village (a key of plugin/data/sprites/movesets.json: update, release, gamer, download). */
  spriteGagMoves: string
  /** The changes tile (the focused session's working tree as `git status` + diffs) takes the grid cell before the vocabulary tile. */
  showGit: boolean
  /** languagelog's SQLite file; its single-word translations join the vocabulary supply. '' = skip. */
  languagelogDb: string
  /** Foxtrot barks (slay's silent comic bursts) when a session starts needing you or finishes a turn. */
  foxBark: boolean
  /** Serve the phone page (main/remote.ts) on the tailnet / LAN. Off = the server is not listening. */
  remote: boolean
}

export const DEFAULT_SETTINGS: DeckSettings = {
  theme: 'cream',
  appearance: 'system',
  glassDate: '',
  compact: false,
  gridColumns: 1,
  gridRows: 4,
  gridOrder: { left: [], right: [] },
  focusWidth: 'third',
  attentionFirst: true,
  confirmKill: true,
  defaultCwd: '',
  worktreeByDefault: false,
  defaultModel: '',
  fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
  focusFontSize: 13,
  tileFontSize: 9,
  cursorBlink: true,
  cursorStyle: 'bar',
  scrollback: 5000,
  showWiki: true,
  weatherPlaces: [WEATHER_PLACE_DEFAULT],
  weatherUnit: 'F',
  showMusic: true,
  music: 'spotify',
  spotifyPlaylists: [
    'spotify:playlist:37i9dQZF1DWWQRwui0ExPn', // lofi beats
    'spotify:playlist:37i9dQZF1DX8Uebhn9wzrS', // chill lofi study beats
    'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ', // Deep Focus
    'spotify:playlist:37i9dQZF1DX4sWSpwq3LiO', // Peaceful Piano
    'spotify:playlist:37i9dQZF1DX0SM0LYsmbMT' // Jazz Vibes
  ],
  spotifyClientId: '',
  showTranslate: true,
  showQuixote: true,
  showStudio: true,
  geminiApiKey: '',
  studioModel: 'gemini-3.1-flash-image',
  translateApiKey: '',
  showVocab: true,
  vocabCycleSeconds: 30,
  showMol: false,
  molTiles: [1],
  showLesson: false,
  lessonTiles: [1],
  webApps: WEB_APPS_DEFAULT,
  showPokemon: false,
  pokemonRomDir: '~/Downloads',
  spriteGag: false,
  spriteGagMoves: 'download',
  showGit: true,
  languagelogDb: '~/languagelog/data/languagelog.db',
  foxBark: true,
  remote: true
}

/**
 * A grid tile's view of a conversation, tailed from the session's transcript
 * (~/.claude/projects/<cwd>/<claudeSessionId>.jsonl) by main/transcript.ts. Only what a
 * glance needs: your prompts, Claude's prose (markdown), and one line per tool call.
 */
export type ChatBlock =
  | { kind: 'user'; text: string; ts: number }
  | { kind: 'text'; text: string; ts: number }
  | { kind: 'tool'; id: string; name: string; label: string; ts: number; done: boolean; error: boolean; /** The path the call names, when it names one: the label opens it in the preview pane. */ path?: string }

export interface Transcript {
  id: string
  /** The most recent blocks (main keeps the tail; see TRANSCRIPT_KEEP). */
  blocks: ChatBlock[]
  /** Claude's own title for the conversation, once it has one. */
  title: string | null
  /** True once the transcript file has been found (a fresh session has none until its first prompt). */
  found: boolean
}

/** What the preview pane can draw for a referenced path (`main/files.ts`). */
export type FileKind = 'text' | 'markdown' | 'image' | 'pdf' | 'dir' | 'binary' | 'missing'

/** One referenced path, read for the preview pane. */
export interface FileDoc {
  /** Absolute, resolved from the reference and the session's cwd. */
  path: string
  name: string
  kind: FileKind
  size: number
  /** Modified time, ms since the epoch (0 when the path is missing). */
  mtime: number
  /** Text kinds: the file, cut off at the cap (`truncated` then says so). */
  text?: string
  truncated?: boolean
  /** Image / PDF: the bytes, which the renderer turns into a blob URL. */
  bytes?: Uint8Array
  mime?: string
  /** Directories: what is in them, directories first. */
  entries?: { name: string; dir: boolean }[]
  /** Why there is nothing to draw (missing, binary, too big), or what was left out. */
  note?: string
}

/** Which of Foxtrot's senses saw something (main/foxtrot.ts). */
export type FoxKind = 'boot' | 'opened' | 'closed' | 'prompt' | 'finished' | 'blocked' | 'unread' | 'collision' | 'errors' | 'died'

/**
 * One of Foxtrot's observations, from the head in the top bar. A `bark` is something that
 * wants you (the top bar shows the last three and he barks); a `note` is the running log,
 * seen in the history. Kept in userData/foxtrot.jsonl.
 */
export interface FoxEntry {
  id: string
  ts: number
  level: 'bark' | 'note'
  kind: FoxKind
  text: string
  /** Deck ids of the sessions it is about: chips that focus them while they are open. */
  sessions: string[]
  /** Files it is about: chips that open the preview pane. */
  paths?: string[]
}

/**
 * How to reach this deck from a phone (main/remote.ts): the address to open, a QR of it, and
 * whether Tailscale is up. `url` carries the token in its fragment; the page keeps it.
 */
export interface RemoteInfo {
  /** The server is listening (the `remote` setting is on and the port was free). */
  listening: boolean
  port: number
  /** The address to open, token included, or '' when there is no usable one. */
  url: string
  /** The same as a PNG data: URL, or '' when there is no url. */
  qr: string
  /** Tailscale's MagicDNS name for this Mac ('' when logged out / not installed). */
  tailscaleHost: string
  /** Tailscale's IPv4 for this Mac ('' when logged out / not installed). */
  tailscaleIp: string
  /** A LAN address, as a fallback when Tailscale is down ('' when none). */
  lanIp: string
  tailscale: 'up' | 'down' | 'missing'
}

/** One session's terminal as tmux has it right now (`capture-pane -e`), for the phone's screen view. */
export interface Screen {
  id: string
  /** The visible rows, ANSI SGR sequences included, joined with \n. */
  text: string
  cols: number
  rows: number
  /** The pane is gone (session parked or exited). */
  gone: boolean
}

/** How one path stands in the working tree, for the changes tile (main/git.ts). */
export type GitStatus = 'M' | 'A' | 'D' | 'R' | 'U' | '?'

/** One changed path of a working tree, as `git status` + `git diff HEAD --numstat` see it. */
export interface GitFile {
  /** Relative to the repo root. */
  path: string
  /** Where it was, for a rename. */
  oldPath?: string
  status: GitStatus
  /** Some of the change is in the index. */
  staged: boolean
  /** Not tracked at all (`??`): its diff is the whole file. */
  untracked: boolean
  /** Lines added / removed against HEAD; null when unknown (binary, unreadable, no HEAD yet). */
  add: number | null
  del: number | null
  binary: boolean
}

/** A working tree's changes at a glance. `repo` is null when `cwd` is not inside a git repository. */
export interface GitChanges {
  /** The folder that was asked about. */
  cwd: string
  /** The repository's top level, or null outside one. */
  repo: string | null
  /** The branch name, else a short commit id when detached, '' with no commit yet. */
  branch: string
  files: GitFile[]
  add: number
  del: number
}

/** One file's diff against HEAD (the whole file, as added, for an untracked one). */
export interface GitDiff {
  path: string
  text: string
  /** Cut off at the cap. */
  truncated: boolean
}

/** One-shot UI requests from the main process (menu items) to the renderer. */
/* ────────────────────────────── Studio ────────────────────────────── */

/** What the Studio generates with when a request names no model (the `studioModel` setting starts here). */
export const STUDIO_MODEL_DEFAULT = 'gemini-3.1-flash-image'
/** The aspect ratios Gemini's image models take (`imageConfig.aspectRatio`). */
export const STUDIO_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
export type StudioRatio = (typeof STUDIO_RATIOS)[number]
/** Output sizes (`imageConfig.imageSize`); 512 is Flash-only, 4K is slow and costs the most. */
export const STUDIO_SIZES = ['512', '1K', '2K', '4K'] as const
export type StudioSize = (typeof STUDIO_SIZES)[number]
/** The most reference images one request may carry. */
export const STUDIO_REFS_MAX = 10

/** One generation asked of the Studio (the tile, the pane, or a session through `POST /studio`). */
export interface StudioRequest {
  prompt: string
  /** A Gemini model id; absent = the `studioModel` setting. */
  model?: string
  ratio?: StudioRatio
  size?: StudioSize
  /** Absolute paths of images to send along (a photo, an earlier result, a sprite sheet); `~/` is allowed. */
  refs?: string[]
  /** Groups jobs in the gallery (a comic's name, say). */
  tag?: string
  /** A word or two for the file's name (slugged); absent = the prompt's first words. */
  name?: string
  /** Where the request came from. */
  from?: 'tile' | 'pane' | 'cli'
  /** Deck id of the session that asked (a `cli` request), so the gallery can say whose it was. */
  session?: string
}

/** A generation, as kept in `userData/studio/jobs.json` and shown in the gallery (newest first). */
export interface StudioJob {
  id: string
  /** When it was asked, ms since the epoch. */
  at: number
  /** How long the model took, once done. */
  ms?: number
  status: 'running' | 'done' | 'error'
  prompt: string
  model: string
  ratio: StudioRatio
  size: StudioSize
  refs: string[]
  tag?: string
  name?: string
  from: 'tile' | 'pane' | 'cli'
  session?: string
  /** Absolute path of the image written (`userData/studio/<stamp>-<slug>.png`). */
  image?: string
  mime?: string
  /** Whatever prose the model returned beside the image (a refusal, a note). */
  text?: string
  error?: string
}

/** A Gemini model that can return images, from the API's model list. */
export interface StudioModel {
  id: string
  name: string
  description: string
}

/** The Studio's standing: whether a key is set (and where from), where images go, the default model. */
export interface StudioInfo {
  ready: boolean
  keySource: 'settings' | 'env' | 'none'
  dir: string
  model: string
}

export type UiEvent = { type: 'openSettings' } | { type: 'closeOverlays' } | { type: 'toggleFoxLog' } | { type: 'toggleStudio' } | { type: 'togglePokemon' } | { type: 'toggleMol' } | { type: 'toggleLesson' } | { type: 'toggleQuixote' } | { type: 'toggleWeb'; id?: string }

/** One of the account's rate-limit windows: how much of it is used (0–100) and when it starts over (ms). */
export interface UsageWindow {
  pct: number
  resetsAt: number
}

/** Usage as Claude Code reports it (main/usage.ts): the account's two windows (null = not known: no subscriber, or nothing said yet) and each session's context %. */
export interface DeckUsage {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  /** When a window last changed (ms; 0 = never). */
  at: number
  /** Deck session id → % of its context window in use. */
  context: Record<string, number>
}

export interface DeckApi {
  getState(): Promise<DeckState>
  onState(cb: (state: DeckState) => void): () => void
  command(cmd: DeckCommand): Promise<{ ok: true } | { ok: false; error: string }>
  /** The `new` command with the record back: its deck id and slot. Rejects with the reason (the cap, a missing folder). Not on the phone. */
  newSession(req: NewSessionRequest): Promise<{ id: string; slot: number }>
  ptyInput(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string) => void): () => void
  setTitle(id: string, title: string): void
  bell(id: string): void
  /** The tile view of a session's conversation (null until main has looked). `agent:<id>` is a subagent's. */
  getTranscript(id: string): Promise<Transcript | null>
  onTranscript(cb: (t: Transcript) => void): () => void
  /**
   * The path to paste for a File dropped onto the window: its own if it will stay put, else a
   * copy main keeps (a macOS screenshot thumbnail is a promise fulfilled into a temp dir; an
   * image dragged out of a page has no path at all). Null when there is nothing usable.
   */
  keepDroppedFile(file: File): Promise<string | null>
  /**
   * Wikipedia's picture of the day: today's (null if the feed has none), or with 'past' one from a
   * random day of the archive (falls back to today's when the archive misses). Cached in main.
   */
  wikiPicture(when?: 'today' | 'past'): Promise<WikiPicture | null>
  /** The glass backdrop for a day ('' = today's). */
  wikiBackdrop(date: string): Promise<WikiBackdrop | null>
  /** Full-text search of English Wikipedia, up to a dozen hits. */
  wikiSearch(q: string): Promise<WikiHit[]>
  /** The lead section of one page, by key. */
  wikiSummary(key: string): Promise<WikiSummary>
  /** The weather now at every place of the `weatherPlaces` setting, in order. Cached 10 min in main. */
  weather(): Promise<WeatherNow[]>
  /** Places by name ("Portland, Maine"), for the tile's "add a place" line. */
  weatherSearch(q: string): Promise<WeatherPlace[]>
  /** Spotify.app's state, now and on every change (main polls it while the tile is showing). */
  onSpotify(cb: (state: SpotifyState) => void): () => void
  spotify(cmd: SpotifyCommand): void
  /** Start a playlist / album / artist / track in Spotify.app (launches it if needed). */
  spotifyPlay(uri: string): void
  /** The `spotifyPlaylists` setting with names, resolved once each via Spotify's oEmbed. */
  spotifyItems(): Promise<SpotifyItem[]>
  /** The connected account, now and whenever it changes (connect / disconnect / a revoked grant). */
  onSpotifyAccount(cb: (a: SpotifyAccount) => void): () => void
  /** Open Spotify's consent page in the browser; resolves once the account is stored (rejects on refusal / timeout). */
  spotifyConnect(): Promise<SpotifyAccount>
  spotifyDisconnect(): void
  /** The account's recent contexts and playlists (cached 5 min in main). Rejects when not connected. */
  spotifyLibrary(): Promise<SpotifyLibrary>
  /** Tracks, playlists, albums and artists for a query, through the account. */
  spotifySearch(q: string): Promise<SpotifyItem[]>
  /**
   * Read a referenced path for the preview pane: `~/x`, `/x`, `x/y` against `cwd`, or a
   * file: URL. Never rejects — a missing or unshowable file comes back with a note.
   */
  readDoc(ref: string, cwd?: string): Promise<FileDoc>
  /** Hand the path to macOS (Preview for a PDF, whatever else owns the type). Resolves an error string, '' when it opened. */
  openPath(path: string): Promise<string>
  /** Reveal the path in Finder. */
  revealPath(path: string): void
  /** Put text on the clipboard (the preview pane's "copy path"). */
  copyText(text: string): void
  openExternal(url: string): void
  /**
   * Detect whether `text` is English or Spanish and translate it to the other one. `hint` is the
   * box it was typed into; it only breaks ties when detection is unsure. `fixed`: the text is
   * `hint`'s language, no detecting (the reader).
   */
  translate(text: string, hint: Lang, fixed?: boolean): Promise<TranslateResult>
  /** Dictionary + thesaurus + etymology for a word and its counterpart in the other language. */
  /** `counterpart` = the other-language headword to use instead of translating (the list's SAT word). */
  vocab(word: string, hint: Lang, counterpart?: string): Promise<VocabResult>
  /** The vocabulary builder's supply: bundled frequency lemmas + the user's languagelog words. */
  vocabWords(): Promise<VocabWord[]>
  /**
   * Store a settled translation; resolves its row id. Pass the id this same edit produced
   * earlier to overwrite that fragment instead of keeping both.
   */
  saveTranslation(r: TranslateResult, supersede: number | null): Promise<number>
  /** Store a word the vocabulary tile showed, linked to the translation it came from, if any. */
  saveWord(r: VocabResult, translationId: number | null, extra?: WordExtra): Promise<SavedWord>
  /** Every liked word's Spanish forms (the headword and the inflection it was met as), for the reader's marks. */
  savedForms(): Promise<SavedForm[]>
  /** The vocabulary store changed (any tile, or the phone): cards, the list and the reader's marks refresh. */
  onVocabChanged(cb: (c: VocabChange) => void): () => void
  /** The reader's book: every section's heading and length (fetched from Gutenberg once, then from userData). */
  quixoteIndex(): Promise<QuixoteIndex>
  quixoteSection(i: number): Promise<QuixoteSection>
  /** The ♥ on the vocabulary card. */
  setWordLiked(id: number, liked: boolean): Promise<void>
  /** The flash-card deck: what is due first, then whatever comes soonest, entries included. */
  vocabDeck(limit?: number): Promise<StoredWord[]>
  /** Every stored word for the review list, soonest due first. */
  vocabList(limit?: number): Promise<StoredWord[]>
  /** Grade one card (0 again, 3 hard, 4 good, 5 easy); resolves where SM-2 put it. */
  gradeWord(id: number, grade: number): Promise<WordSchedule>
  vocabStats(): Promise<VocabStats>
  getSettings(): Promise<DeckSettings>
  /** Merge a partial into the settings; main persists and broadcasts the result. */
  setSettings(patch: Partial<DeckSettings>): Promise<DeckSettings>
  onSettings(cb: (s: DeckSettings) => void): () => void
  /** Folder picker for the default cwd setting. Resolves '' when cancelled. */
  chooseDefaultCwd(): Promise<string>
  /** A folder picker that only answers (the launcher keeps the pick in its form). `title` heads the dialog. Resolves '' when cancelled. Not on the phone. */
  chooseDir(title?: string): Promise<string>
  /** The account's rate-limit windows and each session's context, as the sessions' status lines report them (main/usage.ts). Not on the phone. */
  usage(): Promise<DeckUsage>
  onUsage(cb: (u: DeckUsage) => void): () => void
  /** Every subagent of every open session, running or lately finished (main/agents.ts). */
  agents(): Promise<AgentView[]>
  onAgents(cb: (agents: AgentView[]) => void): () => void
  /** Foxtrot's log, newest last (the last `limit`, default 500). */
  foxLog(limit?: number): Promise<FoxEntry[]>
  /** Each new observation as Foxtrot makes it. */
  onFoxEntry(cb: (e: FoxEntry) => void): () => void
  onUi(cb: (ev: UiEvent) => void): () => void
  /** The phone address (the pairing popover). */
  remoteInfo(): Promise<RemoteInfo>
  /** The session's terminal as tmux has it right now, colors included (the phone's screen view). */
  screen(id: string): Promise<Screen>
  /**
   * The working tree of a session (the folder its pane is in, so a worktree session reads its
   * worktree): every changed path with its line counts. Never rejects for a folder outside a
   * repository (`repo` is null then).
   */
  gitChanges(id: string): Promise<GitChanges>
  /** One file's diff against HEAD, within `repo` (untracked = the whole file as additions). */
  gitDiff(repo: string, path: string, untracked: boolean): Promise<GitDiff>
  /** The Studio (main/studio.ts): every job, newest first. */
  studioJobs(): Promise<StudioJob[]>
  /** The whole list again whenever a job starts, finishes or is deleted. */
  onStudio(cb: (jobs: StudioJob[]) => void): () => void
  /** Generate; resolves with the finished (or failed) job. The running one is already in `onStudio` lists. */
  studioGenerate(req: StudioRequest): Promise<StudioJob>
  /** Forget a job and delete its image. */
  studioDelete(id: string): Promise<void>
  /** The image-capable Gemini models the key can see (cached in main). */
  studioModels(): Promise<StudioModel[]>
  studioInfo(): Promise<StudioInfo>
  /** List .gbc/.gb ROM files in the configured ROM directory. */
  pokemonListRoms(): Promise<{ name: string; path: string }[]>
  /** Read a ROM file and return its bytes + sanitized name. */
  pokemonLoadRom(path: string): Promise<{ bytes: Uint8Array; name: string }>
  /** Persist battery save (SRAM) data for a ROM. */
  pokemonSaveSram(name: string, data: Uint8Array): Promise<void>
  /** Load battery save data for a ROM (null if none). */
  pokemonLoadSram(name: string): Promise<Uint8Array | null>
  /** Save a full emulator state to a numbered slot (0–2) or under a name (the trainer's checkpoints). */
  pokemonSaveState(name: string, slot: number | string, data: Uint8Array): Promise<void>
  /** Load a save state from a slot or a name (null if none). */
  pokemonLoadState(name: string, slot: number | string): Promise<Uint8Array | null>
  /** Write a screenshot's PNG bytes under userData/pokemon/trainer and return its path (a small rotation of files). */
  pokemonShot(bytes: Uint8Array): Promise<string>
  /** A small JPEG (a data: URL) of a web app's webview as it looks now, for its tile; '' when there is nothing to take. */
  webSnap(webContentsId: number): Promise<string>
  /** The trainer's door: main relays `POST /gameboy` here; the renderer answers with `gameboyReply`. */
  onGameboy(cb: (req: GameboyRequest) => void): () => void
  gameboyReply(id: string, result: unknown): void
  /** The Molecule tile: a target (library name, PDB id, AF-<uniprot>, a name, smiles:, a path) → its structure text. Main fetches and caches. */
  molResolve(target: string): Promise<MolStructure>
  /** The built-in library, for the empty tile's chips. */
  molLibrary(): Promise<MolLibraryItem[]>
  /** Write the viewer's PNG to userData/mol/look-<tile>.png and return its path (`look`). */
  molShot(bytes: Uint8Array, tile?: number): Promise<string>
  /** The Molecule tile's door: main relays `POST /mol` here (structures already resolved); the renderer answers with `molReply`. */
  onMol(cb: (req: MolRequest) => void): () => void
  molReply(id: string, result: unknown): void
  /** The Lesson tile: a lesson file's text (an absolute .md, 1MB at most). Main reads; the renderer parses (shared/lesson.ts). Rejects with what to fix. */
  lessonRead(file: string): Promise<LessonFile>
  /** A `fig` block's image: `src` relative to the lesson file, inside its folder tree. */
  lessonFigure(file: string, src: string): Promise<LessonFigure>
  /** The home view: `curriculum.json` of the session's folder (the pane's own cwd, like the changes tile), else of `fallback` (the folder it was last found in). */
  lessonCurriculum(sessionId: string | null, fallback?: string): Promise<CurriculumRead>
  /** Which lesson files are up in some tile: main watches those and re-sends a changed one (`onLessonChanged`). */
  lessonWatch(files: string[]): void
  onLessonChanged(cb: (f: LessonFile) => void): () => void
  /** A `mol` block's button: its lines through the SAME path as `POST /mol`, in order, stopping at the first refusal. */
  lessonMol(run: LessonMolRun): Promise<LessonMolResult>
  /** The Lesson tile's door: main relays `POST /lesson` here (the file already read); the renderer answers with `lessonReply`. */
  onLesson(cb: (req: LessonRequest) => void): () => void
  lessonReply(id: string, result: unknown): void
}

/** A lesson file as main read it. */
export interface LessonFile {
  file: string
  text: string
  mtime: number
}
export type LessonFigure = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string }
/** `<dir>/curriculum.json`: `data` null = none there (`error` when it is there and does not parse). */
export interface CurriculumRead {
  dir: string
  data: Curriculum | null
  error?: string
}
/** One press of a lesson's mol button. `key` names the button (file, card, block), so its `--new` reuses the tile it opened last time. */
export interface LessonMolRun {
  file: string
  key: string
  lines: string[]
  tile?: number
  fresh?: boolean
}
export type LessonMolResult = { ok: true; tile: number | null } | { ok: false; error: string }
/** One request through the Lesson tile's door (main/hooks.ts `/lesson` → lib/lesson.ts). */
export interface LessonRequest {
  id: string
  body: Record<string, unknown>
}

export type MolFormat = 'sdf' | 'cif' | 'pdb' | 'mol2' | 'xyz' | 'cube'

/** A structure as main resolved it (main/mol.ts): the text 3Dmol parses, and partial charges in atom order when the source has them. */
export interface MolStructure {
  target: string
  name: string
  formula?: string
  format: MolFormat
  data: string
  source: 'library' | 'rcsb' | 'alphafold' | 'pubchem' | 'file'
  cached: boolean
  charges?: number[]
  chargeMethod?: string
}

export interface MolLibraryItem {
  key: string
  name: string
  formula: string
  atoms: number
}

/** One request through the Molecule tile's door (main/hooks.ts `/mol` → the renderer's viewer). */
export interface MolRequest {
  id: string
  body: Record<string, unknown>
}

/** One request through the trainer's door (main/hooks.ts `/gameboy` → the renderer's emulator). */
export interface GameboyRequest {
  id: string
  body: Record<string, unknown>
}
