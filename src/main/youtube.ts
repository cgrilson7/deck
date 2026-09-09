// YouTube's embed player refuses to load unless the request looks like a cross-site
// <iframe> navigation: a Referer plus Sec-Fetch-Site/Dest saying so. A top-level
// navigation in a <webview> sends neither (error 153, then 152-4 with just a Referer),
// so the YouTube partition rewrites the headers on embed requests. Verified to play in a
// headless probe; the wrapper-page alternatives were not needed.

import { session } from 'electron'

export const YOUTUBE_PARTITION = 'persist:youtube'
const REFERER = 'https://github.com/cgrilson7/deck'

export function setupYoutubeSession(): void {
  session.fromPartition(YOUTUBE_PARTITION).webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*'] }, (details, cb) => {
    cb({
      requestHeaders: {
        ...details.requestHeaders,
        Referer: REFERER,
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Dest': 'iframe'
      }
    })
  })
}
