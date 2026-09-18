#!/usr/bin/env node
// Boils the pokeyellow disassembly (github.com/pret/pokeyellow, a plain checkout: no build, no
// rgbds) down to plugin/data/yellow.json, the game knowledge the trainer's CLI runs on:
// every map (size, tileset, block layout, warps, connections, signs, people), every tileset
// (block set, walkable tiles, warp / door tiles, counter tiles), ledges, pair collisions,
// the Pokémon (name, types, base stats), the moves, the type chart, items, event flag bits,
// sprite and trainer class names, and the WRAM addresses that matter, read from the symbol
// file. Usage: node scripts/yellow-data.mjs <pokeyellow checkout> <pokeyellow.sym>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [root, symPath] = process.argv.slice(2)
if (!root || !symPath) {
  console.error('usage: yellow-data.mjs <pokeyellow dir> <pokeyellow.sym>')
  process.exit(2)
}
const read = (p) => readFileSync(join(root, p), 'utf8')
const num = (s) => {
  s = s.trim()
  if (/^-?\$[0-9a-f]+$/i.test(s)) return parseInt(s.replace('$', ''), 16)
  if (/^-?%[01]+$/.test(s)) return parseInt(s.replace('%', ''), 2)
  return Number(s)
}

/** rgbds const_def / const / const_skip / const_next / const_export, enough for the constants files. */
function consts(text, opts = {}) {
  const out = {}
  let v = 0
  let hm = 0
  let tm = 0
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim()
    let m
    if ((m = line.match(/^const_def(?:\s+(\S+))?/))) v = m[1] ? num(m[1]) : 0
    else if ((m = line.match(/^(?:const|const_export)\s+(\w+)/))) {
      if (!opts.filter || opts.filter(m[1])) out[m[1]] = v
      v++
    } else if ((m = line.match(/^(\w+_const)\s+(\w+)/)) && opts.macros?.includes(m[1])) {
      out[m[2]] = v
      v++
    } else if ((m = line.match(/^const_skip(?:\s+(\S+))?/))) v += m[1] ? num(m[1]) : 1
    else if ((m = line.match(/^const_next\s+(.+)$/))) v = expr(m[1])
    else if ((m = line.match(/^add_hm\s+(\w+)/))) {
      out[`HM${String(++hm).padStart(2, '0')}_${m[1]}`] = v
      v++
    } else if ((m = line.match(/^add_tm\s+(\w+)/))) {
      out[`TM${String(++tm).padStart(2, '0')}_${m[1]}`] = v
      v++
    }
  }
  return out
}

/** `$550 - 1`, `20`, `$28`: the little arithmetic the constants files use. */
function expr(s) {
  const parts = s.split(/\s*([+-])\s*/)
  let v = num(parts[0])
  for (let i = 1; i < parts.length; i += 2) v = parts[i] === '-' ? v - num(parts[i + 1]) : v + num(parts[i + 1])
  return v
}

const snake = (camel) => camel.replace(/([a-z])([A-Z0-9])/g, '$1_$2').replace(/([A-Z])([0-9])/g, '$1_$2').toUpperCase()
const title = (c) =>
  c
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')

// ---- constants -------------------------------------------------------------------------
const mapIds = consts(read('constants/map_constants.asm'), { macros: ['map_const'] })
const mapSize = {}
for (const m of read('constants/map_constants.asm').matchAll(/map_const\s+(\w+),\s*(\d+),\s*(\d+)/g)) mapSize[m[1]] = { w: +m[2], h: +m[3] }
const tilesetIds = consts(read('constants/tileset_constants.asm'))
const monIds = consts(read('constants/pokemon_constants.asm'))
const moveIds = consts(read('constants/move_constants.asm'))
const typeIds = consts(read('constants/type_constants.asm'))
const itemIds = consts(read('constants/item_constants.asm'))
const eventIds = consts(read('constants/event_constants.asm'))
const spriteIds = consts(read('constants/sprite_constants.asm'))
const trainerIds = consts(read('constants/trainer_constants.asm'), { macros: ['trainer_const'] })

// ---- tilesets --------------------------------------------------------------------------
const bstFile = {}
{
  // gfx/tilesets.asm: one or more `Name_Block::` labels, then INCBIN "gfx/blocksets/x.bst"
  let pending = []
  for (const raw of read('gfx/tilesets.asm').split('\n')) {
    const line = raw.trim()
    const lab = line.match(/^(\w+)_Block::\s*(?:INCBIN\s+"([^"]+)")?/)
    if (lab) {
      pending.push(lab[1])
      if (lab[2]) {
        for (const p of pending) bstFile[p] = lab[2]
        pending = []
      }
    } else if (pending.length && /INCBIN/.test(line)) {
      const f = line.match(/"([^"]+)"/)[1]
      for (const p of pending) bstFile[p] = f
      pending = []
    } else if (line && !line.startsWith(';')) pending = []
  }
}
const collOf = {}
{
  let pending = []
  for (const raw of read('data/tilesets/collision_tile_ids.asm').split('\n')) {
    const line = raw.replace(/;.*$/, '').trim()
    const lab = line.match(/^(\w+)_Coll::/)
    if (lab) pending.push(lab[1])
    else if (line.startsWith('coll_tiles')) {
      const ids = [...line.matchAll(/\$([0-9a-f]+)/gi)].map((m) => parseInt(m[1], 16))
      for (const p of pending) collOf[p] = ids
      pending = []
    }
  }
}
function tileList(text, label, endToken) {
  const i = text.indexOf(label)
  if (i < 0) return []
  const line = text.slice(i).split('\n')[1]
  return [...line.matchAll(/\$([0-9a-f]+)/gi)].map((m) => parseInt(m[1], 16))
}
const warpText = read('data/tilesets/warp_tile_ids.asm')
const doorText = read('data/tilesets/door_tile_ids.asm')
const tilesets = []
{
  const hdr = read('data/tilesets/tileset_headers.asm')
  let id = 0
  for (const m of hdr.matchAll(/^\s*tileset\s+(\w+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*(\w+)/gm)) {
    const name = m[1]
    const bst = bstFile[name]
    const blocks = readFileSync(join(root, bst))
    const counters = [m[2], m[3], m[4]].map(num).filter((n) => n >= 0)
    const grass = num(m[5])
    tilesets.push({
      id,
      name,
      const: snake(name),
      blocks: blocks.toString('base64'),
      walk: collOf[name] ?? [],
      counters,
      grass: grass >= 0 ? grass : null,
      warpTiles: tileList(warpText, `.${name}WarpTileIDs:`),
      doorTiles: tileList(doorText, `.${name}DoorTileIDs:`)
    })
    id++
  }
  // Door lists are shared by name in the pointer table (FOREST_GATE → Museum's list, and so on).
  for (const m of doorText.matchAll(/dbw\s+(\w+),\s*\.(\w+)DoorTileIDs/g)) {
    const t = tilesets.find((t) => t.const === m[1])
    if (t && !t.doorTiles.length) t.doorTiles = tileList(doorText, `.${m[2]}DoorTileIDs:`)
  }
}
const ledges = [...read('data/tilesets/ledge_tiles.asm').matchAll(/db\s+SPRITE_FACING_(\w+),\s*\$([0-9a-f]+),\s*\$([0-9a-f]+),\s*PAD_(\w+)/gi)].map((m) => ({
  facing: m[1],
  standing: parseInt(m[2], 16),
  ledge: parseInt(m[3], 16),
  dir: m[4]
}))
const pairText = read('data/tilesets/pair_collision_tile_ids.asm')
const pairs = (label) => {
  const i = pairText.indexOf(label)
  const j = pairText.indexOf('db -1', i)
  return [...pairText.slice(i, j).matchAll(/db\s+(\w+),\s*\$([0-9a-f]+),\s*\$([0-9a-f]+)/gi)].map((m) => ({ tileset: m[1], a: parseInt(m[2], 16), b: parseInt(m[3], 16) }))
}
const pairLand = pairs('TilePairCollisionsLand::')
const pairWater = pairs('TilePairCollisionsWater::')
const waterTilesets = [...read('data/tilesets/water_tilesets.asm').matchAll(/^\s*db\s+([A-Z_0-9]+)\s*$/gm)].map((m) => m[1]).filter((n) => n in tilesetIds)
const cutTreeBlocks = [...read('data/tilesets/cut_tree_blocks.asm').matchAll(/db\s+\$([0-9a-f]+),\s*\$([0-9a-f]+)/gi)].map((m) => parseInt(m[1], 16))

// ---- maps ------------------------------------------------------------------------------
const blkFile = {}
{
  let pending = []
  for (const raw of read('maps.asm').split('\n')) {
    const line = raw.trim()
    const m = line.match(/^(\w+)_Blocks:\s*(?:INCBIN\s+"([^"]+)")?/)
    if (m) {
      pending.push(m[1])
      if (m[2]) {
        for (const p of pending) blkFile[p] = m[2]
        pending = []
      }
    } else if (pending.length && /INCBIN/.test(line)) {
      const f = line.match(/"([^"]+)"/)[1]
      for (const p of pending) blkFile[p] = f
      pending = []
    } else if (line && !line.startsWith(';')) pending = []
  }
}
const maps = []
for (const file of readdirSync(join(root, 'data/maps/headers')).sort()) {
  const h = read(`data/maps/headers/${file}`)
  const head = h.match(/map_header\s+(\w+),\s*(\w+),\s*(\w+)/)
  if (!head) continue
  const [, label, konst, tileset] = head
  const conns = [...h.matchAll(/connection\s+(north|south|west|east),\s*(\w+),\s*(\w+),\s*(-?\d+)/g)].map((m) => ({ dir: m[1], map: m[3], offset: +m[4] }))
  let obj = ''
  try {
    obj = read(`data/maps/objects/${label}.asm`)
  } catch {
    /* a few unused maps have none */
  }
  const border = obj.match(/db\s+\$([0-9a-f]+)\s*;\s*border block/i)
  const warps = [...obj.matchAll(/warp_event\s+(-?\d+),\s*(-?\d+),\s*(\w+),\s*(\d+)/g)].map((m) => ({ x: +m[1], y: +m[2], map: m[3], id: +m[4] }))
  const signs = [...obj.matchAll(/bg_event\s+(\d+),\s*(\d+),\s*(\w+)/g)].map((m) => ({ x: +m[1], y: +m[2], text: m[3] }))
  const people = [...obj.matchAll(/object_event\s+(\d+),\s*(\d+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+)(?:,\s*(\w+))?(?:,\s*(\w+))?/g)].map((m) => {
    const o = { x: +m[1], y: +m[2], sprite: m[3].replace(/^SPRITE_/, ''), moves: m[4] === 'WALK', text: m[6] }
    if (m[8]) o.trainer = { class: m[7].replace(/^OPP_/, ''), party: +m[8] }
    else if (m[7]) o.item = m[7]
    return o
  })
  const size = mapSize[konst] ?? { w: 0, h: 0 }
  let blocks = ''
  const blk = blkFile[label]
  if (blk) blocks = readFileSync(join(root, blk)).toString('base64')
  maps.push({
    id: mapIds[konst],
    const: konst,
    name: title(konst),
    label,
    tileset,
    w: size.w,
    h: size.h,
    border: border ? parseInt(border[1], 16) : 0,
    blocks,
    connections: conns,
    warps,
    signs,
    people
  })
}
maps.sort((a, b) => a.id - b.id)

// ---- Pokémon, moves, types -------------------------------------------------------------
const dexIds = consts(read('constants/pokedex_constants.asm'))
// Level-up learnsets: `<Name>EvosMoves:` … `db level, MOVE` lines after the evolutions' `db 0`.
const learnsets = {}
{
  const parts = read('data/pokemon/evos_moves.asm').split(/^(\w+)EvosMoves:\s*$/m)
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1] ?? ''
    const j = body.indexOf('; Learnset')
    learnsets[parts[i].toLowerCase()] = [...body.slice(j < 0 ? 0 : j).matchAll(/db\s+(\d+),\s*(\w+)/g)].map((r) => [+r[1], r[2]])
  }
}
const pokemon = {}
for (const [name, id] of Object.entries(monIds)) {
  if (id === 0) continue
  const file = name.toLowerCase().replace(/_/g, '')
  let stats = null
  try {
    const s = read(`data/pokemon/base_stats/${file}.asm`)
    const st = s.match(/db\s+(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\s*\n\s*;\s*hp/)
    const ty = s.match(/db\s+(\w+),\s*(\w+)\s*;\s*type/)
    const learn = s.match(/db\s+([\w, ]+)\s*;\s*level 1 learnset/)
    const dex = s.match(/db\s+(DEX_\w+)/)
    const catchRate = s.match(/db\s+(\d+)\s*;\s*catch rate/)
    const growth = s.match(/db\s+(GROWTH_\w+)/)
    const tmhm = s.match(/tmhm\s+([\s\S]*?)\n\s*;\s*end/)
    stats = {
      dex: dex ? dexIds[dex[1]] : null,
      hp: +st[1],
      atk: +st[2],
      def: +st[3],
      spd: +st[4],
      spc: +st[5],
      types: [ty[1], ty[2]].map((t) => t.replace(/_TYPE$/, '')),
      catchRate: catchRate ? +catchRate[1] : 45,
      growth: growth ? growth[1].replace('GROWTH_', '') : 'MEDIUM_FAST',
      start: learn ? learn[1].split(',').map((x) => x.trim()).filter((x) => x !== 'NO_MOVE') : [],
      learnset: learnsets[file] ?? [],
      tmhm: tmhm ? tmhm[1].replace(/\\/g, ' ').split(',').map((x) => x.trim()).filter(Boolean) : []
    }
  } catch {
    /* MissingNo. and friends */
  }
  pokemon[id] = { name: title(name).replace('Nidoran M', 'Nidoran♂').replace('Nidoran F', 'Nidoran♀').replace(/^Farfetch ?D$/i, "Farfetch'd").replace('Mr Mime', 'Mr. Mime'), ...(stats ?? {}) }
}
const moves = {}
{
  let id = 1
  for (const m of read('data/moves/moves.asm').matchAll(/^\s*move\s+(\w+),\s*(\w+),\s*(\d+),\s*(\w+),\s*(\d+),\s*(\d+)/gm)) {
    moves[id] = { const: m[1], name: title(m[1]).replace(/^Psychic M$/, 'Psychic'), effect: m[2], power: +m[3], type: m[4].replace(/_TYPE$/, ''), acc: +m[5], pp: +m[6] }
    id++
  }
}
const typeNames = {}
for (const [n, id] of Object.entries(typeIds)) typeNames[id] = n.replace(/_TYPE$/, '')
const matchups = [...read('data/types/type_matchups.asm').matchAll(/db\s+(\w+),\s*(\w+),\s*(SUPER_EFFECTIVE|NOT_VERY_EFFECTIVE|NO_EFFECT)/g)].map((m) => ({
  atk: m[1].replace(/_TYPE$/, ''),
  def: m[2].replace(/_TYPE$/, ''),
  x: m[3] === 'SUPER_EFFECTIVE' ? 2 : m[3] === 'NO_EFFECT' ? 0 : 0.5
}))

const items = {}
for (const [n, id] of Object.entries(itemIds)) items[id] = title(n)
// HM01–05 are $C4–$C8 and TM01–50 $C9–$FA; the macros in item_constants.asm name them by move.
for (const [n, id] of Object.entries(itemIds)) {
  if (/^HM\d\d_/.test(n)) items[id] = `HM${n.slice(2, 4)} ${title(n.slice(5))}`
  if (/^TM\d\d_/.test(n)) items[id] = `TM${n.slice(2, 4)} ${title(n.slice(5))}`
}
for (let i = 0; i < 5; i++) if (!/^HM/.test(items[0xc4 + i] ?? '')) items[0xc4 + i] = `HM0${i + 1}`
for (let i = 0; i < 50; i++) if (!/^TM/.test(items[0xc9 + i] ?? '')) items[0xc9 + i] = `TM${String(i + 1).padStart(2, '0')}`
const sprites = {}
for (const [n, id] of Object.entries(spriteIds)) sprites[id] = n.replace(/^SPRITE_/, '')
const trainers = {}
for (const [n, id] of Object.entries(trainerIds)) trainers[id] = title(n)
// The text engine's character set: tile ids in wTileMap decode straight to these.
const charmap = {}
for (const m of read('constants/charmap.asm').matchAll(/charmap\s+"((?:[^"\\]|\\.)*)",\s*\$([0-9a-f]+)/gi)) {
  const code = parseInt(m[2], 16)
  if (!(code in charmap)) charmap[code] = m[1].replace(/\\"/g, '"')
}

// ---- WRAM addresses off the symbol file ------------------------------------------------
const WANT = [
  'wCurMap', 'wYCoord', 'wXCoord', 'wPartyCount', 'wPartySpecies', 'wPartyMon1', 'wPartyMonNicks', 'wPartyMonOT',
  'wObtainedBadges', 'wPlayerMoney', 'wIsInBattle', 'wCurOpponent', 'wBattleType', 'wEnemyMon', 'wEnemyMonNick', 'wBattleMon', 'wBattleMonNick',
  'wTrainerClass', 'wTrainerName', 'wEnemyPartyCount', 'wEnemyMons', 'wEventFlags', 'wPikachuHappiness', 'wSpriteStateData1', 'wSpriteStateData2',
  'wSpritePlayerStateData1FacingDirection', 'wWalkCounter', 'wJoyIgnore', 'wCurrentMenuItem', 'wMaxMenuItem', 'wTileMap', 'wPlayerName', 'wPlayerID',
  'wNumBagItems', 'wBagItems', 'wCurMapTileset', 'wCurMapWidth', 'wCurMapHeight', 'wLastMap', 'wBattleResult', 'wPlayerMonNumber', 'wStatusFlags5',
  'wStatusFlags7', 'wTownVisitedFlag', 'wPokedexOwned', 'wPokedexSeen', 'wNumSprites', 'wTextBoxID', 'wPlayerBattleStatus1', 'wEnemyMonStatus',
  'wRepelRemainingSteps', 'wd72e', 'wd730', 'wd736', 'wFontLoaded', 'wLinkState', 'wCurEnemyLevel', 'wPlayerSelectedMove', 'wEnemySelectedMove',
  'wTopMenuItemY', 'wMenuWatchedKeys', 'wNumberOfWarps', 'wWarpEntries', 'wLastBlackoutMap', 'wPokedexOwned', 'wPokedexSeen', 'wPlayerCoins', 'wBoxCount', 'wNumBoxItems', 'wCurrentBoxNum', 'wPikachuOverworldStateFlags', 'wd472',
  'hJoyHeld', 'hJoyPressed', 'hJoyInput'
]
const addr = {}
for (const line of readFileSync(symPath, 'utf8').split('\n')) {
  const m = line.match(/^00:([0-9a-f]{4})\s+(\w+)\s*$/i)
  if (m && WANT.includes(m[2])) addr[m[2]] = parseInt(m[1], 16)
}
for (const w of WANT) if (!(w in addr)) console.warn('no symbol', w)

const out = {
  generated: new Date().toISOString(),
  source: 'pret/pokeyellow',
  addr,
  events: eventIds,
  mapIds,
  maps,
  tilesets,
  ledges,
  pairLand,
  pairWater,
  waterTilesets,
  waterTile: 0x14,
  cutTreeBlocks,
  pokemon,
  moves,
  types: typeNames,
  matchups,
  items,
  sprites,
  trainers,
  charmap
}
writeFileSync('plugin/data/yellow.json', JSON.stringify(out))
console.log(`maps ${maps.length}, tilesets ${tilesets.length}, pokemon ${Object.keys(pokemon).length}, moves ${Object.keys(moves).length}, events ${Object.keys(eventIds).length}, items ${Object.keys(items).length}, addrs ${Object.keys(addr).length}`)
console.log(`${(JSON.stringify(out).length / 1024).toFixed(0)} KB`)
