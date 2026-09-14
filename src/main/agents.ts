// Subagents as tiles. A session's Agent-tool calls (and the agents a Workflow runs) are
// reported by the CLI's SubagentStart / SubagentStop hooks (documented: agent_id, agent_type,
// agent_description, task_description; the stop adds last_assistant_message), and each one's
// transcript is written to `<projects>/<cwd>/<sessionId>/subagents/agent-<id>.jsonl` — the same
// JSONL as a session's own. So a running subagent is a conversation the deck can tail like any
// tile: this tracker keeps the list per parent session, hands the files to the TranscriptWatcher
// under `agent:<id>`, and broadcasts the list. Finished agents stay until the parent's next
// TYPED prompt (the pack shows this turn's work), then go — a background agent's result comes
// back through UserPromptSubmit too, as a `<task-notification>`, and that one must not count —
// and in any case go after FINISHED_KEEP_MS.

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentView, DeckState } from '@shared/types'
import type { HookEvent, HookPayload } from './hooks'
import type { SessionManager } from './sessions'
import type { TranscriptWatcher } from './transcript'

interface Agent extends AgentView {
  path: string
}

/** A finished agent stays this long past its stop, whatever the parent does. */
const FINISHED_KEEP_MS = 30 * 60_000
/** Agents kept per parent (the oldest finished go first). */
const PER_PARENT = 12

export class AgentTracker {
  private agents = new Map<string, Agent>()

  constructor(
    private readonly manager: SessionManager,
    private readonly projectsDir: string,
    private readonly transcripts: () => TranscriptWatcher | null,
    private readonly emit: (agents: AgentView[]) => void
  ) {}

  list(): AgentView[] {
    return [...this.agents.values()].map(({ path: _p, ...a }) => a).sort((a, b) => a.startedAt - b.startedAt)
  }

  onHook(event: HookEvent, p: HookPayload): void {
    const rec = p.session_id ? this.manager.find({ claudeSessionId: p.session_id }) : null
    if (!rec) return
    switch (event) {
      case 'SubagentStart': {
        const id = String(p.agent_id ?? '')
        if (!id) return
        const path = this.locate(p, id)
        if (!path) return
        this.agents.set(id, {
          id,
          parent: rec.id,
          type: String(p.agent_type ?? ''),
          description: String(p.agent_description ?? '').trim(),
          task: String(p.task_description ?? '').trim(),
          startedAt: Date.now(),
          endedAt: null,
          lastText: null,
          path
        })
        break
      }
      case 'SubagentStop': {
        const a = this.agents.get(String(p.agent_id ?? ''))
        if (!a) return
        a.endedAt = Date.now()
        a.lastText = typeof p.last_assistant_message === 'string' ? p.last_assistant_message : null
        break
      }
      case 'UserPromptSubmit': {
        // A new turn typed into the parent: last turn's finished agents leave the pack. A turn the
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

  /** Agents of sessions no longer open go with them. */
  onState(state: DeckState): void {
    this.prune()
    const open = new Set(state.open.map((s) => s.id))
    let dropped = false
    for (const [id, a] of this.agents) {
      if (open.has(a.parent)) continue
      this.agents.delete(id)
      dropped = true
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
    if (dropped) this.changed()
  }

  private changed(): void {
    this.transcripts()?.syncAgents([...this.agents.values()].map((a) => ({ id: `agent:${a.id}`, path: a.path })))
    this.emit(this.list())
  }

  /** The agent's transcript: next to the parent's (the hook says where that is), else found under the projects folder. */
  private locate(p: HookPayload, agentId: string): string | null {
    const file = `agent-${agentId}.jsonl`
    if (p.transcript_path && p.session_id) return join(dirname(p.transcript_path), p.session_id, 'subagents', file)
    if (!p.session_id) return null
    try {
      for (const d of readdirSync(this.projectsDir)) {
        const dir = join(this.projectsDir, d, p.session_id, 'subagents')
        if (existsSync(dir)) return join(dir, file)
      }
    } catch {
      /* no projects folder yet */
    }
    return null
  }
}
