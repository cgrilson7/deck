// App menu = the keyboard. Accelerators here fire even while an xterm has keyboard focus
// (the renderer's xterm key handler declines these combos so they reach Electron).

import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { CAP, type DeckCommand } from '@shared/types'

export function buildMenu(run: (cmd: DeckCommand) => void): void {
  const slotItems: MenuItemConstructorOptions[] = []
  for (let n = 1; n <= CAP; n++) {
    slotItems.push({ label: `Focus slot ${n}`, accelerator: `CmdOrCtrl+${n}`, click: () => run({ type: 'focus', slot: n }) })
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }]
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
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
