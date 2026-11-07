import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    // The window's bridge, and the screen recorder frame's (main/recorder.ts).
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), recorder: resolve('src/preload/recorder.ts') } } }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: shared },
    // Three pages: the window (index.html), the phone (phone.html, served by main/remote.ts) and the
    // screen recorder's frame (recorder.html, a window of its own: main/recorder.ts).
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html'), phone: resolve('src/renderer/phone.html'), recorder: resolve('src/renderer/recorder.html') }
      }
    },
    // Under `npm run dev` the phone loads its page from Vite too (main redirects there), so listen
    // beyond localhost and accept the Mac's MagicDNS name (Vite refuses unknown hosts; IPs pass anyway).
    server: { host: true, allowedHosts: ['.ts.net', '.local'] }
  }
})
