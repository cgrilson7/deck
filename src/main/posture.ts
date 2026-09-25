// The Posture tile's main side (Posture Pal, github.com/cgrilson7/posture-pal, folded into the deck).
// The camera and the pose model run in the RENDERER (lib/posture.ts); what main owns is what the
// renderer cannot do alone:
//
// - THE `pose:` SCHEME. MediaPipe loads a wasm loader as a <script> and fetches its .wasm and the
//   model, and none of that works from the packaged window's file:// page (Chromium's fetch refuses
//   file:). So `pose://wasm/<file>` serves the two files of @mediapipe/tasks-vision it needs and
//   `pose://model/pose_landmarker_lite.task` the model — the same in dev and packaged, with CORS
//   (the loader is fetched `crossOrigin = anonymous`). The CSP lets `pose:` in for scripts and fetches.
// - THE MODEL: 5.7MB from Google's model bucket, fetched once into userData/posture/.
// - CAMERA ACCESS: macOS asks per app (`askForMediaAccess`), so the first start prompts.
// - The window keeps timers at full speed while tracking (`setBackgroundThrottling(false)`), or a
//   deck behind another app would look at you once a second at best.

import { app, net, protocol, systemPreferences } from 'electron'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const POSE_SCHEME = 'pose'
const MODEL = 'pose_landmarker_lite.task'
const MODEL_URL = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/${MODEL}`
/** The only files of the package the scheme hands out. */
const WASM = new Set(['vision_wasm_internal.js', 'vision_wasm_internal.wasm'])

/** Before `ready`: the scheme must be privileged to be fetched from and to load scripts. */
export function registerPoseScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: POSE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
}

export class Posture {
  private readonly dir: string
  private modelJob: Promise<string> | null = null

  constructor(userData: string) {
    this.dir = join(userData, 'posture')
  }

  /** After `ready`: answer `pose://…` on the default session (the deck window's). */
  serve(): void {
    const wasmDir = join(app.getAppPath(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
    protocol.handle(POSE_SCHEME, async (req) => {
      const { host, pathname } = new URL(req.url)
      const name = decodeURIComponent(pathname.replace(/^\//, ''))
      try {
        let file: string | null = null
        if (host === 'wasm' && WASM.has(name)) file = join(wasmDir, name)
        if (host === 'model' && name === MODEL) file = await this.model()
        if (!file) return new Response('not found', { status: 404 })
        const res = await net.fetch(pathToFileURL(file).toString())
        const type = name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'
        return new Response(res.body, { headers: { 'content-type': type, 'access-control-allow-origin': '*' } })
      } catch (err) {
        return new Response(String((err as Error)?.message ?? err), { status: 502 })
      }
    })
  }

  /** The model's path, downloaded the first time (one download however many ask at once). */
  private model(): Promise<string> {
    const file = join(this.dir, MODEL)
    if (existsSync(file)) return Promise.resolve(file)
    this.modelJob ??= (async () => {
      const res = await net.fetch(MODEL_URL)
      if (!res.ok) throw new Error(`the pose model did not download (HTTP ${res.status})`)
      const bytes = Buffer.from(await res.arrayBuffer())
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(file + '.part', bytes)
      renameSync(file + '.part', file)
      return file
    })().finally(() => {
      this.modelJob = null
    })
    return this.modelJob
  }

  /** Ask macOS for the camera (a prompt the first time; after a refusal only System Settings can say yes). */
  async camera(): Promise<boolean> {
    if (process.platform !== 'darwin') return true
    if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return true
    return systemPreferences.askForMediaAccess('camera')
  }
}
