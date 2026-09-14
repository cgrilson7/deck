// Instant "needs you" signal. Every deck-spawned session gets `--settings <hooksFile>` whose
// Notification / Stop / UserPromptSubmit hooks POST their stdin JSON to this local server.
// `--settings` MERGES with the user's own settings (lists combine), so their hooks still run.
//
// The same server is how a session inside the deck talks back to it: `POST /pack` is the
// wolfpack (main/pack.ts) — an alpha spawning betas, asking after them, dismissing them. The
// settings file also sets DECK_HOOK_PORT / DECK_PROFILE in every session's environment, so
// plugin/scripts/wolfpack.mjs knows which deck it is in, and DECK_WOLFPACK — that script's
// absolute path — so the skill runs it the same way from the repo tree or the packaged app.

import { createServer, type Server } from 'node:http'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type HookEvent = 'Notification' | 'Stop' | 'UserPromptSubmit' | 'SubagentStart' | 'SubagentStop'

export interface HookPayload {
  session_id?: string
  hook_event_name?: string
  notification_type?: string
  cwd?: string
  /** The session's own transcript file (every event carries it). */
  transcript_path?: string
  /** UserPromptSubmit: what was submitted. A background agent's result comes back as one too, starting with `<task-notification>`. */
  prompt?: string
  /** SubagentStart / SubagentStop (main/agents.ts). */
  agent_id?: string
  agent_type?: string
  agent_description?: string
  task_description?: string
  last_assistant_message?: string
  stop_reason?: string
}

const EVENTS: Record<string, HookEvent> = {
  notification: 'Notification',
  stop: 'Stop',
  prompt: 'UserPromptSubmit',
  'subagent-start': 'SubagentStart',
  'subagent-stop': 'SubagentStop'
}

/** hooks.log starts over past this size (at boot). */
const LOG_MAX = 1 << 20

export class HooksServer {
  private server: Server | null = null
  readonly settingsPath: string

  constructor(
    private readonly port: number,
    userDataDir: string,
    private readonly profile: string,
    /** Absolute path of plugin/scripts/wolfpack.mjs, handed to every session as DECK_WOLFPACK. */
    private readonly wolfpackScript: string,
    private readonly onEvent: (event: HookEvent, payload: HookPayload) => void,
    /** `POST /pack`: the body, parsed; the result goes back as JSON (an Error = 400 with its message). */
    private readonly onPack: (body: unknown) => Promise<unknown>
  ) {
    this.settingsPath = join(userDataDir, 'claude-hooks.json')
    this.logPath = join(userDataDir, 'hooks.log')
    try {
      if (statSync(this.logPath).size > LOG_MAX) writeFileSync(this.logPath, '')
    } catch {
      /* no log yet */
    }
    this.writeSettingsFile()
  }

  /** One line per request, for `tail -f` when a hook seems not to arrive (userData/hooks.log). */
  private readonly logPath: string
  private log(path: string, payload: unknown): void {
    const p = (payload ?? {}) as HookPayload
    try {
      appendFileSync(this.logPath, `${new Date().toISOString()} ${path} session=${p.session_id ?? '-'} agent=${p.agent_id ?? '-'} ${p.hook_event_name ?? ''}\n`)
    } catch {
      /* not worth a word */
    }
  }

  private writeSettingsFile(): void {
    const post = (path: string) => ({
      hooks: [
        {
          type: 'command',
          // Never block Claude on us: short timeout, swallow errors, always exit 0.
          command: `curl -s -m 2 -X POST http://127.0.0.1:${this.port}/${path} -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1; exit 0`,
          timeout: 5
        }
      ]
    })
    const settings = {
      env: { DECK_HOOK_PORT: String(this.port), DECK_PROFILE: this.profile, DECK_WOLFPACK: this.wolfpackScript },
      hooks: {
        Notification: [post('notification')],
        Stop: [post('stop')],
        UserPromptSubmit: [post('prompt')],
        // Subagents (the Agent tool, a Workflow) become tiles under their session: main/agents.ts.
        SubagentStart: [post('subagent-start')],
        SubagentStop: [post('subagent-stop')]
      }
    }
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2))
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const path = (req.url ?? '').replace(/^\//, '').replace(/\?.*$/, '')
          let payload: unknown = {}
          try {
            payload = JSON.parse(body || '{}')
          } catch {
            /* ignore malformed */
          }
          this.log(path, payload)
          if (path === 'pack') {
            // The wolfpack answers: JSON either way, and never hangs the caller.
            void this.onPack(payload).then(
              (result) => {
                res.statusCode = 200
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify(result))
              },
              (err: unknown) => {
                res.statusCode = 400
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
              }
            )
            return
          }
          res.statusCode = 204
          res.end()
          const event = EVENTS[path] ?? null
          if (event) this.onEvent(event, (payload ?? {}) as HookPayload)
        })
      })
      this.server.on('error', (err) => {
        // Port taken (another deck instance?). Sessions still work; only the instant signal is lost.
        console.warn('[deck] hooks server not listening:', err.message)
        resolve()
      })
      this.server.listen(this.port, '127.0.0.1', () => resolve())
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }
}
