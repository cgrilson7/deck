// The Studio: Gemini image generation inside the deck. One service, three doors — the Studio
// tile's prompt bar, the Studio pane in the center, and `POST /studio` on the hooks server,
// which is how a Claude session drafts the hyper-specific request (the prompt, the reference
// images, the ratio) and runs it (plugin/scripts/studio.mjs, the `/deck:studio` skill). Every
// result lands in the same gallery: `userData/studio/jobs.json` and a PNG beside it, and the
// whole list is broadcast as `studio:update` on every change, so the tile and the pane just
// draw the list.
//
// The call is the REST `generateContent` of the Generative Language API (v1beta), key in the
// `x-goog-api-key` header, reference images inline as base64, `responseModalities`
// TEXT + IMAGE and the ratio and size beside them; the image comes back as an
// `inlineData` part (JPEG as a rule; the file takes the mime's extension). A 429 / 5xx is retried;
// a model that rejects `imageConfig` is asked again without it.

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StudioInfo, StudioJob, StudioModel, StudioRatio, StudioRequest, StudioSize } from '@shared/types'
import { STUDIO_MODEL_DEFAULT, STUDIO_RATIOS, STUDIO_REFS_MAX, STUDIO_SIZES } from '@shared/types'

const API = 'https://generativelanguage.googleapis.com/v1beta'
/** Jobs kept in the index (images of dropped entries stay on disk; delete removes both). */
const KEEP = 400
/** A reference image larger than this is refused (the API's inline limit is 20MB for the whole request). */
const REF_MAX = 12_000_000
const PROMPT_MAX = 12_000
/** One call may take this long before it is abandoned (4K on the pro model takes a while). */
const CALL_TIMEOUT_MS = 240_000
const MODELS_TTL_MS = 10 * 60_000

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
}

interface Part {
  text?: string
  inlineData?: { mimeType: string; data: string }
}
interface GenerateResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string; safetyRatings?: unknown }[]
  promptFeedback?: { blockReason?: string }
  error?: { code?: number; message?: string; status?: string }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image'

const stamp = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Studio {
  readonly dir: string
  private readonly index: string
  private jobs: StudioJob[] = []
  private models: { at: number; list: StudioModel[] } | null = null

  constructor(
    userDataDir: string,
    /** The key to use right now: the setting, else the login shell's $GEMINI_API_KEY. */
    private readonly key: () => { key: string; source: StudioInfo['keySource'] },
    /** The `studioModel` setting. */
    private readonly defaultModel: () => string,
    private readonly broadcast: (jobs: StudioJob[]) => void
  ) {
    this.dir = join(userDataDir, 'studio')
    this.index = join(this.dir, 'jobs.json')
    mkdirSync(this.dir, { recursive: true })
    try {
      const raw = JSON.parse(readFileSync(this.index, 'utf8')) as StudioJob[]
      // A job still "running" from a previous life never finished.
      this.jobs = raw.map((j) => (j.status === 'running' ? { ...j, status: 'error', error: 'the deck quit while this ran' } : j))
    } catch {
      this.jobs = []
    }
  }

  list(): StudioJob[] {
    return this.jobs
  }

  info(): StudioInfo {
    const k = this.key()
    return { ready: !!k.key, keySource: k.key ? k.source : 'none', dir: this.dir, model: this.defaultModel() || STUDIO_MODEL_DEFAULT }
  }

  private save(): void {
    if (this.jobs.length > KEEP) this.jobs = this.jobs.slice(0, KEEP)
    try {
      writeFileSync(this.index, JSON.stringify(this.jobs, null, 2))
    } catch (err) {
      console.warn('[deck] studio: cannot write jobs.json:', (err as Error).message)
    }
    this.broadcast(this.jobs)
  }

  /** The image-capable models this key can see, cached 10 min. */
  async listModels(): Promise<StudioModel[]> {
    if (this.models && Date.now() - this.models.at < MODELS_TTL_MS) return this.models.list
    const { key } = this.key()
    if (!key) throw new Error('No Gemini API key. Set geminiApiKey in config.json (or $GEMINI_API_KEY).')
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } })
    const body = (await res.json().catch(() => ({}))) as { models?: { name: string; displayName?: string; description?: string; supportedGenerationMethods?: string[] }[]; error?: { message?: string } }
    if (!res.ok) throw new Error(body.error?.message ?? `models: HTTP ${res.status}`)
    const list = (body.models ?? [])
      .filter((m) => /image/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName ?? m.name, description: m.description ?? '' }))
    this.models = { at: Date.now(), list }
    return list
  }

  /** Where a reference path means: absolute, `~/`, or relative to `cwd`. */
  private resolveRef(p: string, cwd?: string): string {
    let s = String(p ?? '').trim().replace(/^['"]+|['"]+$/g, '')
    if (s.startsWith('~/')) s = join(homedir(), s.slice(2))
    return isAbsolute(s) ? s : resolve(cwd ?? homedir(), s)
  }

  /**
   * Run one generation. The job is in the list (running) before the call goes out, and again
   * (done or error) when it comes back; the promise resolves with the final job either way, so
   * callers never throw on a model refusal — they read `error`.
   */
  async generate(req: StudioRequest, cwd?: string): Promise<StudioJob> {
    const prompt = String(req.prompt ?? '').trim()
    const { key } = this.key()
    const model = (req.model && String(req.model).trim()) || this.defaultModel() || STUDIO_MODEL_DEFAULT
    const ratio: StudioRatio = STUDIO_RATIOS.includes(req.ratio as StudioRatio) ? (req.ratio as StudioRatio) : '1:1'
    const size: StudioSize = STUDIO_SIZES.includes(req.size as StudioSize) ? (req.size as StudioSize) : '1K'
    const refs = (Array.isArray(req.refs) ? req.refs : []).map((r) => this.resolveRef(r, cwd)).slice(0, STUDIO_REFS_MAX)
    const job: StudioJob = {
      id: randomUUID().slice(0, 8),
      at: Date.now(),
      status: 'running',
      prompt,
      model,
      ratio,
      size,
      refs,
      tag: req.tag ? String(req.tag).trim().slice(0, 60) || undefined : undefined,
      name: req.name ? String(req.name).trim().slice(0, 60) || undefined : undefined,
      from: req.from === 'tile' || req.from === 'cli' ? req.from : 'pane',
      session: req.session ? String(req.session) : undefined
    }
    this.jobs.unshift(job)
    this.save()

    const fail = (msg: string): StudioJob => {
      job.status = 'error'
      job.error = msg
      job.ms = Date.now() - job.at
      this.save()
      return job
    }

    if (!prompt) return fail('nothing to generate: the prompt is empty')
    if (prompt.length > PROMPT_MAX) return fail(`keep the prompt under ${PROMPT_MAX} characters`)
    if (!key) return fail('No Gemini API key. Set geminiApiKey in config.json (aistudio.google.com → Get API key), or export GEMINI_API_KEY.')
    if (!/^[\w.-]+$/.test(model)) return fail(`not a model id: ${model}`)

    const parts: Part[] = []
    for (const p of refs) {
      const mime = MIME[extname(p).toLowerCase()]
      if (!mime) return fail(`not an image I can send: ${p}`)
      let size = 0
      try {
        size = statSync(p).size
      } catch {
        return fail(`no such file: ${p}`)
      }
      if (size > REF_MAX) return fail(`reference too large (${Math.round(size / 1e6)}MB, max ${REF_MAX / 1e6}MB): ${p}`)
      parts.push({ inlineData: { mimeType: mime, data: readFileSync(p).toString('base64') } })
    }
    parts.push({ text: prompt })

    // `imageConfig` with "1:1" / "1K" is what every image model here takes (verified Sept 2026;
    // the reference's newer `responseFormat.image` wants enum names and rejected these). A 400
    // that names the field falls back to no config: the model still answers, at its own ratio.
    const shapes: Record<string, unknown>[] = [{ imageConfig: { aspectRatio: ratio, imageSize: size } }, {}]
    const body = (shape: Record<string, unknown>) =>
      JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...shape }
      })

    let res: Response | null = null
    let parsed: GenerateResponse = {}
    let shape = 0
    for (let attempt = 0; attempt < 6; attempt++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS)
      try {
        res = await fetch(`${API}/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: body(shapes[shape]),
          signal: ctl.signal
        })
      } catch (err) {
        clearTimeout(timer)
        const msg = (err as Error).name === 'AbortError' ? `no answer in ${CALL_TIMEOUT_MS / 1000}s` : (err as Error).message
        if (attempt < 3) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        return fail(msg)
      }
      clearTimeout(timer)
      parsed = (await res.json().catch(() => ({}))) as GenerateResponse
      if (res.ok) break
      const msg = parsed.error?.message ?? `HTTP ${res.status}`
      if (res.status === 400 && shape < shapes.length - 1 && /response_?format|image_?config|image_?size|aspect_?ratio|unknown name|invalid json payload/i.test(msg)) {
        shape++
        continue
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        await sleep(res.status === 429 ? 6000 * (attempt + 1) : 2000 * (attempt + 1))
        continue
      }
      return fail(msg)
    }
    if (!res || !res.ok) return fail(parsed.error?.message ?? 'no answer')

    const cand = parsed.candidates?.[0]
    const image = cand?.content?.parts?.find((p) => p.inlineData?.data)
    const text = (cand?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) job.text = text
    if (!image?.inlineData) {
      const why = parsed.promptFeedback?.blockReason ? `blocked: ${parsed.promptFeedback.blockReason}` : cand?.finishReason && cand.finishReason !== 'STOP' ? `no image (${cand.finishReason})` : 'no image in the answer'
      return fail(text ? `${why} — ${text.slice(0, 300)}` : why)
    }
    const mime = image.inlineData.mimeType || 'image/png'
    const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png'
    const file = join(this.dir, `${stamp(job.at)}-${slug(job.name || prompt)}${ext}`)
    try {
      writeFileSync(file, Buffer.from(image.inlineData.data, 'base64'))
    } catch (err) {
      return fail(`cannot write ${file}: ${(err as Error).message}`)
    }
    job.image = file
    job.mime = mime
    job.status = 'done'
    job.ms = Date.now() - job.at
    this.save()
    return job
  }

  delete(id: string): void {
    const j = this.jobs.find((x) => x.id === id)
    if (!j) return
    if (j.image && j.image.startsWith(this.dir) && existsSync(j.image)) {
      try {
        unlinkSync(j.image)
      } catch {
        /* keep the entry gone anyway */
      }
    }
    this.jobs = this.jobs.filter((x) => x.id !== id)
    this.save()
  }

  /**
   * `POST /studio` from a session (plugin/scripts/studio.mjs): `{ op: 'gen', ...StudioRequest, cwd }`
   * waits for the job; `list`, `models`, `info` answer at once. `alpha` is the caller's session id,
   * kept on the job as `session`.
   */
  async handle(body: unknown): Promise<unknown> {
    const b = (body ?? {}) as Record<string, unknown> & { op?: string; alpha?: string; cwd?: string }
    switch (b.op) {
      case 'gen': {
        const req: StudioRequest = {
          prompt: String(b.prompt ?? ''),
          model: typeof b.model === 'string' ? b.model : undefined,
          ratio: b.ratio as StudioRatio | undefined,
          size: b.size as StudioSize | undefined,
          refs: Array.isArray(b.refs) ? b.refs.map(String) : undefined,
          tag: typeof b.tag === 'string' ? b.tag : undefined,
          name: typeof b.name === 'string' ? b.name : undefined,
          from: 'cli',
          session: typeof b.alpha === 'string' ? b.alpha : undefined
        }
        const job = await this.generate(req, typeof b.cwd === 'string' ? b.cwd : undefined)
        return { ok: job.status === 'done', job, error: job.error }
      }
      case 'list':
        return { ok: true, jobs: this.jobs.slice(0, typeof b.limit === 'number' ? b.limit : 50) }
      case 'models':
        return { ok: true, models: await this.listModels() }
      case 'info':
        return { ok: true, ...this.info() }
      default:
        throw new Error(`studio: unknown op ${String(b.op)}; one of gen, list, models, info`)
    }
  }
}
