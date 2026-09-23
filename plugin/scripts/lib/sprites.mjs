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

/** A strip of 56×56 frames (data/sprites/fox-back.png) → one tile block per frame. */
export function backFrames(png) {
  if (png.h !== PIC || png.w % PIC) throw new Error(`a back strip is ${PIC}px tall, frames ${PIC}px apart`)
  const frames = []
  for (let f = 0; f < png.w / PIC; f++) {
    const one = { w: PIC, h: PIC, rgba: new Uint8Array(PIC * PIC * 4) }
    for (let y = 0; y < PIC; y++) one.rgba.set(png.rgba.subarray((y * png.w + f * PIC) * 4, (y * png.w + f * PIC + PIC) * 4), y * PIC * 4)
    frames.push(tilesOf(shadesOf(one)))
  }
  return frames
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
    Buffer.from([0x00, 0x4f]), letters('appeared'), Buffer.from([0xe7, 0x58]) // text "" line "appeared!" prompt
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

// ---- the update: four Solar Beams, and a Splash for the other side ------------------------------

// Your FIRST party mon's four moves become a MOVESET from data/sprites/movesets.json — "update" is
// NOTES, WITH, FRIENDS, VERSION 2.0 (Village's tagline down the menu, then the release); edit the
// file for others, four names of up to 13 letters (the move box's width) — each HYPER BEAM'S
// ANIMATION AND POWER ON SOLAR BEAM'S CHARGE, never missing, of the unused BIRD type renamed APP (so
// the box says TYPE/ APP, and nothing resists it): "VILLAGE is updating!" for a turn (the enemy's
// turn — which it spends on Splash, the only move it has) and "VILLAGE used THE POWER OF
// FRIENDSHIP!" the next, WHATEVER THE MOVE WAS CALLED: the used line's code picks the move name on
// the player's branch, and those 8 bytes become a jump to a text of ours (see FIRED below); the
// enemy's branch, and its "used SPLASH!", are untouched. THE LINES THAT NAME YOUR MON from the party — "gained … EXP. Points!", "grew to level",
// "fainted!" — print a scratch buffer the game fills from wPartyMonNicks, which is never written;
// their text_ram pointers are turned to wBattleMonNick instead, so they say VILLAGE too. Transient throughout: (1) in the LOADED ROM, four DONOR moves' records in the move table
// (six bytes: animation / move number, effect, power, type, accuracy, pp) become HYPER_BEAM,
// CHARGE, 150, BIRD, 255, 10, and the one byte of the charge-line selector that says SOLARBEAM says
// HYPER_BEAM, so the charge turn prints Solar Beam's line, rewritten "is updating!"; and THE WHOLE NAME TABLE is
// rebuilt with the donors' names swapped (an @-terminated name per move, so a longer name shifts
// every name after it; the table is followed by 2.5K of zero padding, which takes the growth);
// (2) in WRAM, the moves and PP of wBattleMon and wEnemyMon, the BATTLE-ONLY copies the move menu and
// the AI read: the moves at each send-out, the PP topped up every poll (10; the records say 10 too,
// so the menu reads 10/10). The party keeps its real moves — the game only docks 1 PP a turn off the
// real move in that slot, which the party does keep — so an in-game SAVE never sees the moves. Donors are moves nobody
// carries — never Splash. 13 letters is the move box's width; "used ALL THE ABOVE" fills the text
// line, and the "!" the game adds lands on the box's border.
const MOVE_RECORD = 6
const HYPER_BEAM = 63
const CHARGE = 39 // Solar Beam's effect
const SPLASH = 150
const RECORD = [HYPER_BEAM, CHARGE, 150, 0, 255, 0] // type and pp filled in below
/** The charge-line selector's `cp SOLARBEAM`: cp RAZOR_WIND; ld hl,..; jr z; cp SOLARBEAM … — the byte after the second cp. */
const SELECTOR = Buffer.from([0xfe, 0x0d, 0x21])
const SOLAR_BEAM = 76
// THE FIRED LINE. The used line is "<USER>" then, from a text_asm in the battle bank, "used " + the
// move's name + "!": after `ldh a,[hWhoseTurn]; and a` it loads the PLAYER's move and hl (8 bytes:
// fa d1 cf 21 f1 cc 28 06 — ld a,[wPlayerMoveNum]; ld hl,wPlayerUsedMove; jr z,+6) and falls into the
// enemy's load when it is not the player's turn. Those 8 bytes become `jr nz,+4; ld hl,STUB; ret; nop;
// nop`: the enemy's turn takes the same path as before, the player's returns STUB to the text
// engine — a 5-byte home-bank text (text_far to the bank $27 padding, after the boring text) that
// prints "used THE POWER OF" <SCROLL> "FRIENDSHIP!" and is done. The home bank has 17 spare bytes
// at its very end. wPlayerUsedMove is left stale on the player's turn (only Mirror Move reads it).
const USED_ASM = Buffer.from([0x17, 0x2a, 0x79, 0x27, 0x08, 0xf0, 0xf3, 0xa7]) // text_far _MonName1Text; text_asm; ldh a,[hWhoseTurn]; and a
const USED_PLAYER = Buffer.from([0xfa, 0xd1, 0xcf, 0x21, 0xf1, 0xcc, 0x28, 0x06])
const FIRED_LINE = ['used THE POWER OF', 'FRIENDSHIP!']
const SCROLL = 0x4c
const DONE = 0x57
const LINE = 0x4f
// YOUR NAME in the game's lines: the text engine's <PLAYER> handler in the home bank is `push de; ld
// de,wPlayerName; jr …` (d5 11 57 d1 18); its operand is turned to a string of ours at $0010 — the
// RST vectors: a `rst $38` trap every eighth byte and zeros between, which Yellow never executes — so every "<PLAYER> …" line says VILLAGE USER while
// wPlayerName (which a SAVE keeps) stays as it is. The start menu and the trainer card print
// wPlayerName directly and keep the real name. Lines were laid out for 7 letters; 12 may run long.
export const PLAYER_NAME = 'VILLAGE USER'
export const PLAYER_NAME_MAX = 12 // 7 fits every line the game lays out; past that "defeated" and friends run off the box
const PLAYER_AT = 0x0010
const PLAYER_LOAD = Buffer.from([0xd5, 0x11, 0x57, 0xd1, 0x18]) // push de; ld de,wPlayerName; jr
export function firedText() {
  return Buffer.concat([Buffer.from([0x00, LINE]), letters(FIRED_LINE[0]), Buffer.from([SCROLL]), letters(FIRED_LINE[1]), Buffer.from([DONE])])
}
const DONORS = [140, 117, 132, 164] // BARRAGE, BIDE, CONSTRICT, SUBSTITUTE
export const MOVESETS = JSON.parse(readFileSync(new URL('../../data/sprites/movesets.json', import.meta.url), 'utf8'))
export const MOVE_NAME_MAX = 13
const BIRD = 6
const TYPE_NAME = { was: 'BIRD', now: 'APP' }
/** Solar Beam's charge line, rewritten in place (space-padded to its length). */
const CHARGE_LINE = { was: 'took in sunlight!', now: 'is updating!' }
/** Lines that print the party name from the scratch buffer (text_ram wcd6d, bytes 01 6d cd), found by what follows: text (00) then the words, or a line break (4f) first. */
const NAMED_LINES = [[0x00, ' gained'], [0x00, ' grew'], [0x00, 0x4f, 'fainted!']]
const SCRATCH = Buffer.from([0x01, 0x6d, 0xcd])
const LAST_MOVE = 165
const BATTLE_MOVES = 8
/** battle_struct: species, hp(2), box level, status, types(2), catch, moves(4), DVs(2), level, maxhp(2), atk, def, spd, spc, PP(4) at +$19. +$1c was a bug — it is only the LAST PP slot, so the other three writes landed past the struct, in wTrainerClass on our side and the enemy's base stats on theirs. */
const BATTLE_PP = 0x19
const QUIZ_PP = 10
const SPLASH_PP = 40

/** A run of the game's letters (upper, lower, digits, space . ! -) — no length rule; `encodeName` keeps the HUD's. NEVER a control code: \x4c is the letter L. */
const letters = (s) => Buffer.from([...s].map((ch) => (ch === ' ' ? SPACE : ch === '!' ? 0xe7 : ch === '.' ? 0xe8 : ch >= '0' && ch <= '9' ? 0xf6 + ch.charCodeAt(0) - 48 : ch >= 'a' && ch <= 'z' ? 0xa0 + ch.charCodeAt(0) - 97 : ch >= 'A' && ch <= 'Z' ? 0x80 + ch.charCodeAt(0) - 65 : encodeName(ch)[0])))

/** The tables, found in the cartridge FILE (the pristine bytes) rather than assumed. */
function findTables(rom) {
  const moves = rom.indexOf(Buffer.from([1, 0, 40, 0, 255, 35, 2, 0])) // POUND, KARATE CHOP
  const names = rom.indexOf(Buffer.concat([letters('POUND'), Buffer.from([END]), letters('KARATE CHOP'), Buffer.from([END])]))
  const bird = rom.indexOf(Buffer.concat([letters('ROCK'), Buffer.from([END]), letters(TYPE_NAME.was), Buffer.from([END])]))
  const usedAsm = rom.indexOf(USED_ASM)
  const used = usedAsm >= 0 && rom.subarray(usedAsm + USED_ASM.length, usedAsm + USED_ASM.length + 8).equals(USED_PLAYER) ? usedAsm + USED_ASM.length : -1
  const player = rom.indexOf(PLAYER_LOAD)
  const nameRoom = PLAYER_NAME_MAX + 1
  if (player < 0 || player >= 0x4000 || rom.subarray(PLAYER_AT, PLAYER_AT + nameRoom).some((b) => b !== 0 && b !== 0xff)) throw new Error('the <PLAYER> handler or the RST vectors are not as expected')
  let stub = 0x4000 // the home bank's tail: at least five zero bytes
  while (stub > 0 && rom[stub - 1] === 0) stub--
  if (0x4000 - stub < 5) stub = -1
  const fired = TEXT_AT + boringText().length // right after the boring text, in the same padding
  if (rom.subarray(fired, fired + 40).some((b) => b !== 0)) throw new Error('no room after the boring text')
  let selector = -1
  for (let i = rom.indexOf(SELECTOR); i >= 0; i = rom.indexOf(SELECTOR, i + 1)) if (rom[i + 5] === 0x28 && rom[i + 7] === 0xfe && rom[i + 8] === SOLAR_BEAM && rom[i + 9] === 0x21 && rom[i + 12] === 0x28) { selector = i + 8; break }
  const charge = rom.indexOf(letters(CHARGE_LINE.was))
  const named = NAMED_LINES.map((parts) => rom.indexOf(Buffer.concat([SCRATCH, ...parts.map((p) => (typeof p === 'number' ? Buffer.from([p]) : letters(p)))])))
  if (moves < 0 || names < 0 || bird < 0 || selector < 0 || used < 0 || stub < 0 || charge < 0 || named.some((i) => i < 0)) throw new Error('this is not Pokémon Yellow (UE): the move tables were not found')
  const at = []
  let p = names
  for (let id = 1; id <= LAST_MOVE; id++) {
    const e = rom.indexOf(END, p)
    at[id] = [p, e - p]
    p = e + 1
  }
  return { moves, names, at, end: p, bird: bird + 'ROCK'.length + 1, selector, used, stub, fired, charge, named, player: player + 2 }
}

/** The four names of a moveset, checked: four of them, 1–${MOVE_NAME_MAX} letters, in the game's font. */
export function moveset(name) {
  const set = MOVESETS[name]
  if (!set) throw new Error(`no moveset “${name}”: movesets.json has ${Object.keys(MOVESETS).join(', ')}`)
  if (!Array.isArray(set) || set.length !== 4) throw new Error(`moveset “${name}” must be four names`)
  for (const n of set) {
    if (typeof n !== 'string' || !n.length || n.length > MOVE_NAME_MAX) throw new Error(`a move name is 1–${MOVE_NAME_MAX} letters (the move box): “${n}”`)
    if (!/^[A-Z0-9 .!-]+$/.test(n)) throw new Error(`move names are capitals, digits, spaces, . - !: “${n}”`)
  }
  return set
}

/** The whole name table: every name as it was, the donors' swapped for the moveset's (null = as it was). */
function nameTable(rom, t, names4) {
  const parts = []
  for (let id = 1; id <= LAST_MOVE; id++) {
    const k = DONORS.indexOf(id)
    parts.push(names4 && k >= 0 ? letters(names4[k]) : rom.subarray(t.at[id][0], t.at[id][0] + t.at[id][1]), Buffer.from([END]))
  }
  const table = Buffer.concat(parts)
  const spill = t.names + table.length - t.end
  if (spill > 0 && rom.subarray(t.end, t.end + spill).some((b) => b !== 0)) throw new Error('the move names would run past their table')
  return table
}

/** The cartridge file and its tables, read once per process. */
let cart
async function cartridge(door) {
  if (cart) return cart
  const info = await door.call({ op: 'info' })
  if (!info.rom) throw new Error('no cartridge loaded')
  const rom = readFileSync(info.rom)
  return (cart = { rom, t: findTables(rom) })
}

/** Patch the loaded ROM: the donors' records and names (the name table rebuilt), the type, the selector, the lines. Returns how many bytes changed. */
export async function quizPatch(door, { set = 'update', on = true, name = PLAYER_NAME } = {}) {
  const names4 = moveset(set)
  if (!/^[A-Z0-9 .!-]{1,12}$/.test(name)) throw new Error(`a player name is 1–${PLAYER_NAME_MAX} capitals, digits or spaces: “${name}”`)
  const { rom, t } = await cartridge(door)
  const { moves, names, bird, selector, used, stub, fired, charge, named, player } = t
  const record = Buffer.from(RECORD)
  record[3] = BIRD
  record[5] = QUIZ_PP
  const writes = []
  writes.push([names, b64(nameTable(rom, t, on ? names4 : null))])
  writes.push([selector, b64(Buffer.from([on ? HYPER_BEAM : SOLAR_BEAM]))])
  const text = firedText()
  const rel = (fired & 0x3fff) + 0x4000
  writes.push([fired, b64(on ? text : Buffer.alloc(text.length))])
  writes.push([stub, b64(on ? Buffer.from([0x17, rel & 0xff, rel >> 8, fired >> 14, END]) : Buffer.alloc(5))])
  writes.push([used, b64(on ? Buffer.from([0x20, 0x04, 0x21, stub & 0xff, stub >> 8, 0xc9, 0x00, 0x00]) : USED_PLAYER)])
  writes.push([PLAYER_AT, b64(on ? Buffer.concat([letters(name), Buffer.from([END]), rom.subarray(PLAYER_AT + name.length + 1, PLAYER_AT + PLAYER_NAME_MAX + 1)]) : rom.subarray(PLAYER_AT, PLAYER_AT + PLAYER_NAME_MAX + 1))])
  writes.push([player, b64(on ? Buffer.from([PLAYER_AT & 0xff, PLAYER_AT >> 8]) : Buffer.from([A.wPlayerName & 0xff, A.wPlayerName >> 8]))])
  for (const id of DONORS) {
    const rec = moves + (id - 1) * MOVE_RECORD
    writes.push([rec, b64(on ? record : rom.subarray(rec, rec + MOVE_RECORD))])
  }
  const type = Buffer.alloc(TYPE_NAME.was.length + 1, END)
  letters(on ? TYPE_NAME.now : TYPE_NAME.was).copy(type)
  writes.push([bird, b64(type)])
  const line = Buffer.alloc(CHARGE_LINE.was.length, SPACE)
  letters(on ? CHARGE_LINE.now : CHARGE_LINE.was).copy(line)
  writes.push([charge, b64(line)])
  const nick = Buffer.from([0x01, A.wBattleMonNick & 0xff, A.wBattleMonNick >> 8])
  for (const i of named) writes.push([i, b64(on ? nick : SCRATCH)])
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
  const ours = Buffer.from(DONORS)
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

// ---- Foxtrot in the overworld -------------------------------------------------------------------

// Red is four 8×8 hardware sprites in a 2×2 block, tiles row-major (TL TR BL BR): standing frames at
// OBJ tiles $00–$0B (down, up, left; right is left x-flipped by the game), walking frames at $80–$8B
// — $8000 and $8800 in VRAM, 64 bytes a frame. Pikachu, who trails a step behind, is the same shape
// right after ($0C–$17, $8C–$97). The game shows the standing frame and, as you step, alternates it
// with the walking one; so BOTH are kept equal to the CURRENT frame of Foxtrot's own animation — the
// run cycle while wWalkCounter runs, the idle cycle otherwise — and every direction gets the same
// side-view fox (a fox trots sideways). Pikachu's tiles are blanked: he still follows, unseen. The
// tiles are reloaded by the game on a map change, so a repaint follows whenever they are not ours.
// Never in a battle: $8000 is the battle's sprites then.
const FOX_CELL = 16
const FOX_MS = { idle: 280, run: 69 } // lib/fox.ts: idle 5 frames in 1400ms, run 8 in 550ms
const RED_STAND = 0x8000
const RED_WALK = 0x8800
const PIKA_STAND = 0x80c0
const PIKA_WALK = 0x88c0
const SPRITE_BYTES = 12 * 16 // three frames of four tiles
// His coat: OBJ palette 0 (Red's; the OAM attribute's low bits) in the CGB's palette RAM, through
// OCPS ($FF6A, index | $80 = auto-increment) and OCPD ($FF6B): 1 white, 2 Village's orange, 3 the
// outline, as BGR555. The game rewrites palettes on map loads and fades, so it is set again with
// every paint and once a second.
const OCPS = 0xff6a
const OCPD = 0xff6b
const PALETTE_EVERY_MS = 1000
let paletteAt = 0

async function foxPalette(door) {
  const writes = [[OCPS, b64(Buffer.from([0x80]))]]
  for (const c of FOX_COAT) writes.push([OCPD, b64(Buffer.from([c & 0xff]))], [OCPD, b64(Buffer.from([c >> 8]))])
  await door.call({ op: 'poke', writes })
}

/** A strip PNG (frames 16px apart) → an array of 64-byte frames, the four tiles row-major. */
export function foxFrames(png) {
  if (png.h !== FOX_CELL || png.w % FOX_CELL) throw new Error(`a fox strip is ${FOX_CELL}px tall, frames ${FOX_CELL}px apart`)
  const shades = new Uint8Array(png.w * png.h)
  for (let i = 0; i < shades.length; i++) {
    const [r, g, b, a] = png.rgba.subarray(i * 4, i * 4 + 4)
    shades[i] = a < 128 ? 0 : 3 - Math.min(3, Math.floor((0.299 * r + 0.587 * g + 0.114 * b) / 64))
  }
  const frames = []
  for (let f = 0; f < png.w / FOX_CELL; f++) {
    const out = Buffer.alloc(64)
    let o = 0
    for (const [ty, tx] of [[0, 0], [0, 1], [1, 0], [1, 1]])
      for (let y = 0; y < 8; y++) {
        let lo = 0
        let hi = 0
        for (let x = 0; x < 8; x++) {
          const v = shades[(ty * 8 + y) * png.w + f * FOX_CELL + tx * 8 + x]
          lo = (lo << 1) | (v & 1)
          hi = (hi << 1) | (v >> 1)
        }
        out[o++] = lo
        out[o++] = hi
      }
    frames.push(out)
  }
  return frames
}

/**
 * Paint Foxtrot's current frame into Red's cells (both slots, all three directions) and blank
 * Pikachu's, and set his coat. `fox` is { idle, run } from foxFrames; `now` picks the frame.
 * Returns 'battle' | 'kept' | 'painted' | 'missed', with the frame shown.
 */
export async function overworld(door, fox, now = Date.now()) {
  const [inBattle, walk] = await read(door, [[A.wIsInBattle, 1], [A.wWalkCounter, 1]])
  if (inBattle[0]) return { pic: 'battle' }
  const cycle = walk[0] ? 'run' : 'idle'
  const frames = fox[cycle]
  const frame = frames[Math.floor(now / FOX_MS[cycle]) % frames.length]
  const block = Buffer.concat([frame, frame, frame])
  const out = { pic: 'kept', cycle, frame: frames.indexOf(frame) }
  for (const at of [RED_STAND, RED_WALK]) {
    if ((await readVram(door, at, SPRITE_BYTES)).equals(block)) continue
    out.pic = (await pokeVram(door, at, block)) ? 'painted' : 'missed'
  }
  const blank = Buffer.alloc(SPRITE_BYTES)
  for (const at of [PIKA_STAND, PIKA_WALK]) {
    const now_ = await readVram(door, at, SPRITE_BYTES)
    if (now_.equals(blank)) continue
    if (!(await pokeVram(door, at, blank))) out.pic = 'missed'
    else if (out.pic === 'kept') out.pic = 'painted'
  }
  if (out.pic === 'painted' || now - paletteAt > PALETTE_EVERY_MS) {
    await foxPalette(door)
    paletteAt = now
  }
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
 * absent); `fox` is Foxtrot's idle as back-slot frames (backFrames), painted in RED's place — the
 * back block whole with no HUD of yours — cycling by `now`. A slot's picture is written ONLY while the tile map shows that slot's 7×7 block
 * whole AND it is a mon's — yours: your HUD is up; the enemy's: a wild battle, its HUD up, or
 * "sent out" in the text box — so never Red's back, a trainer's face, a menu, the party screen,
 * a send-out animation. Its name goes in whenever the slot's nick holds one; the HUD is rewritten
 * while its frame is up and the cells hold a name that is not ours. Returns, per slot, what was
 * done: { pic, name } where pic is 'painted' | 'kept' (already ours) | 'hidden' (not up) |
 * 'missed' (VRAM never took it), and name is 'written' | 'kept' | 'none'; `map` is the tile map as read.
 */
const FOX_BACK_MS = 280
/** Foxtrot's colours as a Game Boy palette: clear, white, Village's orange, the outline (BGR555). */
const bgr555 = ([r, g, b]) => ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3)
const FOX_COAT = [[255, 255, 255], [255, 255, 255], [214, 121, 65], [47, 47, 46]].map(bgr555)
// Red's block is BG palette 2 (white, yellow, RED, dark — the tint), shared with the text box, which
// only uses white and dark. Once the battle's fade-in has left Red's finished red in colour 2 (its
// low byte $3f; ours is $fa), the palette becomes his coat's; the game restores its own at the send-out.
// The enemy's picture is BG palette 3, its own (the HUD is 1, the text box 2): Notes wears the real
// icon's colours — paper, yellow, brownish-yellow rules, the outline — set once the fade-in has
// brought colour 0 up to white, and again whenever the game's own flashes and send-outs put the
// species' palette back.
// THAT IS NOT ENOUGH ON ITS OWN. A move's flash (the quiz's charging beam) rebuilds palette 3 a
// step at a time out of the SPECIES' four colours and copies each step into palette RAM, so for a
// few seconds Notes wore green (or red, or whatever the mon is) — and while a step is up colour 0
// is not white, so the check below reads 'fading' and leaves it alone. The steps are not built
// from the hardware palette we overwrote, and not from the game's own copy of palette 3 at $DEE9
// (forcing that to ours every single frame changed nothing): each step is read STRAIGHT OUT OF THE
// CARTRIDGE, from the palette table the species' picture uses. So the species' entry in that table
// is rewritten with Notes' colours for as long as the battle lasts (`notesRom`) — the loaded ROM
// only, never the file — and the game's own flashes, fades and restores then come out yellow of
// their own accord. The entry is put back when the battle ends, so the Pokédex and the party
// screen keep the real colours.
const BCPS = 0xff68
const BCPD = 0xff69
const RED_PALETTE = 2
const RED_LOW = 0x3f
const ENEMY_PALETTE = 3
const NOTES_COLOURS = [[255, 255, 255], [255, 228, 0], [184, 144, 56], [47, 47, 46]].map(bgr555) // the core renders warm, so the yellow is pushed pure
const NOTES_BYTES = Buffer.from(NOTES_COLOURS.flatMap((c) => [c & 0xff, c >> 8]))
/** The game's own copy of BG palette 3: what it hands the hardware, and what a species' SetPal writes. */
const ENEMY_PAL_COPY = 0xdee9
/** The cartridge's palette table, at the ten entries a mon can wear (PAL_MEWMON … PAL_GREYMON), each white … black. */
const MON_PALETTES = 0x72b79
const MON_PALETTE_COUNT = 10

/** One byte of the CGB BG palette RAM, by index. */
async function bgByte(door, index) {
  await door.call({ op: 'poke', writes: [[BCPS, b64(Buffer.from([index]))]] })
  const [b] = await read(door, [[BCPD, 1]])
  return b[0]
}
async function setBgPalette(door, index, colours) {
  const writes = [[BCPS, b64(Buffer.from([0x80 | (index * 8)]))]]
  for (const c of colours) writes.push([BCPD, b64(Buffer.from([c & 0xff]))], [BCPD, b64(Buffer.from([c >> 8]))])
  await door.call({ op: 'poke', writes })
}
async function slotPalette(door) {
  const low = await bgByte(door, RED_PALETTE * 8 + 4)
  if (low === (FOX_COAT[2] & 0xff)) return 'coat'
  if (low !== RED_LOW) return 'fading'
  await setBgPalette(door, RED_PALETTE, FOX_COAT)
  return 'set'
}
async function notesPalette(door) {
  if ((await bgByte(door, ENEMY_PALETTE * 8 + 2)) === (NOTES_COLOURS[1] & 0xff)) return 'notes'
  if ((await bgByte(door, ENEMY_PALETTE * 8)) !== 0xff) return 'fading' // colour 0 not yet white: mid-fade
  await setBgPalette(door, ENEMY_PALETTE, NOTES_COLOURS)
  return 'set'
}

/**
 * The species' entry in the cartridge's palette table, ours while the battle lasts, so every flash,
 * fade and restore the game builds for the enemy's picture is built out of Notes' colours. The
 * table is read from the ROM FILE (the cartridge as it shipped), so it also says what to put back.
 * Returns 'ours' (the game is already handing out our colours), 'patched', 'restored', 'unknown'
 * (palette 3 is nobody's species — a trainer's picture, a fade) or 'none'.
 */
const ROM_RENEW = 2000 // a state load restores the whole ROM, so the entry is written again on a clock, like the text patch
let romPal = null
let romAt = 0
async function notesRom(door, inBattle, now = Date.now()) {
  try {
    if (!inBattle) {
      if (romPal === null) return 'none'
      const { rom } = await cartridge(door)
      await door.call({ op: 'patch', writes: [[romPal, b64(rom.subarray(romPal, romPal + 8))]] })
      romPal = null
      return 'restored'
    }
    const [copy] = await read(door, [[ENEMY_PAL_COPY, 8]])
    const ours = copy.equals(NOTES_BYTES)
    if (ours && (romPal === null || now - romAt < ROM_RENEW)) return 'ours' // the game is handing out our colours already
    const { rom } = await cartridge(door)
    let at = ours ? romPal : -1
    if (!ours) for (let i = 0; i < MON_PALETTE_COUNT; i++) {
      const o = MON_PALETTES + i * 8
      if (copy.equals(rom.subarray(o, o + 8))) { at = o; break }
    }
    if (at < 0) return 'unknown' // palette 3 is nobody's species — a trainer's picture, a fade step of ours: leave the cartridge alone
    const writes = []
    if (romPal !== null && romPal !== at) writes.push([romPal, b64(rom.subarray(romPal, romPal + 8))])
    writes.push([at, b64(NOTES_BYTES)])
    const { changed } = await door.call({ op: 'patch', writes })
    romPal = at
    romAt = now
    return changed ? 'patched' : 'ours'
  } catch {
    return 'none' // no cartridge file to read: the hardware palette alone, as before
  }
}

export async function apply(door, { front, back, fox } = {}, now = Date.now()) {
  const [inBattle, map] = await read(door, [[A.wIsInBattle, 1], [A.wTileMap, COLS * 18]])
  const kind = inBattle[0]
  if (!kind) return { battle: false, rom: await notesRom(door, false) }
  const out = { battle: true, kind: kind === 1 ? 'wild' : 'trainer', map }
  if (front?.tiles) out.rom = await notesRom(door, true)
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
      if (!mon && key === 'back' && fox?.length) {
        // Red, waiting to send out: Foxtrot stands there instead, wagging.
        const frame = fox[Math.floor(now / FOX_BACK_MS) % fox.length]
        if ((await readVram(door, slot.vram, frame.length)).equals(frame)) done.pic = 'Foxtrot'
        else done.pic = (await pokeVram(door, slot.vram, frame)) ? 'Foxtrot painted' : 'missed'
        done.coat = await slotPalette(door)
      } else if (!mon) done.pic = 'not a mon'
      else if ((await readVram(door, slot.vram, want.tiles.length)).equals(want.tiles)) done.pic = 'kept'
      else done.pic = (await pokeVram(door, slot.vram, want.tiles)) ? 'painted' : 'missed'
      if (key === 'front' && done.pic !== 'missed') done.coat = await notesPalette(door) // Village keeps the palette of the species in your slot
    }
  }
  return out
}
