import { useEffect, useState } from 'react'
import type { WikiItem } from '@shared/types'

const CYCLE_MS = 20_000
const REFRESH_MS = 60 * 60 * 1000

/**
 * Wikipedia's featured content for today as full-bleed cards: picture of the day, the
 * featured article, on-this-day events, trending articles. Cycles on its own; click opens
 * the article in the browser.
 */
export function WikiTile() {
  const [items, setItems] = useState<WikiItem[]>([])
  const [i, setI] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      window.deck
        .wikiFeatured()
        .then((xs) => {
          if (!alive) return
          setItems(xs)
          setErr(xs.length ? null : 'Nothing with a picture today')
        })
        .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)))
    void load()
    const t = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  useEffect(() => {
    if (items.length < 2) return
    const t = window.setInterval(() => setI((n) => (n + 1) % items.length), CYCLE_MS)
    return () => window.clearInterval(t)
  }, [items, i]) // `i` in deps restarts the timer after a manual step

  // Warm the next image so the swap is instant.
  useEffect(() => {
    const next = items[(i + 1) % items.length]
    if (next) new Image().src = next.imageUrl
  }, [items, i])

  const it = items[i]
  if (!it) {
    return (
      <div className="tile tile-plugin wiki">
        <div className="plugin-empty">{err ?? 'wikipedia…'}</div>
      </div>
    )
  }

  const step = (d: number) => setI((n) => (n + d + items.length) % items.length)

  return (
    <div className="tile tile-plugin wiki" onClick={() => window.deck.openExternal(it.url)} title="Open on Wikipedia">
      <img key={it.imageUrl} className="wiki-img" src={it.imageUrl} alt="" draggable={false} />
      <div className="wiki-scrim" />
      <div className="wiki-text">
        <span className="wiki-tag">{it.tag}</span>
        <h3 className="wiki-title">{it.title}</h3>
        {it.summary && <p className="wiki-summary">{it.summary}</p>}
      </div>
      {items.length > 1 && (
        <div className="wiki-nav" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => step(-1)} title="Previous">
            ‹
          </button>
          <span>
            {i + 1}/{items.length}
          </span>
          <button onClick={() => step(1)} title="Next">
            ›
          </button>
        </div>
      )}
    </div>
  )
}
