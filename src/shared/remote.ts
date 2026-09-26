// The wire between main/remote.ts and the phone page (renderer/src/phone): one WebSocket,
// JSON frames both ways. Main pushes the same broadcasts the desktop renderer gets over IPC
// (state, transcripts, settings, Foxtrot's entries, errors); the page calls a subset of the
// DeckApi by name and gets a reply by request id. Keep this file dependency-free.

import type { AgentView, DeckSettings, DeckState, FoxEntry, Transcript, VocabChange } from './types'

/** Ports: `deck` (packaged) and everything else, so a dev instance never collides with the installed app. */
export const REMOTE_PORT = { deck: 47810, other: 47811 } as const

/** DeckApi methods the phone may call. Everything else is desktop-only and rejected. */
export const REMOTE_METHODS = [
  'getState', 'command', 'getTranscript', 'getSettings', 'setSettings', 'readDoc', 'foxLog', 'screen', 'openPath', 'agents',
  // the right drawer's apps: everything they ask for is fetched or stored by main, so it works the same from here
  'wikiPicture', 'wikiSearch', 'wikiSummary', 'weather', 'weatherSearch',
  'translate', 'vocab', 'vocabWords', 'saveTranslation', 'saveWord', 'setWordLiked', 'savedForms', 'vocabDeck', 'vocabList', 'gradeWord', 'vocabStats',
  'quixoteIndex', 'quixoteSection', 'gitChanges', 'gitDiff'
] as const
export type RemoteMethod = (typeof REMOTE_METHODS)[number]

export type RemoteUp =
  /** A DeckApi call; `id` comes back on the reply. */
  | { type: 'call'; id: number; method: RemoteMethod; args: unknown[] }
  /** Keystrokes into a session (DeckApi.ptyInput); never resizes — the desktop owns the size. */
  | { type: 'input'; id: string; data: string }

export type RemoteDown =
  | { type: 'hello'; profile: string }
  | { type: 'state'; state: DeckState }
  | { type: 'transcript'; transcript: Transcript }
  | { type: 'settings'; settings: DeckSettings }
  | { type: 'fox'; entry: FoxEntry }
  | { type: 'agents'; agents: AgentView[] }
  | { type: 'vocab'; change: VocabChange }
  | { type: 'error'; error: string }
  | { type: 'reply'; id: number; ok: true; result: unknown }
  | { type: 'reply'; id: number; ok: false; error: string }
