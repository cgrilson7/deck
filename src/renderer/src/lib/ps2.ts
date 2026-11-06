// THE PS2: PCSX2 mirrored (main/pcsx2.ts does the native half). A module singleton that holds ONE live
// capture of PCSX2's game window (Electron's desktop capture: getUserMedia with the window's
// `window:<id>:0` source) in a hidden <video>, and paints it into every attached canvas — the tile and
// the pane — CROPPED to the game: PCSX2's title bar and status bar cut away, then the 4:3 picture inside
// its letterbox. The capture runs only while a view is attached, and follows the window: a poll every
// 2 s notices PCSX2 starting, quitting, or opening a new game window, and restarts the stream.
//
// Keys go the other way through main (`ps2Key`): the deck stays in front, PCSX2 hears them.

import { useEffect, useState } from 'react'
import type { Ps2Button, Ps2Status } from '@shared/types'

/** macOS's title bar and PCSX2's status bar, in window points (cut from the capture). */
const TITLE_BAR = 28
const STATUS_BAR = 24
const POLL_MS = 2000

export interface Ps2View {
  status: Ps2Status | null
  /** The capture is live (a frame has arrived). */
  live: boolean
  error: string | null
}

class Ps2Mirror {
  private view: Ps2View = { status: null, live: false, error: null }
  private readonly listeners = new Set<(v: Ps2View) => void>()
  private readonly canvases = new Set<HTMLCanvasElement>()
  private readonly video: HTMLVideoElement
  private stream: MediaStream | null = null
  private source: string | null = null
  private poll: number | undefined
  private raf = 0
  private starting = false

  constructor() {
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
  }

  get state(): Ps2View {
    return this.view
  }

  subscribe(cb: (v: Ps2View) => void): () => void {
    this.listeners.add(cb)
    cb(this.view)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private set(patch: Partial<Ps2View>): void {
    this.view = { ...this.view, ...patch }
    for (const l of this.listeners) l(this.view)
  }

  /** Paint the game into this canvas until the returned function is called. */
  attach(canvas: HTMLCanvasElement): () => void {
    this.canvases.add(canvas)
    if (this.canvases.size === 1) this.start()
    return () => {
      this.canvases.delete(canvas)
      if (this.canvases.size === 0) this.stop()
    }
  }

  private start(): void {
    void this.refresh()
    this.poll = window.setInterval(() => void this.refresh(), POLL_MS)
    const loop = () => {
      this.paint()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  private stop(): void {
    window.clearInterval(this.poll)
    cancelAnimationFrame(this.raf)
    this.closeStream()
    window.deck.ps2ReleaseAll()
  }

  /** Ask main where PCSX2 is; (re)start the capture when its window changed. */
  async refresh(): Promise<void> {
    let status: Ps2Status
    try {
      status = await window.deck.ps2Status()
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) })
      return
    }
    this.set({ status, error: status.error })
    const want = status.window?.source ?? null
    if (want === this.source && (this.stream || !want)) return
    this.closeStream()
    this.source = want
    if (want && this.canvases.size) await this.openStream(want)
  }

  private async openStream(source: string): Promise<void> {
    if (this.starting) return
    this.starting = true
    try {
      // The source id straight to getUserMedia (Chromium's desktop capture); failing that, getDisplayMedia,
      // which main's display-media handler answers with the same window.
      const stream = await navigator.mediaDevices
        .getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source, maxFrameRate: 60 } }
        } as unknown as MediaStreamConstraints)
        .catch(() => navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: 60 } }))
      if (this.source !== source || !this.canvases.size) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      this.stream = stream
      this.video.srcObject = stream
      await this.video.play().catch(() => {})
      this.set({ live: true, error: null })
    } catch (err) {
      this.source = null
      this.set({ live: false, error: `cannot see PCSX2's window (Screen Recording for Foxtrot's Workshop): ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      this.starting = false
    }
  }

  private closeStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    this.source = null
    if (this.view.live) this.set({ live: false })
  }

  /** The game's rectangle inside the captured frame: chrome cut away, then 4:3 centred in what is left. */
  private crop(): { sx: number; sy: number; sw: number; sh: number } | null {
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    const win = this.view.status?.window
    if (!vw || !vh || !win) return null
    const scale = vh / win.height
    const top = Math.round(TITLE_BAR * scale)
    const bottom = Math.round(STATUS_BAR * scale)
    const h = vh - top - bottom
    if (h <= 0) return null
    const w = Math.min(vw, Math.round((h * 4) / 3))
    const hh = Math.min(h, Math.round((w * 3) / 4))
    return { sx: Math.round((vw - w) / 2), sy: top + Math.round((h - hh) / 2), sw: w, sh: hh }
  }

  private paint(): void {
    if (!this.stream || this.video.readyState < 2) return
    const c = this.crop()
    if (!c) return
    for (const canvas of this.canvases) {
      const box = canvas.parentElement
      if (!box) continue
      const dpr = window.devicePixelRatio || 1
      const bw = Math.max(1, Math.round(box.clientWidth * dpr))
      const bh = Math.max(1, Math.round(box.clientHeight * dpr))
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      const k = Math.min(bw / c.sw, bh / c.sh)
      const dw = Math.round(c.sw * k)
      const dh = Math.round(c.sh * k)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, bw, bh)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(this.video, c.sx, c.sy, c.sw, c.sh, Math.round((bw - dw) / 2), Math.round((bh - dh) / 2), dw, dh)
    }
  }

  press(b: Ps2Button): void {
    window.deck.ps2Key(b, true)
  }
  release(b: Ps2Button): void {
    window.deck.ps2Key(b, false)
  }
  releaseAll(): void {
    window.deck.ps2ReleaseAll()
  }

  async launch(path: string): Promise<void> {
    try {
      await window.deck.ps2Launch(path)
      this.set({ error: null })
      // PCSX2 takes a few seconds to open its game window; the poll picks it up.
      window.setTimeout(() => void this.refresh(), 3000)
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) })
    }
  }
}

let mirror: Ps2Mirror | null = null

export function ps2(): Ps2Mirror {
  if (!mirror) mirror = new Ps2Mirror()
  return mirror
}

export function usePs2(): Ps2View {
  const [v, setV] = useState<Ps2View>(() => ps2().state)
  useEffect(() => ps2().subscribe(setV), [])
  return v
}
