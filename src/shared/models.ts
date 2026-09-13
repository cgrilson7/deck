// The models a new session can be started with: what `claude --model` accepts, as the chooser
// offers them. An alias tracks the latest of its line; a full id pins one. '' = no flag, so
// the CLI's own default (`model` in ~/.claude/settings.json, else the account's) applies.
// Keep this file dependency-free (main, the renderer and the phone all import it).

export interface ModelChoice {
  /** What goes after `--model`; '' for none. */
  id: string
  /** Short, for the chooser and the tile badge. */
  label: string
  /** One line for a tooltip. */
  hint: string
}

export const MODELS: readonly ModelChoice[] = [
  { id: '', label: 'Default', hint: "The CLI's own default: `model` in ~/.claude/settings.json, else your account's" },
  { id: 'fable', label: 'Fable', hint: 'The latest Fable (5.1 today)' },
  { id: 'opus', label: 'Opus', hint: 'The latest Opus (5 today)' },
  { id: 'sonnet', label: 'Sonnet', hint: 'The latest Sonnet' },
  { id: 'haiku', label: 'Haiku', hint: 'The latest Haiku' },
  { id: 'opusplan', label: 'Opus plan', hint: 'Opus while planning, Sonnet for the rest' },
  { id: 'opus[1m]', label: 'Opus 1M', hint: 'The latest Opus with the 1M-token context window' },
  { id: 'sonnet[1m]', label: 'Sonnet 1M', hint: 'The latest Sonnet with the 1M-token context window' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', hint: 'Pinned to Opus 4.6 (legacy; available until at least February 2027)' }
]

/** A model id typed by hand: trimmed, and only the characters an alias or id can have. */
export function cleanModel(v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  return /^[A-Za-z0-9._[\]:-]{1,80}$/.test(s) ? s : ''
}

/** The badge text for a model: the catalog's label, else the id without its `claude-` prefix. */
export function modelLabel(id: string): string {
  const hit = MODELS.find((m) => m.id === id)
  return hit ? hit.label : id.replace(/^claude-/, '')
}
