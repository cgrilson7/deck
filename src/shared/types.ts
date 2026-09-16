// Types shared by main, preload and renderer. Keep this file dependency-free (themes.ts is ours).

import type { Appearance } from './themes'

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
export const PLUGIN_KEYS = ['wiki', 'music', 'git', 'vocab', 'translate'] as const
export type PluginKey = (typeof PLUGIN_KEYS)[number]

/** Which plugin tiles hold a grid cell under these settings (compact mode drops the two fun ones). */
export function pluginCells(s: Pick<DeckSettings, 'compact' | 'showWiki' | 'showMusic' | 'showGit' | 'showVocab' | 'showTranslate'>): PluginKey[] {
  const out: PluginKey[] = []
  if (s.showWiki && !s.compact) out.push('wiki')
  if (s.showMusic && !s.compact) out.push('music')
  if (s.showGit) out.push('git')
  if (s.showVocab) out.push('vocab')
  if (s.showTranslate) out.push('translate')
  return out
}

/** How many tiles one page of the grid holds: both side columns, `gridColumns` wide and `gridRows` tall each. */
export function pageSize(s: Pick<DeckSettings, 'gridColumns' | 'gridRows'>): number {
  return 2 * s.gridColumns * s.gridRows
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
  /** The Agent tool's short description (the tile's name), '' when none was seen. */
  description: string
  /** The task it was given: the prompt's first line, '' until the transcript shows it. */
  task: string
  /** What the Agent call asked for as `model`, '' when unsaid. */
  model: string
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
  createdAt: number
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
  | { type: 'new'; worktree?: boolean; cwd?: string; model?: string }
  | { type: 'chooseFolder'; worktree?: boolean; model?: string }
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
export interface WikiPicture {
  /** The day it was picture of the day, YYYY-MM-DD in local time. */
  date: string
  /** True when it is today's. */
  today: boolean
  title: string
  /** "Photo: …" credit line, '' when the feed has none. */
  credit: string
  imageUrl: string
  /** The file page, opened in the browser on click. */
  url: string
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
   * Where plugin tiles were put: cell index (across pages, left column first) → a plugin key,
   * '' for a cell nothing is pinned to. Sessions and wolfpack members are never pinned: they
   * always fill the first cells in order; then the plugins flow into what is free, pins honored.
   */
  gridLayout: string[]
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
  /** Google Cloud API key with the Cloud Translation API enabled. Falls back to $GOOGLE_CLOUD_API_KEY. */
  translateApiKey: string
  /** The vocabulary tile (Wiktionary: definitions, synonyms, etymology) takes the grid cell left of the translator. */
  showVocab: boolean
  /** Seconds each vocabulary word stays before the next one. */
  vocabCycleSeconds: number
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
  compact: false,
  gridColumns: 1,
  gridRows: 4,
  gridLayout: [],
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
  translateApiKey: '',
  showVocab: true,
  vocabCycleSeconds: 30,
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
export type UiEvent = { type: 'openSettings' } | { type: 'closeOverlays' } | { type: 'toggleFoxLog' }

export interface DeckApi {
  getState(): Promise<DeckState>
  onState(cb: (state: DeckState) => void): () => void
  command(cmd: DeckCommand): Promise<{ ok: true } | { ok: false; error: string }>
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
  /** Full-text search of English Wikipedia, up to a dozen hits. */
  wikiSearch(q: string): Promise<WikiHit[]>
  /** The lead section of one page, by key. */
  wikiSummary(key: string): Promise<WikiSummary>
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
   * box it was typed into; it only breaks ties when detection is unsure.
   */
  translate(text: string, hint: Lang): Promise<TranslateResult>
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
  saveWord(r: VocabResult, translationId: number | null): Promise<SavedWord>
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
}
