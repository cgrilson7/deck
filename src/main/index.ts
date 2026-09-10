import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { DeckCommand, DeckSettings, Lang, TranslateResult, UiEvent, VocabResult } from '@shared/types'
import { CAP } from '@shared/types'
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

// Profiles keep a dev instance (npm run dev) fully separate from an installed build:
// own tmux socket, own userData, own hook port. Override with DECK_PROFILE=name.
const profile = process.env.DECK_PROFILE ?? (app.isPackaged ? 'deck' : 'deck-dev')
const HOOK_PORT = profile === 'deck' ? 47800 : 47801

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

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
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
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: windowBackground(settings!.get()),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true // the YouTube tile
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
    send('settings:changed', s)
    buildMenu(menuHandlers())
  })
  nativeTheme.on('updated', () => settings && win?.setBackgroundColor(windowBackground(settings.get())))
  const tmux = new Tmux(profile, join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'tmux.conf'), env)

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
    // The vocabulary and translator tiles each take a grid cell, so each costs a session slot while shown.
    cap: () => {
      const s = settings!.get()
      return CAP - Number(s.showTranslate) - Number(s.showVocab)
    },
    events: {
      state: (state) => {
        send('deck:state', state)
        syncMenuRecent(state.recent)
        transcripts?.sync(state.open)
      },
      data: (id, data) => send('pty:data', id, data),
      exit: (id) => send('pty:exit', id)
    }
  })

  // Grid tiles show the conversation itself, tailed from Claude Code's transcript files.
  transcripts = new TranscriptWatcher(join(env.CLAUDE_CONFIG_DIR || join(env.HOME ?? homedir(), '.claude'), 'projects'), (t) => send('transcript:update', t))
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
  ipcMain.handle('store:stats', () => store!.stats())
  ipcMain.on('deck:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  setupYoutubeSession()
  buildMenu(menuHandlers())
  createWindow()
  await manager.init()

  const fleet = new Fleet(env, (entries) => manager?.onFleet(entries))
  fleet.start()

  app.on('before-quit', () => {
    fleet.stop()
    hooks.stop()
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
