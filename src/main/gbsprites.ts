// The Game Boy's sprites, main's side (docs/sprites.md step 5): a LIBRARY of compiled art under
// userData/pokemon/sprites/ — an overlay place's art (`place.<place>.<art>.json`, a gbplaces.mjs place
// entry) and a patch set's writes for one cartridge (`set.<rom>.<name>.json`, [[offset, base64]…]).
// The renderer's Game Boy keeps what the door installs here (`keep`) and asks for it back whenever the
// `gbPlaces` / `gbPatches` settings want something it does not have in memory — after every ⌘R, at every
// ROM mount. A miss is COMPILED by `plugin/scripts/sprite.mjs build` as a child (Electron as node, like the
// sprite gag's watch): PNG decoding and the ROM tables stay in the CLI, which is where they are tested.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { GB_ARTS, GB_PLACES, GB_SETS, type GbSpriteReq } from '@shared/types'

const NAME = /^[a-z0-9_-]{1,32}$/
/** A compile reads PNGs or walks the ROM's tables: seconds at most, but never a hung child. */
const BUILD_MS = 60_000

const stem = (rom: string): string => basename(rom, extname(rom)).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)

export class GbSprites {
  private dir: string
  /** One compile per entry at a time: a settings change and a mount asking together share it. */
  private building = new Map<string, Promise<unknown>>()

  constructor(
    userData: string,
    /** Absolute path of plugin/scripts/sprite.mjs. */
    private readonly script: string
  ) {
    this.dir = join(userData, 'pokemon', 'sprites')
    mkdirSync(this.dir, { recursive: true })
  }

  /** The library file for a request, or null when the request is malformed. */
  private file(req: GbSpriteReq): string | null {
    if (req?.kind === 'place') return GB_PLACES.includes(req.place) && NAME.test(req.art) ? join(this.dir, `place.${req.place}.${req.art}.json`) : null
    if (req?.kind === 'set') return NAME.test(req.name) && typeof req.rom === 'string' && req.rom ? join(this.dir, `set.${stem(req.rom)}.${req.name}.json`) : null
    return null
  }

  keep(req: GbSpriteReq, data: unknown): void {
    const f = this.file(req)
    if (!f || data == null) return
    writeFileSync(f, JSON.stringify(data))
  }

  /** The library's copy, else a compile when main knows how (an art of GB_ARTS, a set of GB_SETS), else null. */
  async get(req: GbSpriteReq): Promise<unknown> {
    const f = this.file(req)
    if (!f) return null
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, 'utf8'))
      } catch {
        /* a torn file: compile it again */
      }
    }
    const args =
      req.kind === 'place'
        ? GB_ARTS[req.place].includes(req.art)
          ? ['place', req.place, req.art]
          : null
        : GB_SETS.some((s) => s.name === req.name) && existsSync(req.rom)
          ? ['set', req.name, '--rom', req.rom]
          : null
    if (!args) return null
    let job = this.building.get(f)
    if (!job) {
      job = this.build(args).then((data) => {
        writeFileSync(f, JSON.stringify(data))
        return data
      })
      this.building.set(f, job)
      void job.catch(() => {}).finally(() => this.building.delete(f))
    }
    try {
      return await job
    } catch (err) {
      console.warn(`[deck] sprites: could not build ${args.join(' ')}:`, (err as Error).message)
      return null
    }
  }

  private build(args: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.script, 'build', ...args], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let out = ''
      let err = ''
      child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c))
      child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c))
      const timer = setTimeout(() => child.kill('SIGKILL'), BUILD_MS)
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code !== 0) return reject(new Error(err.trim() || `exit ${code}`))
        try {
          resolve(JSON.parse(out))
        } catch {
          reject(new Error('not JSON'))
        }
      })
    })
  }
}
