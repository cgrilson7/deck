// The PS1 tile's main side. The emulator runs in the RENDERER (lib/ps1.ts: Nostalgist driving
// RetroArch's pcsx_rearmed core, compiled to wasm); what main owns is what the renderer cannot do alone:
//
// - THE `psx:` SCHEME, the Posture way (`pose:`): the packaged window's file:// page cannot fetch
//   files, so everything the emulator loads comes over it —
//     psx://core/pcsx_rearmed_libretro.{js,wasm}   the core, downloaded ONCE into userData/ps1/core
//                                                  (the zip Nostalgist itself would fetch, version-pinned)
//     psx://bios/<file>                            a BIOS from `ps1BiosDir` (DuckStation's folder by default)
//     psx://disc/<id>/<file>                       a disc's files (the .cue and its .bin tracks), <id> naming
//                                                  a folder `listDiscs` found under `ps1DiscDir` — nothing else is served
// - THE DISCS: .cue / .chd / .pbp / .iso under `ps1DiscDir`, four folders deep.
// - THE RAM FINDER'S SAMPLE (`info`): the boot executable read straight off the disc image (ISO 9660 →
//   SYSTEM.CNF → BOOT → the PS-X EXE header), a few 64-byte runs of its code with the RAM address each
//   loads at. The core keeps the PS1's 2 MB of RAM somewhere in its wasm heap and exports no pointer to
//   it, so the renderer finds it by looking for this code.
// - SAVES under userData/ps1/<disc>/: the memory card (card.srm), three state slots and named checkpoints,
//   the door's screenshots (four in rotation).

import { net, protocol } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { Ps1Disc, Ps1DiscInfo } from '../shared/types'

export const PSX_SCHEME = 'psx'
export const PSX_SCHEME_ENTRY = { scheme: PSX_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }

const CORE = 'pcsx_rearmed'
/** The build Nostalgist 0.23 fetches by default (its `coreVersion`), pinned so a download never changes under a save state. */
const CORE_ZIP = `https://cdn.jsdelivr.net/gh/arianrhodsandlot/retroarch-emscripten-build@v1.22.2/retroarch/${CORE}_libretro.zip`
const CORE_FILES = new Set([`${CORE}_libretro.js`, `${CORE}_libretro.wasm`])
const DISC_EXTS = new Set(['.cue', '.chd', '.pbp', '.iso'])
/** The names pcsx_rearmed looks for in RetroArch's system folder, in its order of preference. */
const BIOS_NAMES = ['scph101.bin', 'scph7001.bin', 'scph5501.bin', 'scph1001.bin']
const SKIP_DIRS = new Set(['node_modules', '.git', 'Library', 'Applications'])

function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}
const idOf = (dir: string) => createHash('sha1').update(dir).digest('hex').slice(0, 16)

export class Ps1 {
  private readonly dir: string
  private readonly coreDir: string
  private coreJob: Promise<string> | null = null
  /** Folders a disc was found in, by id: the only places `psx://disc/` reads from. */
  private discDirs = new Map<string, string>()
  private shots = 0

  constructor(
    userData: string,
    private readonly settings: () => { ps1DiscDir: string; ps1BiosDir: string }
  ) {
    this.dir = join(userData, 'ps1')
    this.coreDir = join(this.dir, 'core')
  }

  /** After `ready`: answer `psx://…` on the default session (the deck window's). */
  serve(): void {
    protocol.handle(PSX_SCHEME, async (req) => {
      const { host, pathname } = new URL(req.url)
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
      try {
        let file: string | null = null
        if (host === 'core' && parts.length === 1 && CORE_FILES.has(parts[0])) file = join(await this.core(), parts[0])
        if (host === 'bios' && parts.length === 1) file = this.biosFile(parts[0])
        if (host === 'disc' && parts.length === 2) file = this.discFile(parts[0], parts[1])
        if (!file) return new Response('not found', { status: 404 })
        const res = await net.fetch(pathToFileURL(file).toString())
        const name = parts[parts.length - 1]
        const type = name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'
        return new Response(res.body, { headers: { 'content-type': type, 'access-control-allow-origin': '*' } })
      } catch (err) {
        return new Response(String((err as Error)?.message ?? err), { status: 502 })
      }
    })
  }

  /** The core's folder, downloaded and unzipped the first time (one download however many ask at once). */
  private core(): Promise<string> {
    if ([...CORE_FILES].every((f) => existsSync(join(this.coreDir, f)))) return Promise.resolve(this.coreDir)
    if (this.coreJob) return this.coreJob
    this.coreJob = (async () => {
      const res = await net.fetch(CORE_ZIP)
      if (!res.ok) throw new Error(`the PS1 core did not download (HTTP ${res.status})`)
      const tmp = this.coreDir + '.part'
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      const zip = join(tmp, 'core.zip')
      writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
      await promisify(execFile)('/usr/bin/unzip', ['-o', '-q', zip, '-d', tmp])
      for (const f of CORE_FILES) if (!existsSync(join(tmp, f))) throw new Error(`the PS1 core's zip has no ${f}`)
      rmSync(zip)
      rmSync(this.coreDir, { recursive: true, force: true })
      renameSync(tmp, this.coreDir)
      return this.coreDir
    })().finally(() => {
      this.coreJob = null
    })
    return this.coreJob
  }

  // ---- the BIOS --------------------------------------------------------------------

  private biosDir(): string {
    return expandHome(this.settings().ps1BiosDir)
  }

  /** The BIOS to boot with: a 512 KB .bin in the BIOS folder, a name pcsx_rearmed knows first. `as` is the name it is written under in the core's system folder. */
  bios(): { file: string; url: string; as: string } | null {
    const dir = this.biosDir()
    let names: string[]
    try {
      names = readdirSync(dir).filter((f) => /\.bin$/i.test(f) && statSync(join(dir, f)).size === 512 * 1024)
    } catch {
      return null
    }
    if (!names.length) return null
    const rank = (f: string) => {
      const i = BIOS_NAMES.indexOf(f.toLowerCase())
      return i < 0 ? -1 : i
    }
    const file = [...names].sort((a, b) => rank(b) - rank(a) || a.localeCompare(b))[0]
    const known = rank(file) >= 0
    return { file, url: `psx://bios/${encodeURIComponent(file)}`, as: known ? file.toLowerCase() : 'scph1001.bin' }
  }

  private biosFile(name: string): string | null {
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) return null
    const f = join(this.biosDir(), name)
    return existsSync(f) ? f : null
  }

  // ---- discs -----------------------------------------------------------------------

  /** Every disc under the disc folder (four folders deep), its files as `psx://disc/` URLs. */
  listDiscs(): Ps1Disc[] {
    const root = expandHome(this.settings().ps1DiscDir)
    const out: Ps1Disc[] = []
    const walk = (dir: string, depth: number) => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (depth < 4 && !SKIP_DIRS.has(e.name)) walk(p, depth + 1)
          continue
        }
        const ext = extname(e.name).toLowerCase()
        if (!DISC_EXTS.has(ext)) continue
        // A .bin is never listed on its own: it is a .cue's track.
        const files = ext === '.cue' ? [e.name, ...cueFiles(p)] : [e.name]
        if (files.slice(1).some((f) => !existsSync(join(dir, f)))) continue
        const id = idOf(dir)
        this.discDirs.set(id, dir)
        out.push({ name: basename(e.name, extname(e.name)), path: p, files: files.map((f) => ({ name: f, url: `psx://disc/${id}/${encodeURIComponent(f)}` })) })
      }
    }
    walk(root, 0)
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** A disc by its path, if it is (still) under the disc folder. */
  disc(path: string): Ps1Disc | null {
    return this.listDiscs().find((d) => d.path === path) ?? null
  }

  private discFile(id: string, name: string): string | null {
    const dir = this.discDirs.get(id)
    if (!dir || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null
    const f = join(dir, name)
    // The folder must still be under the disc folder (a setting may have changed since it was listed).
    const root = realpathSync(expandHome(this.settings().ps1DiscDir))
    const real = existsSync(f) ? realpathSync(f) : null
    return real && (real + sep).startsWith(root + sep) ? real : null
  }

  /** The disc's boot executable and the RAM finder's samples; null when the image is not one this can read (a .chd, a .pbp). */
  info(path: string): Ps1DiscInfo | null {
    try {
      return readDiscInfo(path)
    } catch {
      return null
    }
  }

  // ---- saves -----------------------------------------------------------------------

  private saveDir(disc: string): string {
    const d = join(this.dir, 'saves', sanitize(disc))
    mkdirSync(d, { recursive: true })
    return d
  }
  private statePath(disc: string, slot: number | string): string {
    const tag = typeof slot === 'string' ? `-${sanitize(slot)}` : String(Math.max(0, Math.min(2, slot | 0)))
    return join(this.saveDir(disc), `state${tag}.state`)
  }
  saveState(disc: string, slot: number | string, data: Uint8Array): void {
    atomic(this.statePath(disc, slot), data)
  }
  loadState(disc: string, slot: number | string): Uint8Array | null {
    const p = this.statePath(disc, slot)
    return existsSync(p) ? readFileSync(p) : null
  }
  /** The named checkpoints a disc has (the door's `state save <name>`). */
  states(disc: string): string[] {
    try {
      return readdirSync(this.saveDir(disc))
        .map((f) => /^state-(.+)\.state$/.exec(f)?.[1])
        .filter((n): n is string => !!n)
    } catch {
      return []
    }
  }
  saveCard(disc: string, data: Uint8Array): void {
    if (data.length) atomic(join(this.saveDir(disc), 'card.srm'), data)
  }
  loadCard(disc: string): Uint8Array | null {
    const p = join(this.saveDir(disc), 'card.srm')
    return existsSync(p) ? readFileSync(p) : null
  }
  /** The door's screenshots: four files in rotation under ps1/shots, so the folder never grows. */
  shot(bytes: Uint8Array): string {
    const dir = join(this.dir, 'shots')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, `screen-${(this.shots++ % 4) + 1}.png`)
    writeFileSync(p, Buffer.from(bytes))
    return p
  }
}

function atomic(p: string, data: Uint8Array): void {
  writeFileSync(p + '.part', Buffer.from(data))
  renameSync(p + '.part', p)
}

/** The FILE lines of a cue sheet, in order. */
function cueFiles(cue: string): string[] {
  try {
    return [...readFileSync(cue, 'utf8').matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/gim)].map((m) => basename(m[1] ?? m[2]))
  } catch {
    return []
  }
}

// ---- reading a disc image: just enough ISO 9660 to find the boot executable ----------------

interface Image {
  /** 2048 bytes of user data of sector `lba`. */
  sector(lba: number): Buffer
  close(): void
}

function openImage(path: string): Image | null {
  const ext = extname(path).toLowerCase()
  let file = path
  let stride = 2048
  let offset = 0
  if (ext === '.cue') {
    const text = readFileSync(path, 'utf8')
    const first = cueFiles(path)[0]
    if (!first) return null
    file = join(dirname(path), first)
    const mode = /TRACK\s+\d+\s+(MODE1|MODE2)\/(2352|2048|2336)/i.exec(text)
    if (!mode) return null
    stride = Number(mode[2])
    offset = stride === 2352 ? (mode[1].toUpperCase() === 'MODE1' ? 16 : 24) : stride === 2336 ? 8 : 0
  } else if (ext !== '.iso') return null
  const fd = openSync(file, 'r')
  return {
    sector(lba) {
      const b = Buffer.alloc(2048)
      readSync(fd, b, 0, 2048, lba * stride + offset)
      return b
    },
    close: () => closeSync(fd)
  }
}

interface Entry {
  name: string
  lba: number
  size: number
  dir: boolean
}

function readDir(img: Image, lba: number, size: number): Entry[] {
  const out: Entry[] = []
  for (let s = 0; s < Math.ceil(size / 2048); s++) {
    const b = img.sector(lba + s)
    let i = 0
    while (i < 2048 && b[i] > 0) {
      const len = b[i]
      const nameLen = b[i + 32]
      const name = b.subarray(i + 33, i + 33 + nameLen).toString('latin1')
      if (nameLen > 1 || (name !== '\0' && name !== '\x01')) out.push({ name: name.replace(/;\d+$/, ''), lba: b.readUInt32LE(i + 2), size: b.readUInt32LE(i + 10), dir: (b[i + 25] & 2) !== 0 })
      i += len
    }
  }
  return out
}

function readFile(img: Image, e: Entry, max: number): Buffer {
  const n = Math.min(e.size, max)
  const parts: Buffer[] = []
  for (let s = 0; s * 2048 < n; s++) parts.push(img.sector(e.lba + s))
  return Buffer.concat(parts).subarray(0, n)
}

function readDiscInfo(path: string): Ps1DiscInfo | null {
  const img = openImage(path)
  if (!img) return null
  try {
    const pvd = img.sector(16)
    if (pvd.subarray(1, 6).toString('latin1') !== 'CD001') return null
    const volume = pvd.subarray(40, 72).toString('latin1').trim()
    const root: Entry = { name: '', lba: pvd.readUInt32LE(156 + 2), size: pvd.readUInt32LE(156 + 10), dir: true }
    const find = (p: string): Entry | null => {
      let cur: Entry | null = root
      for (const part of p.split(/[\\/]/).filter(Boolean)) {
        if (!cur?.dir) return null
        cur = readDir(img, cur.lba, cur.size).find((e) => e.name.toUpperCase() === part.toUpperCase()) ?? null
      }
      return cur
    }
    const cnf = find('SYSTEM.CNF')
    const boot = cnf ? /BOOT\s*=\s*cdrom:?\\?([^\s;]+)/i.exec(readFile(img, cnf, 2048).toString('latin1'))?.[1] : 'PSX.EXE'
    const exe = boot ? find(boot) : null
    if (!exe) return null
    const head = img.sector(exe.lba)
    if (head.subarray(0, 8).toString('latin1') !== 'PS-X EXE') return null
    const tAddr = head.readUInt32LE(0x18)
    const tSize = head.readUInt32LE(0x1c)
    // Three runs of code from inside the text segment (a game may overwrite some of it later; one surviving is enough).
    const samples: Ps1DiscInfo['samples'] = []
    for (const off of [0x2000, 0x800, 0x8000]) {
      if (off + 64 > tSize) continue
      const sec = img.sector(exe.lba + 1 + Math.floor(off / 2048))
      const at = off % 2048
      const bytes = at + 64 <= 2048 ? sec.subarray(at, at + 64) : Buffer.concat([sec.subarray(at), img.sector(exe.lba + 2 + Math.floor(off / 2048))]).subarray(0, 64)
      samples.push({ addr: ((tAddr & 0x1fffff) + off) >>> 0, hex: bytes.toString('hex') })
    }
    return { volume, serial: basename((boot ?? 'PSX.EXE').replace(/\\/g, '/')), entry: head.readUInt32LE(0x10), textAddr: tAddr, textSize: tSize, samples }
  } finally {
    img.close()
  }
}
