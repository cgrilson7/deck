import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { homedir } from 'node:os'

const ROM_EXTS = new Set(['.gb', '.gbc'])

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

function expandHome(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

export class Pokemon {
  private dir: string

  constructor(userData: string) {
    this.dir = join(userData, 'pokemon')
    mkdirSync(this.dir, { recursive: true })
  }

  listRoms(romDir: string): { name: string; path: string }[] {
    const dir = expandHome(romDir)
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter((f) => ROM_EXTS.has(extname(f).toLowerCase()))
        .map((f) => ({ name: f, path: join(dir, f) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }

  /** The bytes ride IPC as a Buffer, which the renderer receives as a Uint8Array. */
  loadRom(path: string): { bytes: Uint8Array; name: string } {
    const buf = readFileSync(expandHome(path))
    const name = sanitize(basename(path, extname(path)))
    return { bytes: buf, name }
  }

  saveSram(name: string, data: Uint8Array): void {
    writeFileSync(join(this.dir, `${sanitize(name)}.sav`), Buffer.from(data))
  }

  loadSram(name: string): Uint8Array | null {
    const p = join(this.dir, `${sanitize(name)}.sav`)
    if (!existsSync(p)) return null
    return readFileSync(p)
  }

  /** A numbered slot (the pane's three) or a named checkpoint (the trainer's). */
  private statePath(name: string, slot: number | string): string {
    const tag = typeof slot === 'string' ? `-${sanitize(slot)}` : String(Math.max(0, Math.min(2, slot | 0)))
    return join(this.dir, `${sanitize(name)}.state${tag}`)
  }

  saveState(name: string, slot: number | string, data: Uint8Array): void {
    writeFileSync(this.statePath(name, slot), Buffer.from(data))
  }

  loadState(name: string, slot: number | string): Uint8Array | null {
    const p = this.statePath(name, slot)
    if (!existsSync(p)) return null
    return readFileSync(p)
  }

  private shots = 0

  /** The trainer's screenshots: four files in rotation under pokemon/trainer, so the folder never grows. */
  shot(bytes: Uint8Array): string {
    const dir = join(this.dir, 'trainer')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, `screen-${(this.shots++ % 4) + 1}.png`)
    writeFileSync(p, Buffer.from(bytes))
    return p
  }
}
