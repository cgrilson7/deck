// The wolfpack: an alpha (a session inside the deck, Fable as a rule) spawns betas (Opus
// sessions, one per track of work), each a real deck session in a grid cell of its own behind
// the sessions, and later asks after them, talks to them, and dismisses them. The calls come over the
// hooks server (`POST /pack`, hooks.ts) from scripts/wolfpack.mjs, run by the alpha's own Bash
// tool, which identifies itself by CLAUDE_CODE_SESSION_ID (the UUID handed to --session-id)
// or, failing that, by its tmux pane.
//
// Ops, all `{ op, alpha? , pane?, ... }`:
//   spawn    { betas: [{ task, prompt, cwd?, worktree?, model?, permissionMode? }] } → the betas made
//   status   → every open beta with its status, transcript path and last words
//   say      { beta, text } → paste + ⏎ into one beta
//   dismiss  { park?, betas? } → kill (or park) the pack, or just the betas named

import { existsSync } from 'node:fs'
import { BETA_SLOT_BASE, PACK_MAX, type AgentView, type SessionRecord, type SessionView } from '@shared/types'
import { cleanModel } from '@shared/models'
import type { AgentTracker } from './agents'
import type { SessionManager } from './sessions'
import type { Tmux } from './tmux'
import type { TranscriptWatcher } from './transcript'

/** What a beta may be asked to run as; anything else falls back to Opus (the point of the pack). */
const DEFAULT_MODEL = 'opus'
const TASK_MAX = 60
const PROMPT_MAX = 200_000

interface BetaSpec {
  task: string
  prompt: string
  cwd?: string
  worktree?: boolean
  model?: string
  permissionMode?: string
}

interface PackBody {
  op?: unknown
  alpha?: unknown
  pane?: unknown
  betas?: unknown
  beta?: unknown
  text?: unknown
  park?: unknown
}

export interface BetaStatus {
  id: string
  task: string
  slot: number
  status: SessionView['status']
  attention: boolean
  tmuxAlive: boolean
  claudeSessionId: string
  cwd: string
  model: string
  /** The transcript file, once the CLI has written it. */
  transcript: string | null
  /** Claude's latest prose in the transcript, for a glance; null before any. */
  lastText: string | null
  /** The last tool call's line ("Edit src/x.ts"), null before any. */
  lastTool: string | null
  /** How many blocks main is holding for it (its tail). */
  blocks: number
  /** The beta's own subagents (SubagentStart / SubagentStop hooks), if it ran any. */
  agents: AgentView[]
}

export class Wolfpack {
  constructor(
    private readonly manager: SessionManager,
    private readonly tmux: Tmux,
    private readonly transcripts: () => TranscriptWatcher | null,
    private readonly agents: () => AgentTracker | null
  ) {}

  async handle(raw: unknown): Promise<unknown> {
    const body = (raw && typeof raw === 'object' ? raw : {}) as PackBody
    const alpha = await this.resolveAlpha(body)
    switch (body.op) {
      case 'spawn':
        return this.spawn(alpha, body)
      case 'status':
        // The alpha's own subagents ride along too: the same tiles, seen from the other side.
        return { ok: true, alpha: this.alphaInfo(alpha), agents: this.agentsOf(alpha.id), betas: this.status(alpha) }
      case 'say':
        return this.say(alpha, body)
      case 'dismiss':
        return this.dismiss(alpha, body)
      default:
        throw new Error(`unknown op: ${String(body.op)} (spawn, status, say, dismiss)`)
    }
  }

  // ---- ops -----------------------------------------------------------------

  private async spawn(alpha: SessionRecord, body: PackBody): Promise<unknown> {
    if (alpha.pack) throw new Error('a beta cannot spawn a pack of its own')
    const specs = parseBetas(body.betas)
    const have = this.manager.betasOf(alpha.id).length
    if (have + specs.length > PACK_MAX) throw new Error(`a pack holds at most ${PACK_MAX} betas (${have} already open, ${specs.length} asked for)`)
    const home = (await this.manager.liveCwd(alpha.id)) ?? alpha.cwd
    const made: { id: string; slot: number; task: string; claudeSessionId: string; cwd: string; tmux: string; model: string }[] = []
    for (const spec of specs) {
      const cwd = spec.cwd ?? home
      if (!existsSync(cwd)) throw new Error(`folder does not exist: ${cwd} (beta "${spec.task}")`)
      const rec = await this.manager.newSession({
        cwd,
        worktree: spec.worktree ?? false,
        model: spec.model ?? DEFAULT_MODEL,
        pack: { alpha: alpha.id, task: spec.task },
        name: spec.task,
        prompt: spec.prompt,
        permissionMode: spec.permissionMode
      })
      made.push({ id: rec.id, slot: rec.slot!, task: spec.task, claudeSessionId: rec.claudeSessionId, cwd, tmux: rec.tmuxName, model: rec.model ?? '' })
    }
    return { ok: true, alpha: this.alphaInfo(alpha), betas: made }
  }

  private status(alpha: SessionRecord): BetaStatus[] {
    const tw = this.transcripts()
    return this.manager.betasOf(alpha.id).map((rec) => {
      const v = this.manager.view(rec.id)
      const t = tw?.get(rec.id) ?? null
      let lastText: string | null = null
      let lastTool: string | null = null
      for (const b of t?.blocks ?? []) {
        if (b.kind === 'text') lastText = b.text
        else if (b.kind === 'tool') lastTool = `${b.name} ${b.label}`.trim()
      }
      return {
        id: rec.id,
        task: rec.pack?.task ?? rec.name,
        slot: rec.slot ?? BETA_SLOT_BASE,
        status: v?.status ?? 'unknown',
        attention: v?.attention ?? false,
        tmuxAlive: v?.tmuxAlive ?? false,
        claudeSessionId: rec.claudeSessionId,
        cwd: rec.cwd,
        model: rec.model ?? '',
        transcript: tw?.pathOf(rec.id) ?? null,
        lastText,
        lastTool,
        blocks: t?.blocks.length ?? 0,
        agents: this.agentsOf(rec.id)
      }
    })
  }

  private agentsOf(parent: string): AgentView[] {
    return (this.agents()?.list() ?? []).filter((a) => a.parent === parent)
  }

  private say(alpha: SessionRecord, body: PackBody): unknown {
    const beta = this.betaOf(alpha, body.beta)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) throw new Error('nothing to say: `text` is empty')
    if (text.length > PROMPT_MAX) throw new Error(`text is over ${PROMPT_MAX} characters`)
    this.manager.paste(beta.id, text)
    return { ok: true, beta: beta.id }
  }

  private async dismiss(alpha: SessionRecord, body: PackBody): Promise<unknown> {
    const park = body.park === true
    const only = Array.isArray(body.betas) ? body.betas.map((b) => this.betaOf(alpha, b).id) : undefined
    const before = this.manager.betasOf(alpha.id).filter((b) => !only || only.includes(b.id)).map((b) => b.id)
    await this.manager.dismissPack(alpha.id, park, only)
    return { ok: true, [park ? 'parked' : 'killed']: before }
  }

  // ---- who is asking ---------------------------------------------------------

  /** The caller: by the Claude session id it was started with, else by its tmux pane. Must be open. */
  private async resolveAlpha(body: PackBody): Promise<SessionRecord> {
    let rec: SessionRecord | null = null
    if (typeof body.alpha === 'string' && body.alpha) rec = this.manager.find({ claudeSessionId: body.alpha }) ?? this.manager.find({ id: body.alpha })
    if (!rec && typeof body.pane === 'string' && body.pane) {
      const name = await this.tmux.sessionOfPane(body.pane)
      if (name) rec = this.manager.find({ tmuxName: name })
    }
    if (!rec) throw new Error('not a deck session: pass `alpha` (CLAUDE_CODE_SESSION_ID) or `pane` ($TMUX_PANE) of a session this deck runs')
    if (rec.slot === null) throw new Error('the alpha is parked')
    return rec
  }

  private betaOf(alpha: SessionRecord, ref: unknown): SessionRecord {
    const id = typeof ref === 'string' ? ref : ''
    const beta = this.manager.betasOf(alpha.id).find((b) => b.id === id || b.claudeSessionId === id || b.pack?.task === id)
    if (!beta) throw new Error(`no open beta "${id}" in this pack`)
    return beta
  }

  private alphaInfo(alpha: SessionRecord) {
    return { id: alpha.id, slot: alpha.slot, claudeSessionId: alpha.claudeSessionId, cwd: alpha.cwd }
  }
}

function parseBetas(raw: unknown): BetaSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('`betas` must be a non-empty array of { task, prompt, … }')
  const seen = new Set<string>()
  return raw.map((b, i) => {
    const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
    const task = typeof o.task === 'string' ? o.task.trim().slice(0, TASK_MAX) : ''
    const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : ''
    if (!task) throw new Error(`beta ${i + 1}: \`task\` (a short name) is required`)
    if (!prompt) throw new Error(`beta "${task}": \`prompt\` is required`)
    if (prompt.length > PROMPT_MAX) throw new Error(`beta "${task}": prompt is over ${PROMPT_MAX} characters`)
    if (seen.has(task)) throw new Error(`two betas named "${task}"; tasks must be distinct`)
    seen.add(task)
    const spec: BetaSpec = { task, prompt }
    if (typeof o.cwd === 'string' && o.cwd.trim()) spec.cwd = o.cwd.trim()
    if (typeof o.worktree === 'boolean') spec.worktree = o.worktree
    if (typeof o.model === 'string' && cleanModel(o.model)) spec.model = cleanModel(o.model)
    if (typeof o.permissionMode === 'string' && /^[A-Za-z]{1,32}$/.test(o.permissionMode)) spec.permissionMode = o.permissionMode
    return spec
  })
}
