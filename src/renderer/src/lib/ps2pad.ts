// THE PAD AS PRESSED, for the "Foxtrot Plays" DualShock 2 drawing: what the player's real controller is
// doing (the Gamepad API — a DualSense / DualShock paired with the Mac reads here AND in PCSX2, which plays
// it directly) merged with what the deck itself is holding (lib/ps2's keyboard and drawn-pad presses).
// One rAF poll for the window while anything listens, and a new state only when something changed.

import { useEffect, useState } from 'react'
import type { Ps2Button } from '@shared/types'
import { ps2 } from './ps2'

export interface PadState {
  /** Every button down, from either source. */
  down: ReadonlySet<Ps2Button>
  /** The sticks, -1..1 each axis, y down positive (the Gamepad API's way). */
  lx: number
  ly: number
  rx: number
  ry: number
  /** A real controller is reporting. */
  connected: boolean
}

/** The Gamepad API's "standard" mapping → PS2 buttons (index = button number). */
const STANDARD: (Ps2Button | null)[] = ['cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right']
const DEAD = 0.12
const dz = (v: number | undefined) => (v === undefined || Math.abs(v) < DEAD ? 0 : Math.max(-1, Math.min(1, v)))
const q = (v: number) => Math.round(v * 20) / 20

const EMPTY: PadState = { down: new Set(), lx: 0, ly: 0, rx: 0, ry: 0, connected: false }

class PadWatch {
  private state: PadState = EMPTY
  private key = ''
  private readonly listeners = new Set<(s: PadState) => void>()
  private raf = 0
  private offHeld: (() => void) | null = null

  subscribe(cb: (s: PadState) => void): () => void {
    this.listeners.add(cb)
    cb(this.state)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(cb)
      if (!this.listeners.size) this.stop()
    }
  }

  private start(): void {
    this.offHeld = ps2().onHeld(() => this.read())
    const loop = () => {
      this.read()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  private stop(): void {
    cancelAnimationFrame(this.raf)
    this.offHeld?.()
    this.offHeld = null
  }

  private read(): void {
    const down = new Set<Ps2Button>(ps2().holding)
    let lx = 0
    let ly = 0
    let rx = 0
    let ry = 0
    let connected = false
    const pads = navigator.getGamepads?.() ?? []
    for (const g of pads) {
      if (!g || !g.connected) continue
      connected = true
      if (g.mapping === 'standard') {
        g.buttons.forEach((b, i) => {
          const name = STANDARD[i]
          if (name && (b.pressed || b.value > 0.35)) down.add(name)
        })
      }
      lx = dz(g.axes[0]) || lx
      ly = dz(g.axes[1]) || ly
      rx = dz(g.axes[2]) || rx
      ry = dz(g.axes[3]) || ry
    }
    // The deck's own left stick (W A S D in PCSX2's bindings) shows on the drawn stick.
    if (down.has('lleft')) lx = -1
    if (down.has('lright')) lx = 1
    if (down.has('lup')) ly = -1
    if (down.has('ldown')) ly = 1
    lx = q(lx)
    ly = q(ly)
    rx = q(rx)
    ry = q(ry)
    const key = `${[...down].sort().join(',')}|${lx},${ly},${rx},${ry}|${connected}`
    if (key === this.key) return
    this.key = key
    this.state = { down, lx, ly, rx, ry, connected }
    for (const l of this.listeners) l(this.state)
  }
}

let watch: PadWatch | null = null

export function usePad(): PadState {
  const [s, setS] = useState<PadState>(EMPTY)
  useEffect(() => {
    if (!watch) watch = new PadWatch()
    return watch.subscribe(setS)
  }, [])
  return s
}
