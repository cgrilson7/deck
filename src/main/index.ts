import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { DeckCommand, DeckSettings, Lang, Screen, TranslateResult, UiEvent, VocabResult } from '@shared/types'
import { CAP } from '@shared/types'
import { REMOTE_PORT } from '@shared/remote'
import { resolveVariant } from '@shared/themes'
import { shellEnv } from './env'
import { Fleet } from './fleet'
import { HooksServer } from './hooks'
import { buildMenu } from './menu'
import { SessionManager } from './sessions'
import { SettingsStore } from './settings'
import { Tmux } from './tmux'
import { translate } from './translate'
import { lookupVocab } from './dictionary'
import { vocabWords } from './vocabwords'
import { VocabStore } from './store'
import { wikiPicture, wikiSearch, wikiSummary } from './wiki'
import { TranscriptWatcher } from './transcript'
import { homedir } from 'node:os'
import { setupYoutubeSession } from './youtube'
import { keepDrop, type DroppedFile } from './drops'
import { readDoc, resolveRef } from './files'
import { gitChanges, gitDiff } from './git'
import { Foxtrot } from './foxtrot'
import { RemoteServer } from './remote'

// Profiles keep a dev instance (npm run dev) fully separate from an installed build:
// own tmux socket, own userData, own hook port. Override with DECK_PROFILE=name.
const profile = process.env.DECK_PROFILE ?? (app.isPackaged ? 'deck' : 'deck-dev')
const HOOK_PORT = profile === 'deck' ? 47800 : 47801
const REMOTE_PORT_N = profile === 'deck' ? REMOTE_PORT.deck : REMOTE_PORT.other

app.setName('Deck')
// The Dock icon. A packaged build carries build/icon.icns in its bundle; under `npm run dev` the
// process is Electron's own bundle (Electron icon, "Electron" in the menu bar), so set the icon
// by hand. The menu-bar name only changes with a real bundle (`npm run dist`).
const iconPath = join(app.getAppPath(), 'build', 'icon.png')
app.setPath('userData', join(app.getPath('appData'), profile))

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
    minWidth: 1100,
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
        await manager.newSession({ cwd: cmd.cwd, worktree: cmd.worktree })
        break
      case 'chooseFolder': {
        const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'New session in folder' })
        if (r.canceled || r.filePaths.length === 0) break
        await manager.newSession({ cwd: r.filePaths[0], worktree: cmd.worktree })
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
    }
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    send('deck:error', error)
    return { ok: false, error }
  }
}

function menuHandlers() {
  return {
    run: (cmd: DeckCommand) => void runCommand(cmd),
    settings: () => settings!.get(),
    patch: (p: Partial<DeckSettings>) => void settings!.update(p),
    ui: (ev: UiEvent) => send('deck:ui', ev),
    recent: () => manager?.recent() ?? []
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
  const tmux = new Tmux(profile, join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'tmux.conf'), env)

  // Foxtrot watches every session from the top bar: state and transcripts in, a running log out.
  foxtrot = new Foxtrot(userData, (e) => send('fox:entry', e))
  ipcMain.handle('fox:log', (_e, limit?: number) => foxtrot!.log(limit))

  const hooks = new HooksServer(HOOK_PORT, userData, (event, payload) => manager?.onHook(event, payload))
  await hooks.start()

  manager = new SessionManager({
    tmux,
    env,
    userDataDir: userData,
    hooksSettingsPath: hooks.settingsPath,
    profile,
    defaults: () => {
      const s = settings!.get()
      return { cwd: s.defaultCwd, worktree: s.worktreeByDefault }
    },
    // The changes, vocabulary and translator tiles each take a grid cell, so each costs a session slot while shown.
    cap: () => {
      const s = settings!.get()
      return CAP - Number(s.showTranslate) - Number(s.showVocab) - Number(s.showGit)
    },
    events: {
      state: (state) => {
        send('deck:state', state)
        syncMenuRecent(state.recent)
        transcripts?.sync(state.open)
        foxtrot?.onState(state)
      },
      data: (id, data) => send('pty:data', id, data),
      exit: (id) => send('pty:exit', id)
    }
  })

  // Grid tiles show the conversation itself, tailed from Claude Code's transcript files.
  transcripts = new TranscriptWatcher(join(env.CLAUDE_CONFIG_DIR || join(env.HOME ?? homedir(), '.claude'), 'projects'), (t) => {
    send('transcript:update', t)
    foxtrot?.onTranscript(t)
  })
  ipcMain.handle('transcript:get', (_e, id: string) => transcripts!.get(String(id ?? '')))

  ipcMain.handle('deck:getState', () => manager!.getState())
  // A dropped file that lives in a temp dir (a screenshot thumbnail, a promised file) is copied somewhere that lasts.
  ipcMain.handle('drop:keep', (_e, file: DroppedFile) => keepDrop(userData, file))
  ipcMain.handle('deck:command', (_e, cmd: DeckCommand) => runCommand(cmd))
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
  ipcMain.handle('wiki:search', (_e, q: string) => wikiSearch(String(q ?? '')))
  ipcMain.handle('wiki:summary', (_e, key: string) => wikiSummary(String(key ?? '')))
  const translateKey = () => settings!.get().translateApiKey || env.GOOGLE_CLOUD_API_KEY || ''
  ipcMain.handle('translate:run', (_e, text: string, hint: Lang) => translate(text, hint, translateKey()))
  ipcMain.handle('vocab:lookup', (_e, word: string, hint: Lang, counterpart?: string) => lookupVocab(word, hint, translateKey(), counterpart))
  store = new VocabStore(userData)
  // Liked words ride along with the user's own languagelog words: front of the queue, every pass.
  ipcMain.handle('vocab:words', () => vocabWords(settings!.get().languagelogDb, env, store!.likedWords()))
  ipcMain.handle('store:translation', (_e, r: TranslateResult, supersede: number | null) => store!.saveTranslation(r, supersede ?? null))
  ipcMain.handle('store:word', (_e, r: VocabResult, translationId: number | null) => store!.saveWord(r, translationId ?? null))
  ipcMain.handle('store:liked', (_e, id: number, liked: boolean) => store!.setLiked(id, !!liked))
  ipcMain.handle('store:deck', (_e, limit?: number) => store!.deck(limit))
  ipcMain.handle('store:list', (_e, limit?: number) => store!.list(limit))
  ipcMain.handle('store:grade', (_e, id: number, grade: number) => store!.gradeWord(id, grade))
  ipcMain.handle('store:stats', () => store!.stats())
  ipcMain.on('deck:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  // A referenced file, for the preview pane over the grid: read it here, and let macOS open
  // or reveal it (a PDF lands in Preview, everything else in whatever owns the type).
  ipcMain.handle('file:read', (_e, ref: string, cwd?: string) => readDoc(String(ref ?? ''), typeof cwd === 'string' ? cwd : undefined))
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
      }
    }
  })
  ipcMain.handle('remote:info', () => remote!.info())
  if (settings.get().remote) await remote.start()

  setupYoutubeSession()
  buildMenu(menuHandlers())
  createWindow()
  await manager.init()

  const fleet = new Fleet(env, (entries) => manager?.onFleet(entries))
  fleet.start()

  app.on('before-quit', () => {
    fleet.stop()
    hooks.stop()
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
