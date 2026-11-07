// THE RUSHING ATTACK MARATHON: 26.2 miles rushed (46,112 yards), counted play by play from Madden NFL 2005's
// own memory while PCSX2 plays it. PCSX2's PINE server (a unix socket, $TMPDIR/pcsx2.sock; on in its
// PCSX2.ini) answers memory reads; main polls four values at 20 Hz and runs the play counter below.
//
// The RAM map is ~/rushing-attack-247/trainer/rushing-attack-map.md (SLUS-21000, mapped and verified on
// 2026-11-07; every address static). READS ONLY: this file never writes the game's memory.
//
//   ball     0x80ab2c f32  yards from midfield toward the goal (goal line 50.0); 400.0 = no live ball
//   spot     0x80aae0 f32  the line of scrimmage for the next snap; changes the moment a play ends
//   dead     0x760d81 u8   1 for ~2 s after a play ends, and at a round's end
//   offense  0x7926fc i32  0 = Prof 1 (Colin) has the ball this round
//   clock    0x792718 f32  seconds left in the round (0 = over)
//
// A play's yards = the ball's last live value − the spot read on the poll BEFORE it went live (never the spot's
// change: a TD resets the spot backwards). Only Colin's plays count (offense 0), none starts with the clock at
// 0, and a jump of more than 15 yd between two polls is a state load or a menu, not football: that play is
// dropped, and none starts again until the ball has been dead. The total is kept in userData/marathon.json.

import { createConnection, type Socket } from 'node:net'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MarathonState } from '../shared/types'

/** 26.2 miles in yards. */
export const MARATHON_YARDS = 46_112
const SERIAL = 'SLUS-21000'
const POLL_MS = 50
const RETRY_MS = 2000
const JUMP_YD = 15
const NO_BALL = 400
const KEEP_PLAYS = 2000
/** The goal line is 50.0; a play that ends this close to it is a touchdown. */
const TD_AT = 49.5
const SAVE_CLOCK_MS = 5000

const ADDR = { ball: 0x80ab2c, spot: 0x80aae0, dead: 0x760d81, offense: 0x7926fc, clock: 0x792718 }
const OP = { r8: 0, r32: 2, id: 0x0c }

interface Saved {
  yards: number
  tds: number
  /** The marathon clock: time a Rushing Attack round was running (its clock above 0), summed. */
  activeMs: number
  plays: { yards: number; at: number; td?: boolean }[]
  startedAt: number
}

/** One PINE connection: requests are answered in order, so a queue of resolvers is the whole protocol. */
class Pine {
  private sock: Socket | null = null
  private buf = Buffer.alloc(0)
  private waiting: { resolve: (b: Buffer) => void; reject: (e: Error) => void }[] = []

  constructor(private readonly path: string) {}

  get open(): boolean {
    return !!this.sock
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = createConnection(this.path)
      s.once('connect', () => {
        this.sock = s
        resolve()
      })
      s.on('data', (d: Buffer) => this.onData(d))
      s.on('error', (e) => {
        if (!this.sock) reject(e)
        this.close()
      })
      s.on('close', () => this.close())
    })
  }

  close(): void {
    this.sock?.destroy()
    this.sock = null
    this.buf = Buffer.alloc(0)
    for (const w of this.waiting.splice(0)) w.reject(new Error('PINE closed'))
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d])
    while (this.buf.length >= 4) {
      const size = this.buf.readUInt32LE(0)
      if (this.buf.length < size) return
      const body = this.buf.subarray(4, size)
      this.buf = this.buf.subarray(size)
      const w = this.waiting.shift()
      if (!w) continue
      if (body[0] !== 0) w.reject(new Error('PINE call failed'))
      else w.resolve(Buffer.from(body.subarray(1)))
    }
  }

  private call(payload: Buffer): Promise<Buffer> {
    const s = this.sock
    if (!s) return Promise.reject(new Error('PINE not connected'))
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error('PINE timed out'))
        this.close()
      }, 1000)
      this.waiting.push({
        resolve: (b) => {
          clearTimeout(t)
          resolve(b)
        },
        reject: (e) => {
          clearTimeout(t)
          reject(e)
        }
      })
      const head = Buffer.alloc(4)
      head.writeUInt32LE(payload.length + 4)
      s.write(Buffer.concat([head, payload]))
    })
  }

  private read(op: number, addr: number): Promise<Buffer> {
    const p = Buffer.alloc(5)
    p.writeUInt8(op, 0)
    p.writeUInt32LE(addr, 1)
    return this.call(p)
  }

  async u8(addr: number): Promise<number> {
    return (await this.read(OP.r8, addr)).readUInt8(0)
  }
  async u32(addr: number): Promise<Buffer> {
    return this.read(OP.r32, addr)
  }
  async f32(addr: number): Promise<number> {
    return (await this.u32(addr)).readFloatLE(0)
  }
  async i32(addr: number): Promise<number> {
    return (await this.u32(addr)).readInt32LE(0)
  }
  async gameId(): Promise<string> {
    const out = await this.call(Buffer.from([OP.id]))
    const n = out.readUInt32LE(0)
    return out.subarray(4, 4 + n).toString('utf8').replace(/\0+$/, '')
  }
}

export class Marathon {
  private readonly file: string
  private readonly pine: Pine
  private saved: Saved
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private nextTry = 0
  private game: string | null = null
  // the play counter
  private live = false
  private los = 0
  private lastBall = 0
  private prevSpot: number | null = null
  private prevBall: number | null = null
  /** A play may start: false after a jump until the ball has been dead (no live ball) again. */
  private armed = true
  private prevClock: number | null = null
  private view: MarathonState
  private clockAt = 0
  private clockSaved = 0
  onUpdate: (s: MarathonState) => void = () => {}

  constructor(userData: string) {
    this.file = join(userData, 'marathon.json')
    this.pine = new Pine(join(process.env.TMPDIR || tmpdir(), 'pcsx2.sock'))
    this.saved = this.load()
    this.view = this.make({ connected: false, inGame: false, onOffense: false, live: false })
  }

  private load(): Saved {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>
      const plays = Array.isArray(raw.plays) ? raw.plays.filter((p) => Number.isFinite(p?.yards) && Number.isFinite(p?.at)) : []
      return {
        yards: Number.isFinite(raw.yards) ? Number(raw.yards) : plays.reduce((s, p) => s + p.yards, 0),
        tds: Number.isFinite(raw.tds) ? Number(raw.tds) : plays.filter((p) => p.td).length,
        activeMs: Number.isFinite(raw.activeMs) ? Number(raw.activeMs) : 0,
        plays,
        startedAt: Number(raw.startedAt) || Date.now()
      }
    } catch {
      return { yards: 0, tds: 0, activeMs: 0, plays: [], startedAt: Date.now() }
    }
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.saved))
    renameSync(tmp, this.file)
  }

  private make(p: Pick<MarathonState, 'connected' | 'inGame' | 'onOffense' | 'live'>): MarathonState {
    const last = this.saved.plays[this.saved.plays.length - 1] ?? null
    // The clock is sent rounded to the second (so a push is not every poll); the renderer ticks it on its own.
    return { ...p, yards: this.saved.yards, tds: this.saved.tds, activeMs: Math.floor(this.saved.activeMs / 1000) * 1000, goal: MARATHON_YARDS, plays: this.saved.plays.length, last, startedAt: this.saved.startedAt }
  }

  private publish(p: Pick<MarathonState, 'connected' | 'inGame' | 'onOffense' | 'live'>): void {
    const next = this.make(p)
    const changed = JSON.stringify(next) !== JSON.stringify(this.view)
    this.view = next
    if (changed) this.onUpdate(next)
  }

  state(): MarathonState {
    return this.view
  }

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.pine.close()
  }

  /** Start the marathon over (the plays go with it). */
  reset(): MarathonState {
    this.saved = { yards: 0, tds: 0, activeMs: 0, plays: [], startedAt: Date.now() }
    this.save()
    this.publish(this.view)
    return this.view
  }

  /** Take the last counted play back (a miscount). */
  undo(): MarathonState {
    const p = this.saved.plays.pop()
    if (p) {
      this.saved.yards = Math.round((this.saved.yards - p.yards) * 10) / 10
      if (p.td) this.saved.tds -= 1
      this.save()
      this.publish(this.view)
    }
    return this.view
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      if (!this.pine.open) {
        if (Date.now() < this.nextTry) return
        this.nextTry = Date.now() + RETRY_MS
        if (!existsSync(join(process.env.TMPDIR || tmpdir(), 'pcsx2.sock'))) return this.idle(false)
        await this.pine.connect()
        this.game = await this.pine.gameId().catch(() => null)
      }
      if (this.game !== SERIAL) {
        // Another disc (or none yet): ask again now and then, since the socket outlives a disc change.
        if (Date.now() >= this.nextTry) {
          this.nextTry = Date.now() + RETRY_MS
          this.game = await this.pine.gameId().catch(() => null)
        }
        return this.idle(true)
      }
      const ball = await this.pine.f32(ADDR.ball)
      const spot = await this.pine.f32(ADDR.spot)
      const dead = await this.pine.u8(ADDR.dead)
      const offense = await this.pine.i32(ADDR.offense)
      const clock = await this.pine.f32(ADDR.clock)
      this.step(ball, spot, dead, offense, clock)
    } catch {
      this.pine.close()
      this.idle(false)
    } finally {
      this.busy = false
    }
  }

  private idle(connected: boolean): void {
    this.clockAt = 0
    this.prevClock = null
    this.live = false
    this.prevSpot = null
    this.prevBall = null
    this.publish({ connected, inGame: false, onOffense: false, live: false })
  }

  private step(ball: number, spot: number, dead: number, offense: number, clock: number): void {
    // The marathon clock runs while a round does (gaps over a second — a pause, a sleep — are not counted).
    const now = Date.now()
    if (clock > 0 && this.clockAt && now - this.clockAt < 1000) this.saved.activeMs += now - this.clockAt
    this.clockAt = clock > 0 ? now : 0
    if (now - this.clockSaved > SAVE_CLOCK_MS && clock > 0) {
      this.clockSaved = now
      this.save()
    }
    const hasBall = ball !== NO_BALL && Number.isFinite(ball)
    // THE ROUND CLOCK WENT BACK UP: a new round, or a save state loaded (slot 2, the start of a round, is how
    // Colin goes again after his offense). Forget the old round — its spot and its stale ball — so the first
    // play is counted from the new round's own spot (read this poll), not dropped as a jump.
    if (this.prevClock !== null && clock > this.prevClock + 0.5) {
      this.live = false
      this.armed = true
      this.prevSpot = spot
      this.prevBall = null
      this.prevClock = clock
      this.publish({ connected: true, inGame: clock > 0, onOffense: offense === 0, live: false })
      return
    }
    this.prevClock = clock
    // A jump no run makes: a state load, a menu. Drop the play under way, start clean.
    if (hasBall && this.prevBall !== null && this.prevBall !== NO_BALL && Math.abs(ball - this.prevBall) > JUMP_YD) {
      this.live = false
      this.armed = false
    } else if (!this.live && this.armed && hasBall && dead === 0 && clock > 0 && this.prevSpot !== null) {
      this.live = true
      this.los = this.prevSpot
      this.lastBall = ball
    }
    if (!hasBall) this.armed = true
    if (this.live && hasBall) this.lastBall = ball
    if (this.live && (dead === 1 || !hasBall)) {
      this.live = false
      if (offense === 0) {
        const yards = Math.round((this.lastBall - this.los) * 10) / 10
        const td = this.lastBall >= TD_AT
        this.saved.yards = Math.round((this.saved.yards + yards) * 10) / 10
        if (td) this.saved.tds += 1
        this.saved.plays.push(td ? { yards, at: Date.now(), td } : { yards, at: Date.now() })
        if (this.saved.plays.length > KEEP_PLAYS) this.saved.plays.splice(0, this.saved.plays.length - KEEP_PLAYS)
        this.save()
      }
    }
    this.prevSpot = spot
    this.prevBall = hasBall ? ball : NO_BALL
    this.publish({ connected: true, inGame: clock > 0, onOffense: offense === 0, live: this.live && offense === 0 })
  }
}
