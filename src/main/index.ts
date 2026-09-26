import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, Notification, shell } from 'electron'
import { join } from 'node:path'
import type { DeckCommand, NewSessionRequest, SpotifyCommand, DeckSettings, Lang, Screen, StudioRequest, TranslateResult, UiEvent, VocabChange, VocabResult, WordExtra } from '@shared/types'
import { CAP, LESSON_TILES_MAX, MOL_TILES_MAX, nextLessonTile, nextMolTile, type LessonMolRun } from '@shared/types'
import { molBody } from '@shared/lesson'
import { REMOTE_PORT } from '@shared/remote'
import { resolveVariant } from '@shared/themes'
import { shellEnv } from './env'
import { Fleet } from './fleet'
import { HooksServer } from './hooks'
import { UsageTracker } from './usage'
import { buildMenu } from './menu'
import { SessionManager } from './sessions'
import { SettingsStore } from './settings'
import { Tmux } from './tmux'
import { translate } from './translate'
import { lookupVocab } from './dictionary'
import { vocabWords } from './vocabwords'
import { VocabStore } from './store'
import { ReaderBooks } from './quixote'
import { wikiBackdrop, wikiPicture, wikiSearch, wikiSummary } from './wiki'
import { weatherNow, weatherSearch } from './weather'
import { TranscriptWatcher } from './transcript'
import { homedir } from 'node:os'
import { Spotify, spotifyItems } from './spotify'
import { SpotifyApi } from './spotifyapi'
import { SpotifyAuth } from './spotifyauth'
import { setupYoutubeSession } from './youtube'
import { guardWebviews, setupWebSession, webSnap } from './webapps'
import { keepDrop, type DroppedFile } from './drops'
import { readDoc, resolveRef, toggleTask, writeDoc } from './files'
import { gitChanges, gitDiff } from './git'
import { Foxtrot } from './foxtrot'
import { RemoteServer } from './remote'
import { Wolfpack } from './pack'
import { Studio } from './studio'
import { Pokemon } from './pokemon'
import { SpriteGag } from './spritegag'
import { Mol } from './mol'
import { LessonWatch, lessonFigure, lintLessonFile, readCurriculum, readLesson } from './lesson'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { AgentTracker } from './agents'
import { Posture, registerPoseScheme } from './posture'

// Profiles keep a dev instance (npm run dev) fully separate from an installed build:
// own tmux socket, own userData, own hook port. Override with DECK_PROFILE=name.
const profile = process.env.DECK_PROFILE ?? (app.isPackaged ? 'deck' : 'deck-dev')
const HOOK_PORT = profile === 'deck' ? 47800 : 47801
// The Spotify app's registered redirect URIs: http://127.0.0.1:<port>/callback for both.
const SPOTIFY_AUTH_PORT = profile === 'deck' ? 47820 : 47821
const REMOTE_PORT_N = profile === 'deck' ? REMOTE_PORT.deck : REMOTE_PORT.other

app.setName('Deck')
// The Dock icon. A packaged build carries build/icon.icns in its bundle; under `npm run dev` the
// process is Electron's own bundle (Electron icon, "Electron" in the menu bar), so set the icon
// by hand. The menu-bar name only changes with a real bundle (`npm run dist`).
const iconPath = join(app.getAppPath(), 'build', 'icon.png')
app.setPath('userData', join(app.getPath('appData'), profile))
// The Posture tile's MediaPipe files and model (main/posture.ts): privileged schemes are declared before `ready`.
registerPoseScheme()

if (!app.requestSingleInstanceLock({ profile })) {
  app.quit()
}

let win: BrowserWindow | null = null
let manager: SessionManager | null = null
let settings: SettingsStore | null = null
let store: VocabStore | null = null
let transcripts: TranscriptWatcher | null = null
let foxtrot: Foxtrot | null = null
let remote: RemoteServer | null = null
let wolfpack: Wolfpack | null = null
let studio: Studio | null = null
let agents: AgentTracker | null = null

/** A broadcast reaches the window and, relayed by channel name, every phone (main/remote.ts). */
function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  remote?.relay(channel, args)
}

/**
 * The traffic lights sit centered on the left of the top bar, which is tall enough for
 * Foxtrot (88px; 52px compact). Keep in step with `.topbar` in styles.css.
 */
function lightsAt(s: DeckSettings): { x: number; y: number } {
  return { x: 14, y: s.compact ? 19 : 37 }
}

/** Window background = the live theme's gutter color, so resizes and boot never flash. */
function windowBackground(s: DeckSettings): string {
  return resolveVariant(s.theme, s.appearance, nativeTheme.shouldUseDarkColors).bg
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1800,
    height: 1100,
    minWidth: 640, // half a laptop screen: below 1400 the renderer drops the right column
    minHeight: 700,
    title: 'Deck',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: lightsAt(settings!.get()),
    backgroundColor: windowBackground(settings!.get()),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true, // the YouTube tile
      plugins: true // Chromium's PDF viewer, which the preview pane frames a blob URL in
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  guardWebviews(win)
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Reload the renderer, then reattach the ptys once it is listening again so every terminal repaints. */
function refreshUi(): void {
  if (!win || win.isDestroyed()) return
  win.webContents.once('did-finish-load', () => manager?.reattachAll())
  win.webContents.reload()
}

async function runCommand(cmd: DeckCommand): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!manager) return { ok: false, error: 'not ready' }
  try {
    switch (cmd.type) {
      case 'new':
        await manager.newSession({ cwd: cmd.cwd, worktree: cmd.worktree, model: cmd.model, permissionMode: cmd.permissionMode })
        break
      case 'chooseFolder': {
        const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'New session in folder' })
        if (r.canceled || r.filePaths.length === 0) break
        await manager.newSession({ cwd: r.filePaths[0], worktree: cmd.worktree, model: cmd.model, permissionMode: cmd.permissionMode })
        break
      }
      case 'resume':
        await manager.resume(cmd.id)
        break
      case 'focus':
        manager.focus(cmd.slot)
        break
      case 'cycle':
        manager.cycle(cmd.dir)
        break
      case 'jumpAttention':
        manager.jumpAttention()
        break
      case 'detach': {
        const slot = cmd.slot === -1 ? manager.getState().focusSlot : cmd.slot
        if (slot !== null) manager.detach(slot)
        break
      }
      case 'kill':
        await manager.kill(cmd.id)
        break
      case 'forget':
        manager.forget(cmd.id)
        break
      case 'refreshUi':
        refreshUi()
        break
      case 'dismissPack':
        await manager.dismissPack(cmd.alpha, !!cmd.park)
        break
      // The leash on a pack member (a subagent or a beta): main/agents.ts.
      case 'leashPause':
        agents!.pause(cmd.id, cmd.note)
        break
      case 'leashResume':
        agents!.resume(cmd.id)
        break
      case 'leashCancel':
        await agents!.cancel(cmd.id, cmd.reason)
        break
      case 'agentDismiss':
        agents!.dismiss(cmd.id, cmd.force)
        break
    }
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    send('deck:error', error)
    return { ok: false, error }
  }
}

let spotifyAuth: SpotifyAuth | null = null

function menuHandlers() {
  return {
    run: (cmd: DeckCommand) => void runCommand(cmd),
    settings: () => settings!.get(),
    patch: (p: Partial<DeckSettings>) => void settings!.update(p),
    ui: (ev: UiEvent) => send('deck:ui', ev),
    recent: () => manager?.recent() ?? [],
    spotifyAccount: () => spotifyAuth?.account() ?? null,
    spotifyConnect: () => void spotifyAuth?.connect().catch((e: Error) => send('deck:error', e.message)),
    spotifyDisconnect: () => spotifyAuth?.disconnect()
  }
}

/** The Session menu lists recent folders, so it is rebuilt when that list changes. */
let menuRecent = ''
function syncMenuRecent(recent: string[]): void {
  const key = recent.join('\0')
  if (key === menuRecent) return
  menuRecent = key
  buildMenu(menuHandlers())
}

app.whenReady().then(async () => {
  if (!app.isPackaged) app.dock?.setIcon(iconPath)
  const env = shellEnv()
  const userData = app.getPath('userData')
  settings = new SettingsStore(userData)
  // Drives the traffic lights / native dialogs, and what `system` resolves to in the renderer.
  nativeTheme.themeSource = settings.get().appearance
  settings.onChange((s) => {
    nativeTheme.themeSource = s.appearance
    win?.setBackgroundColor(windowBackground(s))
    win?.setWindowButtonPosition(lightsAt(s))
    send('settings:changed', s)
    buildMenu(menuHandlers())
    void remote?.setEnabled(s.remote)
  })
  nativeTheme.on('updated', () => settings && win?.setBackgroundColor(windowBackground(settings.get())))
  // Files that ship beside the code: tmux.conf and the plugin (package.json `extraResources`),
  // in the repo tree during dev and under the app's Resources once packaged.
  const shipped = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const tmux = new Tmux(profile, join(shipped, 'tmux.conf'), env)
  // The deck's Claude Code plugin: `--plugin-dir` on every session, so each has the wolfpack
  // skill (`/deck:wolfpack`) and DECK_WOLFPACK points at the CLI it drives (plugin/scripts/wolfpack.mjs).
  const pluginDir = join(shipped, 'plugin')

  // Foxtrot watches every session from the top bar: state and transcripts in, a running log out.
  foxtrot = new Foxtrot(userData, (e) => send('fox:entry', e))
  ipcMain.handle('fox:log', (_e, limit?: number) => foxtrot!.log(limit))

  // The Studio: Gemini image generation, a gallery under userData/studio, three doors (tile, pane, /studio).
  studio = new Studio(
    userData,
    () => {
      const k = settings!.get().geminiApiKey
      return k ? { key: k, source: 'settings' } : { key: env.GEMINI_API_KEY ?? '', source: 'env' }
    },
    () => settings!.get().studioModel,
    (jobs) => send('studio:update', jobs)
  )
  ipcMain.handle('studio:jobs', () => studio!.list())
  ipcMain.handle('studio:generate', (_e, req: StudioRequest) => studio!.generate(req ?? { prompt: '' }))
  ipcMain.handle('studio:delete', (_e, id: string) => studio!.delete(String(id ?? '')))
  ipcMain.handle('studio:models', () => studio!.listModels())
  ipcMain.handle('studio:info', () => studio!.info())

  // Pokemon: Game Boy Color emulator, ROMs + saves under userData/pokemon.
  const pokemon = new Pokemon(userData)
  ipcMain.handle('pokemon:listRoms', () => pokemon.listRoms(settings!.get().pokemonRomDir))
  ipcMain.handle('pokemon:loadRom', (_e, path: string) => pokemon.loadRom(String(path ?? '')))
  ipcMain.handle('pokemon:saveSram', (_e, name: string, data: Uint8Array) => pokemon.saveSram(String(name ?? ''), data ?? new Uint8Array()))
  ipcMain.handle('pokemon:loadSram', (_e, name: string) => pokemon.loadSram(String(name ?? '')))
  ipcMain.handle('pokemon:saveState', (_e, name: string, slot: number | string, data: Uint8Array) => pokemon.saveState(String(name ?? ''), slot ?? 0, data ?? new Uint8Array()))
  ipcMain.handle('pokemon:loadState', (_e, name: string, slot: number | string) => pokemon.loadState(String(name ?? ''), slot ?? 0))
  ipcMain.handle('pokemon:shot', (_e, bytes: Uint8Array) => pokemon.shot(bytes ?? new Uint8Array()))
  // Web apps: a tile's snapshot of its own webview.
  ipcMain.handle('web:snap', (_e, id: number) => webSnap(id))
  // The trainer's door: a POST /gameboy on the hooks server becomes a request to the renderer's
  // emulator (the one on the Pokemon tile) and its answer comes back on gameboy:reply.
  const gbPending = new Map<string, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>()
  const gameboyCall = (body: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (!win || win.isDestroyed()) return reject(new Error('no window'))
      const id = randomUUID()
      const b = (body ?? {}) as Record<string, unknown>
      const long = b.op === 'hold' || b.op === 'settle'
      const budget = long ? 30_000 + Number(b.iterations ?? b.max ?? 0) * 12 : 15_000
      const timer = setTimeout(() => {
        gbPending.delete(id)
        reject(new Error(long ? 'the Game Boy did not answer in time' : 'no Game Boy listening: turn on the Pokemon tile (a mini app in the + picker) and pick a ROM'))
      }, budget)
      gbPending.set(id, { resolve, timer })
      send('gameboy:req', { id, body: b })
    })
  ipcMain.on('gameboy:reply', (_e, id: string, result: unknown) => {
    const p = gbPending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    gbPending.delete(id)
    p.resolve(result)
  })

  // The Molecule tile: main resolves structures (the renderer may not fetch), the renderer's viewer shows them.
  const mol = new Mol(userData)
  ipcMain.handle('mol:resolve', (_e, target: string) => mol.resolve(String(target ?? '')))
  ipcMain.handle('mol:library', () => mol.library())
  ipcMain.handle('mol:shot', (_e, bytes: Uint8Array, tile?: number) => mol.shot(bytes ?? new Uint8Array(), Number(tile) || 1))
  // Its door: a POST /mol on the hooks server. `list` is main's own; for the rest any structure is
  // resolved FIRST (fetched or read from the cache) and rides along to the renderer's viewer,
  // whose answer comes back on mol:reply. THERE ARE SEVERAL MOLECULE TILES (`molTiles`) and main
  // picks the one a request is for: `tile` (--tile n), `new` (--new: the first EMPTY tile, else
  // one more, up to MOL_TILES_MAX), else the last one the door used. `close` takes one away.
  const MOL_OFF = 'no Molecule tile listening: turn on the Molecule tile (a mini app in the + picker, or View ▸ Molecule ▸ Show Molecule Tile) and run this again'
  const molPending = new Map<string, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>()
  let molLast = 0
  // Tiles a `--new` has taken and not yet filled: several `--new` at once must not all land on the same empty tile.
  const molClaimed = new Set<number>()
  const molAsk = (b: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = randomUUID()
      // A surface over a whole protein is computed on the renderer's thread: give it room.
      const timer = setTimeout(() => {
        molPending.delete(id)
        reject(new Error(MOL_OFF))
      }, 45_000)
      molPending.set(id, { resolve, timer })
      send('mol:req', { id, body: b })
    })
  const molCall = async (body: unknown): Promise<unknown> => {
    const b = { ...((body ?? {}) as Record<string, unknown>) }
    if (b.op === 'list') return { ok: true, ...mol.list() }
    if (!win || win.isDestroyed()) throw new Error('no window')
    if (!settings!.get().showMol) throw new Error(MOL_OFF)
    const tiles = () => settings!.get().molTiles
    const current = () => (tiles().includes(molLast) ? molLast : tiles()[0])
    if (b.op === 'tiles') return { ...((await molAsk({ op: 'tiles', tiles: tiles() })) as object), current: current(), max: MOL_TILES_MAX }
    if (b.op === 'show') b.structures = [await mol.resolve(String(b.target ?? ''))]
    if (b.op === 'compare') b.structures = await Promise.all([mol.resolve(String(b.a ?? '')), mol.resolve(String(b.b ?? ''))])
    let n: number
    if (b.tile != null && b.tile !== '') {
      n = Number(b.tile)
      if (!tiles().includes(n)) throw new Error(`there is no Molecule tile ${String(b.tile)}: the tiles are ${tiles().join(', ')} (\`tiles\` says what each shows; \`show <target> --new\` opens another)`)
    } else if (b.new) {
      const all = ((await molAsk({ op: 'tiles', tiles: tiles() })) as { tiles?: { tile: number; empty: boolean }[] }).tiles ?? []
      const free = all.find((t) => t.empty && !molClaimed.has(t.tile))?.tile ?? nextMolTile(tiles())
      if (free == null) throw new Error(`${MOL_TILES_MAX} Molecule tiles is the most (each holds a WebGL context): reuse one with --tile <n>, or \`close --tile <n>\` first. \`tiles\` says what each shows`)
      if (!tiles().includes(free)) settings!.update({ molTiles: [...tiles(), free] })
      n = free
      molClaimed.add(n)
    } else n = current()
    if (b.op === 'close') {
      // The last tile is only emptied: the door always has somewhere to show.
      if (tiles().length === 1) return { ...((await molAsk({ op: 'clear', tile: n })) as object), note: `tile ${n} is the only Molecule tile, so it was emptied rather than closed` }
      settings!.update({ molTiles: tiles().filter((t) => t !== n) })
      return { ok: true, closed: n, tiles: tiles() }
    }
    molLast = n
    return molAsk({ ...b, tile: n }).finally(() => molClaimed.delete(n))
  }
  ipcMain.on('mol:reply', (_e, id: string, result: unknown) => {
    const p = molPending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    molPending.delete(id)
    p.resolve(result)
  })

  // The Lesson tile: lessons are files of the learner's repo, read (and watched) here; the renderer parses and shows them.
  const lessonWatch = new LessonWatch((f) => send('lesson:changed', f))
  ipcMain.handle('lesson:read', (_e, file: string) => readLesson(String(file ?? '')))
  ipcMain.handle('lesson:figure', (_e, file: string, src: string) => lessonFigure(String(file ?? ''), String(src ?? '')))
  ipcMain.on('lesson:watch', (_e, files: string[]) => lessonWatch.sync(Array.isArray(files) ? files : []))
  // A lesson's mol button: its lines through molCall — THE SAME PATH as `POST /mol` — in order. A
  // file target is relative to the lesson; a `--new` button reuses the tile it opened last time
  // (pressing it twice must not open two).
  const lessonMolTiles = new Map<string, number>()
  ipcMain.handle('lesson:mol', async (_e, run: LessonMolRun) => {
    let tile: number | null = null
    try {
      const lines = Array.isArray(run?.lines) ? run.lines.map(String) : []
      let fresh = run?.fresh === true
      for (let i = 0; i < lines.length; i++) {
        const parsed = molBody(lines[i])
        if ('error' in parsed) throw new Error(`\`${lines[i]}\`: ${parsed.error}`)
        const b = parsed.body
        for (const k of ['target', 'a', 'b']) {
          const t = b[k]
          if (typeof t !== 'string' || isAbsolute(t) || t.startsWith('~')) continue
          const abs = resolvePath(dirname(String(run.file ?? '')), t)
          if ((/\.(pdb|ent|cif|mmcif|sdf|mol|mol2|xyz|cube)$/i.test(t) || t.startsWith('./') || t.startsWith('../')) && existsSync(abs)) b[k] = abs
        }
        if (b.tile == null && run.tile != null) b.tile = run.tile
        if (fresh && b.tile == null && (b.op === 'show' || b.op === 'compare')) b.new = true
        // A --new this button has used before goes back to the tile it opened then, if that is still there.
        const key = `${String(run.key)}#${i}`
        const opens = b.new === true
        if (opens) {
          fresh = false
          const had = lessonMolTiles.get(key)
          if (had !== undefined && settings!.get().molTiles.includes(had)) Object.assign(b, { new: false, tile: had })
        }
        const r = (await molCall(b)) as { ok?: boolean; error?: string; tile?: number }
        if (r?.ok === false) throw new Error(`\`${lines[i]}\`: ${r.error ?? 'the Molecule tile refused'}`)
        if (typeof r?.tile === 'number') {
          tile = r.tile
          if (opens) lessonMolTiles.set(key, r.tile)
        }
      }
      return { ok: true, tile }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // Its door: a POST /lesson on the hooks server (the /mol plan). `lint` is main's own and needs no
  // tile; for the rest the file is READ FIRST and its text rides along to lib/lesson.ts, whose
  // answer comes back on lesson:reply. Main picks the tile: `tile` (--tile n), `new` (--new: the
  // first tile at HOME, else one more, up to LESSON_TILES_MAX), else the last one the door used.
  const LESSON_OFF = 'no Lesson tile listening: turn on the Lesson tile (a mini app in the right column\'s + picker, or View ▸ Lesson ▸ Show Lesson Tile) and run this again'
  const lessonPending = new Map<string, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>()
  let lessonLast = 0
  const lessonAsk = (b: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        lessonPending.delete(id)
        reject(new Error(LESSON_OFF))
      }, 10_000)
      lessonPending.set(id, { resolve, timer })
      send('lesson:req', { id, body: b })
    })
  const lessonCall = async (body: unknown): Promise<unknown> => {
    const b = { ...((body ?? {}) as Record<string, unknown>) }
    if (b.op === 'lint') return lintLessonFile(String(b.file ?? ''))
    if (!win || win.isDestroyed()) throw new Error('no window')
    if (!settings!.get().showLesson) throw new Error(LESSON_OFF)
    const tiles = () => settings!.get().lessonTiles
    const current = () => (tiles().includes(lessonLast) ? lessonLast : tiles()[0])
    if (b.op === 'tiles') return { ...((await lessonAsk({ op: 'tiles', tiles: tiles() })) as object), current: current(), max: LESSON_TILES_MAX }
    if (b.op === 'show') Object.assign(b, await readLesson(String(b.file ?? '')))
    let n: number
    if (b.tile != null && b.tile !== '') {
      n = Number(b.tile)
      if (!tiles().includes(n)) throw new Error(`there is no Lesson tile ${String(b.tile)}: the tiles are ${tiles().join(', ')} (\`tiles\` says what each shows; \`show <file.md> --new\` opens another)`)
    } else if (b.new) {
      const all = ((await lessonAsk({ op: 'tiles', tiles: tiles() })) as { tiles?: { tile: number; empty: boolean }[] }).tiles ?? []
      const free = all.find((t) => t.empty)?.tile ?? nextLessonTile(tiles())
      if (free == null) throw new Error(`${LESSON_TILES_MAX} Lesson tiles is the most: reuse one with --tile <n>, or \`close --tile <n>\` first. \`tiles\` says what each shows`)
      if (!tiles().includes(free)) settings!.update({ lessonTiles: [...tiles(), free] })
      n = free
    } else n = current()
    if (b.op === 'close') {
      // The last tile only goes home: the door always has somewhere to show.
      if (tiles().length === 1) return { ...((await lessonAsk({ op: 'home', tile: n })) as object), note: `tile ${n} is the only Lesson tile, so it went back to the curriculum rather than closing` }
      settings!.update({ lessonTiles: tiles().filter((t) => t !== n) })
      return { ok: true, closed: n, tiles: tiles() }
    }
    lessonLast = n
    return lessonAsk({ ...b, tile: n })
  }
  ipcMain.on('lesson:reply', (_e, id: string, result: unknown) => {
    const p = lessonPending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    lessonPending.delete(id)
    p.resolve(result)
  })

  // The trainer's CLI: DECK_TRAINER in every session's env, and what the sprite gag runs below.
  const trainerScript = join(pluginDir, 'scripts', 'trainer.mjs')
  // The hooks server is also the wolfpack's door: a session inside the deck POSTs /pack to spawn betas.
  const hooks = new HooksServer(
    HOOK_PORT,
    userData,
    profile,
    join(pluginDir, 'scripts', 'wolfpack.mjs'),
    join(pluginDir, 'scripts', 'studio.mjs'),
    trainerScript,
    join(pluginDir, 'scripts', 'mol.mjs'),
    (event, payload) => {
      manager?.onHook(event, payload)
      agents?.onHook(event, payload)
    },
    (body) => (wolfpack ? wolfpack.handle(body) : Promise.reject(new Error('not ready'))),
    (body) => (studio ? studio.handle(body) : Promise.reject(new Error('not ready'))),
    (body) => gameboyCall(body),
    (body) => molCall(body),
    // Every tool call asks the leash (a paused member waits, a cancelled one is refused): main/agents.ts.
    (payload, gone) => (agents ? agents.onPreTool(payload, gone) : Promise.resolve(null))
  )
  hooks.onLesson = (body) => lessonCall(body)
  // The preview pane's door: `$DECK_DOC open <path> [--line N]` (plugin/scripts/doc.mjs) — a file
  // the user should read or edit opens here instead of in whatever app macOS would pick.
  hooks.onDoc = async (body) => {
    const b = (body ?? {}) as { op?: unknown; path?: unknown; line?: unknown }
    if (b.op !== 'open') throw new Error(`unknown op “${String(b.op)}”: the door knows \`open\``)
    if (typeof b.path !== 'string' || !isAbsolute(b.path)) throw new Error('open wants an absolute path')
    if (!win || win.isDestroyed()) throw new Error('no window')
    const doc = await readDoc(b.path)
    if (doc.kind === 'missing') throw new Error(`no such file: ${doc.path}`)
    const line = Number.isInteger(b.line) && (b.line as number) > 0 ? (b.line as number) : null
    send('doc:open', { path: doc.path, line })
    if (win.isMinimized()) win.restore()
    win.show()
    return { ok: true, path: doc.path, kind: doc.kind, editable: (doc.kind === 'text' || doc.kind === 'markdown') && !doc.truncated, ...(line ? { line } : {}), ...(doc.note ? { note: doc.note } : {}) }
  }
  await hooks.start()

  // The sprite gag: `trainer.mjs sprite watch` as a child of main, following the `spriteGag`
  // setting (the Pokemon pane's `gag` button, View ▸ Pokemon ▸ Village vs Notes). It talks back
  // to the renderer's Game Boy through /gameboy, so the hooks server is up first.
  const spriteGag = new SpriteGag(trainerScript, HOOK_PORT)
  spriteGag.sync(settings.get())
  settings.onChange((s) => spriteGag.sync(s))

  manager = new SessionManager({
    tmux,
    env,
    userDataDir: userData,
    hooksSettingsPath: hooks.settingsPath,
    pluginDir,
    profile,
    defaults: () => {
      const s = settings!.get()
      return { cwd: s.defaultCwd, worktree: s.worktreeByDefault, model: s.defaultModel }
    },
    // The grid pages, so plugin and wolfpack member tiles never cost a slot: the cap is the hard one.
    cap: () => CAP,
    events: {
      state: (state) => {
        send('deck:state', state)
        syncMenuRecent(state.recent)
        transcripts?.sync(state.open)
        foxtrot?.onState(state)
        agents?.onState(state)
      },
      data: (id, data) => send('pty:data', id, data),
      exit: (id) => send('pty:exit', id)
    }
  })

  wolfpack = new Wolfpack(manager, tmux, () => transcripts, () => agents)

  // Grid tiles show the conversation itself, tailed from Claude Code's transcript files.
  const projectsDir = join(env.CLAUDE_CONFIG_DIR || join(env.HOME ?? homedir(), '.claude'), 'projects')
  transcripts = new TranscriptWatcher(projectsDir, (t) => {
    send('transcript:update', t)
    foxtrot?.onTranscript(t)
    agents?.onTranscript(t)
  })
  ipcMain.handle('transcript:get', (_e, id: string) => transcripts!.get(String(id ?? '')))
  // Subagents (SubagentStart / SubagentStop hooks) become tiles of their own, after the sessions.
  agents = new AgentTracker(manager, projectsDir, () => transcripts, (list) => send('agents:update', list))
  ipcMain.handle('agents:list', () => agents!.list())
  // Usage for the header: every session's status line reports to /status (main/usage.ts).
  const usage = new UsageTracker(join(userData, 'usage.json'), (sid) => manager?.find({ claudeSessionId: sid })?.id ?? null, (u) => send('usage:update', u))
  hooks.onStatus = (body) => usage.onStatus(body)
  ipcMain.handle('usage:get', () => usage.get())

  ipcMain.handle('deck:getState', () => manager!.getState())
  // A dropped file that lives in a temp dir (a screenshot thumbnail, a promised file) is copied somewhere that lasts.
  ipcMain.handle('drop:keep', (_e, file: DroppedFile) => keepDrop(userData, file))
  ipcMain.handle('deck:command', (_e, cmd: DeckCommand) => runCommand(cmd))
  ipcMain.handle('session:new', async (_e, req: NewSessionRequest) => {
    if (!manager) throw new Error('not ready')
    const r = req ?? {}
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
    const rec = await manager.newSession({
      cwd: str(r.cwd),
      worktree: typeof r.worktree === 'boolean' ? r.worktree : undefined,
      model: typeof r.model === 'string' ? r.model : undefined,
      name: str(r.name),
      prompt: str(r.prompt),
      permissionMode: str(r.permissionMode),
      create: r.create === true,
      gitInit: r.gitInit === true,
      focus: r.focus !== false
    })
    return { id: rec.id, slot: rec.slot }
  })
  // The launcher's folder pickers: they only answer, the form keeps the pick.
  ipcMain.handle('deck:chooseDir', async (_e, title: unknown) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: typeof title === 'string' && title ? title : 'Choose a folder' })
    return r.canceled || r.filePaths.length === 0 ? '' : r.filePaths[0]
  })
  ipcMain.on('pty:input', (_e, id: string, data: string) => manager?.input(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => manager?.resize(id, cols, rows))
  ipcMain.on('deck:setTitle', (_e, id: string, title: string) => manager?.setTitle(id, title))
  ipcMain.on('deck:bell', (_e, id: string) => manager?.bell(id))

  ipcMain.handle('settings:get', () => settings!.get())
  ipcMain.handle('settings:set', (_e, patch: Partial<DeckSettings>) => settings!.update(patch ?? {}))
  ipcMain.handle('settings:chooseDefaultCwd', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Default folder for new sessions' })
    return r.canceled || r.filePaths.length === 0 ? '' : r.filePaths[0]
  })

  ipcMain.handle('wiki:picture', (_e, when: unknown) => wikiPicture(when === 'past' ? 'past' : 'today'))
  ipcMain.handle('wiki:backdrop', (_e, date: unknown) => wikiBackdrop(typeof date === 'string' ? date : '', join(app.getPath('userData'), 'glass')))
  ipcMain.handle('wiki:search', (_e, q: string) => wikiSearch(String(q ?? '')))
  ipcMain.handle('wiki:summary', (_e, key: string) => wikiSummary(String(key ?? '')))
  ipcMain.handle('weather:now', () => weatherNow(settings!.get().weatherPlaces, settings!.get().weatherUnit))
  ipcMain.handle('weather:search', (_e, q: string) => weatherSearch(String(q ?? '')))
  const translateKey = () => settings!.get().translateApiKey || env.GOOGLE_CLOUD_API_KEY || ''
  ipcMain.handle('translate:run', (_e, text: string, hint: Lang, fixed?: boolean) => translate(text, hint, translateKey(), fixed === true))
  ipcMain.handle('vocab:lookup', (_e, word: string, hint: Lang, counterpart?: string) => lookupVocab(word, hint, translateKey(), counterpart))
  store = new VocabStore(userData)
  // Liked words ride along with the user's own languagelog words: front of the queue, every pass.
  ipcMain.handle('vocab:words', () => vocabWords(settings!.get().languagelogDb, env, store!.likedWords()))
  // Every write is told to every tile (`vocab:changed`), so the translator, the vocabulary tile's
  // three faces and the reader's marks stay one store however a word got in.
  const changed = <T,>(c: VocabChange, v: T): T => (send('vocab:changed', c), v)
  ipcMain.handle('store:translation', (_e, r: TranslateResult, supersede: number | null) =>
    changed({ kind: 'translation', liked: false }, store!.saveTranslation(r, supersede ?? null))
  )
  ipcMain.handle('store:word', (_e, r: VocabResult, translationId: number | null, extra?: WordExtra) =>
    changed({ kind: 'word', liked: !!extra?.liked }, store!.saveWord(r, translationId ?? null, extra && typeof extra === 'object' ? extra : {}))
  )
  ipcMain.handle('store:liked', (_e, id: number, liked: boolean) => changed({ kind: 'liked', liked: true }, store!.setLiked(id, !!liked)))
  ipcMain.handle('store:forms', () => store!.savedForms())
  ipcMain.handle('store:deck', (_e, limit?: number) => store!.deck(limit))
  ipcMain.handle('store:list', (_e, limit?: number) => store!.list(limit))
  ipcMain.handle('store:grade', (_e, id: number, grade: number) => changed({ kind: 'grade', liked: false }, store!.gradeWord(id, grade)))
  const books = new ReaderBooks(userData)
  ipcMain.handle('quixote:index', (_e, book: unknown) => books.index(book))
  ipcMain.handle('quixote:section', (_e, book: unknown, i: number) => books.section(book, Number(i)))
  // The Posture tile: MediaPipe's files over `pose:`, the camera prompt, full-speed timers while it
  // watches, and its one alert — ten seconds of slouching — as a Foxtrot bark and a macOS notification.
  const posture = new Posture(userData)
  posture.serve()
  ipcMain.handle('posture:camera', () => posture.camera())
  ipcMain.on('posture:tracking', (_e, on: boolean) => win?.webContents.setBackgroundThrottling(!on))
  ipcMain.on('posture:alert', (_e, text: string) => {
    const body = String(text ?? '').slice(0, 200)
    if (!body) return
    foxtrot?.external('posture', body)
    if (!Notification.isSupported()) return
    const n = new Notification({ title: 'Sit up straight', body, silent: settings!.get().foxBark })
    n.on('click', () => {
      win?.show()
      win?.focus()
    })
    n.show()
  })
  ipcMain.handle('store:stats', () => store!.stats())
  ipcMain.on('deck:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  // A referenced file, for the preview pane over the grid: read it here, and let macOS open
  // or reveal it (a PDF lands in Preview, everything else in whatever owns the type).
  ipcMain.handle('file:read', (_e, ref: string, cwd?: string) => readDoc(String(ref ?? ''), typeof cwd === 'string' ? cwd : undefined))
  // …and writes it back, for the pane's edit mode and its checkboxes: see files.ts for the rules (the mtime read is the lock).
  ipcMain.handle('file:write', (_e, path: string, text: string, mtime: number) => writeDoc(String(path ?? ''), String(text ?? ''), Number(mtime)))
  ipcMain.handle('file:task', (_e, path: string, line: number, checked: boolean, mtime: number) => toggleTask(String(path ?? ''), Math.max(0, Math.floor(Number(line) || 0)), !!checked, Number(mtime)))
  ipcMain.handle('file:open', async (_e, path: string) => shell.openPath(resolveRef(String(path ?? ''))))
  ipcMain.on('file:reveal', (_e, path: string) => shell.showItemInFolder(resolveRef(String(path ?? ''))))
  ipcMain.on('file:copy', (_e, text: string) => clipboard.writeText(String(text ?? '')))

  // The phone: the session's terminal as tmux has it, read without attaching (the size stays the desktop's).
  const screen = async (id: string): Promise<Screen> => {
    const name = manager?.tmuxNameOf(id)
    const cap = name ? await tmux.screen(name) : null
    return cap ? { id, ...cap, gone: false } : { id, text: '', cols: 0, rows: 0, gone: true }
  }
  ipcMain.handle('tmux:screen', (_e, id: string) => screen(String(id ?? '')))

  // The changes tile: the focused session's working tree. The pane's own folder is asked first, so
  // a --worktree session reads its worktree, not the folder it was started from.
  ipcMain.handle('git:changes', async (_e, id: string) => {
    const sid = String(id ?? '')
    const name = manager?.tmuxNameOf(sid)
    const cwd = (name ? await tmux.paneCwd(name) : null) ?? manager?.cwdOf(sid) ?? settings!.get().defaultCwd
    return gitChanges(cwd, env)
  })
  // The Lesson tile's home view: curriculum.json of the focused session's folder, found the way the changes tile finds its tree.
  ipcMain.handle('lesson:curriculum', async (_e, id: string | null, fallback?: string) => {
    const sid = String(id ?? '')
    const name = sid ? manager?.tmuxNameOf(sid) : undefined
    const cwd = sid ? ((name ? await tmux.paneCwd(name) : null) ?? manager?.cwdOf(sid) ?? null) : null
    const here = cwd ? await readCurriculum(cwd) : null
    if (here?.data || here?.error || typeof fallback !== 'string' || !isAbsolute(fallback)) return here ?? { dir: '', data: null }
    const there = await readCurriculum(fallback)
    return there.data ? there : here
  })
  ipcMain.handle('git:diff', (_e, repo: string, path: string, untracked: boolean) => gitDiff(String(repo ?? ''), String(path ?? ''), !!untracked, env))

  // The phone page and its socket, on the tailnet / LAN only, token-gated (main/remote.ts).
  remote = new RemoteServer({
    port: REMOTE_PORT_N,
    userDataDir: userData,
    profile,
    staticDir: join(__dirname, '../renderer'),
    iconPath,
    devUrl: process.env.ELECTRON_RENDERER_URL,
    input: (id, data) => manager?.input(id, data),
    call: async (method, args) => {
      switch (method) {
        case 'getState':
          return manager!.getState()
        case 'command':
          return runCommand(args[0] as DeckCommand)
        case 'getTranscript':
          return transcripts!.get(String(args[0] ?? ''))
        case 'getSettings':
          return settings!.get()
        case 'setSettings':
          return settings!.update((args[0] as Partial<DeckSettings>) ?? {})
        case 'readDoc':
          return readDoc(String(args[0] ?? ''), typeof args[1] === 'string' ? args[1] : undefined)
        case 'foxLog':
          return foxtrot!.log(typeof args[0] === 'number' ? args[0] : undefined)
        case 'screen':
          return screen(String(args[0] ?? ''))
        case 'openPath':
          return shell.openPath(resolveRef(String(args[0] ?? '')))
        case 'agents':
          return agents!.list()
      }
    }
  })
  ipcMain.handle('remote:info', () => remote!.info())
  if (settings.get().remote) await remote.start()

  setupYoutubeSession()
  setupWebSession()
  // Spotify.app over AppleScript, polled only while the music tile shows that face.
  const spotify = new Spotify(env, (state) => send('spotify:state', state))
  const spotifyWanted = (s: DeckSettings) => s.showMusic && !s.compact && s.music === 'spotify'
  ipcMain.handle('spotify:getState', () => spotify.state)
  ipcMain.on('spotify:command', (_e, cmd: SpotifyCommand) => void spotify.command(cmd))
  ipcMain.on('spotify:play', (_e, uri: string) => {
    spotifyApi.invalidate()
    void spotify.play(String(uri ?? ''))
  })
  ipcMain.handle('spotify:items', () => spotifyItems(settings!.get().spotifyPlaylists))
  spotify.setActive(spotifyWanted(settings.get()))
  settings.onChange((s) => spotify.setActive(spotifyWanted(s)))
  // The account: PKCE tokens in userData/spotify.json, the library and search through the Web API.
  const auth = new SpotifyAuth(userData, SPOTIFY_AUTH_PORT, () => settings!.get().spotifyClientId, (a) => {
    if (!a.connected) spotifyApi.forget()
    send('spotify:account', a)
    buildMenu(menuHandlers())
  })
  spotifyAuth = auth
  const spotifyApi = new SpotifyApi(auth)
  ipcMain.handle('spotify:getAccount', () => auth.account())
  ipcMain.handle('spotify:connect', () => auth.connect())
  ipcMain.on('spotify:disconnect', () => auth.disconnect())
  ipcMain.handle('spotify:library', () => spotifyApi.libraryOf())
  ipcMain.handle('spotify:search', (_e, q: string) => spotifyApi.search(String(q ?? '')))
  buildMenu(menuHandlers())
  createWindow()
  await manager.init()

  const fleet = new Fleet(env, (entries) => manager?.onFleet(entries))
  fleet.start()

  app.on('before-quit', () => {
    fleet.stop()
    spotify.stop()
    spriteGag.stop()
    hooks.stop()
    lessonWatch.stop()
    remote?.stop()
    foxtrot?.stop()
    manager?.detachAll()
    store?.close()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
