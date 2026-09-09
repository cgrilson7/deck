import { useCallback, useEffect, useRef, useState } from 'react'

const VIDEO = 'rFZHOHl-L8A' // the lofi live stream
// The bare embed player fills the webview edge to edge. Starts muted so autoplay is allowed.
const EMBED = `https://www.youtube.com/embed/${VIDEO}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3`

// Drive the embed through its player object (#movie_player), not the <video> element: the
// player owns mute/volume state and re-applies it to the element every few seconds, so a
// direct `video.muted = false` gets undone. Player states: 1 playing, 2 paused, 3 buffering.
const P = `const p = document.getElementById('movie_player'); const v = document.querySelector('video');`
const JS = {
  toggleMute: `(() => { ${P}
    if (p && p.isMuted) { if (p.isMuted()) { p.unMute(); if (p.getVolume && p.getVolume() === 0) p.setVolume(100); return false } p.mute(); return true }
    if (!v) return null; v.muted = !v.muted; return v.muted })()`,
  togglePlay: `(() => { ${P}
    if (p && p.getPlayerState) { const s = p.getPlayerState(); if (s === 1 || s === 3) { p.pauseVideo(); return false } p.playVideo(); return true }
    if (!v) return null; if (v.paused) { v.play(); return true } v.pause(); return false })()`,
  read: `(() => { ${P}
    if (p && p.isMuted) { const s = p.getPlayerState(); return { muted: p.isMuted(), playing: s === 1 || s === 3 } }
    return v ? { muted: v.muted, playing: !v.paused } : null })()`
}

/** The lofi stream, full-bleed in an Electron <webview>, with our own play/pause + mute overlaid. */
export function YouTubeTile() {
  const ref = useRef<DeckWebview>(null)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(true)

  const sync = useCallback(async () => {
    const r = (await ref.current?.executeJavaScript(JS.read).catch(() => null)) as { muted: boolean; playing: boolean } | null
    if (r) {
      setMuted(r.muted)
      setPlaying(r.playing)
    }
  }, [])

  // The player's own state can change under us (a click on the video toggles play), so re-read it.
  useEffect(() => {
    const t = window.setInterval(() => void sync(), 2000)
    return () => window.clearInterval(t)
  }, [sync])

  const run = async (code: string, set: (v: boolean) => void) => {
    const r = await ref.current?.executeJavaScript(code).catch(() => null)
    if (typeof r === 'boolean') set(r)
  }

  return (
    <div className="tile tile-plugin youtube">
      {/* The partition's headers are rewritten in main/youtube.ts so the embed loads. */}
      <webview ref={ref} className="youtube-view" src={EMBED} partition="persist:youtube" webpreferences="autoplayPolicy=no-user-gesture-required" />
      <div className="yt-controls">
        <button onClick={() => void run(JS.togglePlay, setPlaying)} title={playing ? 'Pause' : 'Play'}>
          {playing ? '⏸︎' : '▶︎'}
        </button>
        <button onClick={() => void run(JS.toggleMute, setMuted)} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  )
}
