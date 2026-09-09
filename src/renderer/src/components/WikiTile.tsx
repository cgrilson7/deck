import { useEffect, useRef, useState } from 'react'
import type { WikiHit, WikiPicture, WikiSummary } from '@shared/types'

const REFRESH_MS = 60 * 60 * 1000
const SEARCH_DEBOUNCE_MS = 350

/**
 * Wikipedia's picture of the day, full bleed, with a transparent search box in the top right.
 * A search takes over the tile: the hits list over a darkened picture, a hit opens its lead
 * section in place, and the title (or the picture) opens Wikipedia in the browser. Esc or the ×
 * brings the picture back.
 */
export function WikiTile() {
  const [pic, setPic] = useState<WikiPicture | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WikiHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [article, setArticle] = useState<WikiSummary | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    let alive = true
    const load = () =>
      window.deck
        .wikiPicture()
        .then((p) => {
          if (!alive) return
          setPic(p)
          setErr(p ? null : 'No picture today')
        })
        .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)))
    void load()
    const t = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

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
        setErr(e instanceof Error ? e.message : String(e))
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
    input.current?.blur()
  }

  const open = (h: WikiHit) => {
    setArticle({ title: h.title, description: h.description, extract: '', imageUrl: h.imageUrl, url: h.url })
    window.deck
      .wikiSummary(h.key)
      .then(setArticle)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
  }

  const overlay = article ? 'article' : hits || searching ? 'results' : 'picture'
  const bg = article?.imageUrl ?? pic?.imageUrl ?? null

  return (
    <div className={`tile tile-plugin wiki wiki-${overlay}`} onClick={() => overlay === 'picture' && pic && window.deck.openExternal(pic.url)} title={overlay === 'picture' && pic ? 'Open on Wikipedia' : undefined}>
      {bg && <img key={bg} className="wiki-img" src={bg} alt="" draggable={false} />}
      <div className="wiki-scrim" />

      {overlay === 'picture' && (pic ? (
        <div className="wiki-text">
          <span className="wiki-tag">picture of the day</span>
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
    </div>
  )
}
