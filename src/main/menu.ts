// App menu = the keyboard. Accelerators here fire even while an xterm has keyboard focus
// (the renderer's xterm key handler declines these combos so they reach Electron).

import { app, Menu, nativeTheme, type MenuItemConstructorOptions } from 'electron'
import { CAP, type DeckCommand, type DeckSettings, type SpotifyAccount, type UiEvent } from '@shared/types'
import { THEMES, type Appearance } from '@shared/themes'
import { MODELS } from '@shared/models'

export interface MenuHandlers {
  run(cmd: DeckCommand): void
  settings(): DeckSettings
  patch(p: Partial<DeckSettings>): void
  ui(ev: UiEvent): void
  /** Folders sessions were started in lately, most recent first (SessionManager.recent()). */
  recent(): string[]
  /** The connected Spotify account (null before main has one to ask). */
  spotifyAccount(): SpotifyAccount | null
  spotifyConnect(): void
  spotifyDisconnect(): void
}

/** Rebuilt on every settings change (the checkmarks in View) and whenever the recent-folder list changes. */
export function buildMenu({ run, settings, patch, ui, recent, spotifyAccount, spotifyConnect, spotifyDisconnect }: MenuHandlers): void {
  const s = settings()
  const acct = spotifyAccount()
  const recentItems: MenuItemConstructorOptions[] = recent().map((cwd) => ({
    label: cwd.replace(/^\/Users\/[^/]+/, '~'),
    click: () => run({ type: 'new', cwd })
  }))
  const appearanceItem = (label: string, value: Appearance): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: s.appearance === value,
    click: () => patch({ appearance: value })
  })
  const themeItems: MenuItemConstructorOptions[] = THEMES.map((t) => ({
    label: t.name,
    type: 'radio',
    checked: s.theme === t.id,
    click: () => patch({ theme: t.id })
  }))
  // Session ▸ New Session with Model: one shot; Session ▸ Default Model: what ⌘N and the chooser start on.
  const modelItems: MenuItemConstructorOptions[] = MODELS.map((m) => ({
    label: m.label,
    toolTip: m.hint,
    click: () => run({ type: 'new', model: m.id })
  }))
  const defaultModelItems: MenuItemConstructorOptions[] = MODELS.map((m) => ({
    label: m.label,
    type: 'radio',
    checked: s.defaultModel === m.id,
    toolTip: m.hint,
    click: () => patch({ defaultModel: m.id })
  }))
  if (s.defaultModel && !MODELS.some((m) => m.id === s.defaultModel)) {
    defaultModelItems.push({ label: s.defaultModel, type: 'radio', checked: true, toolTip: 'Set by hand in config.json' })
  }
  // ⌘1–9 for the first nine slots, ⌘0 for the tenth.
  const slotItems: MenuItemConstructorOptions[] = []
  for (let n = 1; n <= CAP; n++) {
    slotItems.push({ label: `Focus slot ${n}`, accelerator: `CmdOrCtrl+${n % 10}`, click: () => run({ type: 'focus', slot: n }) })
  }
  const gridItems: MenuItemConstructorOptions[] = [
    ...[1, 2].map((n): MenuItemConstructorOptions => ({ label: `${n} column${n === 1 ? '' : 's'} each side`, type: 'radio', checked: s.gridColumns === n, click: () => patch({ gridColumns: n }) })),
    { type: 'separator' },
    ...[2, 3, 4, 5, 6].map((n): MenuItemConstructorOptions => ({ label: `${n} rows`, type: 'radio', checked: s.gridRows === n, click: () => patch({ gridRows: n }) })),
    { type: 'separator' },
    { label: 'Reset Layout (unpin every tile)', enabled: s.gridLayout.some(Boolean), click: () => patch({ gridLayout: [] }) }
  ]

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => ui({ type: 'openSettings' }) },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }]
    },
    {
      label: 'Session',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => run({ type: 'new' }) },
        { label: 'New Session in Worktree', accelerator: 'CmdOrCtrl+Shift+N', click: () => run({ type: 'new', worktree: true }) },
        { label: 'New Session in Folder…', accelerator: 'CmdOrCtrl+O', click: () => run({ type: 'chooseFolder' }) },
        { label: 'New Session in Recent Folder', enabled: recentItems.length > 0, submenu: recentItems },
        { label: 'New Session with Model', submenu: modelItems },
        { label: 'Default Model for New Sessions', submenu: defaultModelItems },
        { type: 'separator' },
        { label: 'Jump to Session That Needs You', accelerator: 'CmdOrCtrl+Return', click: () => run({ type: 'jumpAttention' }) },
        { label: 'Next Session', accelerator: 'CmdOrCtrl+]', click: () => run({ type: 'cycle', dir: 1 }) },
        { label: 'Previous Session', accelerator: 'CmdOrCtrl+[', click: () => run({ type: 'cycle', dir: -1 }) },
        { type: 'separator' },
        ...slotItems,
        { type: 'separator' },
        { label: 'Close Focused Tile (keeps session)', accelerator: 'CmdOrCtrl+W', click: () => run({ type: 'detach', slot: -1 }) }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Compact Mode', accelerator: 'CmdOrCtrl+Shift+M', type: 'checkbox', checked: s.compact, click: () => patch({ compact: !settings().compact }) },
        { label: 'Fox Barks', type: 'checkbox', checked: s.foxBark, click: () => patch({ foxBark: !settings().foxBark }) },
        { label: 'Grid', submenu: gridItems },
        {
          label: 'Music',
          submenu: [
            { label: 'Show Music Tile', type: 'checkbox', checked: s.showMusic, click: () => patch({ showMusic: !settings().showMusic }) },
            { type: 'separator' },
            { label: 'Spotify', type: 'radio', checked: s.music === 'spotify', click: () => patch({ music: 'spotify' }) },
            { label: 'Lofi Stream (YouTube)', type: 'radio', checked: s.music === 'youtube', click: () => patch({ music: 'youtube' }) },
            { type: 'separator' },
            acct?.connected
              ? { label: `Disconnect Spotify Account${acct.user ? ` (${acct.user})` : ''}`, click: spotifyDisconnect }
              : { label: 'Connect Spotify Account…', enabled: !!acct?.clientId, toolTip: acct?.clientId ? '' : 'set spotifyClientId in config.json first', click: spotifyConnect }
          ]
        },
        { label: "Foxtrot's Log", accelerator: 'CmdOrCtrl+J', click: () => ui({ type: 'toggleFoxLog' }) },
        { type: 'separator' },
        { label: 'Theme', submenu: themeItems },
        {
          label: 'Appearance',
          submenu: [appearanceItem('Follow System', 'system'), appearanceItem('Light', 'light'), appearanceItem('Dark', 'dark')]
        },
        {
          label: 'Toggle Light / Dark',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            const cur = settings().appearance
            // From `system`, jump to the opposite of what is showing now.
            const dark = cur === 'dark' || (cur === 'system' && nativeTheme.shouldUseDarkColors)
            patch({ appearance: dark ? 'light' : 'dark' })
          }
        },
        { type: 'separator' },
        { label: 'Refresh UI (sessions keep running)', accelerator: 'CmdOrCtrl+R', click: () => run({ type: 'refreshUi' }) },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
