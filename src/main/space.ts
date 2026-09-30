// The Space tile's main side: ~/space (Colin's disk-pathways repo) seen from the deck. The two
// meet at two seams and nothing else, the casa way (docs/casa.md): its `state/status.json`,
// watched here, and its CLI (`bin/space.mjs … --json`), run here with Electron as node. Every
// decision and every deletion is the space repo's code; the deck only asks it.
//
// When a scan leaves something that needs Colin (`needsAction`), the tile is switched on if it
// was off and Foxtrot barks: once per scan that brings new items, or again after three days of
// the same ones waiting. What was last barked is kept in userData/space.json.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SpaceAct, SpaceItem, SpaceStatus, TrashGame } from '@shared/types'

const POLL_MS = 3000
const NAG_MS = 3 * 86_400_000
/** The Trash game reads the Trash this often (the deck can read ~/.Trash; the launch agent cannot). */
const TRASH_MS = 60_000

export class Space {
  private watched: string | null = null
  private last: SpaceStatus | null = null
  private readonly barkFile: string
  private trashTimer: NodeJS.Timeout | null = null
  private trashLast: TrashGame | null = null
  /** A reading that saw the Trash emptied: the victory lap. */
  onTrash: ((g: TrashGame) => void) | null = null
  onEmptied: ((g: TrashGame) => void) | null = null

  constructor(
    userData: string,
    /** The `spaceDir` setting ('' = ~/space). */
    private readonly dirSetting: () => string,
    /** The login shell's env: the CLI's `cmd` pathways run npm, brew, git. */
    private readonly env: NodeJS.ProcessEnv,
    private readonly onStatus: (s: SpaceStatus | null) => void,
    /** A scan needs Colin: switch the tile on, bark. */
    private readonly onNeedsYou: (s: SpaceStatus, text: string) => void
  ) {
    this.barkFile = join(userData, 'space.json')
  }

  dir(): string {
    const d = this.dirSetting().trim()
    return d ? d.replace(/^~(?=\/|$)/, homedir()) : join(homedir(), 'space')
  }
  private statusPath(): string {
    return join(this.dir(), 'state', 'status.json')
  }

  /** Watch status.json (a poll: the space repo writes it by rename). Called at boot and when `spaceDir` changes. */
  sync(): void {
    const p = this.statusPath()
    if (this.watched === p) return
    if (this.watched) unwatchFile(this.watched)
    this.watched = p
    watchFile(p, { interval: POLL_MS }, () => this.read())
    this.read()
  }

  stop(): void {
    if (this.watched) unwatchFile(this.watched)
    this.watched = null
    if (this.trashTimer) clearInterval(this.trashTimer)
    this.trashTimer = null
  }

  /** Start reading the Trash every minute, whether or not the tile is up (so every empty scores). */
  startTrash(): void {
    if (this.trashTimer) return
    void this.readTrash()
    this.trashTimer = setInterval(() => void this.readTrash(), TRASH_MS)
  }

  trash(): TrashGame | null {
    return this.trashLast
  }

  async readTrash(): Promise<TrashGame | null> {
    try {
      return this.took((await this.cli(['trash'], 5 * 60_000)) as TrashGame)
    } catch {
      return null
    }
  }

  private took(g: TrashGame): TrashGame {
    this.trashLast = g
    this.onTrash?.(g)
    if (g.emptied) this.onEmptied?.(g)
    return g
  }

  status(): SpaceStatus | null {
    return this.last
  }

  private read(): void {
    let s: SpaceStatus | null = null
    try {
      const raw = JSON.parse(readFileSync(this.statusPath(), 'utf8')) as SpaceStatus
      if (raw && raw.version === 1 && Array.isArray(raw.categories)) s = raw
    } catch {
      /* no repo, no scan yet, or caught mid-write: the next poll has it */
    }
    if (s && this.last && s.ts === this.last.ts) return
    this.last = s
    this.onStatus(s)
    if (s) this.maybeBark(s)
  }

  private maybeBark(s: SpaceStatus): void {
    if (!s.needsAction || !s.lastScan || s.scanning) return
    let told: { lastScan?: number; count?: number; at?: number } = {}
    try {
      told = JSON.parse(readFileSync(this.barkFile, 'utf8'))
    } catch {
      /* never barked */
    }
    if (told.lastScan === s.lastScan) return
    const more = s.pending.count > (told.count ?? 0)
    const stale = Date.now() - (told.at ?? 0) > NAG_MS
    if (!more && !stale) {
      // Same items, recently told: remember this scan, stay quiet.
      writeFileSync(this.barkFile, JSON.stringify({ ...told, lastScan: s.lastScan }))
      return
    }
    writeFileSync(this.barkFile, JSON.stringify({ lastScan: s.lastScan, count: s.pending.count, at: Date.now() }))
    this.onNeedsYou(s, `Disk: ${s.reasons.join('; ')}. The Space tile has ${s.pending.count} item${s.pending.count === 1 ? '' : 's'} for you.`)
  }

  /** Run the space CLI with --json. Rejects with its error text. */
  private cli(args: string[], timeoutMs = 60 * 60_000): Promise<unknown> {
    const script = join(this.dir(), 'bin', 'space.mjs')
    if (!existsSync(script)) return Promise.reject(new Error(`no space repo at ${this.dir()}`))
    return new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [script, ...args, '--json'],
        { env: { ...this.env, ELECTRON_RUN_AS_NODE: '1' }, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
        (err, stdout) => {
          let out: unknown = null
          try {
            out = JSON.parse(String(stdout).trim().split('\n').pop() || 'null')
          } catch {
            /* not JSON */
          }
          const e = out && typeof out === 'object' && 'error' in out ? String((out as { error: unknown }).error) : null
          if (e || (err && !out)) reject(new Error(e ?? err?.message ?? 'space failed'))
          else resolve(out)
        }
      )
    })
  }

  async items(): Promise<SpaceItem[]> {
    const r = await this.cli(['list', '--status', 'pending,approved,failed,waiting,kept'], 60_000)
    return Array.isArray(r) ? (r as SpaceItem[]) : []
  }

  /**
   * One request from the tile, the pane or the door. Approving IS doing: the approved ids run at
   * once (a run takes the space repo's lock, so a daily scan in progress makes it fail; try again).
   */
  async act(req: SpaceAct): Promise<unknown> {
    const ids = 'ids' in req ? req.ids.filter((id) => /^[0-9a-f]{4,40}$/.test(id)) : []
    switch (req.op) {
      case 'approve': {
        if (!ids.length) throw new Error('no items')
        await this.cli(['approve', ...ids, ...(req.as ? ['--as', req.as] : [])])
        return this.cli(['run', ...ids])
      }
      case 'keep':
        return this.cli(['keep', ...ids])
      case 'reopen':
        return this.cli(['reopen', ...ids])
      case 'pathway': {
        const args = ['pathway', req.category]
        if (req.pathway) args.push(req.pathway)
        if (req.standing !== undefined) args.push(req.standing ? '--standing' : '--no-standing')
        return this.cli(args)
      }
      case 'scan':
        return this.cli(['scan'], 30 * 60_000)
      case 'emptyTrash':
        return this.took((await this.cli(['trash', 'empty'], 15 * 60_000)) as TrashGame)
    }
  }
}
