import { useEffect, useRef, useState } from 'react'
import { Copy, Smartphone } from 'lucide-react'
import type { RemoteInfo } from '@shared/types'
import { patchSettings, useSettings } from '../lib/theme'

/**
 * The phone button in the top bar: a popover with the QR code (and the link) that opens this
 * deck on a phone, over Tailscale (main/remote.ts). The link carries the pairing token, so it
 * is shown without it and copied with it. A switch turns the server off altogether.
 */
export function PhonePair() {
  const s = useSettings()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    const load = () => void window.deck.remoteInfo().then((i) => live && setInfo(i))
    load()
    const t = window.setInterval(load, 5000)
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      live = false
      window.clearInterval(t)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, s.remote])

  const copy = () => {
    if (!info?.url) return
    window.deck.copyText(info.url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const shown = info?.url ? info.url.replace(/#t=.*$/, '') : ''
  const note = !info
    ? ''
    : info.tailscale === 'up'
      ? `Tailscale is up: this works from anywhere the phone is on your tailnet.`
      : info.tailscale === 'down'
        ? `Tailscale is logged out on this Mac, so the link only works on this Wi-Fi. Sign in (the menu bar icon) for anywhere.`
        : `Tailscale is not installed, so the link only works on this Wi-Fi. tailscale.com/download for anywhere.`

  return (
    <div className="phone-pair" ref={box}>
      <button className={`bar-btn ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} title="Open this deck on your phone">
        <Smartphone size={13} />
        <span>phone</span>
      </button>
      {open && (
        <div className="popover phone-pop">
          <div className="menu-title">Phone</div>
          {!s.remote ? (
            <p className="phone-note">The phone server is off.</p>
          ) : !info ? (
            <p className="phone-note">…</p>
          ) : !info.listening ? (
            <p className="phone-note warn">The server could not listen on port {info.port}. Is another deck running?</p>
          ) : !info.url ? (
            <p className="phone-note warn">No network address to offer: this Mac is on neither a tailnet nor a Wi-Fi network.</p>
          ) : (
            <>
              {info.qr && <img className="phone-qr" src={info.qr} alt="QR code of the phone link" draggable={false} />}
              <div className="phone-url" title={shown}>
                {shown}
              </div>
              <button className="bar-btn phone-copy" onClick={copy} title="Copy the link, pairing token included">
                <Copy size={12} />
                <span>{copied ? 'copied' : 'copy link'}</span>
              </button>
              <p className="phone-note">Scan it with the camera, then "Add to Home Screen" in Safari's share sheet for an app icon.</p>
            </>
          )}
          {note && <p className={`phone-note ${info?.tailscale !== 'up' ? 'warn' : ''}`}>{note}</p>}
          <label className="phone-switch">
            <input type="checkbox" checked={s.remote} onChange={(e) => patchSettings({ remote: e.target.checked })} />
            serve the phone page (tailnet and LAN only, token-gated)
          </label>
        </div>
      )}
    </div>
  )
}
