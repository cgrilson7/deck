import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Home, RotateCw, Trash2, X } from 'lucide-react'
import type { WebApp } from '@shared/types'
import { patchSettings } from '../lib/theme'
import { openWebApp, shortUrl, writeSnap } from '../lib/webapps'
import { Fox } from './Fox'

/** One partition for every app (main/webapps.ts dresses it): a sign-in survives the deck quitting. */
const PARTITION = 'persist:web'
/** The tile's snapshot is retaken this often while the app is in view, and a beat after each load. */
const SNAP_EVERY = 15_000
const SNAP_AFTER_LOAD = 1_200

/**
 * The web apps in the CENTER column. Unlike the other panes this one is ALWAYS MOUNTED: a
 * <webview> that leaves the DOM loses its page, so every app opened this run keeps its webview
 * here and the layer is merely hidden (`visibility`, never `display: none`, which a webview
 * does not survive well) while the focus pane, the Studio or the Game Boy has the center. So
 * Village comes back to the note it was left on, mid-sentence. An app's webview is made the
 * first time it is opened, not before: each is a process of its own.
 */
export function WebLayer({ apps, open, onClose }: { apps: WebApp[]; /** The app showing, or null while something else has the center. */ open: string | null; onClose: () => void }) {
  const [visited, setVisited] = useState<string[]>([])
  useEffect(() => {
    if (open) setVisited((v) => (v.includes(open) ? v : [...v, open]))
  }, [open])

  // Esc gives the center back — only from the deck's own chrome: inside the page, Esc is the page's.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const live = apps.filter((a) => visited.includes(a.id))
  if (live.length === 0) return null
  return (
    <section className={`focus web-pane ${open ? '' : 'web-off'}`} aria-hidden={!open}>
      {live.map((a) => (
        <WebView key={a.id} app={a} rail={apps} active={a.id === open} onClose={onClose} />
      ))}
    </section>
  )
}

function WebView({ app, rail, active, onClose }: { app: WebApp; rail: WebApp[]; active: boolean; onClose: () => void }) {
  const view = useRef<DeckWebview>(null)
  // A webview's methods throw before its first dom-ready.
  const ready = useRef(false)
  const [nav, setNav] = useState({ url: app.url, title: '', loading: true, back: false, forward: false })
  const [failed, setFailed] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const activeRef = useRef(active)
  activeRef.current = active

  const snap = () => {
    const wv = view.current
    if (!wv || !ready.current || !activeRef.current || document.hidden) return
    void window.deck
      .webSnap(wv.getWebContentsId())
      .then((s) => s && writeSnap(app.id, s))
      .catch(() => {})
  }

  useEffect(() => {
    const wv = view.current
    if (!wv) return
    let after: number | undefined
    const read = () => ready.current && setNav((n) => ({ ...n, url: wv.getURL() || n.url, title: wv.getTitle(), back: wv.canGoBack(), forward: wv.canGoForward() }))
    const on: Record<string, (e: Event) => void> = {
      'dom-ready': () => {
        ready.current = true
        wv.setAudioMuted(!activeRef.current)
        read()
      },
      'did-start-loading': () => setNav((n) => ({ ...n, loading: true })),
      'did-stop-loading': () => {
        setNav((n) => ({ ...n, loading: false }))
        read()
        window.clearTimeout(after)
        after = window.setTimeout(snap, SNAP_AFTER_LOAD)
      },
      'did-navigate': () => {
        setFailed(null)
        read()
      },
      'did-navigate-in-page': read,
      'page-title-updated': read,
      'did-fail-load': (e) => {
        const f = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean; validatedURL: string }
        // -3 is a load we aborted ourselves (a redirect, a second click).
        if (f.isMainFrame && f.errorCode !== -3) setFailed(`${f.errorDescription || 'could not load'} · ${shortUrl(f.validatedURL)}`)
      }
    }
    for (const [k, h] of Object.entries(on)) wv.addEventListener(k, h)
    return () => {
      window.clearTimeout(after)
      for (const [k, h] of Object.entries(on)) wv.removeEventListener(k, h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // In view: the keyboard goes to the page, sound is on, and the tile's snapshot keeps up. Out of view: silent.
  useEffect(() => {
    const wv = view.current
    if (wv && ready.current) wv.setAudioMuted(!active)
    if (!active) return
    wv?.focus()
    const t = window.setInterval(snap, SNAP_EVERY)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!asking) return
    const t = window.setTimeout(() => setAsking(false), 3000)
    return () => window.clearTimeout(t)
  }, [asking])

  const wv = () => (ready.current ? view.current : null)
  const home = () => {
    setFailed(null)
    void wv()?.loadURL(app.url).catch(() => {})
  }
  const remove = () => {
    if (!asking) return setAsking(true)
    onClose()
    writeSnap(app.id, '')
    patchSettings({ webApps: rail.filter((a) => a.id !== app.id) })
  }

  return (
    <div className={`web-app ${active ? '' : 'web-off'}`}>
      <header className="pane-head">
        <Globe size={13} className="webapp-glyph" />
        <span className="name">{app.name}</span>
        <button className="ghost" disabled={!nav.back} title="Back" onClick={() => wv()?.goBack()}>
          <ArrowLeft size={13} />
        </button>
        <button className="ghost" disabled={!nav.forward} title="Forward" onClick={() => wv()?.goForward()}>
          <ArrowRight size={13} />
        </button>
        <button className="ghost" title={nav.loading ? 'Stop' : 'Reload the page'} onClick={() => (nav.loading ? wv()?.stop() : wv()?.reload())}>
          {nav.loading ? <X size={13} /> : <RotateCw size={12} />}
        </button>
        <button className="ghost" title={`Home: ${app.url}`} onClick={home}>
          <Home size={12} />
        </button>
        <span className={`web-url ${nav.loading ? 'loading' : ''}`} title={nav.title ? `${nav.title}\n${nav.url}` : nav.url}>
          {shortUrl(nav.url)}
        </span>
        <span className="spacer" />
        <button className="ghost" title="Open this page in the browser" onClick={() => window.deck.openExternal(nav.url)}>
          <ExternalLink size={12} />
        </button>
        <button className={`ghost ${asking ? 'web-danger' : ''}`} title={`Remove ${app.name} from the deck (its sign-in stays in the web partition)`} onClick={remove}>
          {asking ? 'remove?' : <Trash2 size={12} />}
        </button>
        <button className="ghost" title="Give the center back to the session (Esc)" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      {rail.length > 1 && (
        <div className="mol-rail">
          {rail.map((a) => (
            <button key={a.id} className={`pill ${a.id === app.id ? 'on' : ''}`} title={a.url} onClick={() => openWebApp(a.id)}>
              {a.name}
            </button>
          ))}
        </div>
      )}
      <div className="web-stage">
        <webview ref={view} className="web-view" src={app.url} partition={PARTITION} />
        {failed && (
          <div className="plugin-empty web-failed">
            <Fox anim="idle" scale={2} />
            <span>{failed}</span>
            <button className="pill" onClick={home}>
              try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
