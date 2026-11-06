// `npm run dist`, after the build: writes out/build-info.json, which ships inside the app
// (package.json `files` takes out/**). The installed app compares it with the repo it came from
// (main/updates.ts) to know when there is an update to install.
import { writeFileSync } from 'node:fs'
import { fingerprint } from './lib/fingerprint.mjs'

const repo = process.cwd()
// DECK_FINGERPRINT: the in-app installer takes it BEFORE the build starts, so an edit made
// while it builds still counts as an update afterwards.
const fp = process.env.DECK_FINGERPRINT || (await fingerprint(repo))
writeFileSync('out/build-info.json', JSON.stringify({ repo, fingerprint: fp, builtAt: Date.now() }, null, 2) + '\n')
console.log(`stamp: ${fp ?? 'no fingerprint (not a git repo?)'}`)
