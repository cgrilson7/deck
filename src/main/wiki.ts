// The Wikipedia tile's data: the English Wikipedia featured-content feed for today
// (picture of the day, featured article, on this day, most read), reduced to cards that
// have an image. Fetched in main because the renderer's CSP allows no outbound requests.

import type { WikiItem } from '@shared/types'

const UA = 'deck/0.1 (https://github.com/cgrilson7/deck)'
const TTL_MS = 60 * 60 * 1000

interface Page {
  title?: string
  displaytitle?: string
  normalizedtitle?: string
  extract?: string
  thumbnail?: { source: string; width: number; height: number }
  content_urls?: { desktop?: { page?: string } }
}

interface Feed {
  tfa?: Page
  image?: {
    title?: string
    thumbnail?: { source: string }
    image?: { source: string }
    description?: { text?: string }
    artist?: { text?: string }
    file_page?: string
  }
  mostread?: { articles?: Page[] }
  onthisday?: { text: string; year: number; pages: Page[] }[]
}

let cache: { at: number; items: WikiItem[] } | null = null

function strip(html: string | undefined): string {
  return (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/** Wikipedia thumbnails encode their width in the path; ask for one big enough for a tile. */
function upscale(url: string, px = 1200): string {
  return url.replace(/\/(\d+)px-/, (m, w) => (Number(w) < px ? `/${px}px-` : m))
}

function pageItem(p: Page, kind: WikiItem['kind'], tag: string): WikiItem | null {
  const img = p.thumbnail?.source
  const url = p.content_urls?.desktop?.page
  if (!img || !url) return null
  return {
    kind,
    tag,
    title: strip(p.displaytitle) || p.normalizedtitle || (p.title ?? '').replace(/_/g, ' '),
    summary: strip(p.extract),
    imageUrl: upscale(img),
    url
  }
}

function reduce(f: Feed): WikiItem[] {
  const out: WikiItem[] = []
  const img = f.image
  if (img?.thumbnail?.source && img.file_page) {
    const name = (img.title ?? '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    out.push({
      kind: 'potd',
      tag: 'picture of the day',
      title: strip(img.description?.text) || name,
      summary: img.artist?.text ? `Photo: ${strip(img.artist.text)}` : '',
      imageUrl: upscale(img.thumbnail.source),
      url: img.file_page
    })
  }
  if (f.tfa) {
    const it = pageItem(f.tfa, 'tfa', 'featured article')
    if (it) out.push(it)
  }
  for (const ev of (f.onthisday ?? []).slice(0, 4)) {
    const p = ev.pages.find((x) => x.thumbnail?.source)
    if (!p) continue
    const it = pageItem(p, 'onthisday', `on this day · ${ev.year}`)
    if (it) out.push({ ...it, summary: strip(ev.text) || it.summary })
  }
  let n = 0
  for (const a of f.mostread?.articles ?? []) {
    const it = pageItem(a, 'mostread', 'trending today')
    if (it && (n += 1) <= 4) out.push(it)
  }
  return out
}

export async function wikiFeatured(): Promise<WikiItem[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items
  const d = new Date()
  const ymd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${ymd}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`wikipedia feed: HTTP ${res.status}`)
  const items = reduce((await res.json()) as Feed)
  cache = { at: Date.now(), items }
  return items
}
