// The ad's fake main process: a DeckApi (window.deck) over one scripted world. Same idea as the
// phone's api.ts — the components are the app's own, unchanged — but nothing here is real: the
// sessions, their transcripts, the terminal's bytes, the agents and the mini apps' data are all
// made up by script.ts, and every change is broadcast the way main would broadcast it.

import {
  DEFAULT_SETTINGS,
  type AgentView,
  type ChatBlock,
  type DeckApi,
  type DeckCommand,
  type DeckSettings,
  type DeckState,
  type FileDoc,
  type FoxEntry,
  type GitChanges,
  type MolStructure,
  type SessionStatus,
  type SessionView,
  type SpotifyState,
  type StudioJob,
  type Transcript,
  type VocabResult
} from '@shared/types'
import { MOL_LIBRARY } from '@main/data/molLibrary'
import potd from '../assets/potd.jpg'
import studioHero from '../assets/studio-hero.jpg'
import album from '../assets/album.jpg'
import ubq from '../assets/1UBQ.cif?raw'
import { Tui } from './tui'

type Cb<T extends unknown[]> = (...a: T) => void
class Emitter<T extends unknown[]> {
  private subs = new Set<Cb<T>>()
  on = (cb: Cb<T>): (() => void) => {
    this.subs.add(cb)
    return () => void this.subs.delete(cb)
  }
  emit(...a: T): void {
    for (const cb of [...this.subs]) cb(...a)
  }
}

const HOME = '/Users/you'
const IMAGES: Record<string, string> = { '/studio/fox-desk.jpg': studioHero, '/studio/fox-lofi.jpg': album, '/studio/fox-dawn.jpg': potd }

interface Sess {
  view: SessionView
  blocks: ChatBlock[]
  /** A text block still being written: shown as the last block, and as the terminal's live region. */
  live: string | null
  title: string | null
  tui: Tui
}

export interface NewSess {
  id: string
  slot: number
  name: string
  cwd: string
  model?: string
  worktree?: boolean
  permissionMode?: string
  status?: SessionStatus
  pack?: { alpha: string; task: string }
}

class World {
  readonly state = new Emitter<[DeckState]>()
  readonly transcript = new Emitter<[Transcript]>()
  readonly settingsEv = new Emitter<[DeckSettings]>()
  readonly agentsEv = new Emitter<[AgentView[]]>()
  readonly foxEv = new Emitter<[FoxEntry]>()
  readonly pty = new Emitter<[string, string]>()
  readonly spotifyEv = new Emitter<[SpotifyState]>()
  readonly studioEv = new Emitter<[StudioJob[]]>()
  /** What the script is told about: a prompt submitted from a tile or the terminal. */
  readonly submitted = new Emitter<[string, string]>()

  sessions = new Map<string, Sess>()
  focusSlot: number | null = null
  agents: AgentView[] = []
  fox: FoxEntry[] = []
  jobs: StudioJob[] = []
  git: GitChanges | null = null
  diffs: Record<string, string> = {}
  vocabEntries: Record<string, VocabResult> = {}
  settings: DeckSettings = {
    ...DEFAULT_SETTINGS,
    appearance: 'light',
    defaultCwd: `${HOME}/code`,
    showMol: true,
    // The film was cut before the reader existed.
    showQuixote: false,
    foxBark: true,
    cursorBlink: false
  }
  spotify: SpotifyState = {
    running: true,
    state: 'playing',
    track: 'Paws on the Keys',
    artist: 'foxtrot.fm',
    album: 'Rainy Windowsill',
    artworkUrl: album,
    position: 47,
    duration: 184,
    trackId: 'ad',
    volume: 60,
    shuffling: false
  }
  private typed = new Map<string, string>()
  private seq = 0

  /* ───────────── sessions ───────────── */

  add(n: NewSess): void {
    const view: SessionView = {
      id: n.id,
      tmuxName: `deck-${n.id}`,
      claudeSessionId: `00000000-0000-4000-8000-${n.id.padEnd(12, '0')}`,
      cwd: n.cwd,
      worktree: n.worktree ?? false,
      model: n.model ?? 'fable',
      permissionMode: n.permissionMode ?? '',
      createdAt: Date.now(),
      slot: n.slot,
      name: n.name,
      pack: n.pack,
      status: n.status ?? 'idle',
      attention: false,
      attached: true,
      tmuxAlive: true,
      paused: false
    }
    const tui = new Tui(n.cwd.replace(HOME, '~'), n.model ?? 'fable', (data) => this.pty.emit(n.id, data))
    this.sessions.set(n.id, { view, blocks: [], live: null, title: n.name, tui })
    this.pushState()
  }

  snapshot(): DeckState {
    const open = [...this.sessions.values()].map((s) => ({ ...s.view }))
    return { cap: 10, focusSlot: this.focusSlot, open, parked: [], recent: [`${HOME}/code/atlas`, `${HOME}/code/storefront`, `${HOME}/code/grail`], profile: 'deck' }
  }

  pushState(): void {
    this.state.emit(this.snapshot())
  }

  focus(slot: number | null): void {
    this.focusSlot = slot
    const s = [...this.sessions.values()].find((x) => x.view.slot === slot)
    if (s) s.view.attention = false
    this.pushState()
  }

  status(id: string, status: SessionStatus, attention = false): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.view.status = status
    s.view.attention = attention
    s.tui.busy(status === 'busy')
    this.pushState()
  }

  private tr(s: Sess): Transcript {
    const blocks = s.live ? [...s.blocks, { kind: 'text' as const, text: s.live, ts: Date.now() }] : s.blocks
    return { id: s.view.id, blocks: blocks.slice(-80), title: s.title, found: true }
  }

  /** Add a finished block: a prompt, a tool call (pending or done), or a whole piece of prose. */
  push(id: string, b: ChatBlock): void {
    const s = this.sessions.get(id) ?? this.agentSess(id)
    if (!s) return
    s.blocks.push(b)
    s.tui.block(b)
    this.transcript.emit(this.tr(s))
  }

  /** Prose as it is being written: call with more of it each time, then `commit`. */
  say(id: string, text: string): void {
    const s = this.sessions.get(id) ?? this.agentSess(id)
    if (!s) return
    s.live = text
    s.tui.live(text)
    this.transcript.emit(this.tr(s))
  }

  commit(id: string): void {
    const s = this.sessions.get(id) ?? this.agentSess(id)
    if (!s || s.live === null) return
    const b: ChatBlock = { kind: 'text', text: s.live, ts: Date.now() }
    s.live = null
    s.blocks.push(b)
    s.tui.live(null)
    s.tui.block(b)
    this.transcript.emit(this.tr(s))
  }

  toolDone(id: string, toolId: string, result: string, error = false): void {
    const s = this.sessions.get(id) ?? this.agentSess(id)
    if (!s) return
    s.blocks = s.blocks.map((b) => (b.kind === 'tool' && b.id === toolId ? { ...b, done: true, error } : b))
    s.tui.result(result, error)
    this.transcript.emit(this.tr(s))
  }

  /** Type into the focused terminal's prompt box (the script's hands). */
  typeInTerminal(id: string, text: string): void {
    this.sessions.get(id)?.tui.prompt(text)
  }

  /** A permission prompt in a session's terminal (null = answered). */
  ask(id: string, what: { tool: string; command: string } | null): void {
    this.sessions.get(id)?.tui.ask(what)
  }

  tick(now: number): void {
    for (const s of this.sessions.values()) s.tui.tick(now)
  }

  /* ───────────── agents (their transcripts live under `agent:<id>`) ───────────── */

  private agentTr = new Map<string, Sess>()
  private agentSess(key: string): Sess | null {
    if (!key.startsWith('agent:')) return null
    let s = this.agentTr.get(key)
    if (!s) {
      s = { view: { id: key } as SessionView, blocks: [], live: null, title: null, tui: new Tui('', '', () => {}) }
      this.agentTr.set(key, s)
    }
    return s
  }

  agent(a: Partial<AgentView> & { id: string; parent: string }): void {
    const i = this.agents.findIndex((x) => x.id === a.id)
    const base: AgentView = { type: 'general-purpose', description: '', task: '', model: 'opus', phase: '', background: true, startedAt: Date.now(), endedAt: null, lastText: null, paused: false, held: false, cancelled: null, ...a }
    if (i === -1) this.agents = [...this.agents, base]
    else this.agents = this.agents.map((x, j) => (j === i ? { ...x, ...a } : x))
    this.agentsEv.emit(this.agents)
  }

  /* ───────────── Foxtrot ───────────── */

  bark(text: string, sessions: string[], kind: FoxEntry['kind'] = 'blocked', level: FoxEntry['level'] = 'bark'): void {
    const e: FoxEntry = { id: `f${++this.seq}`, ts: Date.now(), level, kind, text, sessions }
    this.fox.push(e)
    this.foxEv.emit(e)
  }

  patch(p: Partial<DeckSettings>): DeckSettings {
    this.settings = { ...this.settings, ...p }
    this.settingsEv.emit(this.settings)
    return this.settings
  }

  setJobs(jobs: StudioJob[]): void {
    this.jobs = jobs
    this.studioEv.emit(jobs)
  }

  /* ───────────── the DeckApi ───────────── */

  private command(cmd: DeckCommand): void {
    if (cmd.type === 'focus') this.focus(cmd.slot)
    if (cmd.type === 'jumpAttention') {
      const s = [...this.sessions.values()].find((x) => x.view.attention)
      if (s) this.focus(s.view.slot)
    }
    if (cmd.type === 'leashPause') this.agent({ id: cmd.id, ...this.keep(cmd.id), paused: true, held: true })
    if (cmd.type === 'leashResume') this.agent({ id: cmd.id, ...this.keep(cmd.id), paused: false, held: false })
    if (cmd.type === 'leashCancel') this.agent({ id: cmd.id, ...this.keep(cmd.id), cancelled: { reason: cmd.reason, at: Date.now() }, endedAt: Date.now(), paused: false, held: false })
    if (cmd.type === 'agentDismiss') {
      this.agents = this.agents.filter((a) => a.id !== cmd.id)
      this.agentsEv.emit(this.agents)
    }
  }
  private keep(id: string): { parent: string } {
    return { parent: this.agents.find((a) => a.id === id)?.parent ?? '' }
  }

  private input(id: string, data: string): void {
    // A tile's prompt bar: a bracketed paste, then ⏎ a beat later.
    const paste = /\x1b\[200~([\s\S]*?)\x1b\[201~/.exec(data)
    if (paste) {
      this.typed.set(id, (this.typed.get(id) ?? '') + paste[1])
      return
    }
    if (data === '\r') {
      const text = (this.typed.get(id) ?? '').trim()
      this.typed.delete(id)
      if (!text) return
      this.push(id, { kind: 'user', text, ts: Date.now() })
      this.status(id, 'busy')
      this.submitted.emit(id, text)
    }
  }

  private doc(ref: string): FileDoc {
    const name = ref.split('/').pop() ?? ref
    const url = IMAGES[ref]
    if (!url) return { path: ref, name, kind: 'missing', size: 0, mtime: 0, note: 'no such file' }
    return { path: ref, name, kind: 'image', size: 1, mtime: Date.now(), mime: 'image/jpeg', bytes: bytesOf(url) }
  }

  private resolveMol(target: string): MolStructure {
    if (/^1ubq$/i.test(target)) return { target: '1UBQ', name: 'Ubiquitin', format: 'cif', data: ubq, source: 'rcsb', cached: true }
    const lower = target.toLowerCase()
    const lib = MOL_LIBRARY.find((e) => e.key === lower || e.name.toLowerCase() === lower || e.aliases.includes(lower))
    if (!lib) throw new Error(`the ad only knows its library and 1UBQ, not “${target}”`)
    return { target: lib.key, name: lib.name, formula: lib.formula, format: 'sdf', data: lib.sdf, source: 'library', cached: true, charges: lib.charges, chargeMethod: lib.method }
  }

  api(): DeckApi {
    const no = <T>(): Promise<T> => Promise.reject(new Error('not in the ad'))
    const noop = (): void => {}
    const nothing = (): (() => void) => noop
    return {
      getState: async () => this.snapshot(),
      onState: this.state.on,
      command: async (cmd) => (this.command(cmd), { ok: true }),
      newSession: no,
      ptyInput: (id, data) => this.input(id, data),
      ptyResize: (id, cols, rows) => this.sessions.get(id)?.tui.resize(cols, rows),
      onPtyData: this.pty.on,
      onPtyExit: nothing,
      setTitle: noop,
      bell: noop,
      getTranscript: async (id) => {
        const s = this.sessions.get(id) ?? this.agentSess(id)
        return s ? this.tr(s) : null
      },
      onTranscript: this.transcript.on,
      keepDroppedFile: async () => null,
      wikiPicture: async () => ({ date: '2026-09-19', today: true, title: 'Red fox on a frosted alpine meadow at sunrise', credit: '', imageUrl: potd, largeUrl: potd, url: '' }),
      wikiBackdrop: async () => null,
      wikiSearch: async () => [],
      wikiSummary: no,
      weather: async () => [],
      weatherSearch: async () => [],
      onSpotify: (cb) => {
        queueMicrotask(() => cb(this.spotify))
        return this.spotifyEv.on(cb)
      },
      spotify: (cmd) => {
        if (cmd === 'playpause') this.spotify = { ...this.spotify, state: this.spotify.state === 'playing' ? 'paused' : 'playing' }
        this.spotifyEv.emit(this.spotify)
      },
      spotifyPlay: noop,
      spotifyItems: async () => [
        { uri: 'spotify:playlist:a', name: 'lofi beats', kind: 'playlist' },
        { uri: 'spotify:playlist:b', name: 'Deep Focus', kind: 'playlist' },
        { uri: 'spotify:playlist:c', name: 'Peaceful Piano', kind: 'playlist' },
        { uri: 'spotify:playlist:d', name: 'Jazz Vibes', kind: 'playlist' }
      ],
      onSpotifyAccount: nothing,
      spotifyConnect: no,
      spotifyDisconnect: noop,
      spotifyLibrary: no,
      spotifySearch: async () => [],
      readDoc: async (ref) => this.doc(ref),
      openPath: async () => '',
      revealPath: noop,
      copyText: noop,
      openExternal: noop,
      translate: async (text, hint) => ({ source: hint, text, translated: hint === 'en' ? 'el zorro ladra cuando te necesita' : 'the fox barks when it needs you' }),
      vocab: async (word) => this.vocabEntries[word] ?? Object.values(this.vocabEntries)[0],
      vocabWords: async () => Object.keys(this.vocabEntries).map((word, rank) => ({ word, pos: 'adj', rank, mine: false })),
      saveTranslation: async () => 1,
      saveWord: async () => ({ id: 1, liked: true }),
      savedForms: async () => [],
      onVocabChanged: nothing,
      quixoteIndex: no,
      quixoteSection: no,
      postureCamera: async () => false,
      postureTracking: () => {},
      postureAlert: () => {},
      setWordLiked: async () => {},
      vocabDeck: async () => [],
      vocabList: async () => [],
      gradeWord: no,
      vocabStats: async () => ({ words: 412, translations: 96, liked: 38, due: 12 }),
      getSettings: async () => this.settings,
      setSettings: async (p) => this.patch(p),
      onSettings: this.settingsEv.on,
      chooseDefaultCwd: async () => '',
      chooseDir: async () => '',
      usage: async () => ({ fiveHour: null, sevenDay: null, at: 0, context: {} }),
      onUsage: () => () => {},
      agents: async () => this.agents,
      onAgents: this.agentsEv.on,
      foxLog: async () => this.fox,
      onFoxEntry: this.foxEv.on,
      onUi: nothing,
      remoteInfo: no,
      screen: no,
      gitChanges: async (id) => this.git ?? { cwd: this.sessions.get(id)?.view.cwd ?? '', repo: null, branch: '', files: [], add: 0, del: 0 },
      gitDiff: async (_repo, path) => ({ path, text: this.diffs[path] ?? '', truncated: false }),
      studioJobs: async () => this.jobs,
      onStudio: this.studioEv.on,
      studioGenerate: no,
      studioDelete: async () => {},
      studioModels: async () => [],
      studioInfo: async () => ({ ready: true, keySource: 'env', dir: '/studio', model: 'gemini-3.1-flash-image' }),
      pokemonListRoms: async () => [],
      pokemonLoadRom: no,
      pokemonSaveSram: async () => {},
      pokemonLoadSram: async () => null,
      pokemonSaveState: async () => {},
      pokemonLoadState: async () => null,
      pokemonShot: no,
      webSnap: () => Promise.resolve(''),
      onGameboy: nothing,
      gameboyReply: noop,
      molResolve: async (t) => this.resolveMol(t),
      molLibrary: async () => MOL_LIBRARY.map((e) => ({ key: e.key, name: e.name, formula: e.formula, atoms: e.charges.length })),
      molShot: async () => '/mol/look.png',
      onMol: nothing,
      molReply: noop,
      lessonRead: no,
      lessonFigure: no,
      lessonCurriculum: async () => ({ dir: '', data: null }),
      lessonWatch: noop,
      onLessonChanged: nothing,
      lessonMol: no,
      onLesson: nothing,
      lessonReply: noop
    }
  }
}

/** Vite gives an asset as a URL; the Studio wants bytes (it makes its own blob URL). Fetched up front by `preload()`. */
const BYTES = new Map<string, Uint8Array>()
function bytesOf(url: string): Uint8Array {
  return BYTES.get(url) ?? new Uint8Array()
}
export async function preload(): Promise<void> {
  await Promise.all(
    Object.values(IMAGES).map(async (url) => {
      BYTES.set(url, new Uint8Array(await (await fetch(url)).arrayBuffer()))
      await new Promise<void>((res) => {
        const img = new Image()
        img.onload = img.onerror = () => res()
        img.src = url
      })
    })
  )
}

export const world = new World()
