import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DeckApi, DeckCommand, DeckState, SpotifyState } from '@shared/types'

const api: DeckApi = {
  getState: () => ipcRenderer.invoke('deck:getState') as Promise<DeckState>,
  onState: (cb) => {
    const h = (_e: unknown, state: DeckState) => cb(state)
    ipcRenderer.on('deck:state', h)
    return () => ipcRenderer.removeListener('deck:state', h)
  },
  command: (cmd: DeckCommand) => ipcRenderer.invoke('deck:command', cmd),
  ptyInput: (id, data) => ipcRenderer.send('pty:input', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  onPtyData: (cb) => {
    const h = (_e: unknown, id: string, data: string) => cb(id, data)
    ipcRenderer.on('pty:data', h)
    return () => ipcRenderer.removeListener('pty:data', h)
  },
  onPtyExit: (cb) => {
    const h = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('pty:exit', h)
    return () => ipcRenderer.removeListener('pty:exit', h)
  },
  setTitle: (id, title) => ipcRenderer.send('deck:setTitle', id, title),
  bell: (id) => ipcRenderer.send('deck:bell', id),
  // Dropped File objects carry no path in an isolated renderer; the preload resolves it.
  pathForFile: (file) => webUtils.getPathForFile(file),
  onSpotify: (cb) => {
    const h = (_e: unknown, state: SpotifyState) => cb(state)
    ipcRenderer.on('spotify:state', h)
    void ipcRenderer.invoke('spotify:getState').then((s: SpotifyState) => cb(s))
    return () => ipcRenderer.removeListener('spotify:state', h)
  },
  spotify: (cmd) => ipcRenderer.send('spotify:command', cmd)
}

contextBridge.exposeInMainWorld('deck', api)
contextBridge.exposeInMainWorld('deckErrors', {
  onError: (cb: (msg: string) => void) => {
    const h = (_e: unknown, msg: string) => cb(msg)
    ipcRenderer.on('deck:error', h)
    return () => ipcRenderer.removeListener('deck:error', h)
  }
})
