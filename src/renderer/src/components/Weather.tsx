import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { WEATHER_PLACES_MAX, type WeatherNow, type WeatherPlace } from '@shared/types'
import { patchSettings, useSettings } from '../lib/theme'
import { plain } from '../lib/errors'

/** Main caches 10 min; asking a little more often than that costs nothing and never shows it staler. */
const REFRESH_MS = 5 * 60 * 1000
const SEARCH_DEBOUNCE_MS = 350

/** A WMO weather code as a glyph (text presentation, so it takes the tile's white) and a word. */
function look(code: number, day: boolean): { glyph: string; label: string } {
  const g = (glyph: string, label: string) => ({ glyph: `${glyph}\uFE0E`, label })
  if (code === 0) return g(day ? '☀' : '☾', 'Clear')
  if (code === 1) return g(day ? '☀' : '☾', 'Mostly clear')
  if (code === 2) return g('⛅', 'Partly cloudy')
  if (code === 3) return g('☁', 'Overcast')
  if (code === 45 || code === 48) return g('≋', 'Fog')
  if (code >= 51 && code <= 55) return g('☂', 'Drizzle')
  if (code === 56 || code === 57) return g('☂', 'Freezing drizzle')
  if (code === 61) return g('☂', 'Light rain')
  if (code === 63) return g('☂', 'Rain')
  if (code === 65) return g('☂', 'Heavy rain')
  if (code === 66 || code === 67) return g('☂', 'Freezing rain')
  if (code === 71) return g('❄', 'Light snow')
  if (code === 73) return g('❄', 'Snow')
  if (code === 75) return g('❄', 'Heavy snow')
  if (code === 77) return g('❄', 'Snow grains')
  if (code >= 80 && code <= 82) return g('☂', 'Showers')
  if (code === 85 || code === 86) return g('❄', 'Snow showers')
  if (code >= 95) return g('⚡', 'Thunderstorm')
  return g('·', '')
}

const deg = (n: number | null): string => (n === null ? '–' : `${n}°`)
const same = (a: WeatherPlace, b: WeatherPlace): boolean => a.lat === b.lat && a.lon === b.lon

/** The `weatherPlaces` setting's weather, asked again every few minutes and whenever the places or the unit change. */
function useWeather(): { rows: WeatherNow[]; err: string | null } {
  const { weatherPlaces, weatherUnit } = useSettings()
  const [rows, setRows] = useState<WeatherNow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const key = JSON.stringify([weatherPlaces, weatherUnit])
  useEffect(() => {
    let alive = true
    const load = () =>
      window.deck
        .weather()
        .then((xs) => {
          if (!alive) return
          setRows(xs)
          setErr(null)
        })
        .catch((e: unknown) => alive && setErr(plain(e)))
    load()
    const t = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [key])
  // Rows of a list the setting no longer is (one just removed) are dropped before the refetch lands.
  return { rows: rows.filter((r) => weatherPlaces.some((p) => same(p, r.place))), err }
}

/** "3:42 PM" there, for a place whose clock is not this machine's. */
function timeThere(row: WeatherNow): string | null {
  if (!row.timezone || row.utcOffset === -new Date().getTimezoneOffset() * 60) return null
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: row.timezone }).format(new Date())
  } catch {
    return null
  }
}

/**
 * The weather under the Wikipedia tile's clock: the first place large (glyph, temperature, the
 * word for it, then its name with today's high and low), the others a line each, with their own
 * time when that differs. A click opens the places editor.
 */
export function WeatherStrip({ onEdit }: { onEdit: () => void }) {
  const { weatherPlaces } = useSettings()
  const { rows, err } = useWeather()
  const edit = (e: MouseEvent) => {
    e.stopPropagation()
    onEdit()
  }
  if (!weatherPlaces.length)
    return (
      <button className="wiki-weather wiki-weather-none" onClick={edit} title="Show the weather somewhere">
        + weather
      </button>
    )
  const [first, ...others] = rows
  if (!first)
    return (
      <button className="wiki-weather wiki-weather-none" onClick={edit} title={err ?? 'Weather places'}>
        {err ? 'no weather' : 'weather…'}
      </button>
    )
  const now = look(first.code, first.day)
  return (
    <button className="wiki-weather" onClick={edit} title={`${first.place.name}: feels like ${deg(first.feels)}, wind ${first.wind ?? '–'} ${first.unit === 'F' ? 'mph' : 'km/h'} · click to change places`}>
      <span className="wiki-weather-now">
        <span className="wiki-weather-glyph">{now.glyph}</span>
        <span className="wiki-weather-temp">{deg(first.temp)}</span>
        <span className="wiki-weather-label">{now.label}</span>
      </span>
      <span className="wiki-weather-place">
        {first.place.name} · H {deg(first.high)} L {deg(first.low)}
      </span>
      {others.map((r) => {
        const l = look(r.code, r.day)
        const t = timeThere(r)
        return (
          <span key={`${r.place.lat},${r.place.lon}`} className="wiki-weather-other" title={l.label}>
            <span className="wiki-weather-glyph">{l.glyph}</span>
            <span className="wiki-weather-temp">{deg(r.temp)}</span>
            <span>{r.place.name}</span>
            {t && <span className="wiki-weather-time">{t}</span>}
          </span>
        )
      })}
    </button>
  )
}

/**
 * The places editor, a panel over the darkened picture like a search's results: the places in
 * order (↑ makes one the first, × removes it), °F / °C, and a line that finds a place by name
 * ("Portland, Maine"; a hit adds it). Esc or "done" closes.
 */
export function WeatherPlaces({ onClose }: { onClose: () => void }) {
  const { weatherPlaces, weatherUnit } = useSettings()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WeatherPlace[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const seq = useRef(0)
  const full = weatherPlaces.length >= WEATHER_PLACES_MAX

  useEffect(() => {
    const id = ++seq.current
    if (query.trim().length < 2) {
      setHits(null)
      return
    }
    const t = window.setTimeout(() => {
      window.deck
        .weatherSearch(query)
        .then((xs) => {
          if (id !== seq.current) return
          setHits(xs)
          setErr(null)
        })
        .catch((e: unknown) => id === seq.current && setErr(plain(e)))
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [query])

  const add = (p: WeatherPlace) => {
    if (!weatherPlaces.some((x) => same(x, p))) patchSettings({ weatherPlaces: [...weatherPlaces, p] })
    setQuery('')
  }
  const remove = (p: WeatherPlace) => patchSettings({ weatherPlaces: weatherPlaces.filter((x) => !same(x, p)) })
  const lead = (p: WeatherPlace) => patchSettings({ weatherPlaces: [p, ...weatherPlaces.filter((x) => !same(x, p))] })

  return (
    <div className="wiki-panel wiki-places" onClick={(e) => e.stopPropagation()}>
      <div className="wiki-places-head">
        <span className="wiki-tag">weather</span>
        <span className="wiki-places-units">
          {(['F', 'C'] as const).map((u) => (
            <button key={u} className={u === weatherUnit ? 'on' : ''} onClick={() => patchSettings({ weatherUnit: u })}>
              °{u}
            </button>
          ))}
        </span>
        <button className="wiki-back" onClick={onClose} title="Close (Esc)">
          done
        </button>
      </div>
      {weatherPlaces.map((p, i) => (
        <div key={`${p.lat},${p.lon}`} className="wiki-place">
          <span className="wiki-place-name">
            {p.name}
            {p.region && <span className="wiki-hit-desc"> {p.region}</span>}
          </span>
          {i > 0 && (
            <button onClick={() => lead(p)} title="Make it the first">
              ↑
            </button>
          )}
          <button onClick={() => remove(p)} title="Remove">
            ×
          </button>
        </div>
      ))}
      <input
        className="wiki-place-input"
        value={query}
        autoFocus
        disabled={full}
        placeholder={full ? `${WEATHER_PLACES_MAX} places is the most` : 'add a place: Portland, Maine'}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter' && hits?.[0]) add(hits[0])
        }}
      />
      {err && <div className="wiki-none">{err}</div>}
      {hits && hits.length === 0 && <div className="wiki-none">Nowhere called “{query.trim()}”</div>}
      {hits?.map((p) => (
        <button key={`${p.lat},${p.lon}`} className="wiki-hit wiki-place-hit" onClick={() => add(p)}>
          <span className="wiki-hit-title">{p.name}</span>
          <span className="wiki-hit-desc">{p.region}</span>
        </button>
      ))}
    </div>
  )
}
