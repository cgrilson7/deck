// THE SCREEN RECORDER'S FRAME (main/recorder.ts has the whole story): a 9:16 window you drag anywhere,
// its inside click-through, and the capture itself — the display under it cropped every frame to
// where the inside is NOW, into a 1080×1920 canvas, with the Mac's sound (through BlackHole) and
// optionally the microphone mixed in, recorded in one-second chunks that stream to main.

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Circle, Eye, EyeOff, FolderOpen, Grip, Mic, MicOff, Play, Square, Volume2, VolumeX, X } from 'lucide-react'
import './recorder.css'

interface RecSource {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  scale: number
}
declare global {
  interface Window {
    rec: {
      passThrough(through: boolean): void
      move(x: number, y: number): void
      resize(height: number): void
      close(): void
      source(): Promise<RecSource>
      audioOn(): Promise<string>
      audioOff(): Promise<void>
      begin(ext: string): Promise<void>
      chunk(bytes: Uint8Array): Promise<void>
      end(ext: string): Promise<string>
      reveal(path: string): void
      play(path: string): void
      onCloseAsked(cb: () => void): () => void
    }
  }
}

/** Mirrors REC_PAD / REC_BAR in main/recorder.ts. */
const PAD = 14
const BAR = 46
const OUT_W = 1080
const OUT_H = 1920
const FPS = 30
const COUNTDOWN = 3

type Phase = 'idle' | 'countdown' | 'recording' | 'saving' | 'saved' | 'error'

const pref = (k: string, d: boolean) => {
  const v = localStorage.getItem(`rec.${k}`)
  return v === null ? d : v === '1'
}
const keep = (k: string, v: boolean) => localStorage.setItem(`rec.${k}`, v ? '1' : '0')

/** The recordable type this Chromium encodes best: H.264 in MP4 first (the hardware encoder), else WebM. */
function pickType(): { mime: string; ext: string } {
  for (const [mime, ext] of [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,opus', 'mp4'],
    ['video/webm;codecs=h264,opus', 'webm'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm', 'webm']
  ] as const)
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }
  return { mime: '', ext: 'webm' }
}

/** Where the filmed rectangle is on the screen now (DIP), from the window's own position. */
function innerRect() {
  return { x: window.screenX + PAD, y: window.screenY + PAD, w: window.innerWidth - 2 * PAD, h: window.innerHeight - 2 * PAD - BAR }
}

interface Take {
  stop(): void
  cancel(): void
}

async function startTake(opts: { sound: boolean; mic: boolean; onWarn(w: string): void; onSaved(path: string): void; onError(e: string): void }): Promise<Take> {
  const src = await window.rec.source()
  const screenStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: src.id,
        maxWidth: Math.round(src.bounds.width * src.scale),
        maxHeight: Math.round(src.bounds.height * src.scale),
        maxFrameRate: 60
      }
    } as unknown as MediaTrackConstraints
  })
  const video = document.createElement('video')
  video.muted = true
  video.srcObject = screenStream
  await video.play()

  const canvas = document.createElement('canvas')
  canvas.width = OUT_W
  canvas.height = OUT_H
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.imageSmoothingQuality = 'high'
  // Drawn on a clock, not on the capture's frames: a still screen sends none, and the frame may be moving.
  const draw = () => {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return
    const kx = vw / src.bounds.width
    const ky = vh / src.bounds.height
    const r = innerRect()
    const sx = Math.min(Math.max(0, (r.x - src.bounds.x) * kx), vw - 1)
    const sy = Math.min(Math.max(0, (r.y - src.bounds.y) * ky), vh - 1)
    ctx.drawImage(video, sx, sy, Math.min(r.w * kx, vw - sx), Math.min(r.h * ky, vh - sy), 0, 0, OUT_W, OUT_H)
  }
  draw()
  const clock = window.setInterval(draw, 1000 / FPS)
  const out = canvas.captureStream(FPS)

  // Sound: the Mac's output as BlackHole hears it, and the microphone if asked, mixed into one track.
  const extra: MediaStream[] = []
  let audioCtx: AudioContext | null = null
  if (opts.sound || opts.mic) {
    audioCtx = new AudioContext({ sampleRate: 48000 })
    const dest = audioCtx.createMediaStreamDestination()
    const plain = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }
    if (opts.sound) {
      const err = await window.rec.audioOn()
      if (err) opts.onWarn(`no system sound: ${err}`)
      else {
        const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
        const bh = inputs.find((d) => /blackhole/i.test(d.label))
        if (!bh) opts.onWarn('no system sound: BlackHole 2ch is not an input')
        else {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { ...plain, deviceId: { exact: bh.deviceId } } })
          extra.push(s)
          audioCtx.createMediaStreamSource(s).connect(dest)
        }
      }
    }
    if (opts.mic) {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
      const def = inputs.find((d) => d.deviceId === 'default')
      // Never BlackHole as "the microphone": that is the system sound again.
      const pick = def && !/blackhole/i.test(def.label) ? def : inputs.find((d) => d.deviceId !== 'default' && !/blackhole/i.test(d.label))
      if (!pick) opts.onWarn('no microphone found')
      else {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: pick.deviceId }, echoCancellation: true, noiseSuppression: true } })
        extra.push(s)
        audioCtx.createMediaStreamSource(s).connect(dest)
      }
    }
    if (extra.length) for (const t of dest.stream.getAudioTracks()) out.addTrack(t)
  }

  const { mime, ext } = pickType()
  const recorder = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 20_000_000, audioBitsPerSecond: 256_000 })
  await window.rec.begin(ext)
  let chain = Promise.resolve()
  let cancelled = false
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return
    chain = chain.then(async () => window.rec.chunk(new Uint8Array(await e.data.arrayBuffer())))
  }
  const teardown = () => {
    clearInterval(clock)
    for (const s of [screenStream, out, ...extra]) for (const t of s.getTracks()) t.stop()
    void audioCtx?.close()
    video.srcObject = null
  }
  recorder.onstop = () => {
    teardown()
    if (cancelled) return void window.rec.audioOff()
    chain
      .then(() => window.rec.end(ext))
      .then(opts.onSaved, (e: Error) => opts.onError(e.message))
  }
  recorder.start(1000)
  return {
    stop: () => recorder.state !== 'inactive' && recorder.stop(),
    cancel: () => {
      cancelled = true
      if (recorder.state !== 'inactive') recorder.stop()
    }
  }
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Frame() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(0)
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const [sound, setSound] = useState(() => pref('sound', true))
  const [mic, setMic] = useState(() => pref('mic', false))
  const [guides, setGuides] = useState(() => pref('guides', true))
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState('')
  const take = useRef<Take | null>(null)
  const countTimer = useRef(0)
  const through = useRef<boolean | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // The inside lets the pointer through to whatever is under it; the border and the bar do not.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const t = !!(e.target as HTMLElement | null)?.closest?.('.rec-inner')
      if (t !== through.current) {
        through.current = t
        window.rec.passThrough(t)
      }
    }
    const onLeave = () => {
      through.current = true
      window.rec.passThrough(true)
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [phase])

  const begin = async () => {
    setNote('')
    setSaved('')
    try {
      take.current = await startTake({
        sound,
        mic,
        onWarn: (w) => setNote(w),
        onSaved: (p) => {
          take.current = null
          setSaved(p)
          setPhase('saved')
        },
        onError: (e) => {
          take.current = null
          setNote(e)
          setPhase('error')
        }
      })
      setStarted(Date.now())
      setNow(Date.now())
      setPhase('recording')
    } catch (e) {
      void window.rec.audioOff()
      setNote((e as Error).message)
      setPhase('error')
    }
  }

  const record = () => {
    if (phase === 'recording') {
      setPhase('saving')
      take.current?.stop()
      return
    }
    if (phase === 'countdown') {
      clearInterval(countTimer.current)
      setPhase('idle')
      return
    }
    if (phase === 'saving') return
    setPhase('countdown')
    let n = COUNTDOWN
    setCount(n)
    countTimer.current = window.setInterval(() => {
      n -= 1
      if (n > 0) return setCount(n)
      clearInterval(countTimer.current)
      setCount(0)
      void begin()
    }, 1000)
  }
  const recordRef = useRef(record)
  recordRef.current = record

  useEffect(
    () =>
      window.rec.onCloseAsked(() => {
        const p = phaseRef.current
        if (p === 'recording' || p === 'countdown') recordRef.current()
        else if (p !== 'saving') window.rec.close()
      }),
    []
  )

  const close = () => {
    if (phase === 'recording' && !confirm('Stop and throw this take away?')) return
    take.current?.cancel()
    window.rec.close()
  }

  // Moving and resizing are ours (an app-region drag would swallow the pointer events the pass-through needs).
  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const ox = e.screenX - window.screenX
    const oy = e.screenY - window.screenY
    const move = (ev: PointerEvent) => window.rec.move(Math.round(ev.screenX - ox), Math.round(ev.screenY - oy))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const resize = (e: React.PointerEvent) => {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const y0 = e.screenY
    const x0 = e.screenX
    const h0 = window.innerHeight - 2 * PAD - BAR
    const move = (ev: PointerEvent) => {
      // Whichever way the pointer went further sets the size; the width follows at 9:16.
      const dh = Math.max(ev.screenY - y0, ((ev.screenX - x0) * 16) / 9)
      window.rec.resize(h0 + dh)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const live = phase === 'recording'
  const busy = live || phase === 'countdown' || phase === 'saving'
  return (
    <div className={`rec ${live ? 'is-live' : ''}`}>
      <div className="rec-frame" onPointerDown={drag}>
        <div className="rec-inner">
          {guides && !busy && (
            <div className="rec-guides" title="Instagram's own buttons and captions cover these">
              <div className="rec-safe-top" />
              <div className="rec-safe-bottom" />
              <div className="rec-safe-right" />
            </div>
          )}
          {phase === 'countdown' && count > 0 && <div className="rec-count">{count}</div>}
        </div>
      </div>
      <div className="rec-bar" onPointerDown={drag}>
        <button className={`rec-go ${live ? 'is-live' : ''}`} onClick={record} disabled={phase === 'saving'} title={live ? 'Stop and save (⌘⇧O)' : phase === 'countdown' ? 'Cancel' : 'Record (3, 2, 1…)'}>
          {live ? <Square size={14} fill="currentColor" /> : <Circle size={14} fill="currentColor" />}
          <span>{live ? clock(now - started) : phase === 'countdown' ? count : phase === 'saving' ? 'saving…' : 'rec'}</span>
        </button>
        <button className={`rec-tog ${sound ? 'on' : ''}`} disabled={busy} onClick={() => (setSound(!sound), keep('sound', !sound))} title={sound ? "The Mac's sound is recorded (through BlackHole)" : "No system sound"}>
          {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button className={`rec-tog ${mic ? 'on' : ''}`} disabled={busy} onClick={() => (setMic(!mic), keep('mic', !mic))} title={mic ? 'Your microphone is mixed in (headphones, or the speakers echo)' : 'No microphone'}>
          {mic ? <Mic size={15} /> : <MicOff size={15} />}
        </button>
        <button className={`rec-tog ${guides ? 'on' : ''}`} onClick={() => (setGuides(!guides), keep('guides', !guides))} title="Instagram's safe zones (hidden while recording)">
          {guides ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        {phase === 'saved' && (
          <>
            <button className="rec-tog" onClick={() => window.rec.play(saved)} title={`Play ${saved}`}>
              <Play size={15} />
            </button>
            <button className="rec-tog" onClick={() => window.rec.reveal(saved)} title="Show in Finder">
              <FolderOpen size={15} />
            </button>
          </>
        )}
        <span className="rec-space" />
        <button className="rec-tog" onClick={close} title="Close the recorder">
          <X size={15} />
        </button>
        <span className="rec-grip" onPointerDown={resize} title="Resize (stays 9:16)">
          <Grip size={14} />
        </span>
      </div>
      {note && (
        <div className="rec-note" onClick={() => setNote('')} title="Click to dismiss">
          {note}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Frame />)
