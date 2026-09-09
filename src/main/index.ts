import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DeckCommand } from '@shared/types'
import { shellEnv } from './env'
import { Fleet } from './fleet'
import { HooksServer } from './hooks'
import { buildMenu } from './menu'
import { SessionManager } from './sessions'
import { Tmux } from './tmux'

// Profiles keep a dev instance (npm run dev) fully separate from an installed build:
// own tmux socket, own userData, own hook port. Override with DECK_PROFILE=name.
const profile = process.env.DECK_PROFILE ?? (app.isPackaged ? 'deck' : 'deck-dev')
const HOOK_PORT = profile === 'deck' ? 47800 : 47801

app.setName('Deck')
app.setPath('userData', join(app.getPath('appData'), profile))

if (!app.requestSingleInstanceLock({ profile })) {
  app.quit()
}

interface Config {
  gridColumns: number
  defaultCwd: string
}

function loadConfig(userData: string): Config {
  const defaults: Config = { gridColumns: 2, defaultCwd: homedir() }
  const p = join(userData, 'config.json')
  if (!existsSync(p)) return defaults
  try {
    return { ...defaults, ...(JSON.parse(readFileSync(p, 'utf8')) as Partial<Config>) }
  } catch {
    return defaults
  }
}

let win: BrowserWindow | null = null
let manager: SessionManager | null = null

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
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
    backgroundColor: '#efe9dc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
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
    }
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    send('deck:error', error)
    return { ok: false, error }
  }
}

app.whenReady().then(async () => {
  const env = shellEnv()
  const userData = app.getPath('userData')
  const config = loadConfig(userData)
  const tmux = new Tmux(profile, join(app.getAppPath(), 'tmux.conf'), env)

  const hooks = new HooksServer(HOOK_PORT, userData, (event, payload) => manager?.onHook(event, payload))
  await hooks.start()

  manager = new SessionManager({
    tmux,
    env,
    userDataDir: userData,
    hooksSettingsPath: hooks.settingsPath,
    profile,
    gridColumns: config.gridColumns,
    defaultCwd: config.defaultCwd,
    events: {
      state: (state) => send('deck:state', state),
      data: (id, data) => send('pty:data', id, data),
      exit: (id) => send('pty:exit', id)
    }
  })

  ipcMain.handle('deck:getState', () => manager!.getState())
  ipcMain.handle('deck:command', (_e, cmd: DeckCommand) => runCommand(cmd))
  ipcMain.on('pty:input', (_e, id: string, data: string) => manager?.input(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => manager?.resize(id, cols, rows))
  ipcMain.on('deck:setTitle', (_e, id: string, title: string) => manager?.setTitle(id, title))
  ipcMain.on('deck:bell', (_e, id: string) => manager?.bell(id))

  buildMenu((cmd) => void runCommand(cmd))
  createWindow()
  await manager.init()

  const fleet = new Fleet(env, (entries) => manager?.onFleet(entries))
  fleet.start()

  app.on('before-quit', () => {
    fleet.stop()
    hooks.stop()
    manager?.detachAll()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
