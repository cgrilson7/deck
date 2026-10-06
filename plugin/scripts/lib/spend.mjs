// What Claude Code work costs, read off its own transcripts: ONE module for both ends — the deck's
// Spend tile (src/main/spend.ts imports it by relative path, like the renderer imports gbcore.mjs)
// and the ledger CLI (plugin/scripts/ledger.mjs) every deck session can run. Pure: no fs.
//
// A transcript line with `message.usage` is one API response. The CLI writes a streamed response
// more than once under the same `message.id` (with the same usage), so callers count an id once.
// Prices are API LIST prices per million tokens (Sept 2026): on a subscription this is what the
// work WOULD cost on the API, never a bill. A cache write is 1.25× input for the 5-minute cache and
// 2× for the 1-hour one; fast mode is 2× everything.

/** $ per million tokens: in, out, cache read. Longest prefix wins, so dated ids find their model. */
export const PRICES = {
  'claude-fable-5-1': { in: 10, out: 50, read: 0.25 },
  'claude-mythos-5-1': { in: 10, out: 50, read: 0.25 },
  'claude-fable-5': { in: 10, out: 50, read: 1 },
  'claude-mythos-5': { in: 10, out: 50, read: 1 },
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2 },
  'claude-opus-5': { in: 5, out: 25, read: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, read: 0.5 },
  'claude-opus-4-7': { in: 5, out: 25, read: 0.5 },
  'claude-opus-4-6': { in: 5, out: 25, read: 0.5 },
  'claude-opus-4-5': { in: 5, out: 25, read: 0.5 },
  'claude-opus-4': { in: 15, out: 75, read: 1.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2 },
  'claude-sonnet-5': { in: 2, out: 10, read: 0.2 },
  'claude-sonnet-4': { in: 3, out: 15, read: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, read: 0.1 },
}
const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length)

/** The price row for a model id, or null for one we do not know (`<synthetic>`, a new model). */
export function priceOf(model) {
  if (typeof model !== 'string') return null
  const k = KEYS.find((p) => model === p || model.startsWith(p + '-') || model.startsWith(p + '['))
  return k ? PRICES[k] : null
}

/** A short name for a model id: `claude-opus-5-5` → `opus 5.5`, `claude-haiku-4-5-20251001` → `haiku 4.5`. */
export function modelName(model) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?=-|\[|$)/.exec(String(model))
  return m ? `${m[1]} ${m[2]}${m[3] ? '.' + m[3] : ''}` : String(model)
}

/**
 * One API response's tokens and list-price cost. `usage` is the transcript's `message.usage`.
 * A model we have no price for is costed as Opus 5.5 and flagged `unpriced`, so a new model shows
 * up as spend rather than as nothing.
 */
export function costOf(model, usage) {
  const u = usage ?? {}
  const known = priceOf(model)
  const p = known ?? PRICES['claude-opus-5-5']
  const write = u.cache_creation_input_tokens ?? 0
  const write1h = Math.min(write, u.cache_creation?.ephemeral_1h_input_tokens ?? 0)
  const write5m = write - write1h
  const input = u.input_tokens ?? 0
  const read = u.cache_read_input_tokens ?? 0
  const output = u.output_tokens ?? 0
  const fast = u.speed === 'fast' ? 2 : 1
  const cost = (fast * (input * p.in + write5m * p.in * 1.25 + write1h * p.in * 2 + read * p.read + output * p.out)) / 1e6
  return { input, write5m, write1h, read, output, cost, unpriced: !known }
}

/**
 * The project a working directory belongs to: a `--worktree` session's
 * `<repo>/.claude/worktrees/<name>/…` is its repo's, so a project's spend is one number.
 */
export function projectOf(cwd) {
  if (typeof cwd !== 'string' || !cwd) return ''
  const i = cwd.indexOf('/.claude/worktrees/')
  return (i >= 0 ? cwd.slice(0, i) : cwd).replace(/\/+$/, '') || '/'
}

/** Where a project keeps its ledger (the fridge's convention, now every project's). */
export const LEDGER_PATH = 'docs/costs/ledger.jsonl'

/** Active time: the gaps between events shorter than this add up; longer ones are someone away. */
export const IDLE_MS = 5 * 60_000
