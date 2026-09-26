// THE FILES TILE's state: ONE tree for the whole window — the root, which folders are unfolded,
// whether dotfiles show, the listings, and the file that is selected — shared by the tile (the
// small view) and the Files pane (the tree at reading size beside the file's contents, in the
// center column), so each follows the other, like the reader's tile and pane. Kept in
// localStorage `deck.files` so the tree survives ⌘R. Main lists a folder at a time
// (`listDir`); the root and every open folder are re-read every few seconds while a view is
// mounted and the window is visible, and only a listing that changed re-renders.

import { useEffect, useState } from 'react'
import type { DirListing } from '@shared/types'

/** How often the folders that are open are re-read while a view shows and the window is visible. */
const POLL_MS = 4000
const STORE = 'deck.files'

export interface FilesState {
  /** The folder at the top of the tree: absolute once main has resolved it (`~` until then). */
  root: string
  /** The folders unfolded, by absolute path. */
  open: Set<string>
  /** Dotfiles showing. */
  hidden: boolean
  /** What main listed, by absolute path. */
  lists: Map<string, DirListing>
  /** The file whose contents the pane shows (lit in the tree), or null. */
  selected: string | null
}

let state: FilesState = load()
const subs = new Set<(s: FilesState) => void>()
let views = 0
let timer: number | null = null

function load(): FilesState {
  let root = '~'
  let open: string[] = []
  let hidden = false
  let selected: string | null = null
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) {
      const s = JSON.parse(raw) as { root?: unknown; open?: unknown; hidden?: unknown; selected?: unknown }
      if (typeof s.root === 'string' && s.root) root = s.root
      if (Array.isArray(s.open)) open = s.open.filter((p): p is string => typeof p === 'string')
      hidden = !!s.hidden
      if (typeof s.selected === 'string' && s.selected) selected = s.selected
    }
  } catch {
    /* a fresh start */
  }
  return { root, open: new Set(open), hidden, lists: new Map(), selected }
}

function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ root: state.root, open: [...state.open], hidden: state.hidden, selected: state.selected }))
  } catch {
    /* storage may be off */
  }
}

function set(patch: Partial<FilesState>, persist = true): void {
  state = { ...state, ...patch }
  if (persist) save()
  for (const s of subs) s(state)
}

export const tilde = (p: string): string => p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
export const parentOf = (p: string): string => (p === '/' ? '/' : p.replace(/\/[^/]*\/?$/, '') || '/')
export const childOf = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`)

/** Read one folder; only a listing that differs from the one held re-renders. The root's first read makes it absolute. */
export async function list(path: string): Promise<DirListing> {
  const l = await window.deck.listDir(path)
  const have = state.lists.get(l.path)
  const changed = !have || JSON.stringify(have) !== JSON.stringify(l)
  const patch: Partial<FilesState> = {}
  if (changed) patch.lists = new Map(state.lists).set(l.path, l)
  if (path === state.root && l.path !== state.root && !l.error) patch.root = l.path
  if (Object.keys(patch).length) set(patch, 'root' in patch)
  return l
}

/** The root and every open folder, again. */
export function sweep(): void {
  if (document.visibilityState !== 'visible') return
  void list(state.root)
  for (const p of state.open) void list(p)
}

/** Move the root: a typed path, ↑, ⌂ (`~`), a double-clicked folder. */
export function setRoot(path: string): void {
  const p = path.trim()
  if (!p) return
  set({ root: p })
  void list(p)
}

/** Unfold or fold a folder. */
export function toggle(path: string): void {
  const open = new Set(state.open)
  if (open.has(path)) open.delete(path)
  else {
    open.add(path)
    if (!state.lists.has(path)) void list(path)
  }
  set({ open })
}

export function setHidden(hidden: boolean): void {
  set({ hidden })
}

/** The file the pane reads. */
export function select(path: string | null): void {
  set({ selected: path })
}

/** A view is up: the poll runs while any is. */
function attach(): () => void {
  views++
  if (views === 1) {
    sweep()
    timer = window.setInterval(sweep, POLL_MS)
    document.addEventListener('visibilitychange', sweep)
  }
  return () => {
    views--
    if (views === 0) {
      if (timer !== null) window.clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', sweep)
    }
  }
}

/** The tree's state, live; mounting a view starts the poll. */
export function useFiles(): FilesState {
  const [s, setS] = useState(state)
  useEffect(() => {
    subs.add(setS)
    setS(state)
    const off = attach()
    return () => {
      subs.delete(setS)
      off()
    }
  }, [])
  return s
}

// ---- the pane's door ---------------------------------------------------------------

const EVENT = 'deck:files'
export type FilesWant = boolean | 'toggle'
/** Open the Files pane in the center column (with `path` selected, when given). */
export function openFiles(path?: string): void {
  if (path) select(path)
  window.dispatchEvent(new CustomEvent<FilesWant>(EVENT, { detail: true }))
}
export function closeFiles(): void {
  window.dispatchEvent(new CustomEvent<FilesWant>(EVENT, { detail: false }))
}
export function onFilesPane(cb: (want: FilesWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<FilesWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
