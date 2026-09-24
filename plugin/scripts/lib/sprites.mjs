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
// RST vectors: a `rst $38` trap every eighth byte and zeros between, which Yellow never executes — so every "<PLAYER> …" line says VILLAGER while
// wPlayerName (which a SAVE keeps) stays as it is. The start menu and the trainer card print
// wPlayerName directly and keep the real name. Lines were laid out for 7 letters; 12 may run long.
export const PLAYER_NAME = 'VILLAGER' // 8: one over the seven the lines were laid out for; VILLAGE USER (12) wrapped them
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

/** A run of the game's letters (upper, lower, digits, space . ! ? -) — no length rule; `encodeName` keeps the HUD's. NEVER a control code: \x4c is the letter L. */
const letters = (s) => Buffer.from([...s].map((ch) => (ch === ' ' ? SPACE : ch === '!' ? 0xe7 : ch === '?' ? 0xe6 : ch === '.' ? 0xe8 : ch >= '0' && ch <= '9' ? 0xf6 + ch.charCodeAt(0) - 48 : ch >= 'a' && ch <= 'z' ? 0xa0 + ch.charCodeAt(0) - 97 : ch >= 'A' && ch <= 'Z' ? 0x80 + ch.charCodeAt(0) - 65 : encodeName(ch)[0])))

// ---- EVERY TRAINER IS A BUG CATCHER -----------------------------------------------------------

// Three things make a trainer: the CLASS NAME the game prints ("BUG CATCHER wants to fight!",
// "<PLAYER> defeated BUG CATCHER!"), the PICTURE that slides in with it, and the line he says when
// he loses. All three become a Bug Catcher's, in the LOADED image only, and all three are found by
// walking the cartridge FILE rather than assumed.
//
// THE NAME. `TrainerNames` is one @-terminated name per class, 47 of them (DATA.trainers has the
// list), and CODE follows it with no padding at all — so a table of 47 "BUG CATCHER"s (564 bytes
// against the original 399) will not go in its place, and a copy elsewhere would need both the home
// bank's NamePointers entry and the bank byte its caller loads turned to it. It does not have to:
// the lookup is `ld a,[wTrainerClass]` → three `cp`/`jr z` pairs that send the rival's classes off
// to his own name → `ld [<the name index>],a`, TRAINER_NAME, the bank, `call GetName`. So THE THREE
// BYTES of that load become `ld a,BUG_CATCHER; nop` and every class — the rival's included — walks
// to entry 2. It is found by content: the `ld a,[wTrainerClass]` whose next bytes are that exact
// shape, ending in the bank TrainerNames was really found in.
//
// THE PICTURE. `TrainerPicAndMoneyPointers` is five bytes a class — dw picture, three BCD money
// bytes — and sits immediately BEFORE TrainerNames in the same bank. The home-bank routine that
// reads it (`ld a,<that bank>; call Bankswitch; ld a,[wTrainerClass]; dec a; ld hl,<table>;
// ld bc,5; call AddNTimes`) is what finds it, and the table is only believed when all 47 entries
// carry a pointer into a ROM bank and money whose every nibble is a digit, AND it ends exactly
// where TrainerNames begins. Every class's two picture bytes become the Bug Catcher's; the three
// money bytes are left alone, so a COOLTRAINER still pays a COOLTRAINER's.
//
// THE LOSING LINE. Beat a trainer and his END-BATTLE text prints. Every trainer NPC's map script
// carries a TrainerHeader (12 bytes: db flag bit, db view range, dw flag byte, then dw
// before-battle, dw after-battle, dw END-battle and dw the end one again), and each of those
// pointers is a text object in the map's OWN bank of the form `text_far X; text_end` =
// `17 lo hi bank 50`. So ONE text of ours goes into bank $27's padding after the fired line and
// EVERY trainer's end-battle object is repointed at it. `trainerTexts` walks the file: yellow.json
// says which people are trainers (a person whose `trainer.class` is one of the 47 — the stationary
// legendaries wear that field too, and they are not trainers), a map's BLOCKS are found by their
// bytes and its header by `tileset, h, w, blocks` (the pointer is bank-relative) CHECKED AGAINST
// ITS OBJECT DATA — the header's warp / sign / person counts must be yellow.json's, which is what
// keeps a stray five bytes somewhere else in the cartridge from passing for a map header — the
// header's text-pointer table gives that person's entry, which for an ordinary trainer is
// `text_asm; ld hl,<TrainerHeader>; call TalkToTrainer` (08 21 lo hi), and the header's third
// pointer is the losing line's object. The before- and after-battle lines are other objects and
// stay as they were.
// WHAT IT CANNOT REACH, it reports instead of breaking: a SCRIPTED battle (the gym leaders, the
// rival, Giovanni, the Cinnabar Gym quiz trainers, the Rockets with a cutscene) has no TrainerHeader
// of its own — its person entry is `text_asm; ld a,[<an event flag>]` or a `call` — or its object
// is not a plain `text_far; text_end`. Those are left exactly as they were: they still have a Bug
// Catcher's name and picture, and their own losing words. `scripted()` lists them.
// THE LINE IS LAID OUT LIKE THE FIRED ONE, and for the same reason: the game has already printed
// "BUG CATCHER: " on line one, which leaves five characters there — every original losing line
// starts with a word that short ("No!", "I", "Huh?"). So the text opens with a <LINE> and joins
// its two lines with <SCROLL>: line one is the name, line two "No bugs in", and the scroll (no
// button, like the fired line's) carries it up so both of ours are on screen at the <PROMPT>.
const BUG_CATCHER = 'BUG_CATCHER'
const BUG_LINE = ['No bugs in', 'VILLAGE? Not fair!']
const PROMPT = 0x58
const FAR = 0x17
const ASM = 0x08
const LD_HL = 0x21
const LD_A = 0x3e
const NOP = 0x00
const CP = 0xfe
const JR_Z = 0x28
const STORE = 0xea // ld [nn],a
const CALL = 0xcd
const TRAINER_NAME = 7 // wNameListType for a trainer class
const PIC_ENTRY = 5 // dw picture, then three BCD money bytes
const MONEY = 3
const CONNECTION = 11 // bytes per map connection, between the header and its `dw objects`
/** The 47 trainer classes by their yellow.json name, 1-based as the game numbers them. */
const CLASS_OF = new Map(Object.entries(DATA.trainers).filter(([id]) => Number(id) > 0).map(([id, n]) => [n.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), Number(id)]))
const CLASS_COUNT = CLASS_OF.size
const BUG_CLASS = CLASS_OF.get(BUG_CATCHER)

export function bugText() {
  return Buffer.concat([Buffer.from([0x00, LINE]), letters(BUG_LINE[0]), Buffer.from([SCROLL]), letters(BUG_LINE[1]), Buffer.from([PROMPT])])
}

/** `TrainerNames` → { at, end, bank }: the 47 @-terminated class names, found by their first four. */
function trainerNames(rom) {
  const head = Buffer.concat(['YOUNGSTER', 'BUG CATCHER', 'LASS', 'SAILOR'].flatMap((n) => [letters(n), Buffer.from([END])]))
  const at = rom.indexOf(head)
  if (at < 0) throw new Error('this is not Pokémon Yellow (UE): the trainer class names were not found')
  let p = at
  for (let i = 0; i < CLASS_COUNT; i++) {
    const e = rom.indexOf(END, p)
    if (e < 0 || e - p > HUD_LEN + NAME_LEN) throw new Error(`the trainer class names stop at ${i + 1} of ${CLASS_COUNT}`)
    p = e + 1
  }
  return { at, end: p, bank: at >> 14 }
}

/** `TrainerPicAndMoneyPointers`, from the home-bank routine that reads it — and only if it ends where the names begin. */
function picMoney(rom, names) {
  const sig = Buffer.from([LD_A, names.bank, CALL])
  for (let i = rom.indexOf(sig); i >= 0 && i < 0x4000; i = rom.indexOf(sig, i + 1)) {
    const o = i + 5 // past `ld a,<bank>; call Bankswitch`
    if (rom[o] !== 0xfa || rom.readUInt16LE(o + 1) !== A.wTrainerClass || rom[o + 3] !== 0x3d || rom[o + 4] !== LD_HL) continue
    if (rom[o + 7] !== 0x01 || rom[o + 8] !== PIC_ENTRY || rom[o + 9] !== 0x00 || rom[o + 10] !== CALL) continue
    const table = (names.bank << 14) | (rom.readUInt16LE(o + 5) & 0x3fff)
    if (table + CLASS_COUNT * PIC_ENTRY !== names.at) continue
    let sane = true
    for (let c = 0; c < CLASS_COUNT && sane; c++) {
      const e = table + c * PIC_ENTRY
      const pic = rom.readUInt16LE(e)
      if (pic < 0x4000 || pic >= 0x8000) sane = false
      for (let b = 0; b < MONEY; b++) if ((rom[e + 2 + b] & 0x0f) > 9 || rom[e + 2 + b] >> 4 > 9) sane = false
    }
    if (sane) return table
  }
  throw new Error('this is not Pokémon Yellow (UE): the trainer pictures were not found')
}

/** The `ld a,[wTrainerClass]` of the class-name lookup: three cp/jr z for the rival, the store, TRAINER_NAME, the names' bank. */
function nameLookup(rom, names) {
  const load = Buffer.from([0xfa, A.wTrainerClass & 0xff, A.wTrainerClass >> 8])
  for (let i = rom.indexOf(load); i >= 0; i = rom.indexOf(load, i + 1)) {
    const b = rom.subarray(i + load.length, i + load.length + 26)
    if (b.length < 26) continue
    let rivals = true
    for (let k = 0; k < 3; k++) if (b[k * 4] !== CP || b[k * 4 + 2] !== JR_Z || !b[k * 4 + 1] || b[k * 4 + 1] > CLASS_COUNT) rivals = false
    if (!rivals) continue
    if (b[12] !== STORE || b[15] !== LD_A || b[16] !== TRAINER_NAME || b[17] !== STORE) continue
    if (b[20] !== LD_A || b[21] !== names.bank || b[22] !== STORE || b[25] !== CALL) continue
    return i
  }
  throw new Error('this is not Pokémon Yellow (UE): the trainer class-name lookup was not found')
}

/**
 * THE SECOND NAME. The "<class>:" the game puts on line one above a beaten trainer's words does not
 * come from TrainerNames at all: it is a table of POINTERS in a bank of its own, 47 of them, the
 * ones it has no name for aimed straight at wTrainerName (a gym leader is already called by name
 * there). Its reader is `ld hl,<table>; ld a,[wTrainerClass]; dec a; ld c,a; ld b,0; add hl,bc;
 * add hl,bc; ldi a,[hl]; ld h,[hl]; ld l,a`, and its `ld a,[wTrainerClass]` takes the same three
 * bytes as the other one. Found by that shape, and only believed when all 47 pointers go into a ROM
 * bank or to wTrainerName AND the Bug Catcher's spells "BUG CATCHER".
 */
const SPEAKER = Buffer.from([0x3d, 0x4f, 0x06, 0x00, 0x09, 0x09, 0x2a, 0x66, 0x6f])
function speakerLookup(rom) {
  const load = Buffer.from([0xfa, A.wTrainerClass & 0xff, A.wTrainerClass >> 8])
  const bugName = Buffer.concat([letters('BUG CATCHER'), Buffer.from([END])])
  for (let i = rom.indexOf(load); i >= 0; i = rom.indexOf(load, i + 1)) {
    if (i < 3 || rom[i - 3] !== LD_HL) continue
    if (!rom.subarray(i + load.length, i + load.length + SPEAKER.length).equals(SPEAKER)) continue
    const bank = (i >> 14) * 0x4000
    const table = bank + (rom.readUInt16LE(i - 2) & 0x3fff)
    let sane = true
    for (let c = 0; c < CLASS_COUNT && sane; c++) {
      const p = rom.readUInt16LE(table + c * 2)
      if (p !== A.wTrainerName && (p < 0x4000 || p >= 0x8000)) sane = false
    }
    if (!sane) continue
    const bug = bank + (rom.readUInt16LE(table + (BUG_CLASS - 1) * 2) & 0x3fff)
    if (!rom.subarray(bug, bug + bugName.length).equals(bugName)) continue
    return i
  }
  throw new Error('this is not Pokémon Yellow (UE): the beaten trainer’s name was not found')
}

/** A map's header, believed only when its object data carries yellow.json's warp / sign / person counts. */
function mapHeader(rom, m, tileset) {
  const blocks = rom.indexOf(Buffer.from(m.blocks, 'base64'))
  if (blocks < 0) throw new Error(`${m.const}: its blocks are not in this cartridge`)
  const where = (blocks & 0x3fff) + 0x4000
  const key = Buffer.from([tileset[m.tileset], m.h, m.w, where & 0xff, where >> 8])
  for (let i = rom.indexOf(key); i >= 0; i = rom.indexOf(key, i + 1)) {
    const bank = (i >> 14) * 0x4000
    const at = (a) => bank + (a & 0x3fff)
    let o = i + 9 // tileset, h, w, dw blocks, dw texts, dw script
    let links = 0
    for (let b = 0; b < 4; b++) if ((rom[o] >> b) & 1) links++
    o += 1 + links * CONNECTION
    const objects = at(rom.readUInt16LE(o))
    if (objects + 1 >= rom.length) continue
    let q = objects + 1 // past the border block
    const warps = rom[q]
    q += 1 + warps * 4
    const signs = rom[q]
    q += 1 + signs * 3
    if (q >= rom.length) continue
    if (warps !== (m.warps || []).length || signs !== (m.signs || []).length || rom[q] !== (m.people || []).length) continue
    return { header: i, at }
  }
  throw new Error(`${m.const}: its map header is not in this cartridge`)
}

/** Every trainer in the cartridge: `got` = those whose losing line can be repointed, `missed` = the scripted ones. */
function trainerTexts(rom) {
  const tileset = {}
  for (const t of DATA.tilesets) tileset[t.const] = t.id
  const got = []
  const missed = []
  const how = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  for (const m of DATA.maps) {
    const people = (m.people || []).map((p, n) => ({ n: n + 1, p })).filter(({ p }) => p.trainer && CLASS_OF.has(p.trainer.class))
    if (!people.length) continue
    const { header, at } = mapHeader(rom, m, tileset)
    const texts = at(rom.readUInt16LE(header + 5))
    for (const { n, p } of people) {
      const one = { map: m.const, person: n, class: p.trainer.class, party: p.trainer.party }
      const entry = at(rom.readUInt16LE(texts + (n - 1) * 2))
      if (rom[entry] !== ASM || rom[entry + 1] !== LD_HL) {
        missed.push({ ...one, why: `scripted (${how(rom.subarray(entry, entry + 4))})` })
        continue
      }
      const head = at(rom.readUInt16LE(entry + 2))
      const object = at(rom.readUInt16LE(head + 8))
      if (rom[object] !== FAR || rom[object + 4] !== END) {
        missed.push({ ...one, why: `its end-battle text is not a text_far (${how(rom.subarray(object, object + 5))})` })
        continue
      }
      got.push({ ...one, header: head, object })
    }
  }
  if (!got.length) throw new Error('no trainers in this cartridge')
  const bug = missed.find((t) => t.class === BUG_CATCHER)
  if (bug) throw new Error(`${bug.map} person ${bug.person}: a Bug Catcher's losing line is not where it was — ${bug.why}`)
  return { got, missed }
}

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
  const bugs = fired + firedText().length // and the trainers' losing line right after that one
  if (rom.subarray(bugs, bugs + bugText().length).some((b) => b !== 0)) throw new Error('no room after the fired text')
  const names47 = trainerNames(rom)
  const pics = picMoney(rom, names47)
  const lookup = nameLookup(rom, names47)
  const speaker = speakerLookup(rom)
  const trainers = trainerTexts(rom)
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
  return { moves, names, at, end: p, bird: bird + 'ROCK'.length + 1, selector, used, stub, fired, bugs, pics, lookup, speaker, trainers, charge, named, player: player + 2 }
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
  const { moves, names, bird, selector, used, stub, fired, bugs, pics, lookup, speaker, trainers, charge, named, player } = t
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
  const bug = bugText()
  const bugRel = (bugs & 0x3fff) + 0x4000
  const bugFar = Buffer.from([bugRel & 0xff, bugRel >> 8, bugs >> 14])
  writes.push([bugs, b64(on ? bug : Buffer.alloc(bug.length))])
  for (const { object } of trainers.got) writes.push([object + 1, b64(on ? bugFar : rom.subarray(object + 1, object + 4))])
  // Every class's NAME: the lookup is made to read the Bug Catcher's entry, whatever the class is.
  for (const at of [lookup, speaker]) writes.push([at, b64(on ? Buffer.from([LD_A, BUG_CLASS, NOP]) : rom.subarray(at, at + 3))])
  // Every class's PICTURE: the Bug Catcher's two bytes, the three money bytes after them left alone.
  const bugPic = rom.subarray(pics + (BUG_CLASS - 1) * PIC_ENTRY, pics + (BUG_CLASS - 1) * PIC_ENTRY + 2)
  for (let c = 0; c < CLASS_COUNT; c++) {
    const e = pics + c * PIC_ENTRY
    writes.push([e, b64(on ? bugPic : rom.subarray(e, e + 2))])
  }
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
 * Who is a Bug Catcher and who only looks like one: { got, missed } from the cartridge's own tables.
 * Everybody wears the name and the picture — that is two tables, not 341 scripts — but a SCRIPTED
 * battle keeps its own losing words, because its end-battle text is not a TrainerHeader's to move.
 */
export async function scripted(door) {
  const { t } = await cartridge(door)
  return { got: t.trainers.got.length, missed: t.trainers.missed }
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
