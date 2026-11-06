// The Sleepgod tile: heart rate, steps, skin temperature and last night's sleep from the sleepgod
// server (~/sleepgod), four numbers at a glance. Main does the asking (main/sleepgod.ts). The numbers
// are as of the ring's last sync, about every 30 minutes, unless its live view is running, when the
// heart rate is live. The refresh button syncs now. ↗ opens the server's own pages, which hold the detail.

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, HeartPulse, RefreshCw } from 'lucide-react'
import type { SleepgodSummary } from '@shared/types'
import { CellTools } from '../lib/celltools'

const POLL_MS = 15_000
const SYNCING_POLL_MS = 2_000
const PAGE = 'http://127.0.0.1:8484/today'

const hm = (min: number): string => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`
const clock = (unix: number): string => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
/** A night's ISO time keeps its own offset, so read the wall clock it says rather than converting it. */
const wall = (iso: string): string => {
  const h = Number(iso.slice(11, 13))
  return `${h % 12 || 12}:${iso.slice(14, 16)}${h < 12 ? 'am' : 'pm'}`
}
const old = (unix: number | null, now: number): boolean => unix !== null && now - unix > 2 * 3600

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const W = 100
  const H = 22
  const lo = Math.min(...values)
  const span = Math.max(Math.max(...values) - lo, 1)
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / span) * (H - 4)).toFixed(1)}`)
  return (
    <svg className="sleepgod-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function Metric(props: { label: string; value: string; unit?: string; note: string; title?: string; dim?: boolean; spark?: number[] }) {
  return (
    <div className="sleepgod-metric" title={props.title}>
      <div className="sleepgod-label">{props.label}</div>
      <div className={props.dim ? 'sleepgod-value sleepgod-dim' : 'sleepgod-value'}>
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </div>
      <div className="sleepgod-note">{props.note}</div>
      {props.spark && <Spark values={props.spark} />}
    </div>
  )
}

export function SleepgodTile() {
  const [data, setData] = useState<SleepgodSummary | null>(null)
  const [asked, setAsked] = useState(false)
  const [clicked, setClicked] = useState(false) // a failure shows only to whoever just pressed the button
  const [refused, setRefused] = useState<string | null>(null)
  const ask = useCallback((): void => {
    if (document.visibilityState === 'hidden') return
    window.deck
      .sleepgod()
      .then((r) => (setData(r), setAsked(true)))
      .catch(() => (setData(null), setAsked(true)))
  }, [])
  const syncing = data?.sync.running ?? false
  useEffect(() => {
    ask()
    const t = window.setInterval(ask, syncing ? SYNCING_POLL_MS : POLL_MS)
    window.addEventListener('focus', ask)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', ask)
    }
  }, [ask, syncing])
  const syncNow = (): void => {
    setClicked(true)
    setRefused(null)
    void window.deck.sleepgodSync().then((why) => (setRefused(why), ask()))
  }
  const syncError = refused ?? (clicked && !syncing ? (data?.sync.failure ?? null) : null)

  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()
  const hr = data?.heart_rate
  const live = hr?.live_bpm != null
  const temp = data?.temperature
  const sleep = data?.sleep
  const stale = data ? old(data.last_sync, data.now) : false
  const stages = sleep?.stages
    ? (['light', 'deep', 'rem', 'awake'] as const).filter((k) => sleep.stages?.[k]).map((k) => `${k === 'rem' ? 'REM' : k} ${hm(sleep.stages?.[k] ?? 0)}`).join(', ')
    : ''

  return (
    <div className="tile tile-plugin sleepgod-tile" onClick={stop}>
      <header className="pane-head">
        <HeartPulse size={13} className="sleepgod-glyph" />
        <span className="name">Sleepgod</span>
        <span className="spacer" />
        <small className={stale || syncError ? 'sleepgod-warn' : 'sleepgod-muted'} title={syncError ?? undefined}>
          {syncing ? 'syncing…' : syncError ? 'sync failed' : data?.last_sync ? `${stale ? 'last synced' : 'synced'} ${clock(data.last_sync)}` : ''}
        </small>
        <button className="ghost" title="Sync the ring now" aria-label="Sync the ring now" disabled={syncing} onClick={syncNow}>
          <RefreshCw size={12} className={syncing ? 'sleepgod-spin' : undefined} />
        </button>
        <button className="ghost" title="Open today's detail in the browser" aria-label="Open today's detail in the browser" onClick={() => window.deck.openExternal(PAGE)}>
          <ExternalLink size={12} />
        </button>
        <CellTools />
      </header>
      {!data ? (
        <p className="sleepgod-muted sleepgod-empty">{asked ? "The sleepgod server isn't answering on this Mac." : 'Reading…'}</p>
      ) : (
        <div className="sleepgod-grid">
          <Metric
            label={live ? 'Heart rate · live' : 'Heart rate'}
            value={String(live ? hr?.live_bpm : (hr?.bpm ?? '–'))}
            unit="bpm"
            dim={live ? hr?.live_settling : false}
            note={live ? (hr?.live_settling ? 'sensor settling' : 'updating on each beat') : hr?.at ? `at ${clock(hr.at)}, today ${hr.low}–${hr.high}` : 'no reading today'}
            spark={hr?.recent}
          />
          <Metric
            label="Steps today"
            value={(data.steps.today ?? 0).toLocaleString()}
            note={`${(data.steps.distance_m / 1609.34).toFixed(2)} mi · ~${data.steps.kcal} kcal`}
            title={`${(data.steps.distance_m / 1000).toFixed(2)} km, ${data.steps.active_hours} active hour(s). Calories are the ring's estimate.`}
          />
          <Metric
            label="Skin temperature"
            value={temp?.celsius != null ? temp.celsius.toFixed(1) : '–'}
            unit="°C"
            note={temp?.at ? `at ${clock(temp.at)}, unverified` : 'no reading today'}
            title="Finger skin, not core temperature. Unverified on this ring, and only meaningful against your own normal."
            spark={temp?.recent}
          />
          <Metric
            label="Sleep last night"
            value={sleep ? hm(sleep.asleep_min) : '–'}
            note={sleep ? `${wall(sleep.onset)}–${wall(sleep.wake)} · score ${sleep.score}` : 'no night found'}
            title={sleep ? `Resting HR ${Math.round(sleep.resting_hr)}, ${sleep.waso_min} min awake.${stages ? ` The ring's unverified stage estimate: ${stages}.` : ''}` : undefined}
          />
        </div>
      )}
    </div>
  )
}
