// The web apps' main side (Village, and whatever else is registered): every app's <webview>
// lives on ONE persistent partition, so a sign-in survives the deck quitting, and main is where
// a guest page is kept in its box — no preload, no node, a short list of permissions, popups
// handed to the browser — and where a tile's snapshot is taken. The webviews themselves are
// the renderer's (components/WebLayer.tsx).

import { Menu, clipboard, session, shell, webContents, type BrowserWindow, type MenuItemConstructorOptions, type WebContents } from 'electron'

export const WEB_PARTITION = 'persist:web'

/** What a guest page may ask for. Everything else (camera, mic, geolocation, midi, …) is refused. */
const ALLOWED = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'notifications'])

const isHttp = (url: string): boolean => /^https?:\/\//i.test(url)

export function setupWebSession(): void {
  const ses = session.fromPartition(WEB_PARTITION)
  // A plain Chrome: some sites turn an "Electron/…" user agent away.
  ses.setUserAgent(ses.getUserAgent().replace(/ (deck|Deck|Electron)\/\S+/g, ''))
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission))
}

/** Call once per window: guards every webview it attaches, and dresses the web apps' ones. */
export function guardWebviews(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    if (params.partition === WEB_PARTITION && !isHttp(params.src)) e.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_e, guest) => {
    if (guest.session !== session.fromPartition(WEB_PARTITION)) return
    // A new window is the browser's: the deck has one page per app.
    guest.setWindowOpenHandler(({ url }) => {
      if (isHttp(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    guest.on('will-navigate', (ev, url) => {
      if (!isHttp(url)) ev.preventDefault()
    })
    guest.on('context-menu', (_ev, p) => contextMenu(win, guest, p))
  })
}

/** Electron gives a guest page no right-click menu at all: the editing basics, spelling, and a link's way out. */
function contextMenu(win: BrowserWindow, guest: WebContents, p: Electron.ContextMenuParams): void {
  const items: MenuItemConstructorOptions[] = []
  for (const w of p.dictionarySuggestions.slice(0, 5)) items.push({ label: w, click: () => guest.replaceMisspelling(w) })
  if (items.length) items.push({ type: 'separator' })
  if (isHttp(p.linkURL)) {
    items.push({ label: 'Open Link in Browser', click: () => void shell.openExternal(p.linkURL) }, { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' })
  }
  if (p.isEditable) items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' })
  else if (p.selectionText.trim()) items.push({ role: 'copy' })
  if (items.length === 0) return
  if (items[items.length - 1].type === 'separator') items.pop()
  Menu.buildFromTemplate(items).popup({ window: win })
}

/** A web app's page as a small JPEG data: URL, for its tile. Only ever a webview of the web partition. */
export async function webSnap(id: number): Promise<string> {
  const wc = typeof id === 'number' ? webContents.fromId(id) : undefined
  if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.session !== session.fromPartition(WEB_PARTITION)) return ''
  try {
    const img = await wc.capturePage()
    if (img.isEmpty()) return ''
    return `data:image/jpeg;base64,${img.resize({ width: 560, quality: 'good' }).toJPEG(72).toString('base64')}`
  } catch {
    return ''
  }
}
