/// <reference types="vite/client" />

/** Electron's <webview> (enabled via webviewTag in main). Only what the YouTube tile and the web apps use. */
declare global {
  interface DeckWebview extends HTMLElement {
    src: string
    canGoBack(): boolean
    goBack(): void
    canGoForward(): boolean
    goForward(): void
    reload(): void
    stop(): void
    getTitle(): string
    getWebContentsId(): number
    setAudioMuted(muted: boolean): void
    loadURL(url: string): Promise<void>
    getURL(): string
    executeJavaScript(code: string): Promise<unknown>
  }
}

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<DeckWebview>, DeckWebview> & {
        src?: string
        partition?: string
        allowpopups?: string
        useragent?: string
        webpreferences?: string
      }
    }
  }
}
