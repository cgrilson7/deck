// THE SCREEN RECORDER: films a 9:16 piece of the screen for Instagram Reels / Stories (1080×1920).
//
// The FRAME is a window of its own (transparent, frameless, always on top, on every Space): a
// border you drag anywhere on the screen, a corner handle that resizes it (aspect kept) and a
// toolbar under it. Its inside is CLICK-THROUGH (the page asks for `setIgnoreMouseEvents` as the
// pointer crosses it), so the deck under it is used as usual while it films. The frame's page
// (src/renderer/recorder.html) does the capture itself: the whole display as a desktop
// getUserMedia stream, cropped every frame to where the frame's inside is NOW (so dragging it while
// recording pans the shot), drawn into a 1080×1920 canvas and recorded with MediaRecorder. The
// border and toolbar sit OUTSIDE the cropped rectangle, so they never show; the window also asks
// macOS to keep it out of captures (`setContentProtection`).
//
// SOUND is the Mac's own output, through BlackHole 2ch: at the start `recaudio route`
// (plugin/native/recaudio.swift, compiled into userData/recorder) makes the output "<current> +
// Record" — you still hear everything, and BlackHole gets a copy, which the page records as its
// input — and at the end `recaudio restore` puts the output back. The microphone can be mixed in.
//
// Chunks stream to userData/recorder/take.<ext> as they come; at the stop ffmpeg makes it what
// Instagram wants (H.264 High, yuv420p, constant 30 fps, AAC 48 kHz, faststart) in
// ~/Movies/Foxtrot's Workshop/. Without ffmpeg the raw take is moved there as it is.

import { app, BrowserWindow, desktopCapturer, ipcMain, Notification, screen, shell, systemPreferences } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { findInPath } from './env'

/** The frame's margin around the filmed rectangle (the border you drag by), and its toolbar's height. */
export const REC_PAD = 14
export const REC_BAR = 46
/** The filmed rectangle's aspect (width / height) and the file's size. */
const ASPECT = 9 / 16
const MIN_H = 420

const run = promisify(execFile)

// A coordinate for Electron: Math.round(-0.3) is -0, which V8 does not count as an int32, and
// setPosition throws "conversion failure" in main (a drag to the screen's left or top edge did it).
const int = (n: number): number => Math.round(n) | 0

export class Recorder {
  private win: BrowserWindow | null = null
  private readonly dir: string
  private audioJob: Promise<string> | null = null
  private audioBin: string | null = null
  private restoreTo: string | null = null
  private take: { stream: WriteStream; path: string } | null = null

  constructor(
    userData: string,
    private readonly audioSource: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly page: () => { url?: string; file: string },
    private readonly preload: string,
    private readonly deck: () => BrowserWindow | null
  ) {
    this.dir = join(userData, 'recorder')
    this.register()
  }

  isOpen(): boolean {
    return !!this.win && !this.win.isDestroyed()
  }

  toggle(): void {
    if (this.isOpen()) this.win!.webContents.send('rec:closeAsked')
    else this.open()
  }

  open(): void {
    if (this.isOpen()) return void this.win!.show()
    // Start over the deck window (or the screen under the pointer), 80% of the display's height.
    const deck = this.deck()
    const area = (deck && !deck.isDestroyed() ? screen.getDisplayMatching(deck.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea
    const h = Math.max(MIN_H, Math.round(area.height * 0.8) - 2 * REC_PAD - REC_BAR)
    const w = Math.round(h * ASPECT)
    const W = w + 2 * REC_PAD
    const H = h + 2 * REC_PAD + REC_BAR
    const win = new BrowserWindow({
      x: Math.round(area.x + (area.width - W) / 2),
      y: Math.round(area.y + (area.height - H) / 2),
      width: W,
      height: H,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false, // the corner handle resizes, keeping the aspect
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'Recorder',
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false // it films while the deck has the focus
      }
    })
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setContentProtection(true)
    win.setIgnoreMouseEvents(true, { forward: true })
    win.on('closed', () => {
      this.win = null
      this.endTake()
      void this.restoreAudio()
    })
    const p = this.page()
    if (p.url) void win.loadURL(p.url)
    else void win.loadFile(p.file)
    this.win = win
  }

  close(): void {
    if (this.isOpen()) this.win!.close()
  }

  /** Open the frame (if it is not up) with its filmed inside exactly over this screen rectangle (a 9:16 stage of the deck's). */
  cover(r: { x: number; y: number; width: number; height: number }): void {
    if (!this.isOpen()) this.open()
    const h = Math.max(MIN_H, r.height)
    const w = Math.round(h * ASPECT)
    // `| 0`: Math.round can give -0 at a screen edge, which setBounds refuses as not an int32.
    this.win!.setBounds({ x: Math.round(r.x + (r.width - w) / 2 - REC_PAD) | 0, y: Math.round(r.y - REC_PAD) | 0, width: w + 2 * REC_PAD, height: Math.round(h) + 2 * REC_PAD + REC_BAR })
    this.win!.show()
  }

  // ---- sound -------------------------------------------------------------------------

  private compileAudio(): Promise<string> {
    if (this.audioJob) return this.audioJob
    this.audioJob = (async () => {
      const src = readFileSync(this.audioSource, 'utf8')
      const bin = join(this.dir, `recaudio-${createHash('sha1').update(src).digest('hex').slice(0, 12)}`)
      this.audioBin = bin
      if (existsSync(bin)) return bin
      mkdirSync(this.dir, { recursive: true })
      const copy = join(this.dir, 'recaudio.swift')
      writeFileSync(copy, src)
      try {
        await run('/usr/bin/swiftc', ['-O', copy, '-o', bin], { timeout: 180_000 })
      } catch (err) {
        throw new Error(`the recorder's audio helper did not compile (xcode-select --install): ${(err as Error).message}`)
      }
      return bin
    })().catch((err) => {
      this.audioJob = null
      throw err
    })
    return this.audioJob
  }

  private async audio(args: string[]): Promise<{ previous?: string; device?: string; error?: string }> {
    const bin = await this.compileAudio()
    try {
      const { stdout } = await run(bin, args, { timeout: 15_000 })
      return JSON.parse(stdout)
    } catch (err) {
      const out = (err as { stdout?: string }).stdout
      try {
        return JSON.parse(out ?? '')
      } catch {
        return { error: (err as Error).message }
      }
    }
  }

  /** The Mac's output copied into BlackHole for the take. Resolves an error, or '' when it is routed. */
  private async routeAudio(): Promise<string> {
    const r = await this.audio(['route']).catch((e: Error) => ({ error: e.message }) as { error: string; previous?: string; device?: string })
    if (r.error) return r.error
    // Put back only what we changed: an output that was already a "+ Record" device stays.
    if (r.previous && r.previous !== r.device && !this.restoreTo) this.restoreTo = r.previous
    return ''
  }

  private async restoreAudio(): Promise<void> {
    const to = this.restoreTo
    this.restoreTo = null
    if (to) await this.audio(['restore', to]).catch(() => {})
  }

  // ---- the take ----------------------------------------------------------------------

  private endTake(): void {
    if (!this.take) return
    this.take.stream.end()
    rmSync(this.take.path, { force: true })
    this.take = null
  }

  private outDir(): string {
    const d = join(homedir(), 'Movies', "Foxtrot's Workshop")
    mkdirSync(d, { recursive: true })
    return d
  }

  private async finish(ext: string): Promise<string> {
    const take = this.take
    if (!take) throw new Error('nothing was recording')
    this.take = null
    await new Promise<void>((resolve) => take.stream.end(resolve))
    const d = new Date()
    const two = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`
    const ffmpeg = findInPath(this.env.PATH, 'ffmpeg')
    if (!ffmpeg) {
      const raw = join(this.outDir(), `deck ${stamp}.${ext}`)
      renameSync(take.path, raw)
      return raw
    }
    const out = join(this.outDir(), `deck ${stamp}.mp4`)
    await run(
      ffmpeg,
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', take.path,
        '-vf', 'scale=1080:1920:flags=lanczos,fps=30,format=yuv420p',
        '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-preset', 'medium', '-crf', '17', '-maxrate', '25M', '-bufsize', '50M',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', out],
      { timeout: 30 * 60_000, env: this.env }
    )
    rmSync(take.path, { force: true })
    return out
  }

  private register(): void {
    const mine = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => !!this.win && !this.win.isDestroyed() && e.sender === this.win.webContents
    // The page's pointer crossed into / out of the frame's inside.
    ipcMain.on('rec:passThrough', (e, through: boolean) => {
      if (mine(e)) this.win!.setIgnoreMouseEvents(!!through, { forward: true })
    })
    // The border or the bar dragged: the window's new top-left corner.
    ipcMain.on('rec:move', (e, x: number, y: number) => {
      if (mine(e) && Number.isFinite(x) && Number.isFinite(y)) this.win!.setPosition(int(x), int(y))
    })
    // The corner handle: the filmed rectangle's new height, the top-left corner staying put.
    ipcMain.on('rec:resize', (e, height: number) => {
      if (!mine(e)) return
      const b = this.win!.getBounds()
      const area = screen.getDisplayMatching(b).workArea
      const h = Math.round(Math.min(Math.max(MIN_H, Number(height) || MIN_H), area.height - 2 * REC_PAD - REC_BAR))
      this.win!.setBounds({ x: b.x, y: b.y, width: Math.round(h * ASPECT) + 2 * REC_PAD, height: h + 2 * REC_PAD + REC_BAR })
    })
    ipcMain.on('rec:close', (e) => {
      if (mine(e)) this.close()
    })
    // What to film: the display under the frame's middle, as a desktop capture source.
    ipcMain.handle('rec:source', async (e) => {
      if (!mine(e)) throw new Error('not the recorder')
      // Screen capture without the Screen Recording permission fails in the page as a bare "Permission denied".
      const screenStatus = systemPreferences.getMediaAccessStatus('screen')
      if (screenStatus === 'denied' || screenStatus === 'restricted') {
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        throw new Error('screen recording is off for the deck: turn it on in the System Settings pane just opened, then quit and reopen the deck')
      }
      const b = this.win!.getBounds()
      const display = screen.getDisplayNearestPoint({ x: int(b.x + b.width / 2), y: int(b.y + b.height / 2) })
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
      if (!src) throw new Error('no screen to capture (System Settings ▸ Privacy & Security ▸ Screen Recording)')
      return { id: src.id, bounds: display.bounds, scale: display.scaleFactor }
    })
    // Sound: the output routed through BlackHole (and the microphone permission recording an input needs).
    ipcMain.handle('rec:audioOn', async (e) => {
      if (!mine(e)) return 'not the recorder'
      // Recording any input (BlackHole is one) takes the microphone permission.
      // macOS asks only once: after a "no" (status 'denied') askForMediaAccess answers false without a prompt,
      // so open the Microphone pane of System Settings where it can be turned on.
      const status = systemPreferences.getMediaAccessStatus('microphone')
      if (status === 'denied' || status === 'restricted') {
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
        return 'microphone access is off for the deck: turn it on in the System Settings pane just opened, then try again'
      }
      if (!(await systemPreferences.askForMediaAccess('microphone'))) return 'microphone access is off for the deck (System Settings ▸ Privacy & Security ▸ Microphone)'
      return this.routeAudio()
    })
    ipcMain.handle('rec:audioOff', async (e) => {
      if (mine(e)) await this.restoreAudio()
    })
    ipcMain.handle('rec:begin', (e, ext: string) => {
      if (!mine(e)) throw new Error('not the recorder')
      this.endTake()
      mkdirSync(this.dir, { recursive: true })
      const path = join(this.dir, `take.${/^[a-z0-9]{2,4}$/.test(ext) ? ext : 'webm'}`)
      this.take = { stream: createWriteStream(path), path }
    })
    ipcMain.handle('rec:chunk', (e, bytes: Uint8Array) => {
      if (!mine(e) || !this.take) return
      return new Promise<void>((resolve) => (this.take!.stream.write(Buffer.from(bytes)) ? resolve() : this.take!.stream.once('drain', resolve)))
    })
    ipcMain.handle('rec:end', async (e, ext: string) => {
      if (!mine(e)) throw new Error('not the recorder')
      await this.restoreAudio()
      const path = await this.finish(String(ext ?? 'webm'))
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Recording saved', body: path.replace(homedir(), '~'), silent: true })
        n.on('click', () => shell.showItemInFolder(path))
        n.show()
      }
      return path
    })
    ipcMain.on('rec:reveal', (_e, path: string) => {
      const p = String(path ?? '')
      if (p.startsWith(this.outDir()) && existsSync(p)) shell.showItemInFolder(p)
    })
    ipcMain.on('rec:play', (_e, path: string) => {
      const p = String(path ?? '')
      if (p.startsWith(this.outDir()) && existsSync(p)) void shell.openPath(p)
    })
    // Quitting mid-take: the output goes back before the process does.
    app.on('will-quit', () => {
      const to = this.restoreTo
      if (!to || !this.audioBin) return
      this.restoreTo = null
      try {
        execFileSync(this.audioBin, ['restore', to], { timeout: 5000 })
      } catch {
        /* the output stays "+ Record": still audible, nothing lost */
      }
    })
  }
}
