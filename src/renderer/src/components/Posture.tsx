import { useEffect, useRef } from 'react'
import { Maximize2, Pause, PersonStanding, Play, Target } from 'lucide-react'
import { ALERT_MS, WINDOW_MS, openPosture, posture, span, stopwatch, summarize, useNow, usePosture, type PostureView, type Seg } from '../lib/posture'
import { ISSUE_TEXT, type Check } from '../lib/postureMath'
import { Fox } from './Fox'

/** The status in a word (the head's badge). */
const WORD: Record<PostureView['status'], string> = {
  off: 'off',
  starting: 'starting',
  error: 'no camera',
  paused: 'paused',
  uncalibrated: 'calibrate',
  calibrating: 'calibrating',
  good: 'sitting well',
  bad: 'slouching',
  away: 'away'
}

const CHECKS: { key: Check; label: string }[] = [
  { key: 'neck', label: 'Head height' },
  { key: 'lean', label: 'Leaning in' },
  { key: 'slump', label: 'Slumping' },
  { key: 'tilt', label: 'Side lean' }
]

/** The camera and the pose lines, drawn by the tracker into this canvas while it is mounted. */
function Feed({ className }: { className: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => (canvas.current ? posture().attach(canvas.current) : undefined), [])
  return <canvas ref={canvas} className={className} />
}

/** What the feed's box says when there is no picture: starting, paused, the error. */
function FeedCover({ v }: { v: PostureView }) {
  if (v.status === 'good' || v.status === 'bad' || v.status === 'away' || v.status === 'uncalibrated' || v.status === 'calibrating') return null
  return (
    <div className="posture-cover">
      <Fox anim={v.status === 'starting' ? 'run' : v.status === 'error' ? 'look' : 'sleep'} scale={2} />
      {v.status === 'error' && <span>{v.note}</span>}
    </div>
  )
}

/** The streak's clock: counting while you sit well, the last one's length faint while you do not. */
function Streak({ v, now, big }: { v: PostureView; now: number; big?: boolean }) {
  const running = v.streakSince !== null
  const slouch = v.badSince !== null ? now - v.badSince : 0
  return (
    <div className={`posture-streak ${big ? 'big' : ''} ${v.status}`}>
      <div className="posture-clock">{stopwatch(running ? now - v.streakSince! : 0)}</div>
      <div className="posture-sub">
        {v.status === 'bad' ? (
          <span className={slouch >= ALERT_MS ? 'posture-hot' : ''}>slouching {stopwatch(slouch)}</span>
        ) : v.status === 'good' ? (
          'good posture streak'
        ) : v.status === 'away' ? (
          'out of frame'
        ) : v.status === 'uncalibrated' ? (
          'calibrate to start'
        ) : v.status === 'calibrating' ? (
          'calibrating…'
        ) : v.status === 'starting' ? (
          v.note || 'starting…'
        ) : (
          WORD[v.status]
        )}
        {!running && v.lastStreak > 0 && v.status !== 'starting' && <span className="posture-last"> · last {stopwatch(v.lastStreak)}</span>}
      </div>
    </div>
  )
}

/** The calibration overlay over a feed: a countdown, then a bar while it samples. */
function Calib({ v }: { v: PostureView }) {
  if (!v.calib) return null
  return (
    <div className="posture-calib">
      <div className="posture-calib-n">{v.calib.left}</div>
      <div className="posture-calib-text">{v.note}</div>
      <div className="posture-calib-bar">
        <i style={{ width: `${v.calib.frac * 100}%` }} />
      </div>
    </div>
  )
}

/**
 * The Posture tile: the streak's stopwatch and a small feed of you, drawn by the one tracker
 * (lib/posture.ts) that runs while the tile is on. Click = the pane, with the last two hours.
 */
export function PostureTile() {
  const v = usePosture()
  const now = useNow()
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <div className={`tile tile-plugin posture ${v.status === 'bad' && v.badSince !== null && now - v.badSince >= ALERT_MS ? 'posture-alarm' : ''}`} onClick={stop}>
      <header className="pane-head">
        <PersonStanding size={13} className="posture-glyph" />
        <span className="name">Posture</span>
        <span className={`badge posture-badge ${v.status}`}>{WORD[v.status]}</span>
        <span className="spacer" />
        <button className="ghost" title="The last two hours, full size in the center column (⌘⇧P)" onClick={openPosture}>
          <Maximize2 size={12} />
        </button>
      </header>
      <div className="posture-face" onClick={openPosture} title="The last two hours (⌘⇧P)">
        <div className="posture-left">
          <Streak v={v} now={now} />
          {v.status === 'uncalibrated' ? (
            <button
              className="pill"
              onClick={(e) => {
                e.stopPropagation()
                posture().calibrate()
              }}
            >
              <Target size={12} /> calibrate
            </button>
          ) : v.status === 'paused' ? (
            <button
              className="pill"
              onClick={(e) => {
                e.stopPropagation()
                posture().setPaused(false)
              }}
            >
              <Play size={12} /> resume
            </button>
          ) : (
            <Mini history={v.history} now={now} />
          )}
        </div>
        <div className={`posture-feed-box ${v.status}`}>
          <Feed className="posture-feed" />
          <FeedCover v={v} />
          {v.calib && <div className="posture-calib mini">{v.calib.left}</div>}
        </div>
      </div>
    </div>
  )
}

/** The tile's one line of history: the last two hours as a thin strip, and the share of it spent well. */
function Mini({ history, now }: { history: Seg[]; now: number }) {
  const t = summarize(history, now)
  const seen = t.good + t.bad
  return (
    <div className="posture-mini">
      <Strip segs={t.segs} now={now} thin />
      <span className="posture-mini-text">{seen ? `${Math.round((t.good / seen) * 100)}% upright · 2h` : 'no history yet'}</span>
    </div>
  )
}

/** The last two hours, left to right: good, bad, away; untracked time is left empty. */
function Strip({ segs, now, thin }: { segs: Seg[]; now: number; thin?: boolean }) {
  const from = now - WINDOW_MS
  return (
    <div className={`posture-strip ${thin ? 'thin' : ''}`}>
      {segs.map((s, i) => (
        <i
          key={i}
          className={s.s}
          style={{ left: `${((s.a - from) / WINDOW_MS) * 100}%`, width: `${Math.max(0.15, ((s.b - s.a) / WINDOW_MS) * 100)}%` }}
          title={thin ? undefined : `${s.s === 'good' ? 'upright' : s.s === 'bad' ? 'slouching' : 'away'} ${span(s.b - s.a)}, ${new Date(s.a).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
        />
      ))}
    </div>
  )
}

/**
 * The Posture tile full size in the CENTER column (⌘⇧P, the tile, View ▸ Posture): the feed large,
 * the streak, the four checks, and THE LAST TWO HOURS — a strip of good / slouching / away, the
 * time in each, the longest streak. Calibrate, pause and the sensitivity are here. Esc closes.
 */
export function PosturePane({ onClose }: { onClose: () => void }) {
  const v = usePosture()
  const now = useNow()
  const pane = useRef<HTMLElement>(null)
  const t = summarize(v.history, now)
  const seen = t.good + t.bad
  const tracked = seen + t.away

  useEffect(() => pane.current?.focus(), [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !el?.closest('.xterm, input, textarea')) onClose()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onClose])

  const ticks = [0, 30, 60, 90, 120].map((m) => ({ m, at: new Date(now - WINDOW_MS + m * 60_000) }))

  return (
    <section ref={pane} className="focus posture-pane" tabIndex={-1}>
      <header className="pane-head">
        <PersonStanding size={14} className="posture-glyph" />
        <span className="name">Posture</span>
        <span className={`badge posture-badge ${v.status}`}>{WORD[v.status]}</span>
        <span className="spacer" />
        <button className="ghost" title="Back to the terminal (Esc)" onClick={onClose}>
          close
        </button>
      </header>

      <div className="posture-body">
        <div className="posture-top">
          <div className={`posture-feed-box large ${v.status}`}>
            <Feed className="posture-feed" />
            <FeedCover v={v} />
            <Calib v={v} />
          </div>
          <div className="posture-side">
            <Streak v={v} now={now} big />
            {v.status === 'bad' && <div className="posture-issue">{v.note}</div>}
            <div className="posture-checks">
              {CHECKS.map((c) => {
                const x = v.checks && (v.status === 'good' || v.status === 'bad') ? v.checks[c.key] : 0
                return (
                  <div key={c.key} className="posture-check" title={ISSUE_TEXT[c.key]}>
                    <span>{c.label}</span>
                    <i>
                      <b className={x >= 1 ? 'bad' : x >= 0.6 ? 'warn' : 'good'} style={{ width: `${Math.min(100, (x / 1.5) * 100)}%` }} />
                      <em />
                    </i>
                  </div>
                )
              })}
            </div>
            <div className="posture-actions">
              {v.calib ? (
                <button className="pill" onClick={() => posture().cancelCalibration()}>
                  cancel
                </button>
              ) : (
                <button className="pill" disabled={v.status === 'off' || v.status === 'starting'} onClick={() => posture().calibrate()} title="Sit the way you want to sit, then hold still for a few seconds">
                  <Target size={12} /> {v.calibrated ? 'recalibrate' : 'calibrate'}
                </button>
              )}
              <button className={`pill ${v.paused ? 'on' : ''}`} disabled={v.status === 'off'} onClick={() => posture().setPaused(!v.paused)} title={v.paused ? 'Turn the camera back on' : 'Turn the camera off for now (a meeting)'}>
                {v.paused ? <Play size={12} /> : <Pause size={12} />} {v.paused ? 'resume' : 'pause'}
              </button>
              <label className="posture-sens" title="How far from your calibrated posture counts as slouching">
                strictness
                <input type="range" min={0.5} max={2} step={0.1} value={v.sensitivity} onChange={(e) => posture().setSensitivity(Number(e.target.value))} />
                <span>{v.sensitivity.toFixed(1)}×</span>
              </label>
            </div>
          </div>
        </div>

        <div className="posture-history">
          <div className="posture-h-head">
            <span className="posture-h-title">Last 2 hours</span>
            <span className="posture-h-note">{tracked ? `tracked ${span(tracked)}` : 'nothing tracked yet'}</span>
          </div>
          <Strip segs={t.segs} now={now} />
          <div className="posture-axis">
            {ticks.map((x) => (
              <span key={x.m} style={{ left: `${(x.m / 120) * 100}%` }}>
                {x.m === 120 ? 'now' : x.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            ))}
          </div>
          <div className="posture-totals">
            <div className="posture-total good">
              <span className="posture-total-n">{span(t.good)}</span>
              <span className="posture-total-l">good posture{seen ? ` · ${Math.round((t.good / seen) * 100)}%` : ''}</span>
            </div>
            <div className="posture-total bad">
              <span className="posture-total-n">{span(t.bad)}</span>
              <span className="posture-total-l">bad posture{seen ? ` · ${Math.round((t.bad / seen) * 100)}%` : ''}</span>
            </div>
            <div className="posture-total away">
              <span className="posture-total-n">{span(t.away)}</span>
              <span className="posture-total-l">away</span>
            </div>
            <div className="posture-total best">
              <span className="posture-total-n">{stopwatch(t.best)}</span>
              <span className="posture-total-l">longest streak</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
