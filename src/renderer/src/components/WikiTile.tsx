import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { WikiHit, WikiPicture, WikiSummary } from '@shared/types'
import { plain } from '../lib/errors'
import { WeatherPlaces, WeatherStrip } from './Weather'

/** A new picture every so often: today's, then two from the archive, then today's again. */
const CYCLE_MS = 2 * 60 * 1000
const TODAY_EVERY = 3
const SEARCH_DEBOUNCE_MS = 350

const DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const DAY_FMT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

/** "3 March 2019" for a YYYY-MM-DD, read as a local date. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return DAY_FMT.format(new Date(y, m - 1, d))
}

/** Date and time in the machine's zone, top left of the tile, ticking on the second; the weather sits under it. */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="wiki-clock" aria-hidden>
      <span className="wiki-clock-time">{TIME_FMT.format(now)}</span>
      <span className="wiki-clock-date">{DATE_FMT.format(now)}</span>
    </div>
  )
}

/**
 * The picture large, over the whole window: the image at 90% of the width with everything the
 * feed already handed us under it — what it is, who took it, and which day it was the picture of.
 * Nothing here is fetched; it is the tile's own picture, at a size worth looking at. A click
 * anywhere outside the frame, Esc, or the × closes it; the link opens the file page on Commons.
 */
function Viewer({ pic, onClose }: { pic: WikiPicture; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // A portal bubbles through the REACT tree, so without these the tile's own onClick sees every
    // click in here and re-opens the viewer the instant it closes.
    <div
      className="wikibox-scrim"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <figure className="wikibox" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={pic.title}>
        <img className="wikibox-img" src={pic.largeUrl || pic.imageUrl} alt={pic.title} draggable={false} />
        <figcaption className="wikibox-text">
          <span className="wikibox-tag">picture of the day · {pic.today ? 'today' : dayLabel(pic.date)}</span>
          <h3 className="wikibox-title">{pic.title}</h3>
          {pic.credit && <p className="wikibox-credit">{pic.credit}</p>}
          <button className="wikibox-link" onClick={() => window.deck.openExternal(pic.url)} title={pic.url}>
            on Wikimedia Commons ↗
          </button>
        </figcaption>
        <button
          className="wikibox-close"
          title="Close (Esc)"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X size={18} />
        </button>
      </figure>
    </div>
  )
}

/**
 * Wikipedia's picture of the day, full bleed, with a transparent search box in the top right and
 * a clock top left. The picture rotates: every CYCLE_MS a random day's picture from the archive
 * takes over, and every TODAY_EVERY-th one is today's again; ‹ › beside the caption's tag step
 * by hand (back through what was shown, forward to a new one) and start the clock over. A search takes over the tile: the
 * hits list over a darkened picture, a hit opens its lead section in place, and the title opens
 * Wikipedia in the browser. A CLICK ON THE PICTURE opens it large over the whole window
 * (`Viewer`), with its title and credit. Esc or the × brings the picture back. Under the clock
 * is the weather (`Weather.tsx`), and a click on it lays the places editor over the picture.
 */
export function WikiTile() {
  const [pic, setPic] = useState<WikiPicture | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WikiHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [article, setArticle] = useState<WikiSummary | null>(null)
  const [places, setPlaces] = useState(false)
  /** The picture being looked at full size, over the whole window. */
  const [viewing, setViewing] = useState<WikiPicture | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  // Every picture shown so far, so ‹ goes back through them; › past the newest loads another.
  const shown = useRef<WikiPicture[]>([])
  const at = useRef(-1)
  const step = useRef(0)
  const loading = useRef(false)
  /** Bumped by a manual step, which starts the cycle's clock over. */
  const [stepped, setStepped] = useState(0)

  const show = (i: number) => {
    at.current = i
    setPic(shown.current[i])
    setErr(null)
  }

  const next = () => {
    if (at.current < shown.current.length - 1) return show(at.current + 1)
    if (loading.current) return
    loading.current = true
    const when = step.current % TODAY_EVERY === 0 ? 'today' : 'past'
    step.current++
    window.deck
      .wikiPicture(when)
      .then((p) => {
        if (!p) return shown.current.length || setErr('No picture today')
        // Today's comes round every third time: point at the one already kept.
        const had = shown.current.findIndex((x) => x.date === p.date)
        if (had < 0) shown.current.push(p)
        show(had < 0 ? shown.current.length - 1 : had)
      })
      .catch((e: unknown) => setErr(plain(e)))
      .finally(() => (loading.current = false))
  }

  const prev = () => at.current > 0 && show(at.current - 1)

  useEffect(() => {
    if (at.current < 0) next()
    const t = window.setInterval(next, CYCLE_MS)
    return () => window.clearInterval(t)
  }, [stepped])

  const manual = (go: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    go()
    setStepped((n) => n + 1)
  }

  const search = (q: string) => {
    const id = ++seq.current
    if (!q.trim()) {
      setHits(null)
      setSearching(false)
      return
    }
    setSearching(true)
    window.deck
      .wikiSearch(q)
      .then((xs) => {
        if (id !== seq.current) return
        setHits(xs)
        setSearching(false)
      })
      .catch((e: unknown) => {
        if (id !== seq.current) return
        setErr(plain(e))
        setSearching(false)
      })
  }

  // Search after a typing pause; ⏎ searches at once.
  useEffect(() => {
    if (!query.trim()) {
      search('')
      return
    }
    const t = window.setTimeout(() => search(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [query])

  const reset = () => {
    seq.current++
    setQuery('')
    setHits(null)
    setArticle(null)
    setSearching(false)
    setPlaces(false)
    setViewing(null)
    input.current?.blur()
  }

  const open = (h: WikiHit) => {
    setArticle({ title: h.title, description: h.description, extract: '', imageUrl: h.imageUrl, url: h.url })
    window.deck
      .wikiSummary(h.key)
      .then(setArticle)
      .catch((e: unknown) => setErr(plain(e)))
  }

  const overlay = article ? 'article' : hits || searching ? 'results' : places ? 'places' : 'picture'
  const bg = article?.imageUrl ?? pic?.imageUrl ?? null

  return (
    <div
      className={`tile tile-plugin wiki wiki-${overlay}`}
      onClick={() => overlay === 'picture' && pic && setViewing(pic)}
      title={overlay === 'picture' && pic ? 'See it full size' : undefined}
    >
      {bg && <img key={bg} className="wiki-img" src={bg} alt="" draggable={false} />}
      <div className="wiki-scrim" />
      <div className="wiki-corner">
        <Clock />
        {overlay === 'picture' && <WeatherStrip onEdit={() => setPlaces(true)} />}
      </div>

      {overlay === 'picture' && (pic ? (
        <div className="wiki-text">
          <span className="wiki-tagline">
            <span className="wiki-tag">{pic.today ? 'picture of the day' : `picture of the day · ${dayLabel(pic.date)}`}</span>
            <span className="wiki-steps">
              <button onClick={manual(prev)} disabled={at.current <= 0} title="The picture before">
                ‹
              </button>
              <button onClick={manual(next)} title="Another picture">
                ›
              </button>
            </span>
          </span>
          <h3 className="wiki-title">{pic.title}</h3>
          {pic.credit && <p className="wiki-summary">{pic.credit}</p>}
        </div>
      ) : (
        <div className="plugin-empty wiki-empty">{err ?? 'wikipedia…'}</div>
      ))}

      {overlay === 'results' && (
        <div className="wiki-panel" onClick={(e) => e.stopPropagation()}>
          {hits && hits.length === 0 && !searching && <div className="wiki-none">Nothing for “{query.trim()}”</div>}
          {hits?.map((h) => (
            <button key={h.key} className="wiki-hit" onClick={() => open(h)} title={h.url}>
              {h.imageUrl ? <img src={h.imageUrl} alt="" draggable={false} /> : <span className="wiki-hit-noimg" />}
              <span className="wiki-hit-text">
                <span className="wiki-hit-title">{h.title}</span>
                {h.description && <span className="wiki-hit-desc">{h.description}</span>}
                {h.excerpt && <span className="wiki-hit-excerpt">{h.excerpt}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {overlay === 'article' && article && (
        <div className="wiki-panel wiki-article" onClick={(e) => e.stopPropagation()}>
          <button className="wiki-back" onClick={() => setArticle(null)} title="Back to results">
            ‹ results
          </button>
          <h3 className="wiki-title">
            <button className="wiki-link" onClick={() => window.deck.openExternal(article.url)} title="Open on Wikipedia">
              {article.title} ↗
            </button>
          </h3>
          {article.description && <div className="wiki-hit-desc">{article.description}</div>}
          <p className="wiki-extract">{article.extract || '…'}</p>
        </div>
      )}

      {overlay === 'places' && <WeatherPlaces onClose={() => setPlaces(false)} />}

      <form
        className={`wiki-search ${searching ? 'searching' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          search(query)
        }}
      >
        <input
          ref={input}
          value={query}
          placeholder="search wikipedia"
          spellCheck={false}
          onChange={(e) => {
            setArticle(null)
            setQuery(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              reset()
            }
          }}
        />
        {(query || overlay !== 'picture') && (
          <button type="button" className="wiki-clear" onClick={reset} title="Clear (Esc)">
            ×
          </button>
        )}
      </form>

      {/* Over the whole window, so the grid column's scroller never clips it. */}
      {viewing && createPortal(<Viewer pic={viewing} onClose={() => setViewing(null)} />, document.body)}
    </div>
  )
}
