// The sprite gag: in a battle, the enemy's front picture and your mon's back picture are
// repainted from two 56×56 PNGs, and the two names on screen with them. Nothing but transient
// pokes through the door: VRAM tiles, the tile map's HUD cells, and the two BATTLE-ONLY name
// copies (wEnemyMonNick / wBattleMonNick). The ROM, the party's own nicknames and every save
// are never written, so it is gone at the next send-out — `sprite watch` paints it again.
//
// What the game does (read off wTileMap mid-battle, Yellow UE):
//   front pic (enemy)  tiles $00–$30, tile map columns 12–18 rows 0–6  → VRAM $9000
//   back pic (yours)   tiles $31–$61, tile map columns 1–7  rows 5–11 → VRAM $9310
//   both are a full 7×7 tiles laid COLUMN-major (id = first + column × 7 + row), 784 bytes of 2bpp
//   HUD names: the enemy's from tile map (1,0), yours from (10,7), 10 cells, padded with $7F.
//   WHOSE PICTURE IS IN A BLOCK (traced headless, wild and trainer): the back block holds RED's back
//   from the fade-in until your mon is sent out, and your HUD frame is drawn only once it is; the
//   front block holds the TRAINER's picture through "wants to fight!" with no HUD, and his mon's
//   picture is up ~50 steps before its HUD — while "sent out" is in the text box. In a wild battle
//   (wIsInBattle = 1) the front block is only ever the mon's. wEnemyMonNick is STALE from the last
//   battle until a trainer sends out, so it says nothing about what is up.
//   The game keeps a copy of the screen and puts it back (the move list does), old names and
//   all, so the HUD is rewritten whenever its frame is up and the name in it is not ours —
//   `frame` is a few of the HUD's own line tiles, ones the move list does not cover.

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { A, DATA } from './yellow.mjs'

export const PIC = 56
const TILES = 7
const NAME_LEN = 11
const HUD_LEN = 10
const SPACE = 0x7f
const END = 0x50
const COLS = 20
const LINE_LEN = 18 // the text box's line

export const SLOTS = {
  front: { first: 0x00, col: 12, row: 0, vram: 0x9000, nick: A.wEnemyMonNick, hud: { x: 1, y: 0 }, frame: [[2, 2, 0x71], [1, 3, 0x74], [10, 3, 0x78]] },
  back: { first: 0x31, col: 1, row: 5, vram: 0x9310, nick: A.wBattleMonNick, hud: { x: 10, y: 7 }, frame: [[18, 9, 0x6d], [18, 11, 0x77], [12, 11, 0x76]] }
}

// ---- PNG in, the few lines of it we need (door.mjs has the way out) --------------------------

/** PNG bytes → { w, h, rgba }. 8-bit, non-interlaced, colour types 0 / 2 / 3 / 4 / 6. */
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let w = 0
  let h = 0
  let type = 0
  let palette = null
  let trns = null
  const idat = []
  for (let o = 8; o + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(o)
    const name = buf.toString('ascii', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (name === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      type = data[9]
      if (data[8] !== 8) throw new Error(`PNG bit depth ${data[8]}: only 8 is read`)
      if (data[12] !== 0) throw new Error('interlaced PNGs are not read')
      if (![0, 2, 3, 4, 6].includes(type)) throw new Error(`PNG colour type ${type}?`)
    } else if (name === 'PLTE') palette = data
    else if (name === 'tRNS') trns = data
    else if (name === 'IDAT') idat.push(data)
    else if (name === 'IEND') break
    o += 12 + len
  }
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]
  const stride = w * bpp
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length < (stride + 1) * h) throw new Error('PNG data is short')
  const px = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0
      const b = y ? px[dst + x - stride] : 0
      const c = x >= bpp && y ? px[dst + x - stride - bpp] : 0
      let pred = 0
      if (f === 1) pred = a
      else if (f === 2) pred = b
      else if (f === 3) pred = (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[dst + x] = (raw[src + x] + pred) & 0xff
    }
  }
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const s = i * bpp
    let r
    let g
    let b
    let a = 255
    if (type === 0 || type === 4) {
      r = g = b = px[s]
      if (type === 4) a = px[s + 1]
    } else if (type === 3) {
      const p = px[s]
      r = palette[p * 3]
      g = palette[p * 3 + 1]
      b = palette[p * 3 + 2]
      if (trns && p < trns.length) a = trns[p]
    } else {
      r = px[s]
      g = px[s + 1]
      b = px[s + 2]
      if (type === 6) a = px[s + 3]
    }
    rgba.set([r, g, b, a], i * 4)
  }
  return { w, h, rgba }
}

// ---- pixels → the Game Boy's ------------------------------------------------------------------

/** A 56×56 picture → 3136 shades, 0 (white; what a transparent pixel is too) to 3 (black), by luminance. */
export function shadesOf(png) {
  if (png.w !== PIC || png.h !== PIC) throw new Error(`a battle picture is ${PIC}×${PIC}, this is ${png.w}×${png.h}`)
  const out = new Uint8Array(PIC * PIC)
  for (let i = 0; i < out.length; i++) {
    const [r, g, b, a] = png.rgba.subarray(i * 4, i * 4 + 4)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    out[i] = a < 128 ? 0 : 3 - Math.min(3, Math.floor(lum / 64))
  }
  return out
}

/** Shades → 784 bytes of 2bpp, the 49 tiles in the order the game numbers them: column-major. */
export function tilesOf(shades) {
  const out = Buffer.alloc(TILES * TILES * 16)
  let o = 0
  for (let c = 0; c < TILES; c++)
    for (let r = 0; r < TILES; r++)
      for (let y = 0; y < 8; y++) {
        let lo = 0
        let hi = 0
        for (let x = 0; x < 8; x++) {
          const s = shades[(r * 8 + y) * PIC + c * 8 + x]
          lo = (lo << 1) | (s & 1)
          hi = (hi << 1) | (s >> 1)
        }
        out[o++] = lo
        out[o++] = hi
      }
  return out
}

let encode
/** A name → the game's 11 bytes: its characters, then $50s. Ten characters at most, all in the game's font. */
export function encodeName(name) {
  if (!encode) {
    encode = new Map()
    for (const [code, ch] of Object.entries(DATA.charmap)) if (!encode.has(ch)) encode.set(ch, Number(code))
    encode.set(' ', SPACE)
  }
  const chars = [...String(name)]
  if (!chars.length || chars.length > HUD_LEN) throw new Error(`a name is 1–${HUD_LEN} characters: “${name}”`)
  const out = Buffer.alloc(NAME_LEN, END)
  chars.forEach((ch, i) => {
    const code = encode.get(ch)
    if (code == null || code < 0x60) throw new Error(`the game has no “${ch}” (in “${name}”)`)
    out[i] = code
  })
  return out
}

// ---- the text ----------------------------------------------------------------------------------

// "Wild @ appeared!" → "A boring @ appeared!". The text lives in bank $27 of Yellow (UE) at file
// offset $9fb65 (TX_START "Wild " … TX_RAM wEnemyMonNick TX_START <LINE> "appeared!" <PROMPT>), reached
// through a text_far in the battle bank at $f40c7 (17 65 7b 27). "A boring " is longer, so the new
// text goes into the bank's padding at $9fb97 (1129 zero bytes to the bank's end) and the far
// pointer is turned to it. Both are pokes into the LOADED image (`patch`): the file is never
// written, and a state load (which carries the ROM) brings "Wild" back, so the watch reapplies it.
// With this on, the front name + "A boring " must fit the line: nine characters at most.
const TEXT_AT = 0x9fb97
const TEXT_PTR = 0xf40c7
const TEXT_ORIGINAL = Buffer.from([0x17, 0x65, 0x7b, 0x27])
const BORING = 'A boring '
export const FRONT_NAME_MAX = LINE_LEN - BORING.length

export function boringText() {
  const words = Buffer.from([...BORING].map((ch) => (ch === ' ' ? SPACE : encodeName(ch)[0])))
  return Buffer.concat([
    Buffer.from([0x00]), words, Buffer.from([END]), // text "A boring @"
    Buffer.from([0x01, A.wEnemyMonNick & 0xff, A.wEnemyMonNick >> 8]), // text_ram wEnemyMonNick
    Buffer.from([0x00, 0x4f]), encodeName('appeared')?.subarray(0, 8), Buffer.from([0xe7, 0x58]) // text "" line "appeared!" prompt
  ])
}

/** Patch the loaded ROM's wild-encounter text. Returns how many bytes changed (0 = it was already on). */
export async function boring(door, on = true) {
  const text = boringText()
  const addr = TEXT_AT - 0x9c000 + 0x4000 // bank-relative
  const ptr = on ? Buffer.from([0x17, addr & 0xff, addr >> 8, 0x27]) : TEXT_ORIGINAL
  const r = await door.call({ op: 'patch', writes: [[TEXT_AT, b64(text)], [TEXT_PTR, b64(ptr)]] })
  return r.changed ?? 0
}

// ---- the quiz: four Solar Beams, and a Splash for the other side --------------------------------

// Your FIRST party mon's four moves become A, B, C and ALL OF ABOVE, each a SOLAR BEAM: it takes in
// sunlight for a turn (the enemy's turn — which it spends on Splash, the only move it has) and fires
// the next. Transient throughout: (1) in the LOADED ROM, four DONOR moves' records in the move table
// (six bytes: animation / move number, effect, power, type, accuracy, pp) become Solar Beam's — its
// animation, "used SOLARBEAM!", "took in sunlight!", its power — and their names in the name table
// are overwritten in place, padded with spaces to the old length (a longer name would shift every
// name after it — except the LAST donor, SUBSTITUTE, whose 13-letter name spills into STRUGGLE's slot:
// the table's tail is rewritten from there, STRUGGLE moving into the zero padding after the table);
// (2) in WRAM, the moves and PP of wBattleMon and wEnemyMon, the BATTLE-ONLY copies the move menu and
// the AI read: the moves at each send-out, the PP topped up every poll (63, all a six-bit PP field
// holds; the records say 63 too, so the menu reads 63/63). The party keeps its real moves (the game
// copies PP back per slot, nothing else), so an in-game SAVE never sees this. Donors are moves nobody
// carries — never Splash. 13 letters is the move box's width; "used ALL THE ABOVE" fills the text
// line, and the "!" the game adds lands on the box's border.
const MOVE_RECORD = 6
const SOLAR_BEAM = 76
const SPLASH = 150
const QUIZ = [
  { id: 117, was: 'BIDE', name: 'A' },
  { id: 132, was: 'CONSTRICT', name: 'B' },
  { id: 140, was: 'BARRAGE', name: 'C' },
  { id: 164, was: 'SUBSTITUTE', name: 'ALL THE ABOVE' }
]
const LAST_MOVE = 165
const BATTLE_MOVES = 8
const BATTLE_PP = 0x1c
const QUIZ_PP = 63
const SPLASH_PP = 40

/** A run of the game's letters (upper, lower, space) — no length rule; `encodeName` keeps the HUD's. */
const letters = (s) => Buffer.from([...s].map((ch) => (ch === ' ' ? SPACE : ch >= 'a' && ch <= 'z' ? 0xa0 + ch.charCodeAt(0) - 97 : ch >= 'A' && ch <= 'Z' ? 0x80 + ch.charCodeAt(0) - 65 : encodeName(ch)[0])))

/** The tables, found in the cartridge FILE (the pristine bytes) rather than assumed. */
function findTables(rom) {
  const moves = rom.indexOf(Buffer.from([1, 0, 40, 0, 255, 35, 2, 0])) // POUND, KARATE CHOP
  const names = rom.indexOf(Buffer.concat([letters('POUND'), Buffer.from([END]), letters('KARATE CHOP'), Buffer.from([END])]))
  if (moves < 0 || names < 0) throw new Error('this is not Pokémon Yellow (UE): the move tables were not found')
  const at = []
  let p = names
  for (let id = 1; id <= LAST_MOVE; id++) {
    const e = rom.indexOf(END, p)
    at[id] = [p, e - p]
    p = e + 1
  }
  return { moves, at, end: p }
}

/** Patch the loaded ROM: the donors' records and names. Returns how many bytes changed. */
export async function quizPatch(door, on = true) {
  const info = await door.call({ op: 'info' })
  if (!info.rom) throw new Error('no cartridge loaded')
  const rom = readFileSync(info.rom)
  const { moves, at, end } = findTables(rom)
  const record = Buffer.from(rom.subarray(moves + (SOLAR_BEAM - 1) * MOVE_RECORD, moves + SOLAR_BEAM * MOVE_RECORD))
  record[5] = QUIZ_PP
  const writes = []
  for (const q of QUIZ) {
    const [off, len] = at[q.id]
    const name = on ? q.name : q.was
    if (name.length <= len) {
      const bytes = Buffer.alloc(len, SPACE)
      letters(name).copy(bytes)
      writes.push([off, b64(bytes)])
    } else {
      // The tail of the table from this name on, the names after it moved along; the file must have padding to take the spill.
      const tail = [letters(name), ...Array.from({ length: LAST_MOVE - q.id }, (_, i) => rom.subarray(at[q.id + 1 + i][0], at[q.id + 1 + i][0] + at[q.id + 1 + i][1]))]
      const bytes = Buffer.concat(tail.flatMap((n) => [n, Buffer.from([END])]))
      const spill = off + bytes.length - end
      if (spill > 0 && rom.subarray(end, end + spill).some((b) => b !== 0)) throw new Error(`“${name}” would run past the name table`)
      writes.push([off, b64(on ? bytes : rom.subarray(off, off + bytes.length))])
    }
    const rec = moves + (q.id - 1) * MOVE_RECORD
    writes.push([rec, b64(on ? record : rom.subarray(rec, rec + MOVE_RECORD))])
  }
  return (await door.call({ op: 'patch', writes })).changed ?? 0
}

/**
 * The battle copies: your first party mon gets the four quiz moves with fresh PP, the enemy Splash
 * alone — each once per send-out (PP is left alone while the moves are already ours). Returns
 * { mine: 'set' | 'topped up' | 'kept' | 'not first' | 'none', enemy: 'set' | 'kept' | 'none' }.
 */
export async function quizMoves(door) {
  const [inBattle, num, nick, mine, pp, enemy] = await read(door, [[A.wIsInBattle, 1], [A.wPlayerMonNumber, 1], [A.wBattleMonNick, 1], [A.wBattleMon + BATTLE_MOVES, 4], [A.wBattleMon + BATTLE_PP, 4], [A.wEnemyMon + BATTLE_MOVES, 4]])
  if (!inBattle[0]) return { mine: 'none', enemy: 'none' }
  const out = { mine: 'none', enemy: 'none' }
  const writes = []
  const ours = Buffer.from(QUIZ.map((q) => q.id))
  if (nick[0] === 0 || nick[0] === END) out.mine = 'none'
  else if (num[0] !== 0) out.mine = 'not first'
  else if (mine.equals(ours) && pp.every((b) => b === QUIZ_PP)) out.mine = 'kept'
  else {
    if (!mine.equals(ours)) writes.push([A.wBattleMon + BATTLE_MOVES, b64(ours)])
    writes.push([A.wBattleMon + BATTLE_PP, b64(Buffer.alloc(4, QUIZ_PP))])
    out.mine = mine.equals(ours) ? 'topped up' : 'set'
  }
  const splash = Buffer.from([SPLASH, 0, 0, 0])
  if (enemy[0] === 0) out.enemy = 'none'
  else if (enemy.equals(splash)) out.enemy = 'kept'
  else {
    writes.push([A.wEnemyMon + BATTLE_MOVES, b64(splash)], [A.wEnemyMon + BATTLE_PP, b64(Buffer.from([SPLASH_PP, 0, 0, 0]))])
    out.enemy = 'set'
  }
  if (writes.length) await door.call({ op: 'poke', writes })
  return out
}

// ---- the paint ----------------------------------------------------------------------------------

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const read = async (door, ranges) => (await door.call({ op: 'ram', ranges })).data.map((d) => Buffer.from(d, 'base64'))

// VRAM is shut while the LCD draws a line (STAT mode 3): this core drops a write then and
// reads $FF, and a poke or a read lands wherever the last 8ms step ended. So a read that is
// all $FF is asked again one keyless step later, and a write is read back and, on a miss,
// made again a step later.
const TRIES = 24
/** Let a step go by: headless, step the core; in the deck the game runs on by itself, so only WAIT — a `hold` there is a job, which takes the player's keys for that step. */
const step = (door) => (door.core ? door.call({ op: 'hold', keys: [], iterations: 1 }) : new Promise((done) => setTimeout(done, 6)))

async function readVram(door, addr, len) {
  let bytes
  for (let i = 0; i < TRIES; i++) {
    ;[bytes] = await read(door, [[addr, len]])
    if (bytes.some((b) => b !== 0xff)) break
    await step(door)
  }
  return bytes
}

async function pokeVram(door, addr, bytes) {
  for (let i = 0; i < TRIES; i++) {
    await door.call({ op: 'poke', writes: [[addr, b64(bytes)]] })
    if ((await readVram(door, addr, bytes.length)).equals(bytes)) return true
    await step(door)
  }
  return false
}

const isWhole = (slot, map) => {
  for (let c = 0; c < TILES; c++) for (let r = 0; r < TILES; r++) if (map[(slot.row + r) * COLS + slot.col + c] !== slot.first + c * TILES + r) return false
  return true
}
const hudUp = (slot, map) => slot.frame.every(([x, y, tile]) => map[y * COLS + x] === tile)
let SENT
/** "sent out" somewhere in the text box: a trainer's mon is coming in. */
const sentOut = (map) => {
  if (!SENT) SENT = Buffer.from([...'sent'].map((ch) => encodeName(ch)[0]))
  for (let y = 12; y < 18; y++) if (map.subarray(y * COLS, y * COLS + COLS).indexOf(SENT) >= 0) return true
  return false
}

/**
 * Paint what can be painted right now. `front` / `back` are { tiles, name } (either may be
 * absent). A slot's picture is written ONLY while the tile map shows that slot's 7×7 block
 * whole AND it is a mon's — yours: your HUD is up; the enemy's: a wild battle, its HUD up, or
 * "sent out" in the text box — so never Red's back, a trainer's face, a menu, the party screen,
 * a send-out animation. Its name goes in whenever the slot's nick holds one; the HUD is rewritten
 * while its frame is up and the cells hold a name that is not ours. Returns, per slot, what was
 * done: { pic, name } where pic is 'painted' | 'kept' (already ours) | 'hidden' (not up) |
 * 'missed' (VRAM never took it), and name is 'written' | 'kept' | 'none'.
 */
export async function apply(door, { front, back } = {}) {
  const [inBattle, map] = await read(door, [[A.wIsInBattle, 1], [A.wTileMap, COLS * 18]])
  const kind = inBattle[0]
  if (!kind) return { battle: false }
  const out = { battle: true, kind: kind === 1 ? 'wild' : 'trainer' }
  for (const [key, want] of [['front', front], ['back', back]]) {
    if (!want) continue
    const slot = SLOTS[key]
    const [nick] = await read(door, [[slot.nick, NAME_LEN]])
    const done = { pic: 'hidden', name: 'none' }
    out[key] = done

    if (want.name && nick[0] !== 0 && nick[0] !== END) {
      const name = encodeName(want.name)
      const at = slot.hud.y * COLS + slot.hud.x
      const cells = map.subarray(at, at + HUD_LEN)
      const writes = []
      done.name = 'kept'
      if (!nick.equals(name)) {
        writes.push([slot.nick, b64(name)])
        done.name = 'written'
      }
      const ours = Buffer.from(name.subarray(0, HUD_LEN)).map((b) => (b === END ? SPACE : b))
      if (hudUp(slot, map) && !cells.equals(ours) && cells[0] >= 0x80 && cells.every((b) => b >= 0x80 || b === SPACE)) {
        writes.push([A.wTileMap + at, b64(ours)])
        done.name = 'written'
      }
      if (writes.length) await door.call({ op: 'poke', writes })
    }

    if (want.tiles && isWhole(slot, map)) {
      const mon = key === 'back' ? hudUp(slot, map) : kind === 1 || hudUp(slot, map) || sentOut(map)
      if (!mon) done.pic = 'not a mon'
      else if ((await readVram(door, slot.vram, want.tiles.length)).equals(want.tiles)) done.pic = 'kept'
      else done.pic = (await pokeVram(door, slot.vram, want.tiles)) ? 'painted' : 'missed'
    }
  }
  return out
}
