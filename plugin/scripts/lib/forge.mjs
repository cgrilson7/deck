// The forge: a party typed in by name and level, written straight into the game's RAM in the
// shape the game keeps it (the 44-byte party struct, the nickname and OT tables, the Pokédex
// bits), with stats computed the way Gen 1 does and each Pokémon's moves being what it would
// know at that level unless told otherwise. And the warp trick: the current map's warp table
// lives in RAM too, so pointing every door at the Indigo Plateau lobby makes the game's own
// map loader carry you there the next time you walk through one.

import * as Y from './yellow.mjs'

const DATA = Y.DATA
const A = Y.A
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9♂♀]/g, '')

const speciesByName = new Map()
for (const [id, p] of Object.entries(DATA.pokemon)) {
  if (!p.name || p.dex == null) continue
  speciesByName.set(norm(p.name), +id)
  speciesByName.set(norm(p.name).replace('♂', 'm').replace('♀', 'f'), +id)
}
const moveByName = new Map()
for (const [id, m] of Object.entries(DATA.moves)) {
  moveByName.set(norm(m.name), +id)
  moveByName.set(norm(m.const), +id)
}
const typeId = new Map(Object.entries(DATA.types).map(([id, n]) => [n, +id]))
const charCode = new Map()
for (const [code, ch] of Object.entries(DATA.charmap)) if (ch.length === 1 && !charCode.has(ch)) charCode.set(ch, +code)

export function species(name) {
  const id = speciesByName.get(norm(name).replace(/^nidoranmale$/, 'nidoranm').replace(/^nidoranfemale$/, 'nidoranf'))
  if (!id) throw new Error(`no such Pokémon: ${name}`)
  return id
}
export function move(name) {
  const id = moveByName.get(norm(name))
  if (!id) throw new Error(`no such move: ${name}`)
  return id
}

/** The game's text: A–Z, digits, the few marks it has; unknown characters dropped; 0x50 ends it. */
export function encodeText(str, len = 11) {
  const out = new Uint8Array(len).fill(0x50)
  let i = 0
  for (const ch of str) {
    if (i >= len - 1) break
    const code = charCode.get(ch) ?? charCode.get(ch.toUpperCase())
    if (code != null) out[i++] = code
  }
  return out
}

const GROWTH = {
  MEDIUM_FAST: (n) => n ** 3,
  SLIGHTLY_FAST: (n) => n ** 3,
  SLIGHTLY_SLOW: (n) => n ** 3,
  MEDIUM_SLOW: (n) => Math.floor(1.2 * n ** 3 - 15 * n ** 2 + 100 * n - 140),
  FAST: (n) => Math.floor(0.8 * n ** 3),
  SLOW: (n) => Math.floor(1.25 * n ** 3)
}

/** Gen 1's stat formula: ((base + DV) × 2 + ⌈√statExp⌉ / 4) × level / 100, + level + 10 for HP, + 5 otherwise. */
function stat(base, dv, statExp, level, hp) {
  const v = Math.floor(((base + dv) * 2 + Math.floor(Math.ceil(Math.sqrt(statExp)) / 4)) * level / 100)
  return v + (hp ? level + 10 : 5)
}

/** The moves a species knows at `level` by levelling alone: its starting moves, then each level-up move, the last four kept. */
export function movesAtLevel(id, level) {
  const p = DATA.pokemon[id]
  const list = [...(p.start ?? [])]
  for (const [lv, mv] of p.learnset ?? []) if (lv <= level && !list.includes(mv)) list.push(mv)
  return list.slice(-4).map(move)
}

/**
 * One party member as the game stores it. `moves` are names (or ids); missing ones come from
 * the learnset. `dv` 0–15 applies to every stat; `statExp` 0–65535 the same (65535 = fully trained).
 */
export function buildMon({ name, level, moves, dv = 15, statExp = 65535, otId = 0, otName = 'RED', nick }) {
  const id = species(name)
  const p = DATA.pokemon[id]
  level = Math.max(1, Math.min(100, level | 0))
  const moveIds = (moves && moves.length ? moves.map((m) => (typeof m === 'number' ? m : move(m))) : movesAtLevel(id, level)).slice(0, 4)
  while (moveIds.length < 4) moveIds.push(0)
  const s = new Uint8Array(44)
  const w16 = (o, v) => {
    s[o] = (v >> 8) & 0xff
    s[o + 1] = v & 0xff
  }
  const maxHp = stat(p.hp, dv, statExp, level, true)
  s[0] = id
  w16(1, maxHp)
  s[3] = level
  s[4] = 0
  s[5] = typeId.get(p.types[0]) ?? 0
  s[6] = typeId.get(p.types[1] ?? p.types[0]) ?? s[5]
  s[7] = p.catchRate ?? 45
  moveIds.forEach((m, i) => (s[8 + i] = m))
  w16(12, otId)
  const exp = GROWTH[p.growth ?? 'MEDIUM_FAST'](level)
  s[14] = (exp >> 16) & 0xff
  s[15] = (exp >> 8) & 0xff
  s[16] = exp & 0xff
  for (let i = 0; i < 5; i++) w16(17 + i * 2, statExp)
  s[27] = (dv << 4) | dv
  s[28] = (dv << 4) | dv
  moveIds.forEach((m, i) => (s[29 + i] = m ? DATA.moves[m].pp : 0))
  s[33] = level
  w16(34, maxHp)
  w16(36, stat(p.atk, dv, statExp, level))
  w16(38, stat(p.def, dv, statExp, level))
  w16(40, stat(p.spd, dv, statExp, level))
  w16(42, stat(p.spc, dv, statExp, level))
  return { id, name: p.name, level, dex: p.dex, struct: s, nick: encodeText((nick ?? p.name).toUpperCase().replace(/[ .]/g, '')), ot: encodeText(otName), moves: moveIds.map((m) => (m ? DATA.moves[m].name : '-')), maxHp }
}

/** "Alakazam 65: Psychic, Recover, Thunder Wave, Reflect; Snorlax 65; Zapdos 60" → the entries. */
export function parseTeam(spec) {
  return spec
    .split(/\s*[;/|]\s*|\s*\n\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [head, tail] = entry.split(/\s*:\s*/)
      const m = head.match(/^(.+?)\s*(?:L|lv|level)?\s*(\d+)?$/i)
      const name = (m?.[1] ?? head).trim()
      const level = m?.[2] ? +m[2] : 50
      const moves = tail ? tail.split(/\s*,\s*/).filter(Boolean) : null
      return { name, level, moves }
    })
    .slice(0, 6)
}

const b64 = (u8) => Buffer.from(u8).toString('base64')

/**
 * Write a party (1–6). Replaces what is there, or with `add` appends to it (up to six). The
 * Pokédex learns each one as seen and owned. `ot` names another trainer as the original one
 * (a traded Pokémon: it obeys by badges, like the game's own trades).
 */
export async function writeParty(door, team, opts = {}) {
  const [nameBytes, idBytes, dexOwned, dexSeen, had] = (
    await door.call({ op: 'ram', ranges: [[A.wPlayerName, 11], [A.wPlayerID, 2], [A.wPokedexOwned, 19], [A.wPokedexSeen, 19], [A.wPartyCount, A.wPartyMonNicks + 66 - A.wPartyCount]] })
  ).data.map((d) => new Uint8Array(Buffer.from(d, 'base64')))
  const otName = opts.ot ?? (Y.decodeName(nameBytes) || 'RED')
  const otId = opts.ot ? ((idBytes[0] << 8) | idBytes[1]) ^ 0x5a5a : (idBytes[0] << 8) | idBytes[1]
  const keep = opts.add ? Math.min(had[0], 6) : 0
  if (keep + team.length > 6) throw new Error(`the party holds six: ${keep} there already, ${team.length} more asked for`)
  const mons = team.map((t) => buildMon({ ...t, dv: opts.dv ?? 15, statExp: opts.statExp ?? 65535, otId, otName }))
  const n = keep + mons.length
  const P = (sym) => A[sym] - A.wPartyCount
  const speciesList = new Uint8Array(7).fill(0xff)
  const structs = new Uint8Array(6 * 44)
  const nicks = new Uint8Array(6 * 11).fill(0x50)
  const ots = new Uint8Array(6 * 11).fill(0x50)
  if (keep) {
    speciesList.set(had.subarray(P('wPartySpecies'), P('wPartySpecies') + keep))
    structs.set(had.subarray(P('wPartyMon1'), P('wPartyMon1') + keep * 44))
    ots.set(had.subarray(P('wPartyMonOT'), P('wPartyMonOT') + keep * 11))
    nicks.set(had.subarray(P('wPartyMonNicks'), P('wPartyMonNicks') + keep * 11))
  }
  mons.forEach((m, j) => {
    const i = keep + j
    speciesList[i] = m.id
    structs.set(m.struct, i * 44)
    nicks.set(m.nick, i * 11)
    ots.set(m.ot, i * 11)
    if (m.dex) {
      const bit = m.dex - 1
      dexOwned[bit >> 3] |= 1 << (bit & 7)
      dexSeen[bit >> 3] |= 1 << (bit & 7)
    }
  })
  await door.call({
    op: 'poke',
    writes: [
      [A.wPartyCount, b64(new Uint8Array([n]))],
      [A.wPartySpecies, b64(speciesList)],
      [A.wPartyMon1, b64(structs)],
      [A.wPartyMonOT, b64(ots)],
      [A.wPartyMonNicks, b64(nicks)],
      [A.wPokedexOwned, b64(dexOwned)],
      [A.wPokedexSeen, b64(dexSeen)]
    ]
  })
  return mons
}

export async function setBadges(door, mask = 0xff) {
  await door.call({ op: 'poke', writes: [[A.wObtainedBadges, b64(new Uint8Array([mask & 0xff]))]] })
}

export async function setMoney(door, amount) {
  const v = Math.max(0, Math.min(999999, amount | 0))
  const s = String(v).padStart(6, '0')
  const bytes = new Uint8Array(3)
  for (let i = 0; i < 3; i++) bytes[i] = (Number(s[i * 2]) << 4) | Number(s[i * 2 + 1])
  await door.call({ op: 'poke', writes: [[A.wPlayerMoney, b64(bytes)]] })
}

/**
 * Point every warp of the CURRENT map (the copy the game keeps in RAM) at `mapConst`'s warp
 * `warpId`, so the next door taken leads there. wLastMap is set to an outdoor map that has a
 * door into the target, so "back outside" from there makes sense too.
 */
export async function pointWarps(door, mapConst, warpId = 1) {
  const to = Y.mapByConst.get(mapConst)
  if (!to) throw new Error(`no such map ${mapConst}`)
  const [countBytes] = (await door.call({ op: 'ram', ranges: [[A.wNumberOfWarps, 1]] })).data.map((d) => new Uint8Array(Buffer.from(d, 'base64')))
  const count = Math.min(countBytes[0], 32)
  if (!count) throw new Error('this map has no doors to bend; go somewhere with one')
  const [entries] = (await door.call({ op: 'ram', ranges: [[A.wWarpEntries, count * 4]] })).data.map((d) => new Uint8Array(Buffer.from(d, 'base64')))
  for (let i = 0; i < count; i++) {
    entries[i * 4 + 2] = warpId - 1
    entries[i * 4 + 3] = to.id
  }
  const outside = DATA.maps.find((m) => m.warps.some((w) => w.map === to.const) && m.connections.length)
  const writes = [[A.wWarpEntries, b64(entries)]]
  if (outside) writes.push([A.wLastMap, b64(new Uint8Array([outside.id]))])
  await door.call({ op: 'poke', writes })
  return { count, outside: outside?.const ?? null }
}

/** A team that walks through the Elite Four: Psychic and Electric coverage, two sponges, Pikachu up front because it is Yellow. */
export const ELITE_TEAM = [
  { name: 'Pikachu', level: 65, moves: ['Thunderbolt', 'Thunder Wave', 'Quick Attack', 'Body Slam'] },
  { name: 'Alakazam', level: 65, moves: ['Psychic', 'Recover', 'Thunder Wave', 'Seismic Toss'] },
  { name: 'Starmie', level: 65, moves: ['Surf', 'Psychic', 'Thunderbolt', 'Recover'] },
  { name: 'Snorlax', level: 65, moves: ['Body Slam', 'Earthquake', 'Rest', 'Amnesia'] },
  { name: 'Zapdos', level: 65, moves: ['Thunderbolt', 'Drill Peck', 'Thunder Wave', 'Agility'] },
  { name: 'Tauros', level: 65, moves: ['Body Slam', 'Hyper Beam', 'Earthquake', 'Blizzard'] }
]
