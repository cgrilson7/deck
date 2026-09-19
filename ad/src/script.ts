// The film. Everything the viewer sees happen is written here, in seconds: what the sessions say,
// where the camera goes, where Foxtrot runs and what he clicks. The deck underneath is the real UI.

import type { ChatBlock } from '@shared/types'
import type { Director } from './director'
import { world } from './world'

const HOME = '/Users/you'

/** One beat of a scripted conversation. Durations are seconds. */
type Beat =
  | { user: string }
  | { tool: string; label: string; result: string; dur?: number; path?: string; error?: boolean }
  | { say: string; dur?: number }
  | { wait: number }
  | { status: 'idle' | 'busy' | 'blocked'; attention?: boolean }

let toolSeq = 0

/** History a session already has when the film opens. */
function seed(id: string, beats: Beat[]): void {
  for (const b of beats) {
    if ('user' in b) world.push(id, { kind: 'user', text: b.user, ts: Date.now() })
    else if ('say' in b) world.push(id, { kind: 'text', text: b.say, ts: Date.now() })
    else if ('tool' in b) {
      const tid = `t${++toolSeq}`
      world.push(id, { kind: 'tool', id: tid, name: b.tool, label: b.label, ts: Date.now(), done: false, error: false, path: b.path })
      world.toolDone(id, tid, b.result, b.error)
    }
  }
}

/** Play beats from t; returns when they end. Prose is written a few words at a time, like a stream. */
function play(d: Director, id: string, t: number, beats: Beat[]): number {
  for (const b of beats) {
    if ('wait' in b) t += b.wait
    else if ('status' in b) {
      const s = b
      d.at(t, () => world.status(id, s.status, s.attention ?? false))
    } else if ('user' in b) {
      const text = b.user
      d.at(t, () => {
        world.push(id, { kind: 'user', text, ts: Date.now() })
        world.status(id, 'busy')
      })
      t += 0.5
    } else if ('tool' in b) {
      const tid = `t${++toolSeq}`
      const block: ChatBlock = { kind: 'tool', id: tid, name: b.tool, label: b.label, ts: 0, done: false, error: false, path: b.path }
      const { result, error } = b
      d.at(t, () => world.push(id, { ...block, ts: Date.now() }))
      t += b.dur ?? 0.7
      d.at(t, () => world.toolDone(id, tid, result, error))
      t += 0.15
    } else {
      const words = b.say.split(' ')
      const dur = b.dur ?? Math.max(0.8, words.length * 0.055)
      const steps = Math.max(1, Math.round(dur / 0.07))
      for (let i = 1; i <= steps; i++) {
        const n = Math.ceil((words.length * i) / steps)
        d.at(t + (dur * i) / steps, () => world.say(id, words.slice(0, n).join(' ')))
      }
      t += dur + 0.05
      d.at(t, () => world.commit(id))
      t += 0.2
    }
  }
  return t
}

export function film(d: Director, wide: boolean): void {
  /* ───────────── the cast ───────────── */
  world.add({ id: 'atlas', slot: 1, name: 'vector tiles', cwd: `${HOME}/code/atlas`, model: 'fable' })
  world.add({ id: 'shop', slot: 2, name: 'checkout redesign', cwd: `${HOME}/code/storefront`, model: 'opus', worktree: true, status: 'busy' })
  world.add({ id: 'flaky', slot: 3, name: 'flaky test hunt', cwd: `${HOME}/code/atlas`, model: 'sonnet', worktree: true, status: 'busy' })
  world.add({ id: 'grail', slot: 4, name: 'protein folding 101', cwd: `${HOME}/code/grail`, model: 'fable' })
  world.add({ id: 'notes', slot: 5, name: 'release notes', cwd: `${HOME}/code/atlas`, model: 'haiku' })
  world.add({ id: 'infra', slot: 6, name: 'postgres 17 upgrade', cwd: `${HOME}/code/infra`, model: 'opus', permissionMode: 'plan', status: 'busy' })
  world.patch({
    gridRows: wide ? 4 : 6,
    focusWidth: wide ? 'third' : 'twoFifths',
    gridOrder: { left: ['slot:1', 'slot:3', 'pack:atlas', 'mol', 'git', 'studio'], right: ['slot:2', 'slot:4', 'slot:6', 'slot:5', 'music', 'vocab', 'translate', 'wiki'] }
  })
  world.focus(1)

  seed('atlas', [
    { user: 'the map is slow past zoom 12. find out why' },
    { tool: 'Grep', label: 'renderTile', result: 'Found 7 files' },
    { tool: 'Read', label: 'src/tiles/raster.ts', result: 'Read 214 lines', path: 'src/tiles/raster.ts' },
    { say: 'Every tile past zoom 12 is rasterised on the server, per request. Serving **vector tiles** and styling them on the client would cut that to a cache hit.' }
  ])
  seed('shop', [
    { user: 'rebuild checkout as a single page. keep the old one behind a flag' },
    { tool: 'Read', label: 'app/checkout/page.tsx', result: 'Read 318 lines', path: 'app/checkout/page.tsx' },
    { tool: 'Edit', label: 'app/checkout/OnePage.tsx', result: 'Added 142 lines', path: 'app/checkout/OnePage.tsx' }
  ])
  seed('flaky', [
    { user: 'test_tile_cache fails 1 run in 20 on CI. find it' },
    { tool: 'Bash', label: 'pytest tests/test_tile_cache.py --count 50', result: '48 passed, 2 failed' },
    { say: 'Reproduced: both failures race the cache warm-up. The fixture returns before the writer thread has flushed.' }
  ])
  seed('grail', [
    { user: 'why does a protein fold at all?' },
    { say: 'Because the chain is **greasy in places**. Hydrophobic side chains hide from water, and the backbone hydrogen-bonds to itself on the way in. Let me show you one.' }
  ])
  seed('notes', [
    { user: 'draft release notes for 4.2 from the merged PRs' },
    { tool: 'Bash', label: 'gh pr list --state merged --limit 40', result: '37 pull requests' },
    { say: '**4.2** — vector tiles (beta), a one-page checkout behind `checkout_v2`, and 11 fixes. Draft is in `docs/releases/4.2.md`.' }
  ])
  seed('infra', [
    { user: 'plan the postgres 15 → 17 upgrade with zero downtime' },
    { tool: 'Read', label: 'terraform/rds.tf', result: 'Read 96 lines', path: 'terraform/rds.tf' }
  ])

  world.git = {
    cwd: `${HOME}/code/atlas`,
    repo: `${HOME}/code/atlas`,
    branch: 'vector-tiles',
    add: 187,
    del: 42,
    files: [
      { path: 'src/tiles/vector.ts', status: '?', staged: false, untracked: true, add: 96, del: 0, binary: false },
      { path: 'src/tiles/raster.ts', status: 'M', staged: false, untracked: false, add: 12, del: 38, binary: false },
      { path: 'src/routes/map.ts', status: 'M', staged: true, untracked: false, add: 31, del: 4, binary: false },
      { path: 'tests/test_vector.py', status: 'A', staged: true, untracked: false, add: 48, del: 0, binary: false }
    ]
  }
  world.setJobs([
    { id: 'j1', at: Date.now(), ms: 9500, status: 'done', prompt: 'Foxtrot as a voxel figure at his desk', model: 'gemini-3.1-flash-image', ratio: '16:9', size: '1K', refs: [], from: 'cli', image: '/studio/fox-desk.jpg', mime: 'image/jpeg' },
    { id: 'j2', at: Date.now(), ms: 8500, status: 'done', prompt: 'lofi cover, fox in headphones', model: 'gemini-3.1-flash-image', ratio: '1:1', size: '1K', refs: [], from: 'pane', image: '/studio/fox-lofi.jpg', mime: 'image/jpeg' },
    { id: 'j3', at: Date.now(), ms: 9100, status: 'done', prompt: 'red fox at dawn', model: 'gemini-3.1-flash-image', ratio: '16:9', size: '1K', refs: [], from: 'tile', image: '/studio/fox-dawn.jpg', mime: 'image/jpeg' }
  ])
  world.vocabEntries = {
    perspicaz: {
      source: 'es',
      es: { word: 'perspicaz', ipa: '/peɾs.piˈkaθ/', formOf: null, senses: [{ pos: 'adj', glosses: ['perspicacious', 'shrewd'] }], native: [{ pos: 'adj', glosses: ['Que tiene agudeza y penetración de entendimiento.'] }], synonyms: ['agudo', 'sagaz', 'astuto'], etymology: 'Del latín perspicax, de perspicere, “ver a través”.', example: { text: 'Una zorra perspicaz no cae dos veces en la misma trampa.', translation: null }, url: '' },
      en: { word: 'perspicacious', ipa: '/ˌpɜː.spɪˈkeɪ.ʃəs/', formOf: null, senses: [{ pos: 'adj', glosses: ['Of acute discernment; having keen insight.'] }], native: [], synonyms: ['shrewd', 'astute', 'keen'], etymology: 'From Latin perspicax, “sharp-sighted”.', example: { text: 'A perspicacious fox is never caught twice.', translation: null }, url: '' }
    }
  }

  world.diffs['src/routes/map.ts'] = [
    '@@ -12,8 +12,14 @@ export const map = new Hono()',
    " map.get('/:z/:x/:y.png', raster)",
    "-map.get('/:z/:x/:y', raster)",
    "+map.get('/:z/:x/:y.mvt', async (c) => {",
    "+  const { z, x, y } = tileOf(c)",
    "+  if (z < 6) return raster(c)",
    "+  const tile = await vector(z, x, y)",
    "+  return c.body(tile, 200, MVT_HEADERS)",
    "+})",
    ' ',
    ' export default map'
  ].join('\n')

  /* ───────────── the film ───────────── */
  const tile = (slot: number) => (): Element | null =>
    [...document.querySelectorAll('.ad-world .cell-session .pane-head .slot')].find((e) => e.textContent === String(slot))?.closest('.cell') ?? null
  const inside = (of: () => Element | null, sel: string) => (): Element | null => of()?.querySelector(sel) ?? null
  const packRow = (name: string) => (): Element | null => [...document.querySelectorAll('.ad-world .pack-row')].find((r) => r.textContent?.includes(name)) ?? null
  const say = (id: string, text: string): void => world.push(id, { kind: 'text', text, ts: Date.now() })

  // Background chatter, so every tile is alive whenever the camera passes.
  play(d, 'shop', 0.4, [
    { tool: 'Edit', label: 'app/checkout/AddressForm.tsx', result: 'Added 58 lines', path: 'app/checkout/AddressForm.tsx' },
    { tool: 'Bash', label: 'pnpm test checkout', result: '64 passed', dur: 1.4 },
    { say: 'One page, three sections, the old flow still behind `checkout_v1`. Tests pass. **Want me to open the PR?**' },
    { status: 'idle', attention: false }
  ])
  play(d, 'infra', 0.8, [
    { tool: 'Grep', label: 'pg_upgrade|logical_replication', result: 'Found 3 files' },
    { tool: 'WebFetch', label: 'postgresql.org/docs/17/release-17', result: 'Received 212KB', dur: 1.6 },
    { say: 'Plan: a logical replica on 17, a day of dual-write checks, then a 40-second cutover behind pgbouncer.' },
    { tool: 'Write', label: 'docs/pg17-cutover.md', result: 'Wrote 84 lines', path: 'docs/pg17-cutover.md', dur: 2.5 },
    { tool: 'Bash', label: 'terraform plan -target=module.pg17', result: '4 to add, 0 to change', dur: 3 },
    { status: 'idle' }
  ])
  play(d, 'flaky', 1.2, [
    { tool: 'Read', label: 'tests/conftest.py', result: 'Read 120 lines', path: 'tests/conftest.py', dur: 1.2 },
    { tool: 'Edit', label: 'tests/conftest.py', result: 'Added 6 lines, removed 2', path: 'tests/conftest.py', dur: 1.5 },
    { tool: 'Bash', label: 'pytest tests/test_tile_cache.py --count 200', result: '200 passed', dur: 6 },
    { say: 'Fixed: the fixture now joins the writer thread before it returns. 200 runs, 0 failures.' }
  ])

  /* A — the hook: the whole deck, and Foxtrot runs in. */
  d.cam(0, 0, 'window', { w: 0.42, h: 0.3 })
  d.cam(0.05, 2.2, 'window', { w: 0.95, h: 0.68, dy: -40 })
  d.fox(0.2, 1.7, 'window', 0.56, 0.5)
  d.caption(0.25, 2.6, '10 Claude Code sessions.', 'One window. One fox.')
  d.bark(1.9)

  /* B — the focus pane is the real CLI. */
  const term = '.focus .xterm-helper-textarea'
  // The bottom of the terminal, where the prompt box is; the landscape frame is short, so it looks lower still.
  const termFit = { w: 0.97, h: 5, ay: wide ? 0.9 : 0.83 }
  d.cam(2.9, 1.5, '.focus', termFit)
  d.caption(3.3, 4.6, 'The real Claude Code', 'in a real terminal. your skills, hooks and MCP just work')
  d.fox(3.1, 1.0, term, 1.5, 0.5, true)
  const ask = 'serve vector tiles from /map, keep raster as a fallback'
  for (let i = 1; i <= ask.length; i++) d.at(4.1 + i * 0.022, () => world.typeInTerminal('atlas', ask.slice(0, i)))
  d.click(5.5, term, false)
  d.at(5.55, () => world.typeInTerminal('atlas', ''))
  play(d, 'atlas', 5.55, [
    { user: ask },
    { tool: 'Read', label: 'src/routes/map.ts', result: 'Read 88 lines', path: 'src/routes/map.ts', dur: 0.5 },
    { tool: 'Write', label: 'src/tiles/vector.ts', result: 'Wrote 96 lines', path: 'src/tiles/vector.ts', dur: 0.6 },
    { tool: 'Edit', label: 'src/routes/map.ts', result: 'Added 31 lines, removed 4', path: 'src/routes/map.ts', dur: 0.5 },
    { say: 'Vector tiles are served from `/map/{z}/{x}/{y}.mvt`. Raster stays as the fallback below zoom 6. Four tracks left: I can run them as a **wolfpack**.', dur: 1.6 },
    { status: 'idle' }
  ])

  /* C — everything else is a live conversation you can answer in place. */
  d.cam(8.1, 1.4, '.grid-right', { w: 0.97, h: 5, ay: 0.2 })
  d.caption(8.4, 4.6, 'Every other session:', 'a live conversation. answer it without leaving yours')
  const shopBox = inside(tile(2), '.tile-prompt textarea')
  d.fox(8.9, 1.0, shopBox, 0.55, 0.5)
  d.click(9.95, shopBox, false)
  d.type(10.1, 0.8, shopBox, 'yes, open it')
  d.key(11.1, shopBox, 'Enter')
  d.at(11.1, () => d.pose('leap', 380))
  play(d, 'shop', 11.5, [
    { tool: 'Bash', label: 'gh pr create --fill --draft', result: 'github.com/acme/storefront/pull/482', dur: 0.9 },
    { say: 'Draft PR **#482** is up, with the flag default off.' },
    { status: 'idle' }
  ])

  /* D — one needs you: its fox barks, a click brings it to the center. */
  d.cam(13.2, 1.3, tile(3), { w: 0.95, h: 0.5, dy: -40 })
  d.at(14.0, () => {
    world.push('flaky', { kind: 'tool', id: 'push', name: 'Bash', label: 'git push --force-with-lease origin fix/cache-race', ts: Date.now(), done: false, error: false })
    world.ask('flaky', { tool: 'Bash', command: 'git push --force-with-lease origin fix/cache-race' })
    world.status('flaky', 'blocked', true)
    world.bark('“flaky test hunt” wants permission: git push --force-with-lease', ['flaky'])
  })
  d.caption(14.2, 4.4, 'Foxtrot barks', 'the moment a session needs you')
  d.cam(16.9, 1.0, tile(3), { w: 0.95, h: 0.5, dy: -40 })
  d.fox(16.7, 1.1, tile(3), 0.5, 0.45)
  d.click(17.9, inside(tile(3), '.tile'))
  d.cam(18.1, 1.2, '.focus', termFit)
  d.fox(18.3, 0.9, term, 1.5, 0.5, true)
  d.click(19.6, term, false)
  d.at(19.65, () => {
    world.ask('flaky', null)
    world.toolDone('flaky', 'push', 'fix/cache-race → origin (forced update)')
    world.status('flaky', 'busy')
  })
  play(d, 'flaky', 20.0, [{ say: 'Pushed. CI is running the suite 50 times over; I will watch it.', dur: 1.0 }])

  /* E — the wolfpack: subagents as a roster of gold foxes, each on a leash. */
  const pack = [
    { id: 'enc', description: 'vector encoder', type: 'general-purpose' },
    { id: 'sty', description: 'client style spec', type: 'general-purpose' },
    { id: 'hdr', description: 'cache headers', type: 'general-purpose' },
    { id: 'load', description: 'load test', type: 'general-purpose' }
  ]
  d.at(20.2, () => {
    world.push('atlas', { kind: 'user', text: 'go: run the wolfpack', ts: Date.now() })
    world.status('atlas', 'busy')
  })
  pack.forEach((a, i) => d.at(20.6 + i * 0.3, () => world.agent({ ...a, parent: 'atlas', model: 'opus', background: true, startedAt: Date.now() })))
  play(d, 'agent:enc', 21.0, [
    { tool: 'Read', label: 'src/tiles/vector.ts', result: '', dur: 1 },
    { tool: 'Write', label: 'src/tiles/mvt/encode.ts', result: '', dur: 2.2 },
    { tool: 'Bash', label: 'pnpm vitest run tiles/mvt', result: '', dur: 6 }
  ])
  play(d, 'agent:sty', 21.2, [
    { tool: 'WebFetch', label: 'maplibre.org/maplibre-style-spec', result: '', dur: 1.8 },
    { tool: 'Write', label: 'web/map/style.json', result: '', dur: 3 },
    { tool: 'Edit', label: 'web/map/Map.tsx', result: '', dur: 5 }
  ])
  play(d, 'agent:hdr', 21.1, [
    { tool: 'Grep', label: 'Cache-Control', result: '', dur: 0.7 },
    { tool: 'Edit', label: 'src/routes/map.ts', result: '', dur: 1.0 }
  ])
  d.at(23.2, () => world.agent({ id: 'hdr', parent: 'atlas', endedAt: Date.now(), lastText: 'ETag + immutable, max-age a year on hashed tiles.' }))
  play(d, 'agent:load', 21.3, [
    { tool: 'Read', label: 'ops/k6/tiles.js', result: '', dur: 1.2 },
    { tool: 'Bash', label: 'k6 run --vus 2000 ops/k6/tiles.js -e HOST=prod', result: '', dur: 9 }
  ])
  if (wide) d.scroll(20.9, 1.2, '.tile-pack')
  d.cam(20.9, 1.3, '.tile-pack', { w: 0.96, h: 0.5, dy: -30 })
  d.caption(21.2, 5.2, 'Send in a wolfpack', 'every subagent on a leash: pause or cancel, with a reason')
  const loadRow = packRow('load test')
  d.hover(22.6, loadRow, true)
  d.fox(22.4, 1.0, inside(loadRow, '.leash-btn.danger'), 0.5, 0.6)
  d.click(23.6, inside(loadRow, '.leash-btn.danger'))
  d.cam(23.7, 0.8, '.picker.leash', { w: 0.94, h: 0.5 })
  d.fox(23.8, 0.6, '.picker.leash textarea', 0.8, 0.6)
  d.type(24.4, 1.1, '.picker.leash textarea', 'never load test prod. use staging')
  d.fox(25.6, 0.5, '.picker.leash .leash-go', 0.5, 0.6)
  d.click(26.2, '.picker.leash .leash-go')
  d.cam(26.4, 0.9, '.tile-pack', { w: 0.96, h: 0.5, dy: -30 })
  d.at(26.6, () => say('atlas', '**[deck]** The user cancelled your subagent “load test”. Reason: never load test prod. use staging'))
  play(d, 'atlas', 27.0, [{ say: 'Understood. Relaunching the load test against **staging**.', dur: 0.8 }])
  d.at(28.0, () => world.agent({ id: 'load2', parent: 'atlas', description: 'load test (staging)', model: 'opus', background: true, startedAt: Date.now() }))
  play(d, 'agent:load2', 28.1, [{ tool: 'Bash', label: 'k6 run --vus 2000 ops/k6/tiles.js -e HOST=staging', result: '', dur: 9 }])

  /* F — the margins: mini apps. */
  d.at(27.2, () => {
    void import('@r/lib/mol').then(({ mol }) => mol().show('1UBQ', { color: 'hydrophobicity' }).then(() => mol().act({ op: 'view', spin: true, zoom: 'resi 1-72' })))
  })
  play(d, 'grail', 27.0, [
    { tool: 'Bash', label: 'node "$DECK_MOL" show 1UBQ --color hydrophobicity', result: 'ubiquitin, 76 residues', dur: 1.2 },
    { say: 'This is **ubiquitin**. Orange is greasy, blue loves water: watch where the orange ends up. *Inside.*', dur: 2 },
    { status: 'idle' }
  ])
  if (wide) d.scroll(28.9, 1.2, '.tile.mol')
  d.cam(28.9, 1.3, '.tile.mol', { w: 0.96, h: 0.5, dy: -30 })
  d.caption(29.2, 5.6, 'Mini apps in the margins', 'molecules · diffs · image gen · music · Spanish')
  d.fox(29.0, 1.2, '.tile.mol', 0.85, 0.8)
  if (wide) d.scroll(31.0, 1.1, '.tile.gittile')
  d.cam(31.0, 1.2, '.tile.gittile', { w: 0.96, h: 0.5, dy: -30 })
  const row = (): Element | null => document.querySelectorAll('.ad-world .gt-row')[2] ?? null
  d.fox(31.0, 1.1, row, 0.3, 0.6)
  d.click(32.2, row)
  if (wide) d.scroll(33.4, 1.1, '.tile.studio')
  d.cam(33.4, 1.2, '.tile.studio', { w: 0.96, h: 0.5, dy: -30 })
  d.fox(33.4, 1.1, '.tile.studio', 0.8, 0.75)

  /* G — pull back, run through the themes, end card. */
  if (wide) d.scroll(35.0, 1.2, tile(1))
  d.cam(35.0, 1.6, 'window', { w: 0.95, h: 0.68, dy: -40 })
  d.fox(35.0, 1.4, 'window', 0.5, 0.97)
  d.caption(35.3, 2.9, 'Six themes. Light and dark.')
  const looks: [string, 'light' | 'dark'][] = [['cream', 'dark'], ['catppuccin', 'dark'], ['nord', 'dark'], ['gruvbox', 'light'], ['solarized', 'dark'], ['cream', 'light']]
  looks.forEach(([theme, appearance], i) => d.at(36.0 + i * 0.42, () => world.patch({ theme, appearance })))
  d.at(38.7, () => {
    document.getElementById('ad-end')!.classList.add('on')
  })
  d.bark(39.5)
  d.fox(38.5, 0.9, 'window', 0.47, 0.72)
  d.duration = 41.5
}
