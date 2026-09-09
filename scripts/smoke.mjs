#!/usr/bin/env node
// Smoke test for the parts that don't need Electron: login-shell env, tmux on the deck
// socket, and `claude agents --json` parsing. Run: npm run smoke
// Uses socket `deck-smoke` and a plain shell command, never a real Claude session.

import { execFileSync, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const conf = join(root, 'tmux.conf')
const SOCK = 'deck-smoke'
let failed = 0

function check(label, ok, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed++
}

// 1. login-shell env exposes claude + tmux
const shell = process.env.SHELL || '/bin/zsh'
const envOut = execFileSync(shell, ['-lc', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const path = (envOut.match(/^PATH=(.*)$/m) || [])[1] || ''
const has = (bin) => path.split(':').some((d) => d && existsSync(join(d, bin)))
check('login shell PATH has claude', has('claude'))
check('login shell PATH has tmux', has('tmux'))

// 2. tmux round trip on a private socket
const tmux = (...args) => execFileSync('tmux', ['-L', SOCK, '-f', conf, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
try {
  tmux('kill-server')
} catch {}
tmux('new-session', '-d', '-s', 'deck-smoke1', '-x', '80', '-y', '24', 'exec sleep 30')
const list = tmux('list-sessions', '-F', '#{session_name}').trim()
check('tmux new-session + list-sessions', list === 'deck-smoke1', list)
const dead = tmux('display-message', '-p', '-t', 'deck-smoke1', '#{pane_dead}').trim()
check('pane alive', dead === '0', `pane_dead=${dead}`)
let seen = false
try {
  tmux('has-session', '-t', 'deck-smoke1')
  seen = true
} catch {}
check('has-session finds it by name', seen)
tmux('kill-server')
let gone = false
try {
  tmux('has-session', '-t', 'deck-smoke1')
} catch {
  gone = true
}
check('tmux kill-server cleans up', gone)

// 3. claude agents --json parses
execFile('claude', ['agents', '--json'], { encoding: 'utf8', env: { ...process.env, PATH: path } }, (err, stdout) => {
  if (err) {
    check('claude agents --json runs', false, err.message.split('\n')[0])
  } else {
    try {
      const arr = JSON.parse(stdout)
      check('claude agents --json is an array', Array.isArray(arr), `${arr.length} live sessions`)
    } catch (e) {
      check('claude agents --json parses', false, String(e))
    }
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall good')
  process.exit(failed ? 1 : 0)
})
