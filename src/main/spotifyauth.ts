// Connecting a Spotify account: the Authorization Code flow with PKCE, which is the one for
// apps that cannot keep a secret (there is no client secret anywhere in deck). `connect()`
// opens the consent page in the browser and catches the redirect on a loopback listener
// (http://127.0.0.1:<port>/callback, registered on the Spotify app: 47820 for the `deck`
// profile, 47821 for the others). Tokens live in userData/spotify.json, mode 0600; the
// refresh token renews the access token as needed (PKCE hands back a new refresh token each
// time, which is stored). Delete the file, or View ▸ Music ▸ Disconnect, to forget the account.

import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { shell } from 'electron'
import type { SpotifyAccount } from '@shared/types'

const AUTHORIZE = 'https://accounts.spotify.com/authorize'
const TOKEN = 'https://accounts.spotify.com/api/token'
const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-read-recently-played']
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000
/** Renew this long before the access token expires. */
const EARLY_MS = 60 * 1000

interface Stored {
  clientId: string
  refreshToken: string
  accessToken: string
  expiresAt: number
  userId: string
  user: string
}

interface TokenReply {
  access_token: string
  refresh_token?: string
  expires_in: number
}

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const PAGE = (body: string) =>
  `<!doctype html><meta charset="utf-8"><title>deck</title><body style="font:15px -apple-system,sans-serif;color:#333;background:#f6f3ea;display:grid;place-items:center;height:100vh;margin:0"><p>${body}</p>`

export class SpotifyAuth {
  private readonly path: string
  private stored: Stored | null
  private pending: { server: Server; state: string; verifier: string; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null
  private refreshing: Promise<string> | null = null

  constructor(
    userData: string,
    private readonly port: number,
    /** The `spotifyClientId` setting, read at the moment it is needed. */
    private readonly clientId: () => string,
    private readonly onChange: (a: SpotifyAccount) => void
  ) {
    this.path = join(userData, 'spotify.json')
    this.stored = this.read()
  }

  get redirectUri(): string {
    return `http://127.0.0.1:${this.port}/callback`
  }

  account(): SpotifyAccount {
    return { connected: this.stored !== null, user: this.stored?.user ?? '', clientId: this.clientId() !== '', redirectUri: this.redirectUri }
  }

  /** Open the consent page and wait for the redirect. Resolves the account once tokens are stored. */
  async connect(): Promise<SpotifyAccount> {
    const clientId = this.clientId()
    if (!clientId) throw new Error('set spotifyClientId in config.json first (a Spotify app’s client id)')
    this.cancelPending(new Error('another connect started'))
    const verifier = b64url(randomBytes(64))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const state = b64url(randomBytes(16))

    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const err = url.searchParams.get('error')
        const got = url.searchParams.get('code')
        if (url.searchParams.get('state') !== state || err || !got) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE(`Spotify said no: ${err ?? 'bad state'}. You can close this tab.`))
          this.cancelPending(new Error(err ?? 'state mismatch'))
          return
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Spotify is connected to deck. You can close this tab.'))
        this.settle()
        resolve(got)
      })
      server.on('error', (e) => {
        this.settle()
        reject(new Error(`cannot listen on ${this.redirectUri}: ${e.message}`))
      })
      const timer = setTimeout(() => this.cancelPending(new Error('connect timed out')), CONNECT_TIMEOUT_MS)
      this.pending = { server, state, verifier, reject, timer }
      server.listen(this.port, '127.0.0.1', () => {
        const q = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          scope: SCOPES.join(' '),
          redirect_uri: this.redirectUri,
          state,
          code_challenge_method: 'S256',
          code_challenge: challenge
        })
        void shell.openExternal(`${AUTHORIZE}?${q}`)
      })
    })

    const t = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, client_id: clientId, code_verifier: verifier })
    if (!t.refresh_token) throw new Error('Spotify returned no refresh token')
    this.stored = { clientId, refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000, userId: '', user: '' }
    try {
      const me = (await this.api('https://api.spotify.com/v1/me')) as { id?: string; display_name?: string }
      this.stored = { ...this.stored, userId: me.id ?? '', user: me.display_name || me.id || '' }
    } catch {
      /* the name is decoration */
    }
    this.write()
    this.onChange(this.account())
    return this.account()
  }

  disconnect(): void {
    this.cancelPending(new Error('disconnected'))
    this.stored = null
    try {
      if (existsSync(this.path)) unlinkSync(this.path)
    } catch {
      /* leave it */
    }
    this.onChange(this.account())
  }

  /** A live access token, refreshed if it is about to expire. Throws when not connected. */
  async token(): Promise<string> {
    const s = this.stored
    if (!s) throw new Error('Spotify account not connected')
    if (Date.now() < s.expiresAt - EARLY_MS) return s.accessToken
    if (!this.refreshing) {
      this.refreshing = this.refresh(s).finally(() => (this.refreshing = null))
    }
    return this.refreshing
  }

  /** GET a Web API URL as JSON with the account's token (one retry through a refresh on 401). */
  async api(url: string, retry = true): Promise<unknown> {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await this.token()}` }, signal: AbortSignal.timeout(10_000) })
    if (r.status === 401 && retry && this.stored) {
      this.stored.expiresAt = 0
      return this.api(url, false)
    }
    if (r.status === 204) return null
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null
      throw new Error(body?.error?.message ? `Spotify: ${body.error.message}` : `Spotify: HTTP ${r.status}`)
    }
    return r.json()
  }

  private async refresh(s: Stored): Promise<string> {
    let t: TokenReply
    try {
      t = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId })
    } catch (e) {
      // A revoked grant (the user removed deck in their Spotify settings) is the end of the connection.
      if (String((e as Error).message).includes('invalid_grant')) {
        this.disconnect()
        throw new Error('Spotify account disconnected (the grant was revoked)')
      }
      throw e
    }
    this.stored = { ...s, accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 }
    this.write()
    return t.access_token
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenReply> {
    const r = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000)
    })
    const j = (await r.json().catch(() => ({}))) as Partial<TokenReply> & { error?: string; error_description?: string }
    if (!r.ok || !j.access_token || !j.expires_in) throw new Error(`Spotify token: ${j.error ?? r.status}${j.error_description ? ` (${j.error_description})` : ''}`)
    return j as TokenReply
  }

  private settle(): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.server.close()
    this.pending = null
  }

  private cancelPending(why: Error): void {
    const p = this.pending
    this.settle()
    p?.reject(why)
  }

  private read(): Stored | null {
    try {
      if (!existsSync(this.path)) return null
      const j = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Stored>
      if (typeof j.refreshToken !== 'string' || typeof j.clientId !== 'string') return null
      return { clientId: j.clientId, refreshToken: j.refreshToken, accessToken: j.accessToken ?? '', expiresAt: j.expiresAt ?? 0, userId: j.userId ?? '', user: j.user ?? '' }
    } catch {
      return null
    }
  }

  private write(): void {
    if (!this.stored) return
    try {
      writeFileSync(this.path, JSON.stringify(this.stored, null, 2) + '\n', { mode: 0o600 })
      chmodSync(this.path, 0o600)
    } catch {
      /* the token just will not outlive the app */
    }
  }
}
