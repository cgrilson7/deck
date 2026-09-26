// The Posture tile's main side (Posture Pal, github.com/cgrilson7/posture-pal, folded into the deck).
// The camera and the pose model run in the RENDERER (lib/posture.ts); what main owns is what the
// renderer cannot do alone:
//
// - THE `pose:` SCHEME. MediaPipe loads a wasm loader as a <script> and fetches its .wasm and the
//   model, and none of that works from the packaged window's file:// page (Chromium's fetch refuses
//   file:). So `pose://wasm/<file>` serves the two files of @mediapipe/tasks-vision it needs and
//   `pose://model/<name>.task` the models — the same in dev and packaged, with CORS
//   (the loader is fetched `crossOrigin = anonymous`). The CSP lets `pose:` in for scripts and fetches.
// - THE MODELS, from Google's model bucket, each fetched once into userData/posture/: the pose
//   landmarker (5.7MB) and the HAND landmarker (7.5MB, 21 points a hand — the pose model's four
//   hand points are too rough and too often dropped once a hand is against the face, which is
//   exactly where the chin-on-hand check looks).
// - CAMERA ACCESS: macOS asks per app (`askForMediaAccess`), so the first start prompts.
// - The window keeps timers at full speed while tracking (`setBackgroundThrottling(false)`), or a
//   deck behind another app would look at you once a second at best.

import { app, net, protocol, systemPreferences } from 'electron'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const POSE_SCHEME = 'pose'
const MODELS: Record<string, string> = {
  'pose_landmarker_lite.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'
}
/** The only files of the package the scheme hands out. */
const WASM = new Set(['vision_wasm_internal.js', 'vision_wasm_internal.wasm'])

/** Before `ready`: the scheme must be privileged to be fetched from and to load scripts. */
export function registerPoseScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: POSE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
}

export class Posture {
  private readonly dir: string
  private modelJobs = new Map<string, Promise<string>>()

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
        if (host === 'model' && Object.hasOwn(MODELS, name)) file = await this.model(name)
        if (!file) return new Response('not found', { status: 404 })
        const res = await net.fetch(pathToFileURL(file).toString())
        const type = name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'
        return new Response(res.body, { headers: { 'content-type': type, 'access-control-allow-origin': '*' } })
      } catch (err) {
        return new Response(String((err as Error)?.message ?? err), { status: 502 })
      }
    })
  }

  /** A model's path, downloaded the first time (one download however many ask at once). */
  private model(name: string): Promise<string> {
    const file = join(this.dir, name)
    if (existsSync(file)) return Promise.resolve(file)
    const running = this.modelJobs.get(name)
    if (running) return running
    const job = (async () => {
      const res = await net.fetch(MODELS[name])
      if (!res.ok) throw new Error(`${name} did not download (HTTP ${res.status})`)
      const bytes = Buffer.from(await res.arrayBuffer())
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(file + '.part', bytes)
      renameSync(file + '.part', file)
      return file
    })().finally(() => {
      this.modelJobs.delete(name)
    })
    this.modelJobs.set(name, job)
    return job
  }

  /** Ask macOS for the camera (a prompt the first time; after a refusal only System Settings can say yes). */
  async camera(): Promise<boolean> {
    if (process.platform !== 'darwin') return true
    if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return true
    return systemPreferences.askForMediaAccess('camera')
  }
}
