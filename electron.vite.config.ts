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
    resolve: { alias: shared }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: shared },
    // Two pages: the window (index.html) and the phone (phone.html, served by main/remote.ts).
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html'), phone: resolve('src/renderer/phone.html') }
      }
    },
    // Under `npm run dev` the phone loads its page from Vite too (main redirects there), so listen
    // beyond localhost and accept the Mac's MagicDNS name (Vite refuses unknown hosts; IPs pass anyway).
    server: { host: true, allowedHosts: ['.ts.net', '.local'] }
  }
})
