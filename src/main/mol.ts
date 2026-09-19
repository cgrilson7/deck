// The Molecule tile's disk and network side. The renderer's CSP allows no outbound requests, so
// every structure is resolved HERE — a target string in, the structure's text out — and kept
// under userData/mol/cache, so a second `show 1UBQ` never leaves the machine:
//   a library name (water, glycine…)   data/molLibrary.ts, with partial charges; offline
//   a 4-character PDB id (1UBQ)        files.rcsb.org, mmCIF
//   AF-<uniprot> (AF-P0CG48)           AlphaFold DB (the API names the current file), mmCIF, pLDDT in the B-factor
//   any other name, smiles:<…>, cid:<n>  PubChem's computed 3D conformer, SDF (its MMFF94 charges are kept)
//   an absolute path                   a local .pdb .cif .sdf .mol .mol2 .xyz .cube (the CLI makes paths absolute)

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type { MolFormat, MolLibraryItem, MolStructure } from '@shared/types'
import { MOL_LIBRARY } from './data/molLibrary'

const HEADERS = { 'user-agent': 'deck (a personal Electron app; molecule tile)' }
const FILE_FORMATS: Record<string, MolFormat> = { '.pdb': 'pdb', '.ent': 'pdb', '.cif': 'cif', '.mmcif': 'cif', '.sdf': 'sdf', '.mol': 'sdf', '.mol2': 'mol2', '.xyz': 'xyz', '.cube': 'cube' }
/** A structure file past this is not one to hand a tile (a big ribosome's mmCIF is ~250MB). */
const FILE_MAX = 60 * 1024 * 1024

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)

/** The charges of a PubChem 3D SDF's PUBCHEM_MMFF94_PARTIAL_CHARGES field, in atom order (atoms it leaves out are 0). */
export function sdfCharges(sdf: string): number[] | undefined {
  const text = sdf.replace(/\r/g, '')
  const m = /> <PUBCHEM_MMFF94_PARTIAL_CHARGES>\n(\d+)\n([\s\S]*?)\n\n/.exec(text)
  const n = Number(text.split('\n')[3]?.slice(0, 3))
  if (!m || !Number.isFinite(n) || n <= 0) return undefined
  const out = new Array<number>(n).fill(0)
  for (const line of m[2].split('\n')) {
    const [i, q] = line.trim().split(/\s+/).map(Number)
    if (i >= 1 && i <= n && Number.isFinite(q)) out[i - 1] = q
  }
  return out
}

async function get(url: string, what: string, init?: RequestInit): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { ...HEADERS, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) })
  } catch (err) {
    throw new Error(`could not reach ${new URL(url).host} for ${what} (${err instanceof Error ? err.message : String(err)}); the built-in library (\`list\`) and anything already cached still work offline`)
  }
  if (res.status === 404) throw new Error(`${what}: not found at ${new URL(url).host}`)
  if (!res.ok) throw new Error(`${what}: ${new URL(url).host} answered HTTP ${res.status}`)
  return res.text()
}

export class Mol {
  private readonly dir: string
  private readonly cacheDir: string

  constructor(userData: string) {
    this.dir = join(userData, 'mol')
    this.cacheDir = join(this.dir, 'cache')
    mkdirSync(this.cacheDir, { recursive: true })
  }

  library(): MolLibraryItem[] {
    return MOL_LIBRARY.map((e) => ({ key: e.key, name: e.name, formula: e.formula, atoms: e.charges.length }))
  }

  /** The library and what the cache holds: the `list` command. */
  list(): { library: MolLibraryItem[]; cached: { target: string; file: string; bytes: number }[]; dir: string } {
    let cached: { target: string; file: string; bytes: number }[] = []
    try {
      cached = readdirSync(this.cacheDir)
        .filter((f) => !f.startsWith('.'))
        .map((f) => ({ target: cacheTarget(this.cacheDir, f), file: join(this.cacheDir, f), bytes: statSync(join(this.cacheDir, f)).size }))
        .sort((a, b) => a.target.localeCompare(b.target))
    } catch {
      /* an empty cache */
    }
    return { library: this.library(), cached, dir: this.dir }
  }

  /** The teaching session's eye: `look` writes the viewer's PNG here, always the same file. */
  shot(bytes: Uint8Array, tile = 1): string {
    const p = join(this.dir, tile === 1 ? 'look.png' : `look-${tile}.png`)
    writeFileSync(p, Buffer.from(bytes))
    return p
  }

  private cached(file: string): string | null {
    const p = join(this.cacheDir, file)
    try {
      return statSync(p).size > 0 ? readFileSync(p, 'utf8') : null
    } catch {
      return null
    }
  }

  private keep(file: string, data: string): void {
    try {
      writeFileSync(join(this.cacheDir, file), data)
    } catch {
      /* a cache that cannot be written is only slower */
    }
  }

  async resolve(raw: string): Promise<MolStructure> {
    const target = String(raw ?? '').trim()
    if (!target) throw new Error('show what? a library name (`list`), a PDB id like 1UBQ, AF-<uniprot>, a molecule name, smiles:<…>, or a structure file')

    const lower = target.toLowerCase()
    const lib = MOL_LIBRARY.find((e) => e.key === lower || e.name.toLowerCase() === lower || e.formula.toLowerCase() === lower || e.aliases.includes(lower))
    if (lib) return { target: lib.key, name: lib.name, formula: lib.formula, format: 'sdf', data: lib.sdf, source: 'library', cached: true, charges: lib.charges, chargeMethod: lib.method }

    // A path: the CLI sends absolute ones; `~/` is for the tile's own input line.
    if (target.startsWith('/') || target.startsWith('~/')) {
      const p = target.startsWith('~/') ? join(homedir(), target.slice(2)) : target
      const format = FILE_FORMATS[extname(p).toLowerCase()]
      if (!format) throw new Error(`${basename(p)}: not a structure file the tile reads (${Object.keys(FILE_FORMATS).join(' ')})`)
      if (!existsSync(p)) throw new Error(`no such file: ${p}`)
      const size = statSync(p).size
      if (size > FILE_MAX) throw new Error(`${basename(p)} is ${(size / 1e6).toFixed(0)}MB, more than the tile takes (${FILE_MAX / 1024 / 1024}MB)`)
      const data = readFileSync(p, 'utf8')
      return { target: p, name: basename(p), format, data, source: 'file', cached: false, charges: format === 'sdf' ? sdfCharges(data) : undefined, chargeMethod: format === 'sdf' ? 'MMFF94 partial charges, from the SDF’s PubChem field' : undefined }
    }

    if (/^[0-9][a-z0-9]{3}$/i.test(target)) {
      const id = target.toUpperCase()
      const file = `${id}.cif`
      const hit = this.cached(file)
      const data = hit ?? (await get(`https://files.rcsb.org/download/${id}.cif`, `PDB entry ${id}`))
      if (!hit) this.keep(file, data)
      return { target: id, name: id, format: 'cif', data, source: 'rcsb', cached: !!hit }
    }

    const af = /^af-([a-z0-9]{6,10})(?:-f\d+)?$/i.exec(target)
    if (af) {
      const acc = af[1].toUpperCase()
      const file = `AF-${acc}.cif`
      const hit = this.cached(file)
      let data = hit
      if (!data) {
        // The file's version suffix moves (v4, v6…): the API names the current one.
        const meta = JSON.parse(await get(`https://alphafold.ebi.ac.uk/api/prediction/${acc}`, `AlphaFold model of ${acc}`)) as { cifUrl?: string }[]
        const url = meta[0]?.cifUrl
        if (!url) throw new Error(`AlphaFold DB has no model for UniProt ${acc}`)
        data = await get(url, `AlphaFold model of ${acc}`)
        this.keep(file, data)
      }
      return { target: `AF-${acc}`, name: `AF-${acc}`, format: 'cif', data, source: 'alphafold', cached: !!hit }
    }

    // Anything else is PubChem's: a name, or a SMILES string.
    const smiles = /^smiles:(.+)$/i.exec(target)
    const cid = /^cid:(\d+)$/i.exec(target)
    // A SMILES string does not survive as a file name (C=C and C#C would collide): its hash does.
    const file = smiles ? `smiles_${createHash('sha1').update(smiles[1]).digest('hex').slice(0, 12)}.sdf` : cid ? `cid_${cid[1]}.sdf` : `name_${sanitize(lower)}.sdf`
    const hit = this.cached(file)
    let data = hit
    if (!data) {
      const what = smiles ? `SMILES ${smiles[1]}` : cid ? `PubChem CID ${cid[1]}` : `“${target}”`
      try {
        data = smiles
          ? await get('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/SDF?record_type=3d', what, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: `smiles=${encodeURIComponent(smiles[1])}`
            })
          : await get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${cid ? `cid/${cid[1]}` : `name/${encodeURIComponent(target)}`}/SDF?record_type=3d`, what)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/not found/.test(msg)) throw new Error(`${what}: PubChem has no 3D conformer under that ${smiles ? 'SMILES' : 'name'} (salts, mixtures and very large or floppy molecules have none). Try another name, smiles:<…>, a PDB id, or \`list\` for the built-in library`)
        throw err
      }
      if (!/M {2}END/.test(data)) throw new Error(`${what}: PubChem's answer was not a structure`)
      this.keep(file, data)
    }
    return { target, name: smiles ? smiles[1] : target, format: 'sdf', data, source: 'pubchem', cached: !!hit, charges: sdfCharges(data), chargeMethod: 'MMFF94 partial charges, from PubChem’s computed 3D conformer' }
  }
}

/** A cache file's name back to the target that fetches it. */
function cacheTarget(dir: string, file: string): string {
  const stem = file.replace(/\.[^.]+$/, '')
  if (stem.startsWith('name_')) return stem.slice(5).replace(/_/g, ' ')
  if (stem.startsWith('cid_')) return `cid:${stem.slice(4)}`
  if (stem.startsWith('smiles_')) {
    // The hash cannot be turned back: the SDF's first line is the CID PubChem matched.
    try {
      const first = readFileSync(join(dir, file), 'utf8').slice(0, 40).split('\n')[0].trim()
      if (/^\d+$/.test(first)) return `cid:${first}`
    } catch {
      /* fall through */
    }
  }
  return stem
}
