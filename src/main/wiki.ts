// The Wikipedia tile's data, fetched in main because the renderer's CSP allows no outbound
// requests: the picture of the day (from the featured-content feed: today's cached 1h, past days
// for good, they never change), full-text search (the REST v1 search endpoint) and page
// summaries for the in-tile article view.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WikiBackdrop, WikiHit, WikiPicture, WikiSummary } from '@shared/types'

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

/** Picture of the day by local YYYY-MM-DD; `at` only matters for today's entry (TTL_MS). */
const pictures = new Map<string, { at: number; item: WikiPicture | null }>()

/** The featured feed's `image` is there for days from about here on; earlier days come back empty. */
const ARCHIVE_FROM = Date.UTC(2016, 0, 1)
const DAY_MS = 24 * 60 * 60 * 1000
const PAST_TRIES = 4

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function strip(html: string | undefined | null): string {
  return (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Wikipedia thumbnails encode their width in the path. Only a fixed set of widths is served
 * (250, 330, 500, 960, 1280, 1920 work; 640/800/1024/1200 are HTTP 400), so never pick a
 * number off that list. The search endpoint hands out protocol-relative 60px ones with a
 * tracking query string; both are dropped.
 */
function thumb(url: string, width: 250 | 960 | 1920): string {
  return url
    .replace(/^\/\//, 'https://')
    .replace(/\?.*$/, '')
    .replace(/\/\d+px-/, `/${width}px-`)
}

async function pictureOn(date: string): Promise<WikiPicture | null> {
  const today = date === ymd(new Date())
  const hit = pictures.get(date)
  if (hit && (!today || Date.now() - hit.at < TTL_MS)) return hit.item
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${date.replace(/-/g, '/')}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`wikipedia feed: HTTP ${res.status}`)
  const img = ((await res.json()) as Feed).image
  let item: WikiPicture | null = null
  if (img?.thumbnail?.source && img.file_page) {
    const name = (img.title ?? '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    item = {
      date,
      today,
      title: strip(img.description?.text) || name,
      credit: img.artist?.text ? strip(img.artist.text) : '',
      imageUrl: thumb(img.thumbnail.source, 960),
      largeUrl: thumb(img.thumbnail.source, 1920),
      url: img.file_page
    }
  }
  pictures.set(date, { at: Date.now(), item })
  return item
}

/** A random local day between ARCHIVE_FROM and yesterday. */
function randomPastDay(): string {
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const span = Math.max(1, Math.floor((yesterday.getTime() - ARCHIVE_FROM) / DAY_MS))
  const back = Math.floor(Math.random() * span)
  return ymd(new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - back))
}

/**
 * Today's picture of the day, or with 'past' the picture from a random day of the archive: a
 * few days are tried (a day can miss, the feed can hiccup) and the last resort is today's.
 */
export async function wikiPicture(when: 'today' | 'past' = 'today'): Promise<WikiPicture | null> {
  if (when === 'past') {
    for (let i = 0; i < PAST_TRIES; i++) {
      try {
        const item = await pictureOn(randomPastDay())
        if (item) return item
      } catch {
        // try another day
      }
    }
  }
  return pictureOn(ymd(new Date()))
}

/**
 * The glass theme's backdrop: a day's picture ('' = today's) at the SMALLEST width Wikimedia
 * serves (250px — it is only ever seen blurred, so more would be wasted), as a data: URL, since
 * the renderer has to read its pixels for the colors. Kept in `dir` for good (a day's picture
 * never changes), so a pinned day costs one request ever, and with no network today's falls
 * back to the newest one kept.
 */
export async function wikiBackdrop(date: string, dir: string): Promise<WikiBackdrop | null> {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ymd(new Date())
  const file = join(dir, `${day}.json`)
  try {
    return JSON.parse(await readFile(file, 'utf8')) as WikiBackdrop
  } catch {
    // not kept yet
  }
  try {
    const pic = await pictureOn(day)
    if (!pic) return null
    const res = await fetch(thumb(pic.imageUrl, 250), { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`wikipedia backdrop: HTTP ${res.status}`)
    const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]
    if (!mime.startsWith('image/')) throw new Error(`wikipedia backdrop: ${mime}`)
    const item: WikiBackdrop = { date: day, title: pic.title, dataUrl: `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}` }
    await mkdir(dir, { recursive: true })
    await writeFile(file, JSON.stringify(item))
    return item
  } catch (err) {
    if (date) throw err
    const kept = (await readdir(dir).catch(() => [])).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    if (kept.length === 0) throw err
    return JSON.parse(await readFile(join(dir, kept[kept.length - 1]), 'utf8')) as WikiBackdrop
  }
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
