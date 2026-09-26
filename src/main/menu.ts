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
    { label: 'Reset Layout (every tile back to its default place)', enabled: s.gridOrder.left.length + s.gridOrder.right.length > 0, click: () => patch({ gridOrder: { left: [], right: [] } }) }
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
        { label: 'Show Foxtrot Tile', type: 'checkbox', checked: s.showFoxtrot, click: () => patch({ showFoxtrot: !settings().showFoxtrot }) },
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
        {
          label: 'Studio',
          submenu: [
            { label: 'Open Studio', accelerator: 'CmdOrCtrl+Shift+I', click: () => ui({ type: 'toggleStudio' }) },
            { label: 'Show Studio Tile', type: 'checkbox', checked: s.showStudio, click: () => patch({ showStudio: !settings().showStudio }) }
          ]
        },
        {
          label: 'Molecule',
          submenu: [
            { label: 'Open Molecule Viewer', accelerator: 'CmdOrCtrl+Shift+A', click: () => ui({ type: 'toggleMol' }) },
            { label: 'Show Molecule Tile', type: 'checkbox', checked: s.showMol, click: () => patch({ showMol: !settings().showMol }) }
          ]
        },
        {
          label: 'Reader',
          submenu: [
            { label: 'Open the Reader', accelerator: 'CmdOrCtrl+Shift+D', click: () => ui({ type: 'toggleQuixote' }) },
            { label: 'Show Reader Tile', type: 'checkbox', checked: s.showQuixote, click: () => patch({ showQuixote: !settings().showQuixote }) }
          ]
        },
        {
          label: 'Posture',
          submenu: [
            { label: 'Open Posture', accelerator: 'CmdOrCtrl+Shift+P', click: () => ui({ type: 'togglePosture' }) },
            { label: 'Show Posture Tile (uses the camera)', type: 'checkbox', checked: s.showPosture, click: () => patch({ showPosture: !settings().showPosture }) }
          ]
        },
        {
          label: 'Lesson',
          submenu: [
            { label: 'Open Lesson', accelerator: 'CmdOrCtrl+Shift+E', click: () => ui({ type: 'toggleLesson' }) },
            { label: 'Show Lesson Tile', type: 'checkbox', checked: s.showLesson, click: () => patch({ showLesson: !settings().showLesson }) }
          ]
        },
        {
          label: 'Pokemon',
          submenu: [
            { label: 'Play Pokemon', accelerator: 'CmdOrCtrl+Shift+G', click: () => ui({ type: 'togglePokemon' }) },
            { label: 'Show Pokemon Tile', type: 'checkbox', checked: s.showPokemon, click: () => patch({ showPokemon: !settings().showPokemon }) },
            { label: 'Village vs Notes', type: 'checkbox', checked: s.spriteGag, click: () => patch({ spriteGag: !settings().spriteGag }) }
          ]
        },
        {
          label: 'Web Apps',
          submenu: s.webApps.length
            ? s.webApps.flatMap((a, i): MenuItemConstructorOptions[] => [
                { label: `Open ${a.name}`, accelerator: i === 0 ? 'CmdOrCtrl+Shift+B' : undefined, click: () => ui({ type: 'toggleWeb', id: a.id }) },
                { label: `Show ${a.name} Tile`, type: 'checkbox', checked: a.show, click: () => patch({ webApps: settings().webApps.map((w) => (w.id === a.id ? { ...w, show: !w.show } : w)) }) }
              ])
            : [{ label: 'None registered (a + in the grid adds one)', enabled: false }]
        },
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
