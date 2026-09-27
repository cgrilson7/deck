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
  // MEDIUM_SLOW's cubic is negative at level 1 (−54): stored raw it would wrap to 16.7M EXP, the Gen 1
  // "level 1 → 100" glitch. The game's own level-for-EXP loop reads 0 as level 1, so 0 it is.
  const exp = Math.max(0, GROWTH[p.growth ?? 'MEDIUM_FAST'](level))
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
 * Pokédex learns each one as seen and owned, unless `dex: false` (a gift: the game marks it when
 * he looks). `ot` names another trainer as the original one
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
    if (m.dex && opts.dex !== false) {
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

// ---- the box: Bill's PC ---------------------------------------------------------------------
//
// Gen 1 keeps the CURRENT box in WRAM, and the game itself copies it to SRAM (sCurBoxData) at the
// player's next in-game SAVE and whenever he changes boxes — so a gift is a WRAM poke and nothing
// here ever touches a save file. The layout, from pret/pokeyellow's pokeyellow.sym for this very
// cartridge (Yellow UE) and ram/wram.asm's `box_struct`: wBoxCount $DA7F; wBoxSpecies $DA80 (20 +
// the $FF end); wBoxMons $DA95, 20 structs of 33 bytes = the party struct's first 33 (species, HP,
// the level byte at +3, status, types, catch rate, moves, OT id, EXP, stat EXP, DVs, PP — no current
// level, no stats: the game computes those when the mon is withdrawn); wBoxMonOT $DD29 and
// wBoxMonNicks $DE05, 20 × 11 each; wBoxDataEnd $DEE1. Only wBoxCount is in yellow.json; the rest
// are offsets from it, and a cartridge whose wBoxCount is elsewhere is refused.
const BOX_MAX = 20
const BOX_MON = 33
const BOX = { count: 0, species: 1, mons: 0xda95 - 0xda7f, ot: 0xdd29 - 0xda7f, nicks: 0xde05 - 0xda7f, end: 0xdee1 - 0xda7f }

/**
 * A gift: one Pokémon, level 1 unless told otherwise, into the CURRENT BOX (or with `party` the
 * party, appended) with the player's own OT id and name, so it is his and not a trade. EVs 0; DVs
 * `dv` (15 unless told); moves = what it knows at that level; nickname = the species unless `nick`.
 * The Pokédex is left alone. Refuses a full box, and a box whose count and species list disagree.
 * → { mon, where: 'box' | 'party', box (1-based), slot (1-based) }
 */
export async function gift(door, { name, level = 1, nick, party = false, dv = 15 }) {
  if (party) {
    const [had] = (await door.call({ op: 'ram', ranges: [[A.wPartyCount, 1]] })).data.map((d) => new Uint8Array(Buffer.from(d, 'base64')))
    if (had[0] >= 6) throw new Error(`the party is full (${had[0]}/6): leave out --party and it goes into Bill's PC`)
    const [mon] = await writeParty(door, [{ name, level, nick }], { add: true, dex: false, dv, statExp: 0 })
    return { mon, where: 'party', slot: Math.min(had[0], 6) + 1 }
  }
  if (A.wBoxCount !== 0xda7f) throw new Error(`wBoxCount is at $${A.wBoxCount.toString(16)} in this cartridge's data, not $da7f: the box layout here is Yellow UE's`)
  const [nameBytes, idBytes, boxNum, box] = (
    await door.call({ op: 'ram', ranges: [[A.wPlayerName, 11], [A.wPlayerID, 2], [A.wCurrentBoxNum, 1], [A.wBoxCount, BOX.end]] })
  ).data.map((d) => new Uint8Array(Buffer.from(d, 'base64')))
  const n = box[BOX.count]
  if (n >= BOX_MAX) throw new Error(`the current box (${(boxNum[0] & 0x7f) + 1}) is full: ${n}/${BOX_MAX}. Change boxes in Bill's PC, or use --party`)
  const list = box.subarray(BOX.species, BOX.species + BOX_MAX + 1)
  const listed = list.indexOf(0xff)
  if (listed !== n || [...list.subarray(0, n)].some((b) => !DATA.pokemon[b]?.name))
    throw new Error(`the box in RAM does not add up (count ${n}, species list ${[...list.subarray(0, Math.max(n, listed < 0 ? 21 : listed) + 1)].map((b) => b.toString(16)).join(' ')}): not writing into it`)
  const otName = Y.decodeName(nameBytes) || 'RED'
  const otId = (idBytes[0] << 8) | idBytes[1]
  const mon = buildMon({ name, level, nick, dv, statExp: 0, otId, otName })
  const i = n
  await door.call({
    op: 'poke',
    writes: [
      [A.wBoxCount + BOX.mons + i * BOX_MON, b64(mon.struct.subarray(0, BOX_MON))],
      [A.wBoxCount + BOX.ot + i * 11, b64(nameBytes)],
      [A.wBoxCount + BOX.nicks + i * 11, b64(mon.nick)],
      [A.wBoxCount + BOX.species + i, b64(new Uint8Array([mon.id, 0xff]))],
      [A.wBoxCount, b64(new Uint8Array([n + 1]))]
    ]
  })
  return { mon, where: 'box', box: (boxNum[0] & 0x7f) + 1, slot: i + 1 }
}

/**
 * A wild ENCOUNTER on demand: `wCurOpponent` + `wCurEnemyLevel` poked while the player stands free in
 * the overworld, which the game's own overworld loop reads as a wild battle starting (the research
 * harness's trick, docs/sprites/). With `easy`, once the battle has built its enemy copy (wEnemyMon:
 * species, then the stats), that copy's CATCH RATE becomes 255 and its HP a third of the max: Gen 1's
 * first roll (0–255 for a Poké Ball, 0–200 Great, 0–150 Ultra) can never beat 255, and the second is
 * skipped once floor(maxHP·255 / 12 | 8) / floor(HP / 4) ≥ 255, which a third of the HP makes true for
 * every ball. Only the BATTLE copy is touched — nothing an in-game SAVE keeps; the caught mon's own stats
 * are rebuilt from its level. The caller checks the player is free first.
 * → { id, name, level, hp, maxHp, catchRate }
 */
export async function encounter(door, { name, level = 5, easy = false }) {
  const id = species(name)
  const read = async (addr, n) => new Uint8Array(Buffer.from((await door.call({ op: 'ram', ranges: [[addr, n]] })).data[0], 'base64'))
  if ((await read(A.wIsInBattle, 1))[0]) throw new Error('already in a battle')
  await door.call({ op: 'poke', writes: [[A.wCurOpponent, b64(new Uint8Array([id]))], [A.wCurEnemyLevel, b64(new Uint8Array([level]))]] })
  // The intro takes ~300 steps; stop on the enemy's species, then let the stats land after it.
  const r = await door.call({ op: 'hold', keys: [], iterations: 1500, stop: [{ addr: A.wEnemyMon, len: 1, when: 'eq', value: id }], every: 1 })
  if (r.stopped == null) throw new Error('no battle started (was the player free in the overworld?)')
  return settleEnemy(door, id, level, easy, () => door.call({ op: 'hold', keys: [], iterations: 4 }))
}

/** Wait for the battle's enemy copy to carry its stats (the species lands first), then make it easy if asked. */
async function settleEnemy(door, id, level, easy, pause) {
  const read = async (addr, n) => new Uint8Array(Buffer.from((await door.call({ op: 'ram', ranges: [[addr, n]] })).data[0], 'base64'))
  let m
  for (let i = 0; i < 40; i++) {
    m = await read(A.wEnemyMon, 17)
    if (((m[15] << 8) | m[16]) > 0 && m[14] === level) break
    await pause()
  }
  const maxHp = (m[15] << 8) | m[16]
  if (!maxHp) throw new Error('the battle started but the enemy\'s stats never loaded')
  if (easy) {
    const hp = Math.max(1, Math.floor(maxHp / 3))
    await door.call({ op: 'poke', writes: [[A.wEnemyMon + 7, b64(new Uint8Array([255]))], [A.wEnemyMon + 1, b64(new Uint8Array([hp >> 8, hp & 0xff]))]] })
    m = await read(A.wEnemyMon, 17)
  }
  return { id, name: DATA.pokemon[id].name, level: m[14], hp: (m[1] << 8) | m[2], maxHp, catchRate: m[7] }
}

/**
 * The NEXT GRASS ENCOUNTER is `name`: the current map's grass table (wGrassMons, ten level / species pairs the
 * game loads with the map; wGrassRate the chance a step) is filled with it, the way the game's own roll then
 * picks it with no other change. The game reloads the table at every map load, so this WATCHES: `tick()`
 * (every `pause`) fills it again whenever it is not ours outside a battle, keeping each map's own table to put
 * back; when a wild battle starts with `name` in it, the battle copy is made easy (if asked), the map's table
 * restored, and it returns. `ensure()` runs every tick first (the FOXTROT set, re-applied if a reload dropped
 * it). A map without grass (wGrassRate 0) waits for one that has. `stop()` true ends it early, table restored.
 * `say(msg)` narrates. → the enemy, as `encounter` returns it.
 */
export async function nextEncounter(door, { name, level = 5, easy = false, pause, ensure = async () => {}, stop = () => false, say = () => {} }) {
  const id = species(name)
  const ours = new Uint8Array(20)
  for (let i = 0; i < 10; i++) ours.set([level, id], i * 2)
  const originals = new Map() // map id → its own table, as the game loaded it
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  let told = ''
  const tell = (msg) => msg !== told && say((told = msg))
  const restore = async () => {
    const [cur] = await readMany(door, [[A.wCurMap, 1]])
    const own = originals.get(cur[0])
    if (own) await door.call({ op: 'poke', writes: [[A.wGrassMons, b64(own)]] })
  }
  try {
    for (;;) {
      if (stop()) return null
      await ensure()
      const [inB, cur, rate, mons, repel, lead] = await readMany(door, [[A.wIsInBattle, 1], [A.wCurMap, 1], [A.wGrassRate, 1], [A.wGrassMons, 20], [A.wRepelRemainingSteps, 1], [A.wPartyMon1 + 0x21, 1]])
      if (inB[0] === 1) {
        const [enemy] = await readMany(door, [[A.wEnemyMon, 1]])
        if (enemy[0] === id) {
          const e = await settleEnemy(door, id, level, easy, pause)
          await restore()
          return e
        }
        tell('a battle that is not ours: waiting it out')
      } else if (inB[0] === 0) {
        if (!same(mons, ours)) {
          originals.set(cur[0], mons.slice())
          await door.call({ op: 'poke', writes: [[A.wGrassMons, b64(ours)]] })
        }
        if (!rate[0]) tell('no grass on this map: walk to some')
        else if (repel[0] && level < lead[0]) tell(`a REPEL is on (${repel[0]} steps) and keeps away anything below your lead's level ${lead[0]}: wait it out or use --level ${lead[0]}`)
        else tell(`waiting for the next grass encounter (1 in ${Math.round(256 / rate[0])} steps here)`)
      }
      await pause()
    }
  } finally {
    // An early stop or an error: the map's own table back (a battle already over it is left alone).
    const [inB] = await readMany(door, [[A.wIsInBattle, 1]]).catch(() => [[1]])
    if (!inB[0]) await restore().catch(() => {})
  }
}

async function readMany(door, ranges) {
  return (await door.call({ op: 'ram', ranges })).data.map((d) => new Uint8Array(Buffer.from(d, 'base64')))
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
