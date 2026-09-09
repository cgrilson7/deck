// App menu = the keyboard. Accelerators here fire even while an xterm has keyboard focus
// (the renderer's xterm key handler declines these combos so they reach Electron).

import { app, Menu, nativeTheme, type MenuItemConstructorOptions } from 'electron'
import { CAP, type DeckCommand, type DeckSettings, type UiEvent } from '@shared/types'
import { THEMES, type Appearance } from '@shared/themes'

export interface MenuHandlers {
  run(cmd: DeckCommand): void
  settings(): DeckSettings
  patch(p: Partial<DeckSettings>): void
  ui(ev: UiEvent): void
}

/** Rebuilt on every settings change so the checkmarks in View reflect the live values. */
export function buildMenu({ run, settings, patch, ui }: MenuHandlers): void {
  const s = settings()
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
  const slotItems: MenuItemConstructorOptions[] = []
  for (let n = 1; n <= CAP; n++) {
    slotItems.push({ label: `Focus slot ${n}`, accelerator: `CmdOrCtrl+${n}`, click: () => run({ type: 'focus', slot: n }) })
  }

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
