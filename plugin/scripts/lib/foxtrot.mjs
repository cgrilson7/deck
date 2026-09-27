// THE FOXTROT KIT: a species — EEVEE by default (dex 133, internal $66: the game has exactly one, the
// Celadon gift, so there is ONE Foxtrot and no wild ones; `vulpix`, dex 37, was the first choice and
// still works) — relabelled FOXTROT in the LOADED ROM image, as one patch set (`foxtrot`) — never the
// cartridge file, never a save. A caught FOXTROT in a battery save is that species with a nickname to
// an unpatched ROM, which is why it is a relabel and not a 152nd species (docs/sprites/reports/
// rom-patching.md §5). Evolution is untouched: a stone still makes an Eevee-Foxtrot an eeveelution,
// which is itself again. The internal id comes from yellow.json's species table by dex number; every
// check below is "this entry holds THIS species' known bytes". What changes, all while the set is on:
//   the NAME        MonsterNames[internal] = "FOXTROT"
//   the FRONT       plugin/data/sprites/foxtrot-front.png (56×56) compressed, over the species' own front
//                   picture when it fits, else into the pic bank's free tail; the base-stats dims byte
//                   to $77 and the front pointer with it
//   the BACK        foxtrot-back.png (the drawn 28×28 in a 32×32 box) over the species' back when it
//                   fits, else the pic bank's tail
//   the POKéDEX     the entry in place: species FOX, 1'08", 9.5 lb (no longer than the species line it
//                   replaces, so it fits where the entry is; a text_end is written after), text_far to our text in bank
//                   $10's free tail ("The deck's fox. He runs while Claude works and sleeps while it
//                   waits. He barks at bad posture.")
//   his COAT        the unused PAL_0F: MonsterPalettes[dex] → $0F and CGBBasePalettes[$0F] = white,
//                   #F8B070, #D67941, #2F2F2E (battle + dex picture)
//   the PARTY ICON  foxtrot-icon.png (a symmetric front view, two frames) as a NEW icon class: the
//                   icon table has 30 entries and every one is taken (the ten classes' tiles, both
//                   frames, and the trade bubble; ICON_HELIX is Omanyte's, the second half of the
//                   poke ball's 8 tiles), so the table is COPIED into bank $1C's free tail with two
//                   entries more (our frames, 4 tiles each, at the first class no entry loads — $B —
//                   i.e. OBJ tiles $2C and $6C), its two loaders repointed (`ld hl,table; ld a,$1e` →
//                   the copy, $20), and the species' MonPartyData nybble set to that class. The tiles go
//                   in bank $10 after the dex text (an entry names its own bank).
// Every table is FOUND in the cartridge's bytes by a content signature (rom-patching.md §4) and
// checked against what the species' entries must hold; a missing or ambiguous one THROWS naming it. Free
// space is the linker's (pret's pokeyellow.map, rom-patching.md §2): three bank TAILS, each checked
// all-zero to the bank's end before use. Other users of these tails must know: bank $10 from $41F7A
// (text + icon tiles, ~250 bytes), bank $1C from $73EB3 (the icon table, 192 bytes).
//
// THE DEX PAGE'S "?′??″" (the research run's screenshot): not the bytes. DrawDexEntryOnScreen
// (engine/menus/pokedex.asm) first prints the template "HT  ?′??″ / WT   ???lb", then the name and
// the picture, waits (Delay3), plays the cry, and only THEN prints feet, inches and weight — and not
// at all when the species is not OWNED (`ret z`). The shot was taken the step "HT" appeared. The
// format is as the research had it: species @, feet (1 byte), inches (1 byte), dw weight in 0.1 lb.
//
// VERIFIED headless through the `patchset` door, as Vulpix (720 bytes differ) and as Eevee (727):
// "Wild FOXTROT appeared!" with his front and coat and Red's back unchanged, his back picture when he
// is sent out, the party-menu icon in both frames (one poked into the party: OAM tiles $2C / $2E), the
// dex page with HT 1′08″ and WT 9.5lb and both text pages, and `off` — or a state saved with him on,
// loaded with the set off — leaving the image byte-equal to the file. One already in a party or box
// keeps the nickname stored with it ("EEVEE"); one caught while the set is on is named FOXTROT. The sprite gag's
// `species-palette` knows only the ten mon palettes, so against a FOXTROT it stands back ('unknown').

import { readFileSync } from 'node:fs'
import { compress, uncompress } from './pic.mjs'
import { decodePng, doorOps } from './sprites.mjs'
import { DATA } from './yellow.mjs'

export const SET_FOXTROT = 'foxtrot'
/** Which species wears him: a name as yellow.json spells it (any case) or a dex number. */
export const FOXTROT_SPECIES_DEFAULT = 'eevee'
function speciesOf(which) {
  const want = String(which ?? FOXTROT_SPECIES_DEFAULT).toLowerCase()
  for (const [id, p] of Object.entries(DATA.pokemon))
    if (p.name.toLowerCase() === want || String(p.dex) === want) return { dex: p.dex, internal: Number(id), name: p.name.toUpperCase() }
  throw new Error(`foxtrot: no species "${which}"`)
}
const NAME = 'FOXTROT'
const SPECIES = 'FOX'
const FEET = 1
const INCHES = 8
const WEIGHT = 95 // tenths of a pound
/** Three lines a page, 18 characters a line (the box between the dex page's borders). */
const TEXT = [['The deck\'s fox. He', 'runs while Claude', 'works and sleeps'], ['while it waits. He', 'barks at bad', 'posture']] // no final period: <DEXEND> prints one
const COAT = ['#FFFFFF', '#D67941', '#9D5021', '#2F2F2E'] // white, the sheet's two oranges (214,121,65 / 157,80,33), the outline: what the deck's fox really wears
const PAL_0F = 0x0f

const ART = new URL('../../data/sprites/', import.meta.url)

// ---- finding things ----------------------------------------------------------------------------

const hex = (s) => Uint8Array.from(s.split(' '), (x) => parseInt(x, 16))
function findAll(rom, sig) {
  const hits = []
  outer: for (let i = 0; i <= rom.length - sig.length; i++) {
    if (rom[i] !== sig[0]) continue
    for (let k = 1; k < sig.length; k++) if (rom[i + k] !== sig[k]) continue outer
    hits.push(i)
  }
  return hits
}
function findOne(rom, sig, what) {
  const hits = findAll(rom, sig)
  if (hits.length !== 1) throw new Error(`foxtrot: ${what} — its signature is ${hits.length ? `in ${hits.length} places` : 'not in this cartridge'} (a Pokémon Yellow UE cartridge is needed)`)
  return hits[0]
}
const must = (ok, what) => {
  if (!ok) throw new Error(`foxtrot: ${what}`)
}
const bankOf = (o) => o >> 14
/** A file offset → the address the game sees it at (banks 1+ at $4000–$7FFF). */
const rel = (o) => (o < 0x4000 ? o : (o & 0x3fff) + 0x4000)
/** A pointer read in `bank` → a file offset. */
const off = (bank, ptr) => (ptr < 0x4000 ? ptr : bank * 0x4000 + ptr - 0x4000)
const le = (n) => [n & 0xff, (n >> 8) & 0xff]

let charmap
function text(s) {
  if (!charmap) {
    charmap = new Map()
    for (const [code, ch] of Object.entries(DATA.charmap)) if (!charmap.has(ch)) charmap.set(ch, Number(code))
    charmap.set(' ', 0x7f)
  }
  return [...s].map((ch) => {
    const c = charmap.get(ch)
    if (c == null) throw new Error(`foxtrot: "${ch}" is not in the game's font`)
    return c
  })
}

/** A bank's free TAIL per pret's linker map, checked all-zero to the bank's end. */
const TAILS = { 0x0b: 0x2fe30, 0x10: 0x41f7a, 0x1c: 0x73eb3 }
function tail(rom, bank) {
  const start = TAILS[bank]
  must(start != null, `no free space known in bank $${bank.toString(16)}`)
  const end = (bank + 1) * 0x4000
  for (let i = start; i < end; i++) must(rom[i] === 0, `bank $${bank.toString(16)}'s free tail is not free at $${i.toString(16)}`)
  let at = start
  return {
    take(n, what) {
      must(at + n <= end, `${what}: ${n} bytes do not fit in bank $${bank.toString(16)}'s free tail`)
      const o = at
      at += n
      return o
    }
  }
}

// ---- the art -----------------------------------------------------------------------------------

/** A greys PNG → shades 0–3 by luminance (255 / 170 / 85 / 0, what scripts/sprites.mjs writes). */
function shades(name, w, h) {
  const png = decodePng(readFileSync(new URL(name, ART)))
  must(png.w === w && png.h === h, `${name} is ${png.w}×${png.h}, want ${w}×${h}`)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) {
    const [r, g, b, a] = png.rgba.subarray(i * 4, i * 4 + 4)
    out[i] = a < 128 ? 0 : 3 - Math.min(3, Math.floor((0.299 * r + 0.587 * g + 0.114 * b) / 64))
  }
  return out
}
/** Shades (tw × th whole tiles at x0, y0 of a `stride`-wide map) → 2bpp tiles, row-major. */
function tiles(px, stride, x0, y0, tw, th) {
  const out = new Uint8Array(tw * th * 16)
  let o = 0
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++)
      for (let y = 0; y < 8; y++) {
        let lo = 0
        let hi = 0
        for (let x = 0; x < 8; x++) {
          const s = px[(y0 + ty * 8 + y) * stride + x0 + tx * 8 + x]
          lo = (lo << 1) | (s & 1)
          hi = (hi << 1) | (s >> 1)
        }
        out[o++] = lo
        out[o++] = hi
      }
  return out
}
const bgr555 = (c) => {
  const n = parseInt(c.slice(1), 16)
  return (((n & 0xff) >> 3) << 10) | ((((n >> 8) & 0xff) >> 3) << 5) | ((n >> 16) >> 3)
}

// ---- the writes --------------------------------------------------------------------------------

/**
 * Every byte of the relabel, computed from the CARTRIDGE FILE's bytes: [[file offset, bytes], …].
 * Throws, naming the table, when this is not the cartridge it was made for.
 */
export async function foxtrotWrites(rom, which) {
  const { dex: DEX, internal: INTERNAL, name: WAS } = speciesOf(which)
  const writes = []
  const put = (o, bytes) => writes.push([o, Uint8Array.from(bytes)])

  // Base stats (bank $0E, 28 bytes a dex number): +10 dims, +11 front, +13 back.
  const baseStats = findOne(rom, hex('01 2d 31 31 2d 41 16 03 2d 40 55'), 'BaseStats (Bulbasaur\'s entry)')
  const base = baseStats + (DEX - 1) * 28
  must(rom[base] === DEX, `BaseStats: entry ${DEX} is not dex ${DEX}`)

  // The pic bank by internal id (UncompressMonSprite): `cp limit; ld a,bank; jr c` in order, else the last bank.
  const sel = findOne(rom, hex('fe b6 3e 0b 28 1e 78 fe 1f 3e 09 38 17 78 fe 4a 3e 0a 38 10 78 fe 74 3e 0b 38 09 78 fe 99 3e 0c 38 02 3e 0d'), 'UncompressMonSprite\'s bank choice')
  let picBank = rom[sel + 36]
  for (const at of [7, 14, 21, 28]) if (INTERNAL < rom[sel + at + 1]) { picBank = rom[sel + at + 3]; break }

  // FRONT: 7×7, in place over the species' own when it fits.
  const front = compress(tiles(shades('foxtrot-front.png', 56, 56), 56, 0, 0, 7, 7))
  const oldFront = off(picBank, rom[base + 11] | (rom[base + 12] << 8))
  const tails = {}
  const tailOf = (b) => (tails[b] ??= tail(rom, b))
  const frontAt = front.length <= uncompress(rom, oldFront).used ? oldFront : tailOf(picBank).take(front.length, 'the front picture')
  put(frontAt, front)
  put(base + 10, [0x77])
  put(base + 11, le(rel(frontAt)))

  // BACK: 4×4 (the game drops 4 px right and bottom, then doubles), in place when it fits.
  const back = compress(tiles(shades('foxtrot-back.png', 32, 32), 32, 0, 0, 4, 4))
  const oldBack = off(picBank, rom[base + 13] | (rom[base + 14] << 8))
  const backAt = back.length <= uncompress(rom, oldBack).used ? oldBack : tailOf(picBank).take(back.length, 'the back picture')
  put(backAt, back)
  if (backAt !== oldBack) put(base + 13, le(rel(backAt)))

  // NAME: 10 bytes an internal id, @-padded.
  const names = findOne(rom, Uint8Array.from([...text('RHYDON'), 0x50, 0x50, 0x50, 0x50, ...text('KA')]), 'MonsterNames')
  const nameAt = names + (INTERNAL - 1) * 10
  must([...text(WAS), 0x50].every((c, i) => i >= 10 || rom[nameAt + i] === c), `MonsterNames: internal $${INTERNAL.toString(16)} is not ${WAS}`)
  put(nameAt, [...text(NAME), ...Array(10 - NAME.length).fill(0x50)])

  // POKéDEX: the entry in place (species @, feet, inches, dw weight, text_far); the text in bank $10's tail.
  const dexPtrs = findOne(rom, hex('be 4d e8 4d 79 48'), 'PokedexEntryPointers')
  const dexBank = bankOf(dexPtrs)
  const entry = off(dexBank, rom[dexPtrs + (INTERNAL - 1) * 2] | (rom[dexPtrs + (INTERNAL - 1) * 2 + 1] << 8))
  // The species' own entry: "<species>@", feet, inches, dw weight, text_far (4 bytes), text_end.
  const was = rom.indexOf(0x50, entry) - entry
  must(was > 0 && was <= 11 && rom[entry + was + 5] === 0x17 && rom[entry + was + 9] === 0x50, `PokedexEntryPointers: ${WAS}'s entry is not "<species>@ … text_far text_end"`)
  const species = [...text(SPECIES), 0x50]
  must(species.length <= was + 1, `the dex species line "${SPECIES}" is longer than ${WAS}'s`)
  must(TEXT.flat().every((l) => l.length <= 18), 'the dex text: a line is over 18 characters')
  const body = [0x00] // `text`
  TEXT.forEach((page, p) =>
    page.forEach((line, i) => {
      if (p || i) body.push(i ? 0x4e : 0x49) // <NEXT> a line, <PAGE> a page
      body.push(...text(line))
    })
  )
  body.push(0x5f, 0x50) // <DEXEND> @
  const bank10 = tailOf(0x10)
  const textAt = bank10.take(body.length, 'the dex text')
  put(textAt, body)
  put(entry, [...species, FEET, INCHES, ...le(WEIGHT), 0x17, ...le(rel(textAt)), bankOf(textAt), 0x50])

  // COAT: PAL_0F, in the tables and worn by no one.
  const monPals = findOne(rom, hex('10 16 16 16 12 12 12 13'), 'MonsterPalettes')
  must(![...rom.subarray(monPals, monPals + 152)].includes(PAL_0F), 'MonsterPalettes: some species already wears PAL_0F')
  const cgb = findOne(rom, hex('ff 7f f0 13 eb 7e 63 0c ff 7f 37 7e eb 7e 63 0c'), 'CGBBasePalettes')
  put(monPals + DEX, [PAL_0F])
  put(cgb + PAL_0F * 8, COAT.map(bgr555).flatMap(le))

  // PARTY ICON: the table copied with our two frames added, at a class no entry loads and no species wears.
  const icons = findOne(rom, hex('ef 67 04 3f 80 82'), 'MonPartySpritePointers (ICON_PIKACHU\'s entry)') - 13 * 6
  const N = 0x1e
  const loaded = new Set()
  for (let i = 0; i < N; i++) {
    const e = icons + i * 6
    const n = rom[e + 2]
    const vram = rom[e + 4] | (rom[e + 5] << 8)
    must([1, 4, 8].includes(n) && vram >= 0x8000 && vram + n * 16 <= 0x8800, `MonPartySpritePointers: entry ${i} is not an icon entry`)
    for (let t = 0; t < n; t++) loaded.add(((vram - 0x8000) >> 4) + t)
  }
  const partyData = findOne(rom, hex('77 70 00 55 56 66 66 64'), 'MonPartyData')
  const worn = new Set()
  for (let d = 1; d <= 151; d++) worn.add((rom[partyData + ((d - 1) >> 1)] >> (d & 1 ? 4 : 0)) & 0xf)
  let cls = -1
  for (let c = 0xb; c < 0x10 && cls < 0; c++) {
    const own = [0, 1, 2, 3].flatMap((t) => [c * 4 + t, c * 4 + 0x40 + t])
    if (!worn.has(c) && own.every((t) => !loaded.has(t))) cls = c
  }
  must(cls >= 0, 'MonPartySpritePointers: no icon class is free')
  const loaders = findAll(rom, Uint8Array.from([0x21, ...le(rel(icons)), 0x3e, N]))
  must(loaders.length === 2 && loaders.every((o) => bankOf(o) === bankOf(icons)), `MonPartySpritePointers: ${loaders.length} loaders (\`ld hl,table; ld a,$1e\`), want the two`)

  const icon = shades('foxtrot-icon.png', 32, 16)
  const gfx = [0, 16].flatMap((x0) => [...tiles(icon, 32, x0, 0, 2, 2)]) // a frame's TL TR BL BR: the game's writer reads TL and BL and mirrors them
  const gfxAt = bank10.take(gfx.length, 'the party icon\'s tiles')
  put(gfxAt, gfx)
  const table = [...rom.subarray(icons, icons + N * 6)]
  for (const f of [0, 1]) table.push(...le(rel(gfxAt + f * 64)), 4, bankOf(gfxAt), ...le(0x8000 + (cls * 4 + f * 0x40) * 16))
  must(bankOf(TAILS[0x1c]) === bankOf(icons), 'the icon table\'s copy must stay in its loaders\' bank')
  const tableAt = tailOf(0x1c).take(table.length, 'the party icon table')
  put(tableAt, table)
  for (const o of loaders) put(o, [0x21, ...le(rel(tableAt)), 0x3e, N + 2])
  const nyb = partyData + ((DEX - 1) >> 1)
  put(nyb, [DEX & 1 ? (rom[nyb] & 0x0f) | (cls << 4) : (rom[nyb] & 0xf0) | cls])

  return writes
}

/** The cartridge file, read once per path. */
const files = new Map()
function cartridgeFile(path) {
  if (!files.has(path)) files.set(path, new Uint8Array(readFileSync(path)))
  return files.get(path)
}

/**
 * Install (on) or remove (off) the relabel as the patch set `foxtrot`, on `species` (default Eevee).
 * Returns how many bytes changed; turning it on with another species replaces the set whole.
 */
export async function foxtrotPatch(door, on = true, species) {
  if (!(await doorOps(door)).has('patchset')) throw new Error('this Game Boy has no `patchset` op (an older deck): FOXTROT needs it, so a state load can take him out again')
  if (!on) return (await door.call({ op: 'patchset', name: SET_FOXTROT, off: true })).changed ?? 0
  const info = await door.call({ op: 'info' })
  if (!info.rom) throw new Error('no cartridge loaded')
  const writes = await foxtrotWrites(cartridgeFile(info.rom), species)
  const { changed } = await door.call({ op: 'patchset', name: SET_FOXTROT, writes: writes.map(([o, b]) => [o, Buffer.from(b).toString('base64')]) })
  return changed ?? 0
}
