// Instant "needs you" signal. Every deck-spawned session gets `--settings <hooksFile>` whose
// Notification / Stop / UserPromptSubmit hooks POST their stdin JSON to this local server.
// `--settings` MERGES with the user's own settings (lists combine), so their hooks still run.
//
// The same server is how a session inside the deck talks back to it: `POST /studio` is the
// Studio (main/studio.ts: a session drafting and running a Gemini image generation, the
// result landing in the tile's gallery), and `POST /pack` is the
// wolfpack (main/pack.ts) — an alpha spawning betas, asking after them, dismissing them. The
// settings file also sets DECK_HOOK_PORT / DECK_PROFILE in every session's environment, so
// plugin/scripts/wolfpack.mjs knows which deck it is in, and DECK_WOLFPACK — that script's
// absolute path — so the skill runs it the same way from the repo tree or the packaged app.
//
// And it is the LEASH on the pack (main/agents.ts): every tool call of every session POSTs
// /pretool (the PreToolUse hook; inside a subagent the payload carries `agent_id`) and the
// hook's stdout is whatever this server answers. Normally nothing (204, at once). A paused
// member's call is HELD — the response waits until it is resumed (its hook timeout is an hour) —
// and a cancelled member's call is refused with a PreToolUse `deny` decision carrying the
// user's reason, which is what the agent then reads as its tool result.


import { createServer, type Server } from 'node:http'
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type HookEvent = 'Notification' | 'Stop' | 'UserPromptSubmit' | 'SubagentStart' | 'SubagentStop' | 'PreToolUse'

/** What a PreToolUse hook may answer (hooks-guide: `permissionDecision` deny cancels the call and hands Claude the reason). */
export interface PreToolDecision {
  hookSpecificOutput: { hookEventName: 'PreToolUse'; permissionDecision: 'deny'; permissionDecisionReason: string }
}

export interface HookPayload {
  session_id?: string
  hook_event_name?: string
  notification_type?: string
  cwd?: string
  /** The session's own transcript file (every event carries it). */
  transcript_path?: string
  /** UserPromptSubmit: what was submitted. A background agent's result comes back as one too, starting with `<task-notification>`. */
  prompt?: string
  /** SubagentStart / SubagentStop, and every hook fired INSIDE a subagent (PreToolUse included): which one. */
  agent_id?: string
  agent_type?: string
  /** SubagentStop: the subagent's own transcript (`transcript_path` is always the session's). */
  agent_transcript_path?: string
  last_assistant_message?: string
  stop_reason?: string
  /** PreToolUse: the call. The parent's `Agent` call is where a subagent's description, prompt and model are seen. */
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_use_id?: string
}

const EVENTS: Record<string, HookEvent> = {
  notification: 'Notification',
  stop: 'Stop',
  prompt: 'UserPromptSubmit',
  'subagent-start': 'SubagentStart',
  'subagent-stop': 'SubagentStop',
  pretool: 'PreToolUse'
}

/** How long a held tool call may wait (the pause), in seconds: the hook's timeout and curl's. */
const HOLD_MAX_S = 3600

/** hooks.log starts over past this size (at boot). */
const LOG_MAX = 1 << 20

export class HooksServer {
  private server: Server | null = null
  readonly settingsPath: string
  /** `POST /status`: a session's status-line JSON (main/usage.ts). Set after construction; not logged, it arrives with every message. */
  onStatus: ((body: unknown) => void) | null = null

  constructor(
    private readonly port: number,
    userDataDir: string,
    private readonly profile: string,
    /** Absolute path of plugin/scripts/wolfpack.mjs, handed to every session as DECK_WOLFPACK. */
    private readonly wolfpackScript: string,
    /** Absolute path of plugin/scripts/studio.mjs, handed to every session as DECK_STUDIO. */
    private readonly studioScript: string,
    /** Absolute path of plugin/scripts/trainer.mjs (the Pokemon trainer's CLI), handed to every session as DECK_TRAINER. */
    private readonly trainerScript: string,
    /** Absolute path of plugin/scripts/mol.mjs (the Molecule tile's CLI), handed to every session as DECK_MOL. */
    private readonly molScript: string,
    private readonly onEvent: (event: HookEvent, payload: HookPayload) => void,
    /** `POST /pack`: the body, parsed; the result goes back as JSON (an Error = 400 with its message). */
    private readonly onPack: (body: unknown) => Promise<unknown>,
    /** `POST /studio`: the Studio's door (main/studio.ts), the same shape as /pack. A `gen` waits for the image. */
    private readonly onStudio: (body: unknown) => Promise<unknown>,
    /** `POST /gameboy`: the trainer's door to the renderer's emulator (main/index.ts relays it), the same shape. */
    private readonly onGameboy: (body: unknown) => Promise<unknown>,
    /** `POST /mol`: the Molecule tile's door (main resolves the structure, the renderer's viewer does the rest), the same shape. */
    private readonly onMol: (body: unknown) => Promise<unknown>,
    /**
     * `POST /pretool`: the decision on a tool call. Resolves to null = let it through (at once, as a
     * rule; late, for a paused member), or a deny decision; `gone` fires if the caller hung up first.
     */
    private readonly onPreTool: (payload: HookPayload, gone: (cb: () => void) => void) => Promise<PreToolDecision | null>
  ) {
    this.settingsPath = join(userDataDir, 'claude-hooks.json')
    this.logPath = join(userDataDir, 'hooks.log')
    this.statusScript = join(userDataDir, 'statusline.sh')
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

  /**
   * USAGE rides the status line: the CLI hands its `statusLine` command the session's status JSON
   * (context window, and for a subscriber `rate_limits`) — the only documented place the account's
   * 5-hour / weekly windows appear. `statusLine` is ONE object, so ours REPLACES the user's rather
   * than merging with it; the script therefore posts the JSON to /status in the background and
   * then runs the user's own command (read from their settings.json when this file is written)
   * on the same input, so what they see under the prompt is unchanged. No command of theirs =
   * it prints nothing.
   */
  private readonly statusScript: string
  private writeStatusScript(): Record<string, unknown> {
    let theirs: { type?: string; command?: string; padding?: number } = {}
    try {
      const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
      theirs = (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).statusLine ?? {}) as typeof theirs
    } catch {
      /* no settings of theirs, or none we can read */
    }
    const own = theirs.type === 'command' && typeof theirs.command === 'string' && !theirs.command.includes(this.statusScript) ? theirs.command : ''
    const script = [
      '#!/bin/bash',
      '# Written by the deck at every boot (main/hooks.ts): usage for the header, then your own status line.',
      'input=$(cat)',
      `printf '%s' "$input" | curl -s -m 2 -X POST http://127.0.0.1:${this.port}/status -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1 &`,
      own ? `printf '%s' "$input" | (\n${own}\n)` : ':',
      ''
    ].join('\n')
    writeFileSync(this.statusScript, script, { mode: 0o755 })
    return { type: 'command', command: `bash '${this.statusScript.replace(/'/g, `'\\''`)}'`, ...(typeof theirs.padding === 'number' ? { padding: theirs.padding } : {}) }
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
    // The leash: the answer (nothing, or a deny decision) IS the hook's stdout, and a held call
    // waits on the response. No deck listening = curl fails at once = the call goes through.
    const ask = (path: string) => ({
      hooks: [
        {
          type: 'command',
          command: `curl -s -m ${HOLD_MAX_S} -X POST http://127.0.0.1:${this.port}/${path} -H 'content-type: application/json' --data-binary @- 2>/dev/null; exit 0`,
          timeout: HOLD_MAX_S
        }
      ]
    })
    const settings = {
      statusLine: this.writeStatusScript(),
      env: { DECK_HOOK_PORT: String(this.port), DECK_PROFILE: this.profile, DECK_WOLFPACK: this.wolfpackScript, DECK_STUDIO: this.studioScript, DECK_TRAINER: this.trainerScript, DECK_MOL: this.molScript },
      hooks: {
        Notification: [post('notification')],
        Stop: [post('stop')],
        UserPromptSubmit: [post('prompt')],
        // Subagents (the Agent tool, a Workflow) become tiles of their own: main/agents.ts.
        SubagentStart: [post('subagent-start')],
        SubagentStop: [post('subagent-stop')],
        // Every tool call asks the deck first: a paused member waits here, a cancelled one is refused.
        PreToolUse: [ask('pretool')]
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
          if (path === 'pretool') {
            // The leash. Nothing to say = 204 at once; a hold = the response waits; a refusal = the decision as JSON.
            const p = (payload ?? {}) as HookPayload
            void this.onPreTool(p, (cb) => req.on('close', cb)).then(
              (decision) => {
                if (res.writableEnded) return
                if (!decision) {
                  res.statusCode = 204
                  res.end()
                  return
                }
                this.log('pretool:deny', p)
                res.statusCode = 200
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify(decision))
              },
              () => {
                if (res.writableEnded) return
                res.statusCode = 204
                res.end()
              }
            )
            return
          }
          if (path === 'status') {
            res.statusCode = 204
            res.end()
            try {
              this.onStatus?.(payload)
            } catch {
              /* a bad payload is nobody's problem */
            }
            return
          }
          if (path !== 'gameboy') this.log(path, payload)
          if (path === 'pack' || path === 'studio' || path === 'gameboy' || path === 'mol') {
            // The wolfpack (or the Studio, the Game Boy, the Molecule tile) answers: JSON either way, and never hangs the caller.
            void (path === 'pack' ? this.onPack(payload) : path === 'studio' ? this.onStudio(payload) : path === 'mol' ? this.onMol(payload) : this.onGameboy(payload)).then(
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
