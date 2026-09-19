// The weather under the Wikipedia tile's clock, fetched in main like the rest of that tile's data
// (the renderer's CSP allows no outbound requests). Open-Meteo, which needs no key: one forecast
// call for every place of the `weatherPlaces` setting (cached 10 min), and its geocoder for the
// tile's "add a place" line.

import { WEATHER_PLACES_MAX, type TempUnit, type WeatherNow, type WeatherPlace } from '@shared/types'

const TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 12_000

interface Forecast {
  timezone?: string
  utc_offset_seconds?: number
  current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number; is_day?: number; wind_speed_10m?: number }
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] }
}

interface GeoHit {
  name?: string
  latitude?: number
  longitude?: number
  admin1?: string
  country?: string
  country_code?: string
}

let cached: { key: string; at: number; rows: WeatherNow[] } | null = null

const round = (n: number | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null)

/** Now, and today's high and low, for each place, in order. Throws when Open-Meteo cannot be reached. */
export async function weatherNow(places: WeatherPlace[], unit: TempUnit): Promise<WeatherNow[]> {
  if (!places.length) return []
  const key = JSON.stringify([places.map((p) => [p.lat, p.lon]), unit])
  if (cached && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.rows
  const q = new URLSearchParams({
    latitude: places.map((p) => p.lat).join(','),
    longitude: places.map((p) => p.lon).join(','),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '1',
    timezone: 'auto',
    temperature_unit: unit === 'F' ? 'fahrenheit' : 'celsius',
    wind_speed_unit: unit === 'F' ? 'mph' : 'kmh'
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`weather: HTTP ${res.status}`)
  // One place comes back as an object, several as a list in the order asked.
  const body = (await res.json()) as Forecast | Forecast[]
  const list = Array.isArray(body) ? body : [body]
  const rows = places.map((place, i): WeatherNow => {
    const f = list[i] ?? {}
    return {
      place,
      unit,
      temp: round(f.current?.temperature_2m),
      feels: round(f.current?.apparent_temperature),
      high: round(f.daily?.temperature_2m_max?.[0]),
      low: round(f.daily?.temperature_2m_min?.[0]),
      wind: round(f.current?.wind_speed_10m),
      code: f.current?.weather_code ?? -1,
      day: f.current?.is_day !== 0,
      timezone: f.timezone ?? '',
      utcOffset: f.utc_offset_seconds ?? 0
    }
  })
  cached = { key, at: Date.now(), rows }
  return rows
}

/**
 * Places by name. The geocoder matches the name alone, so "Portland, Maine" searches "Portland"
 * and puts the hits whose state / country match the rest first.
 */
export async function weatherSearch(query: string): Promise<WeatherPlace[]> {
  const [name, ...rest] = query.split(',').map((s) => s.trim()).filter(Boolean)
  if (!name || name.length < 2) return []
  const q = new URLSearchParams({ name, count: '10', language: 'en', format: 'json' })
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`weather search: HTTP ${res.status}`)
  const hits = ((await res.json()) as { results?: GeoHit[] }).results ?? []
  const want = rest.join(' ').toLowerCase()
  const score = (h: GeoHit): number => {
    if (!want) return 0
    const words = [h.admin1, h.country, h.country_code].map((s) => (s ?? '').toLowerCase())
    return words.some((w) => w === want) ? 0 : words.some((w) => w && (w.startsWith(want) || want.startsWith(w))) ? 1 : 2
  }
  return hits
    .filter((h) => h.name && typeof h.latitude === 'number' && typeof h.longitude === 'number')
    .map((h, i) => ({ h, i, s: score(h) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, WEATHER_PLACES_MAX + 2)
    .map(({ h }) => ({
      name: h.name!,
      region: [h.admin1, h.country_code ?? h.country].filter(Boolean).join(', '),
      lat: Math.round(h.latitude! * 1e4) / 1e4,
      lon: Math.round(h.longitude! * 1e4) / 1e4
    }))
}
