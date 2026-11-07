// The screen recorder's frame (main/recorder.ts): its own small bridge, window.rec.
import { contextBridge, ipcRenderer } from 'electron'

export interface RecSource {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  scale: number
}

const rec = {
  passThrough: (through: boolean) => ipcRenderer.send('rec:passThrough', through),
  move: (x: number, y: number) => ipcRenderer.send('rec:move', x, y),
  resize: (height: number) => ipcRenderer.send('rec:resize', height),
  close: () => ipcRenderer.send('rec:close'),
  source: () => ipcRenderer.invoke('rec:source') as Promise<RecSource>,
  /** Route the Mac's output through BlackHole. Resolves an error, '' when routed. */
  audioOn: () => ipcRenderer.invoke('rec:audioOn') as Promise<string>,
  audioOff: () => ipcRenderer.invoke('rec:audioOff') as Promise<void>,
  begin: (ext: string) => ipcRenderer.invoke('rec:begin', ext) as Promise<void>,
  chunk: (bytes: Uint8Array) => ipcRenderer.invoke('rec:chunk', bytes) as Promise<void>,
  /** The take is done: resolves the saved file's path. */
  end: (ext: string) => ipcRenderer.invoke('rec:end', ext) as Promise<string>,
  reveal: (path: string) => ipcRenderer.send('rec:reveal', path),
  play: (path: string) => ipcRenderer.send('rec:play', path),
  /** ⌘⇧O while the frame is up: stop a take, else close. */
  onCloseAsked: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('rec:closeAsked', h)
    return () => ipcRenderer.removeListener('rec:closeAsked', h)
  }
}

export type RecApi = typeof rec
contextBridge.exposeInMainWorld('rec', rec)
