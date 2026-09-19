// The ad's own Vite root: it mounts the REAL renderer (src/renderer/src) against a scripted fake
// window.deck, so the app's build and entries are untouched. `npm run ad:dev` previews it live.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const repo = resolve(__dirname, '..')

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(repo, 'src/shared'), '@r': resolve(repo, 'src/renderer/src'), '@main': resolve(repo, 'src/main') } },
  server: { port: 5199, strictPort: true, fs: { allow: [repo] } }
})
