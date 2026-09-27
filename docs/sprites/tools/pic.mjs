// A JS port of pret's tools/pkmncompress.c (pokeyellow e89ead1): the Gen 1 "pic" codec.
// compress(twobpp) — twobpp is a square picture as rgbgfx writes it: tiles ROW-major, 16 bytes a tile.
// uncompress(bytes, at) — returns { width, height, twobpp (row-major tiles), used (bytes consumed) }.
// Scratch prototype for research/rom-patching.md; not deck code.

const GRAY = [
  [0x0, 0x1, 0x3, 0x2, 0x6, 0x7, 0x5, 0x4, 0xc, 0xd, 0xf, 0xe, 0xa, 0xb, 0x9, 0x8],
  [0x8, 0x9, 0xb, 0xa, 0xe, 0xf, 0xd, 0xc, 0x4, 0x5, 0x7, 0x6, 0x2, 0x3, 0x1, 0x0]
]
const UNGRAY = [
  [0x0, 0x1, 0x3, 0x2, 0x7, 0x6, 0x4, 0x5, 0xf, 0xe, 0xc, 0xd, 0x8, 0x9, 0xb, 0xa],
  [0xf, 0xe, 0xc, 0xd, 0x8, 0x9, 0xb, 0xa, 0x0, 0x1, 0x3, 0x2, 0x7, 0x6, 0x4, 0x5]
]

function transposeTiles(data, width) {
  const size = width * width
  for (let i = 0; i < size; i++) {
    const j = (i * width + Math.floor(i / width)) % size
    if (i < j) {
      const tmp = data.slice(i * 16, i * 16 + 16)
      data.copyWithin(i * 16, j * 16, j * 16 + 16)
      data.set(tmp, j * 16)
    }
  }
}

function compressPlane(plane, width) {
  const ram = width * width * 8
  let lo = 0
  for (let i = 0; i < ram; i++) {
    const m = i % width
    if (!m) lo = 0
    const j = Math.floor(i / width) + m * width * 8
    const hi = (plane[j] >> 4) & 0xf
    const ch = GRAY[lo & 1][hi]
    lo = plane[j] & 0xf
    const cl = GRAY[hi & 1][lo]
    plane[j] = (ch << 4) | cl
  }
}

class BitWriter {
  constructor(n) {
    this.out = new Uint8Array(n)
    this.bit = 7
    this.byte = 0
  }
  put(b) {
    if (++this.bit === 8) {
      this.byte++
      this.bit = 0
    }
    this.out[this.byte] |= b << (7 - this.bit)
  }
  rle(n) {
    let bits = -1
    n++
    let v = n + 1
    v |= v >> 1
    v |= v >> 2
    v |= v >> 4
    v |= v >> 8
    v |= v >> 16
    v -= v >> 1
    v--
    const number = n - v
    while (v) {
      v >>= 1
      bits++
    }
    for (let j = 0; j < bits; j++) this.put(1)
    this.put(0)
    for (let j = bits; j >= 0; j--) this.put((number >> j) & 1)
  }
}

function interpret(planes, mode, order, width) {
  const ram = width * width * 8
  const rams = [Uint8Array.from(planes[order]), Uint8Array.from(planes[order ^ 1])]
  if (mode !== 0) for (let i = 0; i < ram; i++) rams[1][i] ^= rams[0][i]
  compressPlane(rams[0], width)
  if (mode !== 1) compressPlane(rams[1], width)
  const w = new BitWriter(15 * 15 * 16)
  w.out[0] = (width << 4) | width
  w.put(order)
  // Faithful to the C, quirks included: `index` is NOT reset between the two planes (the array is).
  const groups = new Uint8Array(15 * 4 * 15 * 8)
  let index = 0
  const packet = () => {
    for (let i = 0; i < index; i++) {
      w.put((groups[i] >> 1) & 1)
      w.put(groups[i] & 1)
    }
  }
  for (let plane = 0; plane < 2; plane++) {
    let type = 0
    let nums = 0
    groups.fill(0)
    for (let x = 0; x < width; x++)
      for (let bit = 0; bit < 8; bit += 2)
        for (let y = 0, byte = x * width * 8; y < width * 8; y++, byte++) {
          const g = (rams[plane][byte] >> (6 - bit)) & 3
          if (g) {
            if (type === 0) w.put(1)
            else if (type === 1) w.rle(nums)
            type = 2
            groups[index++] = g
            nums = 0
          } else {
            if (type === 0) w.put(0)
            else if (type === 1) nums++
            else {
              packet()
              w.put(0)
              w.put(0)
            }
            type = 1
            groups.fill(0)
            index = 0
          }
        }
    if (type === 1) w.rle(nums)
    else packet()
    if (!plane) {
      if (mode === 0) w.put(0)
      else {
        w.put(1)
        w.put(mode - 1)
      }
    }
  }
  const bits = (w.byte + 1) * 8 + w.bit
  return { bits, out: w.out }
}

/** 2bpp (row-major tiles, square) → the compressed pic, byte-for-byte what pkmncompress writes. */
export function compress(twobpp) {
  const data = Uint8Array.from(twobpp)
  let width = 0
  for (let w = 1; w < 16; w++) if (data.length === w * w * 16) width = w
  if (!width) throw new Error('a pic is a square of 1–15 tiles')
  const ram = width * width * 8
  transposeTiles(data, width)
  const planes = [new Uint8Array(ram), new Uint8Array(ram)]
  for (let i = 0; i < ram; i++) {
    planes[0][i] = data[i * 2]
    planes[1][i] = data[i * 2 + 1]
  }
  let best = null
  for (let mode = 0; mode < 3; mode++)
    for (let order = 0; order < 2; order++) {
      if (mode === 0 && order === 0) continue
      const r = interpret(planes, mode, order, width)
      if (!best || r.bits < best.bits) best = { bits: r.bits, out: r.out.slice(0, Math.floor(r.bits / 8)) }
    }
  return best.out
}

/** The pic at bytes[at…] → { width, height, twobpp (row-major tiles), used }. Square pics only (all of Yellow's are). */
export function uncompress(bytes, at = 0) {
  let byte = at
  let bit = 7
  const readBit = () => {
    if (bit === -1) {
      byte++
      bit = 7
    }
    return (bytes[byte] >> bit--) & 1
  }
  const readInt = (n) => {
    let v = 0
    while (n--) v = (v << 1) | readBit()
    return v
  }
  const width = readInt(4)
  const height = readInt(4)
  if (width !== height) throw new Error(`pic ${width}×${height}: not square`)
  const size = width * width * 8
  const fill = () => {
    const TABLE = [0x1, 0x3, 0x7, 0xf, 0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff, 0x3fff, 0x7fff, 0xffff]
    let mode = readBit()
    const psize = width * width * 0x20
    const plane = new Uint8Array(psize)
    let len = 0
    while (len < psize) {
      if (mode) {
        while (len < psize) {
          const g = readInt(2)
          if (!g) break
          plane[len++] = g
        }
      } else {
        let w = 0
        while (readBit()) w++
        if (w >= TABLE.length) throw new Error('invalid compressed data')
        let n = TABLE[w] + readInt(w + 1)
        while (len < psize && n--) plane[len++] = 0
      }
      mode ^= 1
    }
    const r = new Uint8Array(psize)
    len = 0
    for (let y = 0; y < width; y++) for (let x = 0; x < width * 8; x++) for (let i = 0; i < 4; i++) r[len++] = plane[(y * 4 + i) * width * 8 + x]
    for (let i = 0; i < psize - 3; i += 4) r[i / 4] = (r[i] << 6) | (r[i + 1] << 4) | (r[i + 2] << 2) | r[i + 3]
    return r.subarray(0, size)
  }
  const unplane = (plane) => {
    for (let x = 0; x < width * 8; x++) {
      let b = 0
      for (let y = 0; y < width; y++) {
        const i = y * width * 8 + x
        const ch = UNGRAY[b][(plane[i] >> 4) & 0xf]
        b = ch & 1
        const cl = UNGRAY[b][plane[i] & 0xf]
        b = cl & 1
        plane[i] = (ch << 4) | cl
      }
    }
  }
  const rams = []
  const order = readBit()
  rams[order] = Uint8Array.from(fill())
  let mode = readBit()
  if (mode) mode += readBit()
  rams[order ^ 1] = Uint8Array.from(fill())
  unplane(rams[order])
  if (mode !== 1) unplane(rams[order ^ 1])
  if (mode !== 0) for (let i = 0; i < size; i++) rams[order ^ 1][i] ^= rams[order][i]
  const out = new Uint8Array(size * 2)
  for (let i = 0; i < size; i++) {
    out[i * 2] = rams[0][i]
    out[i * 2 + 1] = rams[1][i]
  }
  transposeTiles(out, width)
  return { width, height, twobpp: out, used: byte - at + 1 }
}
