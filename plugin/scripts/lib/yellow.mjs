// Pokémon Yellow, as the trainer's CLI knows it: the WRAM layout (off pokeyellow's symbol file),
// the text engine's character set, the party / battle / map / event decoders, the collision
// model (blocks → tiles → the one tile the game checks under the player's feet), and a
// pathfinder over every map joined by its warps and edge connections. All of it comes from
// plugin/data/yellow.json, which scripts/yellow-data.mjs boils out of the disassembly. Nothing
// here touches an emulator: it reads bytes a door hands it and plans over static data.

import { readFileSync } from 'node:fs'

export const DATA = JSON.parse(readFileSync(new URL('../../data/yellow.json', import.meta.url), 'utf8'))
export const A = DATA.addr

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
export const KEY_OF_DIR = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' }
/** wSpritePlayerStateData1FacingDirection: $00 down, $04 up, $08 left, $0C right. */
const FACING = { 0: 'down', 4: 'up', 8: 'left', 12: 'right' }
export const BADGES = ['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth']
const PARTY_MON = 44
const NAME_LEN = 11

export const mapById = new Map(DATA.maps.map((m) => [m.id, m]))
export const mapByConst = new Map(DATA.maps.map((m) => [m.const, m]))
export const tilesetByConst = new Map(DATA.tilesets.map((t) => [t.const, t]))
const eventBit = new Map(Object.entries(DATA.events))

// ---- text ------------------------------------------------------------------------------

/** The text engine's charset. A tile id ≥ $80 in wTileMap IS a character. */
export function decodeChar(c) {
  const ch = DATA.charmap[c]
  if (ch == null) return c === 0x7f ? ' ' : c >= 0x80 ? '?' : ''
  if (ch === '@') return ''
  if (ch.startsWith('<')) return ch === '<PK>' ? 'PK' : ch === '<MN>' ? 'MN' : ch === '<LINE>' || ch === '<NEXT>' || ch === '<CONT>' || ch === '<PARA>' || ch === '<PAGE>' || ch === '<DONE>' || ch === '<PROMPT>' ? '' : ''
  return ch
}

export function decodeName(bytes) {
  let s = ''
  for (const b of bytes) {
    if (b === 0x50) break
    s += decodeChar(b)
  }
  return s.trim()
}

/**
 * The 20×18 tile map as text: each row's characters, map tiles left blank. `waiting` reads the
 * two glyphs the engine draws only when it wants you: ▼ (a text box waiting for A) and ▶ (a menu
 * cursor). That is how the CLI knows a press landed and what kind of screen it is looking at.
 */
export function readScreen(tilemap) {
  const rows = []
  let arrow = false
  let cursor = null
  for (let y = 0; y < 18; y++) {
    let row = ''
    for (let x = 0; x < 20; x++) {
      const t = tilemap[y * 20 + x]
      if (t === 0xee) arrow = true
      if (t === 0xed) cursor = { x, y }
      row += t >= 0x80 ? decodeChar(t) || ' ' : t === 0x7f ? ' ' : ' '
    }
    rows.push(row)
  }
  const text = rows.map((r) => r.replace(/\s+$/, '')).filter((r) => r.trim())
  return { rows, text, waiting: arrow ? 'text' : cursor ? 'menu' : null, cursor }
}

// ---- state -----------------------------------------------------------------------------

const u16 = (b, i) => (b[i] << 8) | b[i + 1]
const bcd = (b, i, n) => {
  let v = 0
  for (let k = 0; k < n; k++) v = v * 100 + ((b[i + k] >> 4) * 10 + (b[i + k] & 15))
  return v
}
const typeName = (id) => DATA.types[id] ?? `type${id}`
const moveOf = (id) => DATA.moves[id]
export const monName = (id) => DATA.pokemon[id]?.name ?? (id ? `#${id}` : '-')

function decodeMon(b, o, { party }) {
  const species = b[o]
  const mon = {
    species,
    name: monName(species),
    hp: u16(b, o + 1),
    status: b[o + 4],
    types: [...new Set([typeName(b[o + 5]), typeName(b[o + 6])])],
    moves: []
  }
  const pp = party ? o + 0x1d : o + 0x1c
  for (let i = 0; i < 4; i++) {
    const id = b[o + 8 + i]
    if (!id) continue
    const m = moveOf(id)
    mon.moves.push({ slot: i + 1, id, name: m?.name ?? `move${id}`, type: m?.type, power: m?.power ?? 0, acc: m?.acc, pp: b[pp + i] & 0x3f })
  }
  if (party) {
    mon.level = b[o + 0x21]
    mon.maxHp = u16(b, o + 0x22)
  } else {
    // battle_struct: species, hp(2), box level, status, types(2), catch, moves(4), DVs(2), level, maxhp(2), atk, def, spd, spc, pp(4)
    mon.level = b[o + 0x0e]
    mon.maxHp = u16(b, o + 0x0f)
  }
  return mon
}

const STATUS = (s) => (s & 0x40 ? 'PAR' : s & 0x20 ? 'FRZ' : s & 0x10 ? 'BRN' : s & 0x08 ? 'PSN' : s & 0x07 ? 'SLP' : '')

/** The byte ranges one `state` needs: read them in one door call. */
export const STATE_RANGES = {
  party: [A.wPartyCount, A.wPartyMonNicks + 6 * NAME_LEN - A.wPartyCount],
  world: [A.wPlayerMoney, A.wCurMapHeight + 1 - A.wPlayerMoney],
  battle: [A.wEnemyMon, A.wBattleType + 1 - A.wEnemyMon],
  events: [A.wEventFlags, 320],
  sprites: [A.wSpriteStateData1, 512],
  screen: [A.wTileMap, 360],
  misc: [A.wCurrentMenuItem, 4],
  joy: [A.wJoyIgnore, 1],
  walk: [A.wWalkCounter, 1],
  happy: [A.wPikachuHappiness, 1],
  bag: [A.wNumBagItems, 42],
  result: [A.wBattleResult, 1],
  repel: [A.wRepelRemainingSteps, 1],
  facing: [A.wSpritePlayerStateData1FacingDirection, 1],
  name: [A.wPlayerName, NAME_LEN],
  font: [A.wFontLoaded, 1]
}

export function event(events, name) {
  const bit = eventBit.get(name)
  if (bit == null) return null
  return !!(events[bit >> 3] & (1 << (bit & 7)))
}

/** Every reading the CLI prints, from the bytes of STATE_RANGES (an object of Uint8Arrays keyed the same). */
export function decodeState(r) {
  const w = r.world
  const W = (sym) => A[sym] - A.wPlayerMoney
  const mapId = w[W('wCurMap')]
  const map = mapById.get(mapId) ?? null
  const x = w[W('wXCoord')]
  const y = w[W('wYCoord')]
  const badgeBits = w[W('wObtainedBadges')]
  const p = r.party
  const P = (sym) => A[sym] - A.wPartyCount
  const count = Math.min(p[0], 6)
  const party = []
  for (let i = 0; i < count; i++) {
    const mon = decodeMon(p, P('wPartyMon1') + i * PARTY_MON, { party: true })
    mon.nick = decodeName(p.subarray(P('wPartyMonNicks') + i * NAME_LEN, P('wPartyMonNicks') + (i + 1) * NAME_LEN))
    mon.status = STATUS(mon.status)
    party.push(mon)
  }
  const b = r.battle
  const B = (sym) => A[sym] - A.wEnemyMon
  const inBattle = b[B('wIsInBattle')]
  let battle = null
  if (inBattle) {
    const enemy = decodeMon(b, B('wEnemyMon'), { party: false })
    enemy.nick = decodeName(b.subarray(B('wEnemyMonNick'), B('wEnemyMonNick') + NAME_LEN))
    enemy.status = STATUS(enemy.status)
    const mine = decodeMon(b, B('wBattleMon'), { party: false })
    mine.nick = decodeName(b.subarray(B('wBattleMonNick'), B('wBattleMonNick') + NAME_LEN))
    mine.status = STATUS(mine.status)
    const trainerClass = b[B('wTrainerClass')]
    battle = {
      kind: inBattle === 2 ? 'trainer' : inBattle === 1 ? 'wild' : `code ${inBattle}`,
      trainer: inBattle === 2 ? `${DATA.trainers[trainerClass] ?? 'trainer'} ${decodeName(b.subarray(B('wTrainerName'), B('wTrainerName') + 13))}`.trim() : null,
      enemy,
      mine,
      advice: advise(mine, enemy)
    }
  }
  const sprites = []
  for (let i = 1; i < 16; i++) {
    const pic = r.sprites[i * 16]
    if (!pic) continue
    const sy = r.sprites[256 + i * 16 + 4] - 4
    const sx = r.sprites[256 + i * 16 + 5] - 4
    // Slot 15 is the Pikachu at your heels (Yellow gives it a picture id of its own); it never blocks you.
    sprites.push({ i, sprite: i === 15 ? 'PIKACHU' : DATA.sprites[pic] ?? `sprite${pic}`, x: sx, y: sy })
  }
  const screen = readScreen(r.screen)
  const bag = []
  for (let i = 0; i < Math.min(r.bag[0], 20); i++) bag.push({ item: DATA.items[r.bag[1 + i * 2]] ?? `item${r.bag[1 + i * 2]}`, n: r.bag[2 + i * 2] })
  return {
    player: decodeName(r.name),
    map: map ? { id: mapId, const: map.const, name: map.name, w: map.w * 2, h: map.h * 2 } : { id: mapId, const: `MAP_${mapId}`, name: `map ${mapId}`, w: 0, h: 0 },
    x,
    y,
    facing: FACING[r.facing[0]] ?? 'down',
    walking: r.walk[0] !== 0,
    joyIgnore: r.joy[0],
    menu: { item: r.misc[0], max: r.misc[2] },
    money: bcd(w, W('wPlayerMoney'), 3),
    badges: BADGES.filter((_, i) => badgeBits & (1 << i)),
    happiness: r.happy[0],
    repel: r.repel[0],
    party,
    battle,
    lastBattle: r.result[0],
    sprites,
    bag,
    screen,
    events: r.events,
    // A text box keeps the font in VRAM (wFontLoaded); the overworld proper does not. So 'free' means you can walk.
    fontLoaded: !!(r.font[0] & 1),
    waiting: inBattle ? (screen.waiting ?? 'busy') : screen.waiting ?? (r.joy[0] ? 'busy' : r.font[0] & 1 ? 'text' : r.walk[0] ? 'walking' : 'free')
  }
}

// ---- battle advice ---------------------------------------------------------------------

const effect = (atk, def) => {
  let x = 1
  for (const t of def) {
    const m = DATA.matchups.find((r) => r.atk === atk && r.def === t)
    if (m) x *= m.x
  }
  return x
}

/** Damage-ish score per move: power × STAB × effectiveness × accuracy; status moves score 0. */
export function advise(mine, enemy) {
  const rows = mine.moves
    .filter((m) => m.pp > 0)
    .map((m) => {
      const eff = effect(m.type, enemy.types)
      const stab = mine.types.includes(m.type) ? 1.5 : 1
      return { ...m, eff, score: m.power * stab * eff * ((m.acc ?? 100) / 100) }
    })
    .sort((a, b) => b.score - a.score)
  const best = rows[0]
  return {
    best: best ? `${best.name} (slot ${best.slot}${best.eff !== 1 ? `, ×${best.eff} vs ${enemy.types.join('/')}` : ''})` : 'no attacking move with PP',
    moves: rows.map((m) => `${m.slot}:${m.name}${m.power ? ` ${m.power}${m.eff !== 1 ? `×${m.eff}` : ''}` : ' (status)'} pp${m.pp}`)
  }
}

// ---- the world -------------------------------------------------------------------------

const blockCache = new Map()
function blocksOf(map) {
  let b = blockCache.get(map.id)
  if (!b) {
    b = Buffer.from(map.blocks, 'base64')
    blockCache.set(map.id, b)
  }
  return b
}
const bstCache = new Map()
function blocksetOf(ts) {
  let b = bstCache.get(ts.id)
  if (!b) {
    b = Buffer.from(ts.blocks, 'base64')
    bstCache.set(ts.id, b)
  }
  return b
}

export function tilesetOf(map) {
  return tilesetByConst.get(map.tileset) ?? DATA.tilesets[0]
}

/** The 8×8 tile id at tile coordinates (tx, ty) of a map, its border block outside. */
export function tileAt(map, tx, ty) {
  const ts = tilesetOf(map)
  const bst = blocksetOf(ts)
  const bw = map.w
  const bh = map.h
  const bx = tx >> 2
  const by = ty >> 2
  let block
  if (bx < 0 || by < 0 || bx >= bw || by >= bh) block = map.border
  else block = blocksOf(map)[by * bw + bx]
  return bst[block * 16 + (ty & 3) * 4 + (tx & 3)]
}

/** The block id under a square (for cut trees). */
export function blockAt(map, x, y) {
  const bx = x >> 1
  const by = y >> 1
  if (bx < 0 || by < 0 || bx >= map.w || by >= map.h) return map.border
  return blocksOf(map)[by * map.w + bx]
}

/** The tile the game tests when you step onto square (x, y): the bottom-left 8×8 of its 16×16. */
export const footTile = (map, x, y) => tileAt(map, 2 * x, 2 * y + 1)

export function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.w * 2 && y < map.h * 2
}

/** What a square is, for the map drawing and the planner. */
export function classify(map, x, y) {
  const ts = tilesetOf(map)
  const t = footTile(map, x, y)
  if (!inBounds(map, x, y)) return 'void'
  // A warp square counts only where the game lets you stand (Red's bedroom keeps debug warps on its wall).
  if (map.warps.some((w) => w.x === x && w.y === y) && (ts.walk.includes(t) || ts.warpTiles.includes(t) || ts.doorTiles.includes(t))) return 'warp'
  if (DATA.waterTilesets.includes(ts.const) && t === DATA.waterTile) return 'water'
  if (ts.const === 'OVERWORLD' && DATA.ledges.some((l) => l.ledge === t)) return 'ledge'
  if (ts.const === 'OVERWORLD' && DATA.cutTreeBlocks.includes(blockAt(map, x, y)) && !ts.walk.includes(t)) return 'tree'
  if (ts.grass != null && t === ts.grass) return 'grass'
  return ts.walk.includes(t) ? 'floor' : 'wall'
}

function pairBlocked(ts, a, b) {
  return DATA.pairLand.some((p) => p.tileset === ts.const && ((p.a === a && p.b === b) || (p.a === b && p.b === a)))
}

/** The ledge jump out of (x, y) heading `dir`, if the game allows one there. */
export function ledgeJump(map, x, y, dir) {
  const [dx, dy] = DIRS[dir]
  const standing = footTile(map, x, y)
  const next = footTile(map, x + dx, y + dy)
  if (tilesetOf(map).const !== 'OVERWORLD') return null
  const ok = DATA.ledges.some((l) => l.dir.toLowerCase() === dir && l.standing === standing && l.ledge === next)
  if (!ok) return null
  const lx = x + 2 * dx
  const ly = y + 2 * dy
  return inBounds(map, lx, ly) && classify(map, lx, ly) !== 'wall' && classify(map, lx, ly) !== 'water' ? { x: lx, y: ly } : null
}

/**
 * Can the player step from (x, y) to the neighbour in `dir` on this map, on foot: the foot tile
 * must be walkable, the pair table must not forbid the crossing, and it must not be water.
 * People are not here (they move): the executor deals with them.
 */
export function canStep(map, x, y, dir, opts = {}) {
  const [dx, dy] = DIRS[dir]
  const nx = x + dx
  const ny = y + dy
  if (!inBounds(map, nx, ny)) return false
  const ts = tilesetOf(map)
  const from = footTile(map, x, y)
  const to = footTile(map, nx, ny)
  const kind = classify(map, nx, ny)
  if (kind === 'wall' || kind === 'water' || kind === 'ledge' || kind === 'void') return false
  if (kind === 'tree' && !opts.cut) return false
  if (pairBlocked(ts, from, to)) return false
  return true
}

// ---- connections and warps -------------------------------------------------------------

/** Step off the edge of `map` heading `dir` from (x, y): the map and square you land on, or null. */
export function crossEdge(map, x, y, dir) {
  const c = map.connections.find((c) => c.dir === { up: 'north', down: 'south', left: 'west', right: 'east' }[dir])
  if (!c) return null
  const to = mapByConst.get(c.map)
  if (!to) return null
  const o = 2 * c.offset
  let nx
  let ny
  if (dir === 'up') [nx, ny] = [x - o, to.h * 2 - 1]
  else if (dir === 'down') [nx, ny] = [x - o, 0]
  else if (dir === 'left') [nx, ny] = [to.w * 2 - 1, y - o]
  else [nx, ny] = [0, y - o]
  if (!inBounds(to, nx, ny)) return null
  return { map: to, x: nx, y: ny }
}

/** Where warp `w` of `map` leads: one or more (map, x, y); LAST_MAP fans out to every map that warps here. */
export function warpTargets(map, w) {
  const out = []
  const land = (to, id) => {
    const dst = to.warps[id - 1]
    if (dst) out.push({ map: to, x: dst.x, y: dst.y })
  }
  if (w.map === 'LAST_MAP') {
    // wLastMap is the last OUTDOOR map (towns and routes: the first 37 ids), never another building.
    for (const m of DATA.maps) if (m.id < 37 && m.warps.some((v) => v.map === map.const)) land(m, w.id)
  } else {
    const to = mapByConst.get(w.map)
    if (to) land(to, w.id)
  }
  return out
}

/** Whether stepping onto a warp square enters it by itself (a door, a carpet, stairs) or needs a push toward the edge. */
export function warpEntry(map, w) {
  const ts = tilesetOf(map)
  const t = footTile(map, w.x, w.y)
  if (ts.warpTiles.includes(t) || ts.doorTiles.includes(t)) return { auto: true }
  const dir = w.y >= map.h * 2 - 1 ? 'down' : w.y <= 0 ? 'up' : w.x <= 0 ? 'left' : w.x >= map.w * 2 - 1 ? 'right' : 'down'
  return { auto: false, push: dir }
}

// ---- the planner -----------------------------------------------------------------------

const key = (m, x, y) => `${m.id}:${x}:${y}`

/**
 * A* from one square to another, across maps: steps on foot, ledge jumps, warps (doors, stairs,
 * cave mouths) and the edges between outdoor maps. Returns the legs — {dir}, {jump, dir},
 * {warp, dir|null, to} — or null. `blocked` is a set of "map:x:y" the executor learnt are taken.
 */
export function plan(from, to, opts = {}) {
  const start = key(from.map, from.x, from.y)
  const goal = key(to.map, to.x, to.y)
  const h = (m, x, y) => (m.id === to.map.id ? Math.abs(x - to.x) + Math.abs(y - to.y) : 10)
  const open = new Map([[start, { f: h(from.map, from.x, from.y), g: 0, node: { map: from.map, x: from.x, y: from.y }, via: null, step: null }]])
  const closed = new Map()
  const blocked = opts.blocked ?? new Set()
  const grassCost = opts.avoidGrass ? 4 : 1
  let expanded = 0
  while (open.size) {
    let bestK = null
    let best = null
    for (const [k, v] of open) if (!best || v.f < best.f) (best = v), (bestK = k)
    open.delete(bestK)
    closed.set(bestK, best)
    if (bestK === goal) {
      const steps = []
      let cur = best
      while (cur.via) {
        steps.push(cur.step)
        cur = closed.get(cur.via)
      }
      return steps.reverse()
    }
    if (++expanded > 60000) return null
    const { map, x, y } = best.node
    const relax = (n, step, cost) => {
      const k = key(n.map, n.x, n.y)
      if (closed.has(k) || blocked.has(k)) return
      const g = best.g + cost
      const had = open.get(k)
      if (!had || g < had.g) open.set(k, { f: g + h(n.map, n.x, n.y), g, node: n, via: bestK, step })
    }
    // A warp square is entered the moment you stand on it (auto) or by a push; either way it is a leg of its own.
    const here = map.warps.find((w) => w.x === x && w.y === y)
    if (here && !(map.id === from.map.id && x === from.x && y === from.y && !opts.warpFromStart)) {
      const entry = warpEntry(map, here)
      for (const t of warpTargets(map, here)) relax(t, { warp: true, dir: entry.auto ? null : entry.push, to: t.map.const }, 2)
    }
    for (const dir of Object.keys(DIRS)) {
      const [dx, dy] = DIRS[dir]
      const nx = x + dx
      const ny = y + dy
      if (!inBounds(map, nx, ny)) {
        const over = crossEdge(map, x, y, dir)
        if (over && classify(over.map, over.x, over.y) !== 'wall') relax(over, { dir, edge: over.map.const }, 1)
        continue
      }
      const kind = classify(map, nx, ny)
      if (kind === 'tree' && opts.cut) relax({ map, x: nx, y: ny }, { dir, cut: true }, 30)
      else if (canStep(map, x, y, dir)) relax({ map, x: nx, y: ny }, { dir }, kind === 'grass' ? grassCost : 1)
      const jump = ledgeJump(map, x, y, dir)
      if (jump) relax({ map, x: jump.x, y: jump.y }, { dir, jump: true }, 2)
    }
  }
  return null
}

// ---- drawing ---------------------------------------------------------------------------

const GLYPH = { floor: '.', grass: '"', wall: '#', water: '~', ledge: '_', tree: 'T', warp: 'D', void: ' ' }

/**
 * The map around the player as text, `r` squares each way: # wall, . floor, " grass, ~ water,
 * _ ledge (one-way, jump from above / beside), T cut tree, D door / stairs / cave mouth, @ you,
 * a letter per person (P), a sign (S), the compass along the frame.
 */
export function drawMap(map, x, y, sprites = [], r = { x: 12, y: 8 }) {
  const rows = []
  const people = new Map(sprites.map((s) => [`${s.x}:${s.y}`, s.sprite === 'PIKACHU' ? 'p' : 'P']))
  const signs = new Map(map.signs.map((s) => [`${s.x}:${s.y}`, 'S']))
  const x0 = x - r.x
  const y0 = y - r.y
  let head = '    '
  for (let cx = x0; cx <= x + r.x; cx++) head += cx >= 0 && cx < map.w * 2 ? (cx % 5 === 0 ? String(cx % 100).padStart(2, ' ').slice(-1) : ' ') : ' '
  rows.push(head)
  for (let cy = y0; cy <= y + r.y; cy++) {
    let row = (cy >= 0 && cy < map.h * 2 ? String(cy).padStart(3, ' ') : '   ') + ' '
    for (let cx = x0; cx <= x + r.x; cx++) {
      const k = `${cx}:${cy}`
      if (cx === x && cy === y) row += '@'
      else if (!inBounds(map, cx, cy)) row += ' '
      else if (people.has(k)) row += people.get(k)
      else if (signs.has(k)) row += 'S'
      else row += GLYPH[classify(map, cx, cy)]
    }
    rows.push(row)
  }
  return rows.join('\n')
}

/** The exits of a map: its connections (with the square range that crosses) and warps (with what they lead to). */
export function describeExits(map) {
  const out = []
  for (const c of map.connections) {
    const to = mapByConst.get(c.map)
    if (!to) continue
    const o = 2 * c.offset
    let span
    if (c.dir === 'north' || c.dir === 'south') span = `x ${Math.max(0, o)}–${Math.min(map.w * 2, o + to.w * 2) - 1}`
    else span = `y ${Math.max(0, o)}–${Math.min(map.h * 2, o + to.h * 2) - 1}`
    out.push(`${c.dir} edge → ${to.name} (${span})`)
  }
  map.warps.forEach((w, i) => {
    const targets = warpTargets(map, w)
    const names = [...new Set(targets.map((t) => t.map.name))]
    out.push(`door ${i + 1} at (${w.x},${w.y}) → ${names.join(' / ') || w.map}`)
  })
  return out
}

/** Every named square the planner can be sent to: landmarks for the quest, plus `MAP@x,y` and `door:<MAP>` forms. */
export const LANDMARKS = {
  // Pallet Town
  'oaks-lab': { map: 'PALLET_TOWN', x: 12, y: 12, note: "in front of Oak's lab door; step up to enter" },
  'reds-house': { map: 'PALLET_TOWN', x: 5, y: 6 },
  // Viridian
  'viridian-pokecenter': { map: 'VIRIDIAN_CITY', warp: 'VIRIDIAN_POKECENTER' },
  'viridian-mart': { map: 'VIRIDIAN_CITY', warp: 'VIRIDIAN_MART' },
  'viridian-forest-south': { map: 'ROUTE_2', warp: 'VIRIDIAN_FOREST_SOUTH_GATE' },
  'viridian-forest-north': { map: 'ROUTE_2', warp: 'VIRIDIAN_FOREST_NORTH_GATE' },
  // Pewter
  'pewter-pokecenter': { map: 'PEWTER_CITY', warp: 'PEWTER_POKECENTER' },
  'pewter-mart': { map: 'PEWTER_CITY', warp: 'PEWTER_MART' },
  'pewter-gym': { map: 'PEWTER_CITY', warp: 'PEWTER_GYM' },
  'brock': { map: 'PEWTER_GYM', talk: { x: 4, y: 1 }, note: 'Brock stands at the top of the gym; talk from below' },
  // Route 3 / 4 / Mt. Moon
  'mt-moon-pokecenter': { map: 'ROUTE_4', warp: 'MT_MOON_POKECENTER' },
  'mt-moon': { map: 'ROUTE_4', warp: 'MT_MOON_1F' },
  // Cerulean
  'cerulean-pokecenter': { map: 'CERULEAN_CITY', warp: 'CERULEAN_POKECENTER' },
  'cerulean-mart': { map: 'CERULEAN_CITY', warp: 'CERULEAN_MART' },
  'cerulean-gym': { map: 'CERULEAN_CITY', warp: 'CERULEAN_GYM' },
  'misty': { map: 'CERULEAN_GYM', talk: { x: 4, y: 2 } },
  'melanies-house': { map: 'CERULEAN_CITY', warp: 'CERULEAN_MELANIES_HOUSE', note: 'the Bulbasaur: Melanie gives it if Pikachu is happy enough (147+)' },
  'melanie': { map: 'CERULEAN_MELANIES_HOUSE', talk: { x: 3, y: 1 } },
  'nugget-bridge': { map: 'ROUTE_24', x: 10, y: 35, note: 'the south end of Nugget Bridge; five trainers up the bridge, then a Rocket' },
  'charmander-man': { map: 'ROUTE_24', talk: { x: 6, y: 5 }, note: 'the trainer who gives away Charmander (say YES)' },
  'bills-house': { map: 'ROUTE_25', warp: 'BILLS_HOUSE' },
  // Vermilion
  'vermilion-pokecenter': { map: 'VERMILION_CITY', warp: 'VERMILION_POKECENTER' },
  'vermilion-mart': { map: 'VERMILION_CITY', warp: 'VERMILION_MART' },
  'vermilion-gym': { map: 'VERMILION_CITY', warp: 'VERMILION_GYM', note: 'a small tree blocks the gym door: Cut it (HM01 from the S.S. Anne captain)' },
  'lt-surge': { map: 'VERMILION_GYM', talk: { x: 5, y: 1 } },
  'officer-jenny': { map: 'VERMILION_CITY', talk: { x: 19, y: 15 }, note: 'gives Squirtle once you hold the Thunder Badge' },
  'ss-anne': { map: 'VERMILION_CITY', warp: 'VERMILION_DOCK' },
  'underground-north': { map: 'ROUTE_5', warp: 'UNDERGROUND_PATH_ROUTE_5' },
  'underground-south': { map: 'ROUTE_6', warp: 'UNDERGROUND_PATH_ROUTE_6' },
  // The Elite Four (after `elite` + `warp INDIGO_PLATEAU_LOBBY`): each room's door onward opens once its trainer is beaten.
  'elite-four': { map: 'INDIGO_PLATEAU_LOBBY', warp: 'LORELEIS_ROOM', note: "Lorelei's door, top of the lobby; heal at the nurse first (walk up to the counter at (7,6))" },
  'nurse': { map: 'INDIGO_PLATEAU_LOBBY', talk: { x: 7, y: 5 }, note: 'the lobby nurse heals the party' },
  'lorelei': { map: 'LORELEIS_ROOM', talk: { x: 5, y: 2 }, note: 'Ice / Water: Thunderbolt (Pikachu, Zapdos, Starmie)' },
  'bruno': { map: 'BRUNOS_ROOM', talk: { x: 5, y: 2 }, note: 'Fighting / Rock: Psychic (Alakazam, Starmie), Surf' },
  'agatha': { map: 'AGATHAS_ROOM', talk: { x: 5, y: 2 }, note: 'Ghost / Poison: Psychic; Earthquake on Golbat is useless (Flying), use Thunderbolt' },
  'lance': { map: 'LANCES_ROOM', talk: { x: 6, y: 1 }, note: 'Dragon / Flying: Blizzard (Tauros), Thunderbolt on Gyarados / Aerodactyl' },
  'champion': { map: 'CHAMPIONS_ROOM', talk: { x: 4, y: 2 }, note: 'your rival, six Pokémon; his Eevee evolved into Jolteon, Vaporeon or Flareon' }
}

/** Resolve a target to a square, and how to finish there (a warp to enter, a person to face). */
export function resolveTarget(spec, current) {
  let lm = LANDMARKS[spec]
  let mapConst
  let x
  let y
  let note = lm?.note ?? ''
  let face = null
  let enter = null
  if (!lm) {
    let m
    if ((m = spec.match(/^([A-Z0-9_]+)@(\d+),(\d+)$/))) {
      mapConst = m[1]
      x = +m[2]
      y = +m[3]
    } else if ((m = spec.match(/^door:([A-Z0-9_]+)$/))) {
      lm = { map: current.map.const, warp: m[1] }
    } else if ((m = spec.match(/^([A-Z0-9_]+)$/)) && mapByConst.has(m[1])) {
      // A map by name: the square you would arrive on from the current map, else its first warp.
      const to = mapByConst.get(m[1])
      const back = to.warps.find((w) => w.map === current.map.const || w.map === 'LAST_MAP') ?? to.warps[0]
      if (back) {
        mapConst = to.const
        x = back.x
        y = back.y
      } else {
        mapConst = to.const
        x = to.w
        y = to.h
      }
    } else return null
  }
  if (lm) {
    const map = mapByConst.get(lm.map)
    if (!map) return null
    mapConst = map.const
    if (lm.warp) {
      const w = map.warps.find((w) => w.map === lm.warp)
      if (!w) return null
      // Stand ON the warp square: the planner enters it as its own leg.
      const t = warpTargets(map, w)[0]
      if (!t) return null
      mapConst = t.map.const
      x = t.x
      y = t.y
      enter = lm.warp
    } else if (lm.talk) {
      // The square in front of the person, and the way to face; below them if that is floor, else beside.
      const cands = [
        ['up', lm.talk.x, lm.talk.y + 1],
        ['down', lm.talk.x, lm.talk.y - 1],
        ['right', lm.talk.x - 1, lm.talk.y],
        ['left', lm.talk.x + 1, lm.talk.y]
      ]
      const pick = cands.find(([, cx, cy]) => inBounds(map, cx, cy) && ['floor', 'grass', 'warp'].includes(classify(map, cx, cy)))
      if (!pick) return null
      ;[face, x, y] = pick
    } else {
      x = lm.x
      y = lm.y
    }
  }
  const map = mapByConst.get(mapConst)
  if (!map) return null
  return { map, x, y, face, enter, note }
}

/** The quest, as the skill tells it: the three gifts and the badge each one needs. */
export function questStatus(state) {
  const ev = state.events
  return {
    bulbasaur: event(ev, 'EVENT_GOT_BULBASAUR_IN_CERULEAN'),
    charmander: event(ev, 'EVENT_54F'),
    squirtle: event(ev, 'EVENT_GOT_SQUIRTLE_FROM_OFFICER_JENNY'),
    brock: event(ev, 'EVENT_BEAT_BROCK'),
    misty: event(ev, 'EVENT_BEAT_MISTY'),
    surge: event(ev, 'EVENT_BEAT_LT_SURGE'),
    starter: event(ev, 'EVENT_GOT_STARTER'),
    pokedex: event(ev, 'EVENT_GOT_POKEDEX'),
    metBill: event(ev, 'EVENT_MET_BILL'),
    hm01: event(ev, 'EVENT_GOT_HM01'),
    ssAnneLeft: event(ev, 'EVENT_SS_ANNE_LEFT'),
    happiness: state.happiness
  }
}
