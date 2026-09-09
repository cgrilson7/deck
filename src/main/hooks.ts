// Instant "needs you" signal. Every deck-spawned session gets `--settings <hooksFile>` whose
// Notification / Stop / UserPromptSubmit hooks POST their stdin JSON to this local server.
// `--settings` MERGES with the user's own settings (lists combine), so their hooks still run.

import { createServer, type Server } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type HookEvent = 'Notification' | 'Stop' | 'UserPromptSubmit'

export interface HookPayload {
  session_id?: string
  hook_event_name?: string
  notification_type?: string
  cwd?: string
}

export class HooksServer {
  private server: Server | null = null
  readonly settingsPath: string

  constructor(
    private readonly port: number,
    userDataDir: string,
    private readonly onEvent: (event: HookEvent, payload: HookPayload) => void
  ) {
    this.settingsPath = join(userDataDir, 'claude-hooks.json')
    this.writeSettingsFile()
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
      hooks: {
        Notification: [post('notification')],
        Stop: [post('stop')],
        UserPromptSubmit: [post('prompt')]
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
          res.statusCode = 204
          res.end()
          let payload: HookPayload = {}
          try {
            payload = JSON.parse(body || '{}') as HookPayload
          } catch {
            /* ignore malformed */
          }
          const path = (req.url ?? '').replace(/^\//, '')
          const event: HookEvent | null =
            path === 'notification' ? 'Notification' : path === 'stop' ? 'Stop' : path === 'prompt' ? 'UserPromptSubmit' : null
          if (event) this.onEvent(event, payload)
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
