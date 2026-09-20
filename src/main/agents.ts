// Subagents as tiles, and the leash on the pack. A session's Agent-tool calls (and the agents a
// Workflow runs) are reported by the CLI's SubagentStart / SubagentStop hooks (agent_id,
// agent_type; the stop adds agent_transcript_path + last_assistant_message), and each one's
// transcript is the same JSONL as a session's own, under `<projects>/<cwd>/<sessionId>/subagents/`:
//   agent-<id>.jsonl                          an Agent-tool subagent
//   workflows/wf_<runId>/agent-<id>.jsonl     an agent a Workflow runs (type `workflow-subagent`)
// each with a sidecar `agent-<id>.meta.json` (agentType, description, model; a Workflow's also
// workflowPhase). So a running subagent is a conversation the deck can tail like any tile: this
// tracker keeps the list, hands the files to the TranscriptWatcher under `agent:<id>`, and
// broadcasts the list; every agent is a grid cell of its own.
//
// WHERE the file is cannot be known at SubagentStart — neither it nor (for a Workflow) its run's
// folder need exist yet — so nothing is guessed: an agent's `path` stays null and `resolve()` looks
// again (RESOLVE_MS, and on its every tool call) until the file is there; the stop hook's
// agent_transcript_path wins whenever it names a file that exists.
//
// Names: SubagentStart says only the type. The parent's own PreToolUse for the `Agent` tool
// carries the call's description, prompt and model, and the SubagentStart that follows is that
// agent — so those are queued per session and matched to the next start of the same type. A
// Workflow's agents have no such call: their name is the sidecar's `description` (the script's
// `label` for that agent), read when the transcript is found, with the phase and model beside it.
// Failing both, a tile takes the prompt's first line once the transcript shows it (a Workflow
// agent's is the harness's preamble, which is why the sidecar matters). A stop for an agent never seen to start (the session began before the
// hooks file had SubagentStart) still gets a tile, finished.
//
// The LEASH: every tool call of every session comes through PreToolUse (hooks.ts) with the
// subagent's id when it is one's, or the session's id when it is a beta's own. A PAUSED member's
// call is held — the hook's response waits until resume — and a CANCELLED member's is refused
// with the user's reason, which the agent reads as its tool result and returns early on. Both
// tell the alpha in its terminal (a message typed while it works reaches it at the next tool
// boundary), the cancel with the reason, so it can fix the brief and relaunch, or drop the track.
//
// Finished agents stay until the parent's next TYPED prompt (a background agent's result comes
// back through UserPromptSubmit too, as a `<task-notification>`, and that one must not count),
// or FINISHED_KEEP_MS, or a × on the tile.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { agentName, type AgentView, type DeckState, type Transcript } from '@shared/types'
import type { HookEvent, HookPayload, PreToolDecision } from './hooks'
import type { SessionManager } from './sessions'
import type { TranscriptWatcher } from './transcript'

interface Agent extends AgentView {
  /** The transcript, null until `resolve()` has SEEN the file (never a guess). */
  path: string | null
  /** The parent's Claude session id and transcript path (when the hook said), which is where to look. */
  sessionId: string
  parentTranscript: string | null
  /** The sidecar has been read (it can land a beat after the transcript). */
  meta: boolean
  /** A pause note was typed into the alpha, so the resume is told too. */
  told: boolean
}

/** The parent's `Agent` call, waiting for the SubagentStart that is it. */
interface PendingCall {
  at: number
  type: string
  description: string
  task: string
  model: string
  background: boolean
}

/** The leash on a beta session (its own tool calls, by its Claude session id). */
interface BetaLeash {
  paused: boolean
  told: boolean
  cancelled: string | null
}

/** A held tool call: let it through, or refuse it. */
type Release = (decision: PreToolDecision | null) => void

/** A finished agent stays this long past its stop, whatever the parent does. */
const FINISHED_KEEP_MS = 30 * 60_000
/** Agents kept per parent (the oldest finished go first). */
const PER_PARENT = 12
/** An `Agent` call unmatched to a start after this long is forgotten. */
const PENDING_MS = 5 * 60_000
const REASON_MAX = 2000
/** How often an agent whose transcript has not been found yet is looked for again. */
const RESOLVE_MS = 500
/** A finished agent whose transcript never turned up is given up on this long after its stop. */
const RESOLVE_GIVE_UP_MS = 30_000
/** A sidecar not there when the transcript was found is looked for this long after the agent's start. */
const META_WAIT_MS = 10_000
/** How deep under `subagents/` a transcript is looked for (`workflows/wf_<run>/` is two). */
const RESOLVE_DEPTH = 3

export class AgentTracker {
  private agents = new Map<string, Agent>()
  /** Per Claude session id: `Agent` calls seen, oldest first. */
  private pending = new Map<string, PendingCall[]>()
  /** Held tool calls, per member key (`agent:<id>` or `session:<claudeSessionId>`). */
  private holds = new Map<string, Set<Release>>()
  private betas = new Map<string, BetaLeash>()
  private resolver: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly manager: SessionManager,
    private readonly projectsDir: string,
    private readonly transcripts: () => TranscriptWatcher | null,
    private readonly emit: (agents: AgentView[]) => void
  ) {}

  list(): AgentView[] {
    return [...this.agents.values()].map(view).sort((a, b) => a.startedAt - b.startedAt)
  }

  get(id: string): AgentView | null {
    const a = this.agents.get(id)
    if (!a) return null
    return view(a)
  }

  // ---- hooks ---------------------------------------------------------------

  onHook(event: HookEvent, p: HookPayload): void {
    const rec = p.session_id ? this.manager.find({ claudeSessionId: p.session_id }) : null
    if (!rec) return
    switch (event) {
      case 'SubagentStart': {
        const id = String(p.agent_id ?? '')
        if (!id || this.agents.has(id)) return
        const a = this.fresh(id, rec.id, String(p.agent_type ?? ''), p, this.takePending(p.session_id!, String(p.agent_type ?? '')))
        this.agents.set(id, a)
        this.resolve(a)
        break
      }
      case 'SubagentStop': {
        const id = String(p.agent_id ?? '')
        if (!id) return
        let a = this.agents.get(id)
        if (!a) {
          // Never seen to start: a tile all the same, already finished.
          a = this.fresh(id, rec.id, String(p.agent_type ?? ''), p, null)
          this.agents.set(id, a)
        }
        // The CLI says where the transcript is: that beats whatever was found (or not) before.
        if (p.agent_transcript_path && p.agent_transcript_path !== a.path && existsSync(p.agent_transcript_path)) this.found(a, p.agent_transcript_path)
        else this.resolve(a)
        a.endedAt = Date.now()
        a.lastText = typeof p.last_assistant_message === 'string' ? p.last_assistant_message : null
        this.release(`agent:${id}`, null)
        break
      }
      case 'Stop': {
        // The parent's turn ended: it has processed any agent results from this turn. Finished
        // agents leave the grid — no need to wait for the next typed prompt or the 30-min timer.
        for (const [id, a] of this.agents) if (a.parent === rec.id && a.endedAt !== null) this.agents.delete(id)
        break
      }
      case 'UserPromptSubmit': {
        // A new turn typed into the parent: last turn's finished agents leave the grid. A turn the
        // CLI made from a background agent's result (`<task-notification>…`) is not one.
        if (/^\s*</.test(String(p.prompt ?? ''))) return
        for (const [id, a] of this.agents) if (a.parent === rec.id && a.endedAt !== null) this.agents.delete(id)
        break
      }
      default:
        return
    }
    this.changed()
  }

  /**
   * Every tool call of every session (PreToolUse). The parent's `Agent` call is remembered for the
   * name; a subagent's call is a sign of life (and a tile, if its start was missed); a paused
   * member's call waits here; a cancelled member's is refused with the reason.
   */
  onPreTool(p: HookPayload, gone: (cb: () => void) => void): Promise<PreToolDecision | null> {
    const rec = p.session_id ? this.manager.find({ claudeSessionId: p.session_id }) : null
    if (!rec) return Promise.resolve(null)
    const agentId = String(p.agent_id ?? '')
    if (!agentId) {
      if (p.tool_name === 'Agent') this.remember(p.session_id!, p.tool_input ?? {})
      // A beta's own call: its leash.
      const leash = this.betas.get(rec.id)
      if (!leash) return Promise.resolve(null)
      if (leash.cancelled) return Promise.resolve(deny(leash.cancelled))
      if (leash.paused) return this.hold(`session:${rec.id}`, gone)
      return Promise.resolve(null)
    }
    let a = this.agents.get(agentId)
    if (!a) {
      a = this.fresh(agentId, rec.id, String(p.agent_type ?? ''), p, this.takePending(p.session_id!, String(p.agent_type ?? '')))
      this.agents.set(agentId, a)
      this.resolve(a)
      this.changed()
    } else if (!a.path && this.resolve(a)) this.changed()
    if (a.cancelled) return Promise.resolve(deny(a.cancelled.reason))
    if (a.paused) {
      a.held = true
      this.changed()
      return this.hold(`agent:${agentId}`, gone).finally(() => {
        if (!this.holds.has(`agent:${agentId}`)) {
          a.held = false
          this.changed()
        }
      })
    }
    return Promise.resolve(null)
  }

  /** An agent's transcript came in: a nameless one takes its prompt's first line. */
  onTranscript(t: Transcript): void {
    if (!t.id.startsWith('agent:')) return
    const a = this.agents.get(t.id.slice(6))
    if (!a || a.task || a.description) return
    const first = t.blocks.find((b) => b.kind === 'user')
    if (!first) return
    a.task = firstLine(first.text)
    if (a.task) this.changed()
  }

  // ---- the leash -------------------------------------------------------------

  /** Pause a member: its next tool call waits. A note is typed into the alpha (so is the resume, then). */
  pause(id: string, note?: string): void {
    const a = this.agents.get(id)
    if (a) {
      if (a.endedAt !== null) throw new Error('that agent has already finished')
      if (a.cancelled) throw new Error('that agent was cancelled')
      a.paused = true
      if (note?.trim()) {
        this.tell(a.parent, `[deck] The user paused your subagent “${agentName(a)}” (${a.type}${a.background ? ', in the background' : ''}): ${clip(note)}. Its next tool call waits until they resume it. No action needed from you unless the note asks for one.`)
        a.told = true
      }
      this.changed()
      return
    }
    const beta = this.betaOf(id)
    const leash = this.betas.get(beta.id) ?? { paused: false, told: false, cancelled: null }
    if (leash.cancelled) throw new Error('that beta was cancelled')
    leash.paused = true
    this.betas.set(beta.id, leash)
    this.manager.setPaused(beta.id, true)
    if (note?.trim() && beta.pack) {
      this.tell(beta.pack.alpha, `[deck] The user paused your beta “${beta.pack.task}”: ${clip(note)}. Its next tool call waits until they resume it.`)
      leash.told = true
    }
  }

  /** Let a paused member go on. */
  resume(id: string): void {
    const a = this.agents.get(id)
    if (a) {
      if (!a.paused) return
      a.paused = false
      a.held = false
      this.release(`agent:${id}`, null)
      if (a.told) this.tell(a.parent, `[deck] The user resumed your subagent “${agentName(a)}”.`)
      a.told = false
      this.changed()
      return
    }
    const beta = this.betaOf(id)
    const leash = this.betas.get(beta.id)
    if (!leash?.paused) return
    leash.paused = false
    this.release(`session:${beta.id}`, null)
    this.manager.setPaused(beta.id, false)
    if (leash.told && beta.pack) this.tell(beta.pack.alpha, `[deck] The user resumed your beta “${beta.pack.task}”.`)
    leash.told = false
  }

  /**
   * Cancel a member with a reason: a subagent's tool calls are refused with it from now on (a
   * held one at once), so it returns early; a beta is killed. The alpha is told the reason and
   * asked to tweak and relaunch, fold the track in, or drop it.
   */
  async cancel(id: string, reason: string): Promise<void> {
    const why = clip(reason.trim())
    if (!why) throw new Error('a cancel needs a reason: it is what the alpha acts on')
    const a = this.agents.get(id)
    if (a) {
      if (a.endedAt !== null) throw new Error('that agent has already finished')
      a.cancelled = { reason: why, at: Date.now() }
      a.paused = false
      a.held = false
      this.release(`agent:${id}`, deny(why))
      this.tell(
        a.parent,
        `[deck] The user cancelled your subagent “${agentName(a)}” (${a.type}, agent ${a.id}${a.background ? ', running in the background' : ''}). Reason: ${why}\n` +
          `Its tool calls are now refused with that reason, so it will stop and return early${a.background ? ' (TaskStop it if it has not)' : ''}. Take the reason as a correction: fix its brief and relaunch it, fold the track into another agent, or drop it — and say in one line which you did.`
      )
      this.changed()
      return
    }
    const beta = this.betaOf(id)
    const leash = this.betas.get(beta.id) ?? { paused: false, told: false, cancelled: null }
    leash.cancelled = why
    leash.paused = false
    this.betas.set(beta.id, leash)
    this.release(`session:${beta.id}`, deny(why))
    if (beta.pack) {
      this.tell(beta.pack.alpha, `[deck] The user cancelled your beta “${beta.pack.task}” and it has been killed. Reason: ${why}\nTake the reason as a correction: fix its brief and spawn it again, fold the track into another beta, or drop it — and say in one line which you did.`)
    }
    // The refusal reaches whatever call was in flight; a beat later the session goes.
    await new Promise((r) => setTimeout(r, 150))
    await this.manager.kill(beta.id)
    this.betas.delete(beta.id)
  }

  /** Remove a tile: a finished or cancelled agent goes at once; a stuck one (SubagentStop never
   *  arrived — e.g. a killed workflow) is force-dismissed and any held calls are refused. */
  dismiss(id: string, force = false): void {
    const a = this.agents.get(id)
    if (!a) return
    if (a.endedAt === null && !a.cancelled && !force) throw new Error('that agent is still running: cancel it, with a reason, instead')
    this.agents.delete(id)
    this.release(`agent:${id}`, deny(a.cancelled?.reason ?? 'dismissed from the deck'))
    this.changed()
  }

  private hold(key: string, gone: (cb: () => void) => void): Promise<PreToolDecision | null> {
    return new Promise<PreToolDecision | null>((resolve) => {
      let set = this.holds.get(key)
      if (!set) this.holds.set(key, (set = new Set()))
      const release: Release = (d) => {
        set!.delete(release)
        if (set!.size === 0) this.holds.delete(key)
        resolve(d)
      }
      set.add(release)
      // The CLI gave up on the hook (its timeout) or the agent was stopped: nothing to answer any more.
      gone(() => release(null))
    })
  }

  private release(key: string, decision: PreToolDecision | null): void {
    const set = this.holds.get(key)
    if (!set) return
    for (const r of [...set]) r(decision)
  }

  /** Typed into the alpha's terminal and submitted; mid-turn it reaches Claude at the next tool boundary. */
  private tell(parentId: string, text: string): void {
    if (!this.manager.isOpen(parentId)) return
    this.manager.paste(parentId, text)
  }

  private betaOf(id: string) {
    const rec = this.manager.find({ id })
    if (!rec || rec.slot === null) throw new Error(`no open agent or beta “${id}”`)
    if (!rec.pack) throw new Error('only a wolfpack member can be leashed (park or kill a session instead)')
    return rec
  }

  // ---- the list ----------------------------------------------------------------

  /** Agents of sessions no longer open go with them; so does a beta's leash. */
  onState(state: DeckState): void {
    this.prune()
    const open = new Set(state.open.map((s) => s.id))
    let dropped = false
    for (const [id, a] of this.agents) {
      if (open.has(a.parent)) continue
      this.agents.delete(id)
      this.release(`agent:${id}`, null)
      dropped = true
    }
    for (const id of [...this.betas.keys()]) {
      if (open.has(id)) continue
      this.betas.delete(id)
      this.release(`session:${id}`, null)
    }
    if (dropped) this.changed()
  }

  /** Finished agents past their keep time, and the oldest past the per-parent cap, go. Called from the state broadcast. */
  prune(): void {
    const now = Date.now()
    let dropped = false
    const byParent = new Map<string, Agent[]>()
    for (const [id, a] of this.agents) {
      if (a.endedAt !== null && now - a.endedAt > FINISHED_KEEP_MS) {
        this.agents.delete(id)
        dropped = true
        continue
      }
      byParent.set(a.parent, [...(byParent.get(a.parent) ?? []), a])
    }
    for (const list of byParent.values()) {
      const finished = list.filter((a) => a.endedAt !== null).sort((x, y) => x.endedAt! - y.endedAt!)
      for (const a of finished.slice(0, Math.max(0, list.length - PER_PARENT))) {
        this.agents.delete(a.id)
        dropped = true
      }
    }
    for (const [sid, calls] of this.pending) {
      const live = calls.filter((c) => now - c.at < PENDING_MS)
      if (live.length) this.pending.set(sid, live)
      else this.pending.delete(sid)
    }
    if (dropped) this.changed()
  }

  private changed(): void {
    this.watchUnresolved()
    this.transcripts()?.syncAgents([...this.agents.values()].map((a) => ({ id: `agent:${a.id}`, path: a.path })))
    this.emit(this.list())
  }

  private fresh(id: string, parent: string, type: string, p: HookPayload, call: PendingCall | null): Agent {
    return {
      id,
      parent,
      type: type || call?.type || '',
      description: call?.description ?? '',
      task: call?.task ?? '',
      model: call?.model ?? '',
      background: call?.background ?? false,
      startedAt: Date.now(),
      endedAt: null,
      lastText: null,
      paused: false,
      held: false,
      cancelled: null,
      phase: '',
      path: null,
      sessionId: p.session_id ?? '',
      parentTranscript: p.transcript_path ?? null,
      meta: false,
      told: false
    }
  }

  /** The parent's `Agent` call: kept until the start that is it. */
  private remember(sessionId: string, input: Record<string, unknown>): void {
    const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '')
    const call: PendingCall = {
      at: Date.now(),
      type: str('subagent_type') || 'general-purpose',
      description: str('description').slice(0, 80),
      task: firstLine(str('prompt')),
      model: str('model'),
      background: input.run_in_background === true
    }
    this.pending.set(sessionId, [...(this.pending.get(sessionId) ?? []), call])
  }

  /** The oldest remembered call of this type (the CLI starts them in order), else the oldest of any. */
  private takePending(sessionId: string, type: string): PendingCall | null {
    const calls = this.pending.get(sessionId)
    if (!calls?.length) return null
    let i = calls.findIndex((c) => c.type === type)
    if (i < 0) i = 0
    const [call] = calls.splice(i, 1)
    if (!calls.length) this.pending.delete(sessionId)
    return call
  }

  // ---- the transcript ------------------------------------------------------------

  /** Look for the agent's transcript; true when this call found it. Never commits to a file it has not seen. */
  private resolve(a: Agent): boolean {
    if (a.path) return false
    const file = `agent-${a.id}.jsonl`
    for (const base of this.bases(a)) {
      const path = findUnder(base, file, RESOLVE_DEPTH)
      if (!path) continue
      this.found(a, path)
      return true
    }
    return false
  }

  /** The transcript is at `path`: tail it, and take what its sidecar knows that the hooks did not. */
  private found(a: Agent, path: string): void {
    a.path = path
    a.meta = false
    this.readMeta(a)
  }

  /** `agent-<id>.meta.json`, beside the transcript; true when this call read it. */
  private readMeta(a: Agent): boolean {
    if (!a.path || a.meta) return false
    try {
      const meta = JSON.parse(readFileSync(a.path.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as Record<string, unknown>
      const str = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string).trim() : '')
      a.type ||= str('agentType')
      a.description ||= str('description').slice(0, 80)
      a.model ||= str('model')
      a.phase ||= str('workflowPhase').slice(0, 80)
      a.meta = true
      return true
    } catch {
      return false // no sidecar (an older CLI), or not written yet: the hooks' word stands
    }
  }

  /** The `subagents` folders the transcript can be under: beside the parent's transcript (the hook says where that is), else under every project folder. */
  private bases(a: Agent): string[] {
    if (!a.sessionId) return []
    if (a.parentTranscript) return [join(dirname(a.parentTranscript), a.sessionId, 'subagents')]
    try {
      return readdirSync(this.projectsDir).map((d) => join(this.projectsDir, d, a.sessionId, 'subagents'))
    } catch {
      return [] // no projects folder yet
    }
  }

  /** Runs only while some agent's transcript is still to be found. */
  private watchUnresolved(): void {
    const now = Date.now()
    const waiting = [...this.agents.values()].some((a) =>
      a.path ? !a.meta && now - a.startedAt < META_WAIT_MS : a.endedAt === null || now - a.endedAt < RESOLVE_GIVE_UP_MS
    )
    if (waiting && !this.resolver) {
      this.resolver = setInterval(() => {
        let any = false
        for (const a of this.agents.values()) if (this.resolve(a) || this.readMeta(a)) any = true
        // Either way this timer stops itself once nothing is waiting.
        if (any) this.changed()
        else this.watchUnresolved()
      }, RESOLVE_MS)
    } else if (!waiting && this.resolver) {
      clearInterval(this.resolver)
      this.resolver = null
    }
  }
}

function view({ path: _p, sessionId: _s, parentTranscript: _pt, meta: _m, told: _t, ...a }: Agent): AgentView {
  return a
}

/** `file` in `dir` or, failing that, in a folder under it, `depth` levels down at most. */
function findUnder(dir: string, file: string, depth: number): string | null {
  const direct = join(dir, file)
  if (existsSync(direct)) return direct
  if (depth <= 0) return null
  let subs: string[]
  try {
    subs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return null // not there yet
  }
  for (const sub of subs) {
    const hit = findUnder(join(dir, sub), file, depth - 1)
    if (hit) return hit
  }
  return null
}

function deny(reason: string): PreToolDecision {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Cancelled from the deck by the user. Reason: ${reason}\nStop now: do not try another tool. Reply with one short paragraph saying you were cancelled, the reason, and what you had done so far.`
    }
  }
}

function firstLine(s: string): string {
  const line = s.split('\n').find((l) => l.trim()) ?? ''
  return line.trim().replace(/^#+\s*/, '').slice(0, 120)
}

function clip(s: string): string {
  return s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1)}…` : s
}
