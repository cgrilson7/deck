// Types shared by main, preload and renderer. Keep this file dependency-free (themes.ts is ours).

import type { Appearance } from './themes'

/** Hard cap on open (slotted) sessions: the focus pane + six grid tiles. Slots 1..CAP are sticky. */
export const CAP = 7

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
  createdAt: number
  /** 1..CAP while open, null while parked (detached or exited). Sticky while open. */
  slot: number | null
  /** Last known name: fleet listing name, else terminal title, else a placeholder. */
  name: string
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
}

export interface DeckState {
  cap: number
  focusSlot: number | null
  open: SessionView[]
  parked: SessionView[]
  /** Which tmux socket / profile this instance runs on (deck or deck-dev). */
  profile: string
}

export type DeckCommand =
  | { type: 'new'; worktree?: boolean; cwd?: string }
  | { type: 'chooseFolder'; worktree?: boolean }
  | { type: 'resume'; id: string }
  | { type: 'focus'; slot: number }
  | { type: 'cycle'; dir: 1 | -1 }
  | { type: 'jumpAttention' }
  | { type: 'detach'; slot: number }
  | { type: 'kill'; id: string }
  | { type: 'forget'; id: string }
  /** Reload the renderer and reattach every tmux client so the terminals redraw. Sessions keep running. */
  | { type: 'refreshUi' }

/** One card in the Wikipedia tile, from the featured-content feed. */
export interface WikiItem {
  kind: 'potd' | 'tfa' | 'onthisday' | 'mostread'
  /** Small label over the title: "picture of the day", "on this day · 1969", ... */
  tag: string
  title: string
  summary: string
  imageUrl: string
  /** Opened in the browser on click. */
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

/** Everything the user can change from the settings panel. Persisted in userData/config.json. */
export interface DeckSettings {
  /** Theme family id (see shared/themes.ts). */
  theme: string
  /** Light, dark, or follow macOS. */
  appearance: Appearance
  /** Compact mode: tighter chrome, smaller headers, plugin row hidden. */
  compact: boolean
  /** Grid columns for the six tiles (1..3). */
  gridColumns: number
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
  /** Terminal font. */
  fontFamily: string
  focusFontSize: number
  tileFontSize: number
  cursorBlink: boolean
  cursorStyle: 'bar' | 'block' | 'underline'
  scrollback: number
  /** Plugin row. */
  showWiki: boolean
  showYouTube: boolean
  /** Seconds between Wikipedia cards. */
  wikiCycleSeconds: number
  /** The English ⇄ Spanish translator takes the last grid cell (and one session slot). */
  showTranslate: boolean
  /** Google Cloud API key with the Cloud Translation API enabled. Falls back to $GOOGLE_CLOUD_API_KEY. */
  translateApiKey: string
  /** The vocabulary tile (Wiktionary: definitions, synonyms, etymology) takes the grid cell left of the translator. */
  showVocab: boolean
  /** Seconds each vocabulary word stays before the next one. */
  vocabCycleSeconds: number
  /** languagelog's SQLite file; its single-word translations join the vocabulary supply. '' = skip. */
  languagelogDb: string
  /** Foxtrot barks (slay's silent comic bursts) when a session starts needing you or finishes a turn. */
  foxBark: boolean
}

export const DEFAULT_SETTINGS: DeckSettings = {
  theme: 'cream',
  appearance: 'system',
  compact: false,
  gridColumns: 2,
  focusWidth: 'third',
  attentionFirst: true,
  confirmKill: true,
  defaultCwd: '',
  worktreeByDefault: false,
  fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
  focusFontSize: 13,
  tileFontSize: 9,
  cursorBlink: true,
  cursorStyle: 'bar',
  scrollback: 5000,
  showWiki: true,
  showYouTube: true,
  wikiCycleSeconds: 20,
  showTranslate: true,
  translateApiKey: '',
  showVocab: true,
  vocabCycleSeconds: 30,
  languagelogDb: '~/languagelog/data/languagelog.db',
  foxBark: true
}

/** One-shot UI requests from the main process (menu items) to the renderer. */
export type UiEvent = { type: 'openSettings' } | { type: 'closeOverlays' }

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
  /** Absolute path of a File dropped onto the window ('' if it has none). */
  pathForFile(file: File): string
  /** Today's Wikipedia featured content, only items that have an image. Cached in main. */
  wikiFeatured(): Promise<WikiItem[]>
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
  vocabStats(): Promise<VocabStats>
  getSettings(): Promise<DeckSettings>
  /** Merge a partial into the settings; main persists and broadcasts the result. */
  setSettings(patch: Partial<DeckSettings>): Promise<DeckSettings>
  onSettings(cb: (s: DeckSettings) => void): () => void
  /** Folder picker for the default cwd setting. Resolves '' when cancelled. */
  chooseDefaultCwd(): Promise<string>
  onUi(cb: (ev: UiEvent) => void): () => void
}
