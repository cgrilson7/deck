/// <reference types="vite/client" />

/** Electron's <webview> (enabled via webviewTag in main). Only what the YouTube tile uses. */
declare global {
  interface DeckWebview extends HTMLElement {
    src: string
    canGoBack(): boolean
    goBack(): void
    loadURL(url: string): Promise<void>
    getURL(): string
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
      }
    }
  }
}
