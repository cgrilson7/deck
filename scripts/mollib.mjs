#!/usr/bin/env node
// Regenerates src/main/data/molLibrary.ts, the Molecule tile's built-in library: the small
// molecules a first chemistry lesson needs, with 3D coordinates and per-atom partial charges,
// so `show water --labels charges` works offline and at once.
//
//   node scripts/mollib.mjs
//
// Most entries are PubChem's computed 3D conformer (PUG REST, `record_type=3d`: MMFF94-optimised),
// whose SDF carries PUBCHEM_MMFF94_PARTIAL_CHARGES — those are the charges kept. PubChem has no
// 3D record for H2, for a salt, or for a complex, so three are written by hand below: H2 (the
// experimental bond length, no charges), the NaCl gas-phase ion pair (experimental distance,
// FORMAL ±1 charges) and the hydrogen-bonded water dimer (experimental monomer geometry, the
// O···O distance and acceptor tilt of the gas-phase dimer, water's MMFF94 charges).

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'data', 'molLibrary.ts')

const MMFF = 'MMFF94 partial charges, from PubChem’s computed 3D conformer'

/** key, display name, formula, what to ask PubChem for, other names `show` takes. */
const PUBCHEM = [
  ['o2', 'Oxygen', 'O₂', 'oxygen', ['oxygen', 'dioxygen']],
  ['n2', 'Nitrogen', 'N₂', 'nitrogen', ['nitrogen', 'dinitrogen']],
  ['water', 'Water', 'H₂O', 'water', ['h2o']],
  ['methane', 'Methane', 'CH₄', 'methane', ['ch4']],
  ['ammonia', 'Ammonia', 'NH₃', 'ammonia', ['nh3']],
  ['co2', 'Carbon dioxide', 'CO₂', 'carbon dioxide', ['carbon dioxide', 'carbon-dioxide']],
  ['methanol', 'Methanol', 'CH₃OH', 'methanol', ['ch3oh']],
  ['ethanol', 'Ethanol', 'C₂H₅OH', 'ethanol', ['c2h5oh']],
  ['acetic-acid', 'Acetic acid', 'CH₃COOH', 'acetic acid', ['acetic acid', 'ch3cooh', 'acetate']],
  ['benzene', 'Benzene', 'C₆H₆', 'benzene', ['c6h6']],
  ['glycine', 'Glycine', 'C₂H₅NO₂', 'glycine', ['gly']],
  ['alanine', 'Alanine', 'C₃H₇NO₂', 'L-alanine', ['ala', 'l-alanine']],
  ['gly-ala', 'Gly-Ala dipeptide', 'C₅H₁₀N₂O₃', 'glycylalanine', ['glyala', 'glycylalanine', 'gly-ala dipeptide', 'dipeptide']]
]

const f = (n) => n.toFixed(4).padStart(10)
function molblock(title, atoms, bonds, chg = []) {
  const lines = [title, '  deck scripts/mollib.mjs', '']
  lines.push(`${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`)
  for (const [el, x, y, z] of atoms) lines.push(`${f(x)}${f(y)}${f(z)} ${el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`)
  for (const [a, b, o] of bonds) lines.push(`${String(a).padStart(3)}${String(b).padStart(3)}${String(o).padStart(3)}  0  0  0  0`)
  if (chg.length) lines.push(`M  CHG${String(chg.length).padStart(3)}${chg.map(([i, q]) => `${String(i).padStart(4)}${String(q).padStart(4)}`).join('')}`)
  lines.push('M  END', '$$$$', '')
  return lines.join('\n')
}

function waterDimer() {
  const R = 0.9572
  const HOH = (104.52 * Math.PI) / 180
  // The donor lies in the xz mirror plane, one O–H along +x at the acceptor's oxygen.
  const d = [
    ['O', 0, 0, 0],
    ['H', R, 0, 0],
    ['H', R * Math.cos(HOH), 0, -R * Math.sin(HOH)]
  ]
  // The acceptor, 2.98 Å away, its bisector tilted 57° off the O···O axis, its hydrogens either side of the plane.
  const tilt = (57 * Math.PI) / 180
  const half = HOH / 2
  const b = [Math.cos(tilt), 0, Math.sin(tilt)]
  const a = [
    ['O', 2.98, 0, 0],
    ['H', 2.98 + R * Math.cos(half) * b[0], R * Math.sin(half), R * Math.cos(half) * b[2]],
    ['H', 2.98 + R * Math.cos(half) * b[0], -R * Math.sin(half), R * Math.cos(half) * b[2]]
  ]
  return [...d, ...a]
}

const HAND = [
  {
    key: 'h2',
    name: 'Hydrogen',
    formula: 'H₂',
    aliases: ['hydrogen', 'dihydrogen'],
    sdf: molblock('hydrogen', [['H', -0.3707, 0, 0], ['H', 0.3707, 0, 0]], [[1, 2, 1]]),
    charges: [0, 0],
    method: 'a homonuclear bond shares its electrons evenly: no partial charges (bond length 0.741 Å, experimental)'
  },
  {
    key: 'nacl',
    name: 'Sodium chloride (ion pair)',
    formula: 'NaCl',
    aliases: ['sodium chloride', 'salt', 'na+cl-'],
    sdf: molblock('sodium chloride ion pair', [['Na', -1.1805, 0, 0], ['Cl', 1.1805, 0, 0]], [], [[1, 1], [2, -1]]),
    charges: [1, -1],
    method: 'FORMAL ionic charges (the gas-phase pair really carries about ±0.8); Na–Cl 2.361 Å, experimental; no covalent bond drawn'
  },
  {
    key: 'water-dimer',
    name: 'Water dimer (hydrogen-bonded)',
    formula: '(H₂O)₂',
    aliases: ['water dimer', 'h2o-dimer', 'waters'],
    sdf: molblock('water dimer', waterDimer(), [[1, 2, 1], [1, 3, 1], [4, 5, 1], [4, 6, 1]]),
    charges: [-0.86, 0.43, 0.43, -0.86, 0.43, 0.43],
    method: 'water’s MMFF94 charges on each monomer; geometry by hand: experimental monomers, O···O 2.98 Å, a linear O–H···O, the acceptor tilted 57°'
  }
]

/** The `n` charges of an SDF's PUBCHEM_MMFF94_PARTIAL_CHARGES field (atoms it leaves out are 0). */
function charges(sdf, n) {
  const out = new Array(n).fill(0)
  const m = /> <PUBCHEM_MMFF94_PARTIAL_CHARGES>\n(\d+)\n([\s\S]*?)\n\n/.exec(sdf)
  if (m) for (const line of m[2].split('\n')) {
    const [i, q] = line.trim().split(/\s+/).map(Number)
    if (i >= 1 && i <= n && Number.isFinite(q)) out[i - 1] = q
  }
  return out
}

const entries = []
for (const [key, name, formula, query, aliases] of PUBCHEM) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(query)}/SDF?record_type=3d`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${query}: HTTP ${res.status}`)
  const sdf = (await res.text()).replace(/\r/g, '')
  const n = Number(sdf.split('\n')[3].slice(0, 3))
  const cid = sdf.split('\n')[0].trim()
  const block = sdf.slice(0, sdf.indexOf('M  END') + 6).split('\n')
  block[0] = query
  block[1] = `  PubChem CID ${cid}, 3D conformer`
  entries.push({ key, name, formula, aliases, sdf: block.join('\n') + '\n$$$$\n', charges: charges(sdf, n), method: `${MMFF} (CID ${cid})` })
  console.log(`${key}: ${n} atoms, CID ${cid}`)
  await new Promise((r) => setTimeout(r, 250))
}

const ORDER = ['h2', 'o2', 'n2', 'water', 'methane', 'ammonia', 'co2', 'nacl', 'methanol', 'ethanol', 'acetic-acid', 'benzene', 'water-dimer', 'glycine', 'alanine', 'gly-ala']
const all = [...entries, ...HAND].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))

const ts = `// GENERATED by scripts/mollib.mjs — do not edit by hand; its header says where each entry comes from.
// The Molecule tile's built-in library: 3D coordinates (an SDF molblock) and per-atom partial
// charges, in atom order. \`method\` says how each entry's charges were come by.

export interface MolLibraryEntry {
  key: string
  name: string
  formula: string
  aliases: string[]
  sdf: string
  charges: number[]
  method: string
}

export const MOL_LIBRARY: MolLibraryEntry[] = ${JSON.stringify(all, null, 2)}
`
writeFileSync(OUT, ts)
console.log(`wrote ${OUT} (${all.length} molecules)`)
