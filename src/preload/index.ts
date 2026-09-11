import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DeckApi, DeckCommand, DeckSettings, DeckState, FileDoc, Lang, SavedWord, StoredWord, Transcript, TranslateResult, UiEvent, VocabResult, VocabStats, VocabWord, WikiHit, WikiPicture, WikiSummary, WordSchedule } from '@shared/types'

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
  getTranscript: (id) => ipcRenderer.invoke('transcript:get', id) as Promise<Transcript | null>,
  onTranscript: (cb) => {
    const h = (_e: unknown, t: Transcript) => cb(t)
    ipcRenderer.on('transcript:update', h)
    return () => ipcRenderer.removeListener('transcript:update', h)
  },
  // Dropped File objects carry no path in an isolated renderer; the preload resolves it, and main
  // decides whether that path lasts. A File without one (an image out of a page) ships its bytes.
  keepDroppedFile: async (file) => {
    if (!(file instanceof File)) return null
    let path = ''
    try {
      path = webUtils.getPathForFile(file)
    } catch {
      /* not a real file */
    }
    let bytes: Uint8Array | undefined
    if (!path && file.size > 0) bytes = new Uint8Array(await file.arrayBuffer())
    return ipcRenderer.invoke('drop:keep', { name: file.name, path, bytes }) as Promise<string | null>
  },
  wikiPicture: (when?: 'today' | 'past') => ipcRenderer.invoke('wiki:picture', when ?? 'today') as Promise<WikiPicture | null>,
  wikiSearch: (q: string) => ipcRenderer.invoke('wiki:search', q) as Promise<WikiHit[]>,
  wikiSummary: (key: string) => ipcRenderer.invoke('wiki:summary', key) as Promise<WikiSummary>,
  readDoc: (ref, cwd) => ipcRenderer.invoke('file:read', ref, cwd) as Promise<FileDoc>,
  openPath: (path) => ipcRenderer.invoke('file:open', path) as Promise<string>,
  revealPath: (path) => ipcRenderer.send('file:reveal', path),
  copyText: (text) => ipcRenderer.send('file:copy', text),
  openExternal: (url) => ipcRenderer.send('deck:openExternal', url),
  translate: (text: string, hint: Lang) => ipcRenderer.invoke('translate:run', text, hint) as Promise<TranslateResult>,
  vocab: (word: string, hint: Lang, counterpart?: string) => ipcRenderer.invoke('vocab:lookup', word, hint, counterpart) as Promise<VocabResult>,
  vocabWords: () => ipcRenderer.invoke('vocab:words') as Promise<VocabWord[]>,
  saveTranslation: (r, supersede) => ipcRenderer.invoke('store:translation', r, supersede) as Promise<number>,
  saveWord: (r, translationId) => ipcRenderer.invoke('store:word', r, translationId) as Promise<SavedWord>,
  setWordLiked: (id, liked) => ipcRenderer.invoke('store:liked', id, liked) as Promise<void>,
  vocabDeck: (limit?: number) => ipcRenderer.invoke('store:deck', limit) as Promise<StoredWord[]>,
  vocabList: (limit?: number) => ipcRenderer.invoke('store:list', limit) as Promise<StoredWord[]>,
  gradeWord: (id: number, grade: number) => ipcRenderer.invoke('store:grade', id, grade) as Promise<WordSchedule>,
  vocabStats: () => ipcRenderer.invoke('store:stats') as Promise<VocabStats>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<DeckSettings>,
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch) as Promise<DeckSettings>,
  onSettings: (cb) => {
    const h = (_e: unknown, s: DeckSettings) => cb(s)
    ipcRenderer.on('settings:changed', h)
    return () => ipcRenderer.removeListener('settings:changed', h)
  },
  chooseDefaultCwd: () => ipcRenderer.invoke('settings:chooseDefaultCwd') as Promise<string>,
  onUi: (cb) => {
    const h = (_e: unknown, ev: UiEvent) => cb(ev)
    ipcRenderer.on('deck:ui', h)
    return () => ipcRenderer.removeListener('deck:ui', h)
  }
}

contextBridge.exposeInMainWorld('deck', api)
contextBridge.exposeInMainWorld('deckErrors', {
  onError: (cb: (msg: string) => void) => {
    const h = (_e: unknown, msg: string) => cb(msg)
    ipcRenderer.on('deck:error', h)
    return () => ipcRenderer.removeListener('deck:error', h)
  }
})
