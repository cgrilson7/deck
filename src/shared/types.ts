// Types shared by main, preload and renderer. Keep this file dependency-free.

/** Hard cap on open (slotted) sessions. Slots are numbered 1..CAP and are sticky. */
export const CAP = 9

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
  gridColumns: number
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
}
