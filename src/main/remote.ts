// The phone. A small HTTP + WebSocket server in main that serves the phone build of the
// renderer (out/renderer/phone.html) and speaks shared/remote.ts over one socket per phone:
// every broadcast the desktop renderer gets (state, transcripts, settings, Foxtrot) is relayed,
// and the phone calls a whitelisted slice of the DeckApi by name. Reach is Tailscale's job:
// the server only answers private addresses (loopback, the tailnet's CGNAT range, RFC 1918)
// and every socket must carry the token from userData/remote.json, which the pairing popover
// puts in the URL's fragment (the page keeps it in localStorage). Nothing here resizes a pty:
// the desktop owns the terminal size, the phone reads tmux's screen.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { basename, extname, join } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { WebSocketServer, WebSocket } from 'ws'
import QRCode from 'qrcode'
import type { RemoteInfo } from '@shared/types'
import { REMOTE_METHODS, type RemoteDown, type RemoteMethod, type RemoteUp } from '@shared/remote'

export interface RemoteServerOptions {
  port: number
  userDataDir: string
  profile: string
  /** out/renderer: phone.html + assets/. */
  staticDir: string
  /** build/icon.png, the home-screen icon. */
  iconPath: string
  /** Under `npm run dev`: the Vite dev server (ELECTRON_RENDERER_URL); `/` redirects there. */
  devUrl: string | undefined
  /** The DeckApi slice the phone may call, by name. */
  call: (method: RemoteMethod, args: unknown[]) => Promise<unknown>
  /** Keystrokes into a session. */
  input: (id: string, data: string) => void
}

const TAILSCALE_BIN = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const PING_MS = 25_000
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json'
}
/** The phone page fetches nothing but itself and its socket. */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-src 'self' blob:"

export class RemoteServer {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private readonly token: string
  private clients = new Set<WebSocket>()
  /** Answered the last ping; a phone that has not is dropped on the next one. */
  private alive = new WeakMap<WebSocket, boolean>()
  private pinger: NodeJS.Timeout | null = null
  private listening = false

  constructor(private readonly o: RemoteServerOptions) {
    this.token = loadToken(o.userDataDir)
  }

  /** Listen (idempotent). Resolves once bound, or after logging that the port was taken. */
  start(): Promise<void> {
    if (this.server) return Promise.resolve()
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ noServer: true })
      this.wss.on('connection', (ws) => this.accept(ws))
      this.server = createServer((req, res) => this.http(req, res))
      this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head))
      this.server.on('error', (err) => {
        console.warn('[deck] remote server not listening:', err.message)
        this.server = null
        resolve()
      })
      this.server.listen(this.o.port, '0.0.0.0', () => {
        this.listening = true
        this.pinger = setInterval(() => this.ping(), PING_MS)
        resolve()
      })
    })
  }

  stop(): void {
    if (this.pinger) clearInterval(this.pinger)
    this.pinger = null
    for (const ws of this.clients) ws.terminate()
    this.clients.clear()
    this.wss?.close()
    this.wss = null
    this.server?.close()
    this.server = null
    this.listening = false
  }

  /** The `remote` setting: on = listen, off = drop every phone and stop. */
  async setEnabled(on: boolean): Promise<void> {
    if (on) await this.start()
    else this.stop()
  }

  // ---- broadcasts --------------------------------------------------------

  /** Push one frame to every phone. */
  publish(msg: RemoteDown): void {
    if (this.clients.size === 0) return
    const data = JSON.stringify(msg)
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data)
  }

  /** The desktop's IPC broadcasts, by channel name, relayed as frames. Unknown channels are dropped. */
  relay(channel: string, args: unknown[]): void {
    switch (channel) {
      case 'deck:state':
        return this.publish({ type: 'state', state: args[0] as never })
      case 'transcript:update':
        return this.publish({ type: 'transcript', transcript: args[0] as never })
      case 'settings:changed':
        return this.publish({ type: 'settings', settings: args[0] as never })
      case 'fox:entry':
        return this.publish({ type: 'fox', entry: args[0] as never })
      case 'deck:error':
        return this.publish({ type: 'error', error: String(args[0] ?? '') })
    }
  }

  // ---- pairing -----------------------------------------------------------

  /** Where to point the phone: Tailscale's name for this Mac when it is up, else a LAN address. */
  async info(): Promise<RemoteInfo> {
    const ts = await tailscale()
    const lanIp = lanAddress()
    const host = ts.host || ts.ip || lanIp
    const url = host && this.listening ? `http://${host}:${this.o.port}/#t=${this.token}` : ''
    let qr = ''
    if (url) {
      try {
        qr = await QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      } catch {
        /* no QR, the url still shows */
      }
    }
    return { listening: this.listening, port: this.o.port, url, qr, tailscaleHost: ts.host, tailscaleIp: ts.ip, lanIp, tailscale: ts.state }
  }

  // ---- http --------------------------------------------------------------

  private http(req: IncomingMessage, res: ServerResponse): void {
    if (!isPrivate(req.socket.remoteAddress)) {
      res.statusCode = 403
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    // The page asks here after a dropped socket: 204 = the token is fine, keep retrying; 403 = re-pair.
    if (path === '/auth') {
      res.setHeader('access-control-allow-origin', '*') // in dev the page is on Vite's port
      res.statusCode = this.tokenOk(url.searchParams.get('t')) ? 204 : 403
      res.end()
      return
    }
    if (path === '/' || path === '/index.html' || path === '/phone.html') {
      if (this.o.devUrl) {
        // Vite serves the page in dev (HMR and all); the browser keeps the #fragment across a redirect.
        const dev = new URL(this.o.devUrl)
        dev.hostname = hostOf(req) || dev.hostname
        dev.pathname = '/phone.html'
        res.statusCode = 302
        res.setHeader('location', dev.toString())
        res.end()
        return
      }
      return this.file(res, join(this.o.staticDir, 'phone.html'), 'no-cache')
    }
    if (path === '/icon.png') return this.file(res, this.o.iconPath, 'public, max-age=86400')
    // Hashed bundles: one folder deep, the name as Vite wrote it, nothing else.
    const m = /^\/assets\/([^/]+)$/.exec(path)
    if (m && basename(m[1]) === m[1] && !m[1].startsWith('.')) return this.file(res, join(this.o.staticDir, 'assets', m[1]), 'public, max-age=31536000, immutable')
    res.statusCode = 404
    res.end()
  }

  private file(res: ServerResponse, path: string, cache: string): void {
    let body: Buffer
    try {
      body = readFileSync(path)
    } catch {
      res.statusCode = 404
      res.end(existsSync(this.o.staticDir) ? 'not found' : 'no phone build: run npm run build')
      return
    }
    const ext = extname(path)
    res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream')
    res.setHeader('cache-control', cache)
    if (ext === '.html') res.setHeader('content-security-policy', CSP)
    res.end(body)
  }

  // ---- websocket ---------------------------------------------------------

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://x')
    const ok = isPrivate(req.socket.remoteAddress) && url.pathname === '/ws' && this.tokenOk(url.searchParams.get('t'))
    if (!ok || !this.wss) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss!.emit('connection', ws, req))
  }

  private tokenOk(t: string | null): boolean {
    if (!t || t.length !== this.token.length) return false
    return timingSafeEqual(Buffer.from(t), Buffer.from(this.token))
  }

  private accept(ws: WebSocket): void {
    this.clients.add(ws)
    this.alive.set(ws, true)
    ws.on('pong', () => this.alive.set(ws, true))
    ws.on('close', () => this.clients.delete(ws))
    ws.on('error', () => this.clients.delete(ws))
    ws.on('message', (raw) => {
      let msg: RemoteUp
      try {
        msg = JSON.parse(String(raw)) as RemoteUp
      } catch {
        return
      }
      if (msg.type === 'input') {
        if (typeof msg.id === 'string' && typeof msg.data === 'string') this.o.input(msg.id, msg.data)
      } else if (msg.type === 'call') {
        void this.call(ws, msg)
      }
    })
    ws.send(JSON.stringify({ type: 'hello', profile: this.o.profile } satisfies RemoteDown))
  }

  private async call(ws: WebSocket, msg: Extract<RemoteUp, { type: 'call' }>): Promise<void> {
    const id = Number(msg.id)
    const reply = (r: RemoteDown): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(r))
    }
    if (!REMOTE_METHODS.includes(msg.method)) return reply({ type: 'reply', id, ok: false, error: `no such method: ${String(msg.method)}` })
    try {
      const result = await this.o.call(msg.method, Array.isArray(msg.args) ? msg.args : [])
      reply({ type: 'reply', id, ok: true, result: wire(result) })
    } catch (err) {
      reply({ type: 'reply', id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Drop a phone that missed a ping (a locked phone leaves sockets half-open for a long time). */
  private ping(): void {
    for (const ws of this.clients) {
      if (!this.alive.get(ws)) {
        ws.terminate()
        this.clients.delete(ws)
        continue
      }
      this.alive.set(ws, false)
      ws.ping()
    }
  }
}

/** JSON has no bytes: a FileDoc's image / PDF bytes ride as base64 (`bytesB64`), the page turns them back. */
function wire(result: unknown): unknown {
  if (result && typeof result === 'object' && 'bytes' in result && (result as { bytes?: unknown }).bytes instanceof Uint8Array) {
    const { bytes, ...rest } = result as { bytes: Uint8Array }
    return { ...rest, bytesB64: Buffer.from(bytes).toString('base64') }
  }
  return result
}

/** The bearer for every socket: made once, kept in userData/remote.json. Delete the file to rotate it. */
function loadToken(userData: string): string {
  const path = join(userData, 'remote.json')
  try {
    const t = (JSON.parse(readFileSync(path, 'utf8')) as { token?: unknown }).token
    if (typeof t === 'string' && t.length >= 32) return t
  } catch {
    /* fresh */
  }
  const token = randomBytes(24).toString('base64url')
  try {
    mkdirSync(userData, { recursive: true })
    writeFileSync(path, JSON.stringify({ token }, null, 2) + '\n')
  } catch {
    /* read-only userData: a new token each boot, which only means re-pairing */
  }
  return token
}

/** The request's Host header without the port (what the phone typed or scanned). */
function hostOf(req: IncomingMessage): string {
  const h = req.headers.host ?? ''
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1)
  return h.split(':')[0]
}

/**
 * Only addresses a tailnet or a home network hands out: loopback, Tailscale's CGNAT block
 * (100.64/10) and its IPv6 prefix, and the RFC 1918 ranges. A public address never gets an answer.
 */
export function isPrivate(addr: string | undefined): boolean {
  if (!addr) return false
  let a = addr
  if (a.startsWith('::ffff:')) a = a.slice(7)
  if (a === '::1') return true
  if (a.includes(':')) {
    const l = a.toLowerCase()
    return l.startsWith('fd7a:115c:a1e0:') || l.startsWith('fe80:')
  }
  const p = a.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  if (p[0] === 127) return true
  if (p[0] === 10) return true
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 192 && p[1] === 168) return true
  return false
}

function isTailnet(ip: string): boolean {
  const p = ip.split('.').map(Number)
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127
}

/** The first IPv4 on a real interface that is neither loopback nor the tailnet. */
function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || isTailnet(i.address)) continue
      return i.address
    }
  }
  return ''
}

interface TailscaleState {
  state: 'up' | 'down' | 'missing'
  host: string
  ip: string
}

/** Ask the Tailscale app for this Mac's MagicDNS name and IP; the interface list is the fallback. */
function tailscale(): Promise<TailscaleState> {
  return new Promise((resolve) => {
    const fromInterfaces = (): string => {
      for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && isTailnet(i.address)) return i.address
      return ''
    }
    if (!existsSync(TAILSCALE_BIN)) return resolve({ state: 'missing', host: '', ip: fromInterfaces() })
    execFile(TAILSCALE_BIN, ['status', '--json'], { encoding: 'utf8', timeout: 3000 }, (err, stdout) => {
      let host = ''
      let ip = ''
      let up = false
      try {
        const j = JSON.parse(stdout || '{}') as { BackendState?: string; Self?: { DNSName?: string; TailscaleIPs?: string[] } }
        up = j.BackendState === 'Running'
        host = (j.Self?.DNSName ?? '').replace(/\.$/, '')
        ip = (j.Self?.TailscaleIPs ?? []).find((x) => isTailnet(x)) ?? ''
      } catch {
        /* logged out prints text, not JSON */
      }
      if (!up) return resolve({ state: err ? 'missing' : 'down', host: '', ip: fromInterfaces() })
      resolve({ state: 'up', host, ip: ip || fromInterfaces() })
    })
  })
}
