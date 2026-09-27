// Types for gbcore.mjs, THE ONE RUNTIME MODULE shared by the headless door (plugin/scripts/lib/door.mjs)
// and the renderer's emulator (src/renderer/src/lib/gameboy.ts). gbcore.mjs is pure JS: Uint8Array in
// and out, no `Buffer`, no fs, no DOM — so both ends run the same bytes and a headless preview is
// exact. Keep this file in step with gbcore.mjs by hand (it is the renderer's only view of it).

/** The slice of serverboy's private core that gbcore touches. Both ends already hold one. */
export interface GbCore {
  /** The cartridge as loaded. REPLACED by a state load (saveState.js:215), so never cache a reference. */
  ROM: Uint8Array
  /** Flat memory: bank-0 ROM mirror at 0–$3FFF, VRAM bank 0 at $8000–$9FFF, OAM at $FE00–$FE9F, I/O at $FF00–. */
  memory: Uint8Array
  /** VRAM bank 1's TILE DATA ($8000–$97FF as VRAM[addr & $1FFF]). Its $1800– half is unused: the maps are below. */
  VRAM: Uint8Array
  /** The TILE MAPS ($9800–$9FFF, $800 bytes each): bank 0's map and bank 1's GBC attributes. The core writes
   *  them here, never to memory[] or VRAM[]. Optional only so an older `Core` type still fits; serverboy has both. */
  BGCHRBank1?: Uint8Array
  BGCHRBank2?: Uint8Array
  /** True while the boot ROM is mapped over bank 0 (patch mirroring skips its windows then). */
  inBootstrap?: boolean
  currVRAMBank: number
  /** LCD STAT mode 0–3; the core drops VRAM writes and reads $FF while it is 3. */
  modeSTAT: number
  /** The core's I/O writers by address; [0xFF4F] selects the VRAM bank (and BGCHRCurrentBank). */
  memoryWriter: Array<(core: GbCore, address: number, data: number) => void>
  memoryRead(address: number): number
  memoryWrite(address: number, data: number): void
  /** Raw CGB palette RAM mirrors, 64 bytes each: palette i, colour c, byte lo/hi = [i*8 + c*2 + (0|1)]. */
  gbcBGRawPalette: Uint8Array
  gbcOBJRawPalette: Uint8Array
  /** Write ONE byte of palette RAM by index (0–63) and refresh the core's colour cache; never touches BCPS/OCPS. */
  updateGBCBGPalette(index: number, data: number): void
  updateGBCOBJPalette(index: number, data: number): void
}

/** A colour for `paletteSet`: a BGR555 number (0–0x7FFF) or '#rrggbb'. */
export type GbColour = number | string

/** The names `info.ops` reports when a door end has gbcore: the CLI feature-detects on these. */
export const OPS: readonly ['vram', 'oam', 'palette', 'patchset']

/**
 * Write `bytes` at `addr` ($8000–$9FFF) in VRAM `bank` (0 | 1) through the core's own writer with
 * STAT forced to mode 0 and the bank selected around it, both restored after — so the write always
 * lands (mode 3 drops it otherwise) and the tile cache stays right. Throws on a range outside VRAM.
 */
export function vramWrite(core: GbCore, addr: number, bytes: Uint8Array, bank?: number): void
/** Read VRAM directly (tile data: bank 0 = memory[], bank 1 = VRAM[]; maps: BGCHRBank1 / BGCHRBank2), never $FF for mode 3. */
export function vramRead(core: GbCore, addr: number, len: number, bank?: number): Uint8Array
/** The 160 bytes of OAM (40 × y, x, tile, attr) straight from memory. Read only: the game rebuilds OAM every frame. */
export function oamRead(core: GbCore): Uint8Array
/** Set whole palettes (4 colours each) by index 0–7, BG and/or OBJ, through updateGBC*Palette. */
export function paletteSet(core: GbCore, want: { bg?: Array<[number, GbColour[]]>; obj?: Array<[number, GbColour[]]> }): void
/** Copies of the raw palette RAM: bg and obj, 64 bytes each. */
export function paletteRead(core: GbCore): { bg: Uint8Array; obj: Uint8Array }
/** '#rrggbb' → BGR555. */
export function bgr555(colour: GbColour): number

/** One write of a patch set: file offset + the bytes that go there. */
export type PatchWrite = [offset: number, bytes: Uint8Array]

/**
 * Named, reversible patches into the LOADED ROM image, bound to a PRISTINE copy of the cartridge
 * (the file's bytes, kept by the end that owns them). `reconcile` is the whole point: it rewrites the
 * image as pristine + every set that is on, which is what cleans a save state that was made with
 * patches baked in (a state carries the whole ROM). Sets are per cartridge: make a new PatchSets when
 * the ROM changes.
 */
export class PatchSets {
  constructor(pristine: Uint8Array)
  readonly pristine: Uint8Array
  /** Install (or replace) a set and apply it to `core` now. Returns how many bytes of the image changed. Throws on an offset outside the cartridge, a set over 64K bytes, or more than 64 sets. */
  set(core: GbCore, name: string, writes: PatchWrite[]): number
  /** Forget a set and put the pristine bytes back over its ranges (unless another set that is on covers them). Returns the bytes changed; 0 when unknown. */
  off(core: GbCore, name: string): number
  has(name: string): boolean
  /** Every set that is on, with its byte count. */
  list(): Array<{ name: string; bytes: number }>
  /** pristine over the whole image, then every set that is on, in install order. Call after a ROM mount and after EVERY state load. Returns bytes changed. */
  reconcile(core: GbCore): number
  /** The sets as plain data (for the headless end to persist beside its state), and back. */
  toJSON(): { sets: Array<{ name: string; writes: Array<[number, string]> }> }
  static fromJSON(pristine: Uint8Array, data: { sets: Array<{ name: string; writes: Array<[number, string]> }> }): PatchSets
}

/** base64 without Buffer or atob: the two ends and the wire agree on it. */
export function b64enc(bytes: Uint8Array): string
export function b64dec(text: string): Uint8Array
