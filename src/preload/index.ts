import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { GameboyRequest, MolRequest, LessonFile, LessonRequest, AgentView, DeckApi, DeckUsage, DeckCommand, DeckSettings, NewSessionRequest, DeckState, FileDoc, FoxEntry, GitChanges, GitDiff, Lang, QuixoteIndex, QuixoteSection, ReaderBook, RemoteInfo, SavedForm, SavedWord, Screen, SpotifyAccount, SpotifyCommand, SpotifyItem, SpotifyLibrary, SpotifyState, StoredWord, StudioInfo, StudioJob, StudioModel, StudioRequest, Transcript, TranslateResult, UiEvent, VocabChange, VocabResult, VocabStats, VocabWord, WeatherNow, WeatherPlace, WikiBackdrop, WikiHit, WikiPicture, WikiSummary, WordSchedule } from '@shared/types'

const api: DeckApi = {
  getState: () => ipcRenderer.invoke('deck:getState') as Promise<DeckState>,
  onState: (cb) => {
    const h = (_e: unknown, state: DeckState) => cb(state)
    ipcRenderer.on('deck:state', h)
    return () => ipcRenderer.removeListener('deck:state', h)
  },
  command: (cmd: DeckCommand) => ipcRenderer.invoke('deck:command', cmd),
  newSession: (req: NewSessionRequest) => ipcRenderer.invoke('session:new', req) as Promise<{ id: string; slot: number }>,
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
  wikiBackdrop: (date: string) => ipcRenderer.invoke('wiki:backdrop', date) as Promise<WikiBackdrop | null>,
  wikiSearch: (q: string) => ipcRenderer.invoke('wiki:search', q) as Promise<WikiHit[]>,
  wikiSummary: (key: string) => ipcRenderer.invoke('wiki:summary', key) as Promise<WikiSummary>,
  weather: () => ipcRenderer.invoke('weather:now') as Promise<WeatherNow[]>,
  weatherSearch: (q: string) => ipcRenderer.invoke('weather:search', q) as Promise<WeatherPlace[]>,
  onSpotify: (cb) => {
    const h = (_e: unknown, state: SpotifyState) => cb(state)
    ipcRenderer.on('spotify:state', h)
    void ipcRenderer.invoke('spotify:getState').then((s: SpotifyState) => cb(s))
    return () => ipcRenderer.removeListener('spotify:state', h)
  },
  spotify: (cmd: SpotifyCommand) => ipcRenderer.send('spotify:command', cmd),
  spotifyPlay: (uri: string) => ipcRenderer.send('spotify:play', uri),
  spotifyItems: () => ipcRenderer.invoke('spotify:items') as Promise<SpotifyItem[]>,
  onSpotifyAccount: (cb) => {
    const h = (_e: unknown, a: SpotifyAccount) => cb(a)
    ipcRenderer.on('spotify:account', h)
    void ipcRenderer.invoke('spotify:getAccount').then((a: SpotifyAccount) => cb(a))
    return () => ipcRenderer.removeListener('spotify:account', h)
  },
  spotifyConnect: () => ipcRenderer.invoke('spotify:connect') as Promise<SpotifyAccount>,
  spotifyDisconnect: () => ipcRenderer.send('spotify:disconnect'),
  spotifyLibrary: () => ipcRenderer.invoke('spotify:library') as Promise<SpotifyLibrary>,
  spotifySearch: (q: string) => ipcRenderer.invoke('spotify:search', q) as Promise<SpotifyItem[]>,
  readDoc: (ref, cwd) => ipcRenderer.invoke('file:read', ref, cwd) as Promise<FileDoc>,
  openPath: (path) => ipcRenderer.invoke('file:open', path) as Promise<string>,
  revealPath: (path) => ipcRenderer.send('file:reveal', path),
  copyText: (text) => ipcRenderer.send('file:copy', text),
  openExternal: (url) => ipcRenderer.send('deck:openExternal', url),
  translate: (text: string, hint: Lang, fixed?: boolean) => ipcRenderer.invoke('translate:run', text, hint, fixed) as Promise<TranslateResult>,
  vocab: (word: string, hint: Lang, counterpart?: string) => ipcRenderer.invoke('vocab:lookup', word, hint, counterpart) as Promise<VocabResult>,
  vocabWords: () => ipcRenderer.invoke('vocab:words') as Promise<VocabWord[]>,
  saveTranslation: (r, supersede) => ipcRenderer.invoke('store:translation', r, supersede) as Promise<number>,
  saveWord: (r, translationId, extra) => ipcRenderer.invoke('store:word', r, translationId, extra) as Promise<SavedWord>,
  savedForms: () => ipcRenderer.invoke('store:forms') as Promise<SavedForm[]>,
  onVocabChanged: (cb) => {
    const h = (_e: unknown, c: VocabChange) => cb(c)
    ipcRenderer.on('vocab:changed', h)
    return () => ipcRenderer.removeListener('vocab:changed', h)
  },
  quixoteIndex: (book: ReaderBook) => ipcRenderer.invoke('quixote:index', book) as Promise<QuixoteIndex>,
  quixoteSection: (book: ReaderBook, i: number) => ipcRenderer.invoke('quixote:section', book, i) as Promise<QuixoteSection>,
  postureCamera: () => ipcRenderer.invoke('posture:camera') as Promise<boolean>,
  postureTracking: (on) => ipcRenderer.send('posture:tracking', on),
  postureAlert: (text) => ipcRenderer.send('posture:alert', text),
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
  chooseDir: (title?: string) => ipcRenderer.invoke('deck:chooseDir', title) as Promise<string>,
  usage: () => ipcRenderer.invoke('usage:get') as Promise<DeckUsage>,
  onUsage: (cb) => {
    const h = (_e: unknown, u: DeckUsage) => cb(u)
    ipcRenderer.on('usage:update', h)
    return () => ipcRenderer.removeListener('usage:update', h)
  },
  agents: () => ipcRenderer.invoke('agents:list') as Promise<AgentView[]>,
  onAgents: (cb) => {
    const h = (_e: unknown, list: AgentView[]) => cb(list)
    ipcRenderer.on('agents:update', h)
    return () => ipcRenderer.removeListener('agents:update', h)
  },
  foxLog: (limit?: number) => ipcRenderer.invoke('fox:log', limit) as Promise<FoxEntry[]>,
  onFoxEntry: (cb) => {
    const h = (_e: unknown, entry: FoxEntry) => cb(entry)
    ipcRenderer.on('fox:entry', h)
    return () => ipcRenderer.removeListener('fox:entry', h)
  },
  onUi: (cb) => {
    const h = (_e: unknown, ev: UiEvent) => cb(ev)
    ipcRenderer.on('deck:ui', h)
    return () => ipcRenderer.removeListener('deck:ui', h)
  },
  remoteInfo: () => ipcRenderer.invoke('remote:info') as Promise<RemoteInfo>,
  screen: (id) => ipcRenderer.invoke('tmux:screen', id) as Promise<Screen>,
  gitChanges: (id) => ipcRenderer.invoke('git:changes', id) as Promise<GitChanges>,
  gitDiff: (repo, path, untracked) => ipcRenderer.invoke('git:diff', repo, path, untracked) as Promise<GitDiff>,
  studioJobs: () => ipcRenderer.invoke('studio:jobs') as Promise<StudioJob[]>,
  onStudio: (cb) => {
    const h = (_e: unknown, jobs: StudioJob[]) => cb(jobs)
    ipcRenderer.on('studio:update', h)
    return () => ipcRenderer.removeListener('studio:update', h)
  },
  studioGenerate: (req: StudioRequest) => ipcRenderer.invoke('studio:generate', req) as Promise<StudioJob>,
  studioDelete: (id: string) => ipcRenderer.invoke('studio:delete', id) as Promise<void>,
  studioModels: () => ipcRenderer.invoke('studio:models') as Promise<StudioModel[]>,
  studioInfo: () => ipcRenderer.invoke('studio:info') as Promise<StudioInfo>,
  pokemonListRoms: () => ipcRenderer.invoke('pokemon:listRoms') as Promise<{ name: string; path: string }[]>,
  pokemonLoadRom: (path: string) => ipcRenderer.invoke('pokemon:loadRom', path) as Promise<{ bytes: Uint8Array; name: string }>,
  pokemonSaveSram: (name: string, data: Uint8Array) => ipcRenderer.invoke('pokemon:saveSram', name, data) as Promise<void>,
  pokemonLoadSram: (name: string) => ipcRenderer.invoke('pokemon:loadSram', name) as Promise<Uint8Array | null>,
  pokemonSaveState: (name: string, slot: number | string, data: Uint8Array) => ipcRenderer.invoke('pokemon:saveState', name, slot, data) as Promise<void>,
  pokemonLoadState: (name: string, slot: number | string) => ipcRenderer.invoke('pokemon:loadState', name, slot) as Promise<Uint8Array | null>,
  pokemonShot: (bytes: Uint8Array) => ipcRenderer.invoke('pokemon:shot', bytes) as Promise<string>,
  webSnap: (webContentsId: number) => ipcRenderer.invoke('web:snap', webContentsId) as Promise<string>,
  onGameboy: (cb) => {
    const h = (_e: unknown, req: GameboyRequest) => cb(req)
    ipcRenderer.on('gameboy:req', h)
    return () => ipcRenderer.removeListener('gameboy:req', h)
  },
  gameboyReply: (id: string, result: unknown) => ipcRenderer.send('gameboy:reply', id, result),
  molResolve: (target) => ipcRenderer.invoke('mol:resolve', target),
  molLibrary: () => ipcRenderer.invoke('mol:library'),
  molShot: (bytes, tile) => ipcRenderer.invoke('mol:shot', bytes, tile),
  onMol: (cb) => {
    const h = (_e: unknown, req: MolRequest) => cb(req)
    ipcRenderer.on('mol:req', h)
    return () => ipcRenderer.removeListener('mol:req', h)
  },
  molReply: (id: string, result: unknown) => ipcRenderer.send('mol:reply', id, result),
  lessonRead: (file) => ipcRenderer.invoke('lesson:read', file),
  lessonFigure: (file, src) => ipcRenderer.invoke('lesson:figure', file, src),
  lessonCurriculum: (sessionId, fallback) => ipcRenderer.invoke('lesson:curriculum', sessionId, fallback),
  lessonWatch: (files) => ipcRenderer.send('lesson:watch', files),
  onLessonChanged: (cb) => {
    const h = (_e: unknown, f: LessonFile) => cb(f)
    ipcRenderer.on('lesson:changed', h)
    return () => ipcRenderer.removeListener('lesson:changed', h)
  },
  lessonMol: (run) => ipcRenderer.invoke('lesson:mol', run),
  onLesson: (cb) => {
    const h = (_e: unknown, req: LessonRequest) => cb(req)
    ipcRenderer.on('lesson:req', h)
    return () => ipcRenderer.removeListener('lesson:req', h)
  },
  lessonReply: (id: string, result: unknown) => ipcRenderer.send('lesson:reply', id, result)
}

contextBridge.exposeInMainWorld('deck', api)
contextBridge.exposeInMainWorld('deckErrors', {
  onError: (cb: (msg: string) => void) => {
    const h = (_e: unknown, msg: string) => cb(msg)
    ipcRenderer.on('deck:error', h)
    return () => ipcRenderer.removeListener('deck:error', h)
  }
})
