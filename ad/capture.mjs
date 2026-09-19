// Renders the ad to video: `npx electron ad/capture.mjs [--wide] [--fps 60] [--until 12] [--out file.mp4]`
// or stills for checking a moment: `--shots 1,4.5,9 [--dir folder]`.
//
// An offscreen Electron window loads the ad page (served by Vite from ad/) with ?capture, which puts
// the page on a virtual clock (public/clock.js). Each video frame: advance the clock one frame, let the
// compositor paint, capturePage, hand the raw BGRA to ffmpeg. Nothing is real time, so nothing drops.

import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}

const wide = flag('wide')
const fps = Number(opt('fps', 30))
const scale = Number(opt('scale', 2))
const [W, H] = wide ? [960, 540] : [540, 960]
const shots = opt('shots', '')
  .split(',')
  .filter(Boolean)
  .map(Number)
const dir = resolve(opt('dir', resolve(here, 'out')))
const out = resolve(opt('out', resolve(dir, wide ? 'deck-ad-16x9.mp4' : 'deck-ad-9x16.mp4')))

app.commandLine.appendSwitch('force-device-scale-factor', String(scale))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.dock?.hide()

app.whenReady().then(async () => {
  mkdirSync(dir, { recursive: true })
  const server = await createServer({ configFile: resolve(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5198, strictPort: false } })
  await server.listen()
  const port = server.config.server.port ?? 5198
  const base = server.resolvedUrls?.local[0] ?? `http://localhost:${port}/`

  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, frame: false, webPreferences: { offscreen: true, backgroundThrottling: false } })
  win.webContents.setFrameRate(60)
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log(`[page ${e.level}]`, e.message.slice(0, 400))
  })
  await win.loadURL(`${base}?capture${wide ? '&wide' : ''}`)
  const js = (code) => win.webContents.executeJavaScript(code, true)

  // The page boots on real promises (fonts, images) but virtual timers: nudge the clock until it says ready.
  for (let i = 0; i < 400 && !(await js('Boolean(window.__ad && window.__ad.ready)')); i++) await js('window.__adv(16)')
  const duration = Number(opt('until', await js('window.__ad.duration')))
  // A few frames for the deck to lay out (terminal fit, tiles) before the film's clock starts.
  for (let i = 0; i < 30; i++) await js('window.__adv(16)')
  await js('window.__ad.start()')

  const first = await win.webContents.capturePage()
  const size = first.getSize()
  console.log(`frame ${size.width}×${size.height}, ${duration}s @ ${fps}fps${shots.length ? `, stills at ${shots.join(', ')}` : ` → ${out}`}`)

  let ff = null
  if (!shots.length) {
    ff = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${size.width}x${size.height}`, '-r', String(fps), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    )
  }

  const frames = Math.round(duration * fps)
  const want = new Set(shots.map((s) => Math.round(s * fps)))
  const started = Date.now()
  for (let n = 1; n <= frames; n++) {
    await js(`window.__adv(${1000 / fps})`)
    if (ff) {
      const img = await win.webContents.capturePage()
      if (!ff.stdin.write(img.toBitmap())) await new Promise((r) => ff.stdin.once('drain', r))
      if (n % (fps * 2) === 0) console.log(`  ${(n / fps).toFixed(0)}s / ${duration}s  (${((Date.now() - started) / n).toFixed(0)}ms a frame)`)
    } else if (want.has(n)) {
      const img = await win.webContents.capturePage()
      const file = resolve(dir, `shot-${(n / fps).toFixed(2).padStart(6, '0')}.png`)
      writeFileSync(file, img.toPNG())
      console.log('  wrote', file)
    }
  }
  if (opt('eval', '')) console.log(JSON.stringify(await js(opt('eval', '')), null, 1))
  if (flag('dump')) {
    console.log(await js(`(() => { const out = []; const walk = (el, d) => { if (d > 7) return; for (const c of el.children) { const cls = typeof c.className === 'string' ? c.className : ''; if (cls && !/xterm|lucide/.test(cls)) out.push('  '.repeat(d) + c.tagName.toLowerCase() + '.' + cls.trim().split(/\\s+/).join('.') + (c.children.length ? '' : ' “' + (c.textContent || '').slice(0, 30) + '”')); walk(c, d + 1) } }; walk(document.querySelector('${opt('dump-root', '.main')}'), 0); return out.join('\\n') })()`))
  }
  if (ff) {
    ff.stdin.end()
    await new Promise((r) => ff.on('close', r))
    console.log('done:', out)
  }
  await server.close()
  app.exit(0)
})
