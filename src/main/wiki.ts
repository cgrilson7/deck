// The Wikipedia tile's data, fetched in main because the renderer's CSP allows no outbound
// requests: today's picture of the day (from the featured-content feed, cached 1h), full-text
// search (the REST v1 search endpoint) and page summaries for the in-tile article view.

import type { WikiHit, WikiPicture, WikiSummary } from '@shared/types'

const UA = 'deck/0.1 (https://github.com/cgrilson7/deck)'
const TTL_MS = 60 * 60 * 1000
const HEADERS = { 'User-Agent': UA, Accept: 'application/json' }

interface Feed {
  image?: {
    title?: string
    thumbnail?: { source: string }
    description?: { text?: string }
    artist?: { text?: string }
    file_page?: string
  }
}

interface SearchPage {
  key: string
  title: string
  excerpt?: string
  description?: string | null
  thumbnail?: { url: string } | null
}

interface Summary {
  title?: string
  displaytitle?: string
  description?: string
  extract?: string
  thumbnail?: { source: string }
  content_urls?: { desktop?: { page?: string } }
}

let picture: { at: number; item: WikiPicture | null } | null = null

function strip(html: string | undefined | null): string {
  return (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Wikipedia thumbnails encode their width in the path. Only a fixed set of widths is served
 * (250, 330, 500, 960, 1280, 1920 work; 640/800/1024/1200 are HTTP 400), so never pick a
 * number off that list. The search endpoint hands out protocol-relative 60px ones with a
 * tracking query string; both are dropped.
 */
function thumb(url: string, width: 250 | 960): string {
  return url
    .replace(/^\/\//, 'https://')
    .replace(/\?.*$/, '')
    .replace(/\/\d+px-/, `/${width}px-`)
}

export async function wikiPicture(): Promise<WikiPicture | null> {
  if (picture && Date.now() - picture.at < TTL_MS) return picture.item
  const d = new Date()
  const ymd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${ymd}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`wikipedia feed: HTTP ${res.status}`)
  const img = ((await res.json()) as Feed).image
  let item: WikiPicture | null = null
  if (img?.thumbnail?.source && img.file_page) {
    const name = (img.title ?? '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    item = {
      title: strip(img.description?.text) || name,
      credit: img.artist?.text ? strip(img.artist.text) : '',
      imageUrl: thumb(img.thumbnail.source, 960),
      url: img.file_page
    }
  }
  picture = { at: Date.now(), item }
  return item
}

export async function wikiSearch(q: string): Promise<WikiHit[]> {
  const query = q.trim()
  if (!query) return []
  const res = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=12`, { headers: HEADERS })
  if (!res.ok) throw new Error(`wikipedia search: HTTP ${res.status}`)
  const pages = ((await res.json()) as { pages?: SearchPage[] }).pages ?? []
  return pages.map((p) => ({
    key: p.key,
    title: p.title,
    description: strip(p.description),
    excerpt: strip(p.excerpt),
    imageUrl: p.thumbnail?.url ? thumb(p.thumbnail.url, 250) : null,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`
  }))
}

export async function wikiSummary(key: string): Promise<WikiSummary> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`wikipedia summary: HTTP ${res.status}`)
  const s = (await res.json()) as Summary
  return {
    title: strip(s.displaytitle) || s.title || key.replace(/_/g, ' '),
    description: strip(s.description),
    extract: (s.extract ?? '').trim(),
    imageUrl: s.thumbnail?.source ? thumb(s.thumbnail.source, 960) : null,
    url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(key)}`
  }
}
