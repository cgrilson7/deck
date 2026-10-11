import { useSyncExternalStore } from 'react'

// Web apps (Village, …): opening one in the center is a window event App listens to, the way the
// Studio and the Game Boy are raised; a tile's face is the last SNAPSHOT of its page, kept in
// localStorage so the tile has something to show before the app has been opened this run.

const EVENT = 'deck:webapp'

export interface WebWant {
  want: boolean | 'toggle'
  /** Which app; none = the one showing (close), or the first registered (open / toggle). */
  id?: string
}

export function openWebApp(id: string): void {
  window.dispatchEvent(new CustomEvent<WebWant>(EVENT, { detail: { want: true, id } }))
}
export function closeWebApp(): void {
  window.dispatchEvent(new CustomEvent<WebWant>(EVENT, { detail: { want: false } }))
}

export function onWebApp(cb: (want: WebWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<WebWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

const SNAP_KEY = (id: string) => `deck.web.snap.${id}`
const snaps = new Map<string, string>()
const subs = new Set<() => void>()

function readSnap(id: string): string {
  let s = snaps.get(id)
  if (s === undefined) {
    try {
      s = localStorage.getItem(SNAP_KEY(id)) ?? ''
    } catch {
      s = ''
    }
    snaps.set(id, s)
  }
  return s
}

/** '' forgets it (the app was removed). */
export function writeSnap(id: string, dataUrl: string): void {
  snaps.set(id, dataUrl)
  try {
    if (dataUrl) localStorage.setItem(SNAP_KEY(id), dataUrl)
    else localStorage.removeItem(SNAP_KEY(id))
  } catch {}
  for (const s of subs) s()
}

const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => subs.delete(cb)
}

/** The app's last snapshot as a data: URL, '' when it has never been opened. */
export function useWebSnap(id: string): string {
  return useSyncExternalStore(subscribe, () => readSnap(id))
}

/** "villagenotes.app/dream" of a URL, for a head. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, '') + u.search
  } catch {
    return url
  }
}

// THE DOCK: a web app's tile is a live view of the page, not only a snapshot. The webview cannot
// move into the tile (a webview that leaves the DOM loses its page), so the tile registers its
// face here and WebLayer lays that app's webview over it, following it as the column scrolls.
const faces = new Map<string, HTMLElement>()
const faceSubs = new Set<() => void>()

/** The tile's face for an app, or null as the tile goes away. */
export function dockFace(id: string, el: HTMLElement | null): void {
  if (el) faces.set(id, el)
  else faces.delete(id)
  for (const s of faceSubs) s()
}

let faceVersion = 0
faceSubs.add(() => faceVersion++)
const subscribeFaces = (cb: () => void) => {
  faceSubs.add(cb)
  return () => faceSubs.delete(cb)
}

/** The ids whose tiles are in the grid now (each a dock for its webview). */
export function useDockedIds(): string[] {
  useSyncExternalStore(subscribeFaces, () => faceVersion)
  return [...faces.keys()]
}

export function faceOf(id: string): HTMLElement | null {
  return faces.get(id) ?? null
}
