// window.deck for the phone: the same DeckApi the desktop gets from its preload, spoken over
// one WebSocket to main/remote.ts (shared/remote.ts is the wire). Broadcasts fan out to the
// same `on*` subscriptions the tile components already use, calls go by name and come back by
// id, and keystrokes are fire-and-forget. What has no business on a phone (terminals, drops,
// the Mac-only mini apps) is a no-op or rejects. The socket reconnects on its own; a call made while
// it is down waits for the next connection (up to a bound) instead of failing at once.

import type { AgentView, DeckApi, DeckSettings, DeckState, FileDoc, FoxEntry, Transcript, VocabChange } from '@shared/types'
import { REMOTE_PORT, type RemoteDown, type RemoteMethod } from '@shared/remote'

export type Link = 'unpaired' | 'connecting' | 'open' | 'closed' | 'unauthorized'

const TOKEN_KEY = 'deck:remoteToken'
const CALL_TIMEOUT_MS = 20_000
const BACKOFF_MS = [800, 1500, 3000, 5000, 8000]

/**
 * The token rides in the URL's fragment (the QR / link from the Mac) and STAYS there: on iOS a
 * home-screen app has storage of its own, and the URL Safari saves for it is this one, hash
 * included. localStorage is the fallback for a link typed without it.
 */
function loadToken(): string {
  const m = /[#&]t=([A-Za-z0-9_-]+)/.exec(location.hash)
  if (m) {
    try {
      localStorage.setItem(TOKEN_KEY, m[1])
    } catch {
      /* private mode: the token lives for this page load only */
    }
    return m[1]
  }
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Where main's server is: the page's own origin, or under Vite in dev the dev port of the same host. */
function serverBase(): { http: string; ws: string } {
  const host = location.hostname
  const port = import.meta.env.DEV ? String(REMOTE_PORT.other) : location.port
  const h = host.includes(':') ? `[${host}]` : host
  return { http: `http://${h}${port ? `:${port}` : ''}`, ws: `ws://${h}${port ? `:${port}` : ''}` }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }

class Remote {
  link: Link = 'unpaired'
  private token = loadToken()
  private ws: WebSocket | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private queue: string[] = []
  private attempt = 0
  private timer = 0
  private readonly subs = {
    state: new Set<(s: DeckState) => void>(),
    transcript: new Set<(t: Transcript) => void>(),
    settings: new Set<(s: DeckSettings) => void>(),
    fox: new Set<(e: FoxEntry) => void>(),
    agents: new Set<(a: AgentView[]) => void>(),
    vocab: new Set<(c: VocabChange) => void>(),
    error: new Set<(m: string) => void>(),
    link: new Set<(l: Link) => void>()
  }

  constructor() {
    if (this.token) this.connect()
    // Back from the background: iOS drops sockets while the app sleeps. Reconnect at once.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.link !== 'open' && this.token) this.connect(true)
    })
    window.addEventListener('online', () => this.token && this.connect(true))
  }

  on<K extends keyof Remote['subs']>(kind: K, cb: Parameters<Remote['subs'][K]['add']>[0]): () => void {
    const set = this.subs[kind] as Set<unknown>
    set.add(cb)
    return () => void set.delete(cb)
  }

  private setLink(l: Link): void {
    if (this.link === l) return
    this.link = l
    for (const cb of this.subs.link) cb(l)
  }

  private connect(now = false): void {
    window.clearTimeout(this.timer)
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    if (now) this.attempt = 0
    this.setLink('connecting')
    const ws = new WebSocket(`${serverBase().ws}/ws?t=${encodeURIComponent(this.token)}`)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.setLink('open')
      for (const m of this.queue) ws.send(m)
      this.queue = []
    }
    ws.onmessage = (ev) => this.receive(ev.data as string)
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      void this.afterClose()
    }
    ws.onerror = () => ws.close()
  }

  /** A refused upgrade looks like any other drop to the browser; ask the server whether the token is the problem. */
  private async afterClose(): Promise<void> {
    let unauthorized = false
    try {
      const r = await fetch(`${serverBase().http}/auth?t=${encodeURIComponent(this.token)}`, { cache: 'no-store' })
      unauthorized = r.status === 403
    } catch {
      /* server unreachable: keep retrying */
    }
    if (unauthorized) {
      this.setLink('unauthorized')
      this.failPending('not paired with this deck')
      return
    }
    this.setLink('closed')
    const delay = BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)]
    this.timer = window.setTimeout(() => this.connect(), delay)
  }

  private failPending(why: string): void {
    for (const [id, p] of this.pending) {
      window.clearTimeout(p.timer)
      p.reject(new Error(why))
      this.pending.delete(id)
    }
    this.queue = []
  }

  private receive(raw: string): void {
    let msg: RemoteDown
    try {
      msg = JSON.parse(raw) as RemoteDown
    } catch {
      return
    }
    switch (msg.type) {
      case 'hello':
        return
      case 'state':
        for (const cb of this.subs.state) cb(msg.state)
        return
      case 'transcript':
        for (const cb of this.subs.transcript) cb(msg.transcript)
        return
      case 'settings':
        for (const cb of this.subs.settings) cb(msg.settings)
        return
      case 'fox':
        for (const cb of this.subs.fox) cb(msg.entry)
        return
      case 'agents':
        for (const cb of this.subs.agents) cb(msg.agents)
        return
      case 'vocab':
        for (const cb of this.subs.vocab) cb(msg.change)
        return
      case 'error':
        for (const cb of this.subs.error) cb(msg.error)
        return
      case 'reply': {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        window.clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error))
      }
    }
  }

  private send(frame: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame)
    else if (this.token && this.link !== 'unauthorized') this.queue.push(frame)
  }

  call<T>(method: RemoteMethod, args: unknown[] = []): Promise<T> {
    if (!this.token) return Promise.reject(new Error('not paired: open the link from the Mac'))
    if (this.link === 'unauthorized') return Promise.reject(new Error('not paired with this deck'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method}: no reply`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.send(JSON.stringify({ type: 'call', id, method, args }))
    })
  }

  input(id: string, data: string): void {
    this.send(JSON.stringify({ type: 'input', id, data }))
  }

  /** Forget the token and start over (a "not paired" page's way out). */
  unpair(): void {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* nothing kept */
    }
    history.replaceState(null, '', location.pathname + location.search)
    this.token = ''
    this.ws?.close()
    this.setLink('unpaired')
  }
}

export const remote = new Remote()

const notHere = <T>(): Promise<T> => Promise.reject(new Error('not on the phone'))
const noop = (): void => {}
const nothing = (): (() => void) => noop

/** Image / PDF bytes came as base64 (main/remote.ts `wire`); give DocPane the Uint8Array it expects. */
function undoc(d: FileDoc & { bytesB64?: string }): FileDoc {
  if (!d.bytesB64) return d
  const { bytesB64, ...rest } = d
  const bin = atob(bytesB64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { ...rest, bytes }
}

export const api: DeckApi = {
  getState: () => remote.call('getState'),
  onState: (cb) => remote.on('state', cb),
  command: (cmd) => remote.call('command', [cmd]),
  newSession: notHere,
  ptyInput: (id, data) => remote.input(id, data),
  // The desktop owns the size; the phone reads tmux's screen instead of attaching.
  ptyResize: noop,
  onPtyData: nothing,
  onPtyExit: nothing,
  setTitle: noop,
  bell: noop,
  getTranscript: (id) => remote.call('getTranscript', [id]),
  onTranscript: (cb) => remote.on('transcript', cb),
  keepDroppedFile: () => Promise.resolve(null),
  // The right drawer's apps: main fetches and stores for them, so they are the desktop's calls by name.
  wikiPicture: (when) => remote.call('wikiPicture', [when ?? 'today']),
  wikiBackdrop: notHere,
  wikiSearch: (q) => remote.call('wikiSearch', [q]),
  wikiSummary: (key) => remote.call('wikiSummary', [key]),
  weather: () => remote.call('weather'),
  weatherSearch: (q) => remote.call('weatherSearch', [q]),
  broadcast: () => remote.call('broadcast'),
  onSpotify: nothing,
  spotify: noop,
  spotifyPlay: noop,
  spotifyItems: () => Promise.resolve([]),
  onSpotifyAccount: nothing,
  spotifyConnect: notHere,
  spotifyDisconnect: noop,
  spotifyLibrary: notHere,
  spotifySearch: notHere,
  readDoc: (ref, cwd) => remote.call<FileDoc & { bytesB64?: string }>('readDoc', [ref, cwd]).then(undoc),
  // The phone reads files; the directory tree and writing them are the desktop's.
  listDir: notHere,
  writeDoc: notHere,
  toggleTask: notHere,
  onDocOpen: nothing,
  openPath: (path) => remote.call('openPath', [path]),
  revealPath: noop,
  copyText: (text) => void navigator.clipboard?.writeText(text).catch(noop),
  openExternal: (url) => void window.open(url, '_blank', 'noopener'),
  translate: (text, hint, fixed) => remote.call('translate', [text, hint, fixed]),
  vocab: (word, hint, counterpart) => remote.call('vocab', [word, hint, counterpart]),
  vocabWords: () => remote.call('vocabWords'),
  saveTranslation: (r, supersede) => remote.call('saveTranslation', [r, supersede]),
  saveWord: (r, translationId, extra) => remote.call('saveWord', [r, translationId, extra]),
  savedForms: () => remote.call('savedForms'),
  onVocabChanged: (cb) => remote.on('vocab', cb),
  quixoteIndex: (book) => remote.call('quixoteIndex', [book]),
  quixoteSection: (book, i) => remote.call('quixoteSection', [book, i]),
  postureCamera: () => Promise.resolve(false),
  postureTracking: () => {},
  postureAlert: () => {},
  spaceStatus: () => Promise.resolve(null),
  onSpaceStatus: () => () => {},
  spaceItems: () => Promise.resolve([]),
  spaceAct: () => Promise.resolve(null),
  spaceTrash: () => Promise.resolve(null),
  onSpaceTrash: () => () => {},
  setWordLiked: (id, liked) => remote.call('setWordLiked', [id, liked]),
  vocabDeck: (limit) => remote.call('vocabDeck', [limit]),
  vocabList: (limit) => remote.call('vocabList', [limit]),
  gradeWord: (id, grade) => remote.call('gradeWord', [id, grade]),
  vocabStats: () => remote.call('vocabStats'),
  getSettings: () => remote.call('getSettings'),
  setSettings: (patch) => remote.call('setSettings', [patch]),
  onSettings: (cb) => remote.on('settings', cb),
  chooseDefaultCwd: () => Promise.resolve(''),
  chooseDir: () => Promise.resolve(''),
  foxLog: (limit) => remote.call('foxLog', [limit]),
  onFoxEntry: (cb) => remote.on('fox', cb),
  usage: () => Promise.resolve({ fiveHour: null, sevenDay: null, at: 0, context: {} }),
  onUsage: nothing,
  agents: () => remote.call('agents', []),
  onAgents: (cb) => remote.on('agents', cb),
  onUi: nothing,
  remoteInfo: notHere,
  screen: (id) => remote.call('screen', [id]),
  gitChanges: (id) => remote.call('gitChanges', [id]),
  gitDiff: (repo, path, untracked) => remote.call('gitDiff', [repo, path, untracked]),
  // The Studio is the desktop's (its images live in userData); the phone shows no tile for it.
  studioJobs: () => Promise.resolve([]),
  onStudio: nothing,
  studioGenerate: notHere,
  studioDelete: notHere,
  studioModels: notHere,
  studioInfo: notHere,
  // The Game Boy runs in the desktop's renderer; the phone has no tile for it.
  pokemonListRoms: () => Promise.resolve([]),
  pokemonLoadRom: notHere,
  pokemonSaveSram: notHere,
  pokemonLoadSram: notHere,
  pokemonSaveState: notHere,
  pokemonLoadState: notHere,
  pokemonShot: notHere,
  gbSpriteGet: () => Promise.resolve(null),
  gbSpriteKeep: () => Promise.resolve(),
  // Web apps are webviews of the desktop's window.
  webSnap: () => Promise.resolve(''),
  onGameboy: nothing,
  gameboyReply: noop,
  molResolve: notHere,
  molLibrary: () => Promise.resolve([]),
  molShot: notHere,
  onMol: nothing,
  molReply: noop,
  // Lessons are read off the Mac's disk into the desktop's tiles.
  lessonRead: notHere,
  lessonFigure: notHere,
  lessonCurriculum: () => Promise.resolve({ dir: '', data: null }),
  lessonWatch: noop,
  onLessonChanged: nothing,
  lessonMol: notHere,
  onLesson: nothing,
  lessonReply: noop
}

/** Stand in for the preload: the components read window.deck and window.deckErrors. */
export function installApi(): void {
  window.deck = api
  window.deckErrors = { onError: (cb) => remote.on('error', cb) }
}
