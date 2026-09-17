#!/usr/bin/env node
// The Studio's CLI: run by a Claude session inside the deck from its Bash tool, so the session
// that drafted a hyper-specific image prompt is the one that runs it and the result lands in the
// deck's gallery (the Studio tile, the Studio pane, userData/studio) rather than in a file nobody
// sees. Talks to the deck's hooks server (main/hooks.ts → main/studio.ts) on 127.0.0.1, port from
// DECK_HOOK_PORT, else from the tmux socket's name ($TMUX: deck → 47800, anything else → 47801),
// identifying the caller by CLAUDE_CODE_SESSION_ID with $TMUX_PANE as the fallback. Its absolute
// path is DECK_STUDIO in every deck session's env. No dependencies; Node 18+.
//
//   studio.mjs gen [--model M] [--ratio R] [--size S] [--ref PATH]… [--tag T] [--name N]
//                  [--out PATH] [--prompt-file F] "<prompt>"    one image; waits for it (10–120s)
//   studio.mjs list [--limit N]                                 the gallery, newest first
//   studio.mjs models                                           the image models this key can see
//   studio.mjs info                                             key set? where images go? which model?
//   studio.mjs comic <manifest.json> [--out DIR] [--only 1,3,5|name,…] [--force]
//                                                               a SERIES: style + cast + panel, in order,
//                                                               each panel chained onto the last for consistency
//
// A generation may take two minutes (4K on the pro model), so no fetch timeout here: the deck's
// own CALL_TIMEOUT_MS is the one that matters.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'

const [cmd, ...rest] = process.argv.slice(2)

/** Image extensions the deck will send along (main/studio.ts MIME). */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif'])
/** STUDIO_REFS_MAX in shared/types.ts: past this the deck drops the rest, so say so first. */
const REFS_MAX = 10

function port() {
  if (process.env.DECK_HOOK_PORT) return Number(process.env.DECK_HOOK_PORT)
  const sock = (process.env.TMUX ?? '').split(',')[0]
  const name = sock.slice(sock.lastIndexOf('/') + 1)
  return name === 'deck' ? 47800 : 47801
}

function who() {
  return { alpha: process.env.CLAUDE_CODE_SESSION_ID ?? process.env.TMUX_PANE ?? '', pane: process.env.TMUX_PANE ?? '' }
}

/**
 * One POST to /studio. `soft` returns a non-ok answer instead of dying, which is how `gen` still
 * prints the failed job (the model's refusal is on it) before exiting 1.
 */
async function call(body, soft = false) {
  let res
  try {
    res = await fetch(`http://127.0.0.1:${port()}/studio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...who(), cwd: process.cwd(), ...body })
    })
  } catch (err) {
    die(`no deck answering on port ${port()} (${err.message}). Is this session running inside the deck?`)
  }
  const out = await res.json().catch(() => ({ ok: false, error: `bad reply (${res.status})` }))
  if (soft) return out
  if (!res.ok || out.ok === false) die(out.error ?? `HTTP ${res.status}`)
  return out
}

function die(msg) {
  console.error(`studio: ${msg}`)
  process.exit(1)
}

/** Absolute, `~/` expanded, relative to `base` (the cwd for a flag, the manifest's folder for a manifest). */
function abs(p, base) {
  let s = String(p ?? '').trim().replace(/^['"]+|['"]+$/g, '')
  if (s.startsWith('~/')) s = join(homedir(), s.slice(2))
  return isAbsolute(s) ? s : resolve(base ?? process.cwd(), s)
}

/** Every reference is checked HERE, before a call that costs money and two minutes. */
function checkRef(p, where) {
  if (!existsSync(p)) die(`no such reference image: ${p}${where ? ` (${where})` : ''}`)
  if (!statSync(p).isFile()) die(`not a file: ${p}${where ? ` (${where})` : ''}`)
  if (!IMAGE_EXT.has(extname(p).toLowerCase())) die(`not an image I can send: ${p} (png, jpg, webp, gif, heic)`)
  return p
}

function flags(args) {
  const out = { _: [], refs: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--force') out.force = true
    else if (a === '--ref') out.refs.push(need(args, ++i, '--ref'))
    else if (a === '--model' || a === '--ratio' || a === '--size' || a === '--tag' || a === '--name' || a === '--out' || a === '--only') out[a.slice(2)] = need(args, ++i, a)
    else if (a === '--prompt-file') out.promptFile = need(args, ++i, '--prompt-file')
    else if (a === '--limit') out.limit = Number(need(args, ++i, '--limit'))
    else if (a.startsWith('--')) die(`unknown flag ${a}`)
    else out._.push(a)
  }
  return out
}

const need = (args, i, flag) => (args[i] === undefined ? die(`${flag} wants a value`) : args[i])

const print = (x) => console.log(JSON.stringify(x, null, 2))
const secs = (ms) => `${Math.round((ms ?? 0) / 100) / 10}s`

/** The prompt: the positional words, `--prompt-file`, or stdin (the argument `-`). */
async function promptFrom(f) {
  if (f.promptFile) {
    const p = abs(f.promptFile)
    try {
      return readFileSync(p, 'utf8').trim()
    } catch (err) {
      die(`cannot read ${p}: ${err.message}`)
    }
  }
  const words = f._.join(' ').trim()
  if (words && words !== '-') return words
  if (words === '-' || !process.stdin.isTTY) {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    return Buffer.concat(chunks).toString('utf8').trim()
  }
  return ''
}

/** `--out` is a file when it looks like one, else a folder to drop the image into. */
function outPathFor(out, fallbackName) {
  const p = abs(out)
  const looksLikeFile = IMAGE_EXT.has(extname(p).toLowerCase())
  const file = looksLikeFile ? p : join(p, fallbackName)
  mkdirSync(dirname(file), { recursive: true })
  return file
}

switch (cmd) {
  case 'gen': {
    const f = flags(rest)
    const prompt = await promptFrom(f)
    if (!prompt) die('nothing to generate: pass the prompt as an argument, --prompt-file FILE, or on stdin with -')
    const refs = f.refs.map((r) => checkRef(abs(r), '--ref'))
    if (refs.length > REFS_MAX) die(`${refs.length} references, and the deck sends at most ${REFS_MAX}`)
    const out = await call(
      {
        op: 'gen',
        prompt,
        ...(f.model ? { model: f.model } : {}),
        ...(f.ratio ? { ratio: f.ratio } : {}),
        ...(f.size ? { size: f.size } : {}),
        ...(f.tag ? { tag: f.tag } : {}),
        ...(f.name ? { name: f.name } : {}),
        refs
      },
      true
    )
    const job = out.job
    if (job) print(job)
    if (!out.ok) die(out.error ?? job?.error ?? 'no image')
    if (f.out && job?.image) {
      const dest = outPathFor(f.out, `${f.name ? f.name : basename(job.image, extname(job.image))}${extname(job.image)}`)
      try {
        copyFileSync(job.image, dest)
      } catch (err) {
        die(`cannot write ${dest}: ${err.message}`)
      }
      console.log(dest)
    }
    break
  }
  case 'list': {
    const f = flags(rest)
    print(await call({ op: 'list', ...(f.limit ? { limit: f.limit } : {}) }))
    break
  }
  case 'models':
    print(await call({ op: 'models' }))
    break
  case 'info':
    print(await call({ op: 'info' }))
    break
  case 'comic': {
    const f = flags(rest)
    const file = f._[0]
    if (!file) die('usage: comic <manifest.json> [--out DIR] [--only 1,3,5] [--force]')
    const manifestPath = abs(file)
    let m
    try {
      m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      die(`cannot read ${manifestPath}: ${err.message}`)
    }
    const here = dirname(manifestPath)
    if (!Array.isArray(m.panels) || m.panels.length === 0) die(`${manifestPath} has no "panels" array`)

    // Everything is checked before the first call: a manifest typo should not surface after two
    // minutes of generating, and a missing reference not at panel seven.
    const seen = new Set()
    m.panels.forEach((p, i) => {
      if (!p || typeof p !== 'object') die(`panel ${i + 1} is not an object`)
      if (!p.name || !/^[\w.-]+$/.test(p.name)) die(`panel ${i + 1} needs a "name" of word characters (it is the file's name)`)
      if (seen.has(p.name)) die(`two panels are called "${p.name}"`)
      seen.add(p.name)
      if (!p.prompt || !String(p.prompt).trim()) die(`panel "${p.name}" has no prompt`)
    })
    const common = (Array.isArray(m.refs) ? m.refs : []).map((r) => checkRef(abs(r, here), 'the manifest’s refs'))
    const panelRefs = m.panels.map((p) => (Array.isArray(p.refs) ? p.refs : []).map((r) => checkRef(abs(r, here), `panel "${p.name}"`)))
    const chain = Number.isFinite(m.chain) ? Math.max(0, Math.trunc(m.chain)) : 0
    const out = f.out ? abs(f.out) : join(here, 'out')

    const only = f.only
      ? new Set(
          String(f.only)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        )
      : null
    if (only) {
      for (const want of only) {
        const hit = m.panels.some((p, i) => p.name === want || String(i + 1) === want)
        if (!hit) die(`--only names "${want}", which is neither a panel name nor a panel number (1..${m.panels.length})`)
      }
    }
    const wanted = (p, i) => (only ? only.has(p.name) || only.has(String(i + 1)) : true)

    mkdirSync(out, { recursive: true })
    const existing = (name) => [`${name}.png`, `${name}.jpg`, `${name}.webp`].map((n) => join(out, n)).find((p) => existsSync(p))

    const done = []
    const results = []
    let made = 0
    let skipped = 0
    let failed = 0
    for (let i = 0; i < m.panels.length; i++) {
      const p = m.panels[i]
      const had = existing(p.name)
      // A panel outside --only is not re-run, but its image still chains into the next one and
      // still belongs on the contact sheet.
      if (!wanted(p, i)) {
        if (had) {
          results.push({ name: p.name, prompt: String(p.prompt), file: had, skipped: true })
          done.push(had)
        }
        continue
      }
      // Naming a panel in --only IS the ask to redo it; otherwise an image already there is kept.
      if (had && !only && !f.force) {
        console.error(`${p.name}: have it, skipping (${had})`)
        results.push({ name: p.name, prompt: String(p.prompt), file: had, skipped: true })
        done.push(had)
        skipped++
        continue
      }
      // Chained refs come last so the manifest's own references stay in front of them.
      const refs = [...common, ...panelRefs[i], ...(chain ? done.slice(-chain) : [])].slice(0, REFS_MAX)
      const pieces = [m.style, m.cast, `PANEL: ${String(p.prompt).trim()}`].map((s) => String(s ?? '').trim()).filter(Boolean)
      if (refs.length) pieces.push('Keep every recurring character exactly as in the reference images.')
      const t0 = Date.now()
      const answer = await call(
        {
          op: 'gen',
          prompt: pieces.join('\n\n'),
          ...(m.model ? { model: m.model } : {}),
          ...(m.ratio ? { ratio: m.ratio } : {}),
          ...(m.size ? { size: m.size } : {}),
          ...(m.tag ? { tag: m.tag } : {}),
          name: p.name,
          refs
        },
        true
      )
      const job = answer.job
      if (!answer.ok || !job?.image) {
        console.error(`${p.name}: FAILED after ${secs(Date.now() - t0)} — ${answer.error ?? job?.error ?? 'no image'}`)
        results.push({ name: p.name, prompt: String(p.prompt), error: answer.error ?? job?.error ?? 'no image' })
        failed++
        continue
      }
      const dest = join(out, `${p.name}${extname(job.image) || '.png'}`)
      try {
        copyFileSync(job.image, dest)
      } catch (err) {
        die(`cannot write ${dest}: ${err.message}`)
      }
      console.error(`${p.name}: ${secs(job.ms ?? Date.now() - t0)} → ${dest}`)
      results.push({ name: p.name, prompt: String(p.prompt), file: dest })
      done.push(dest)
      made++
    }

    const contact = join(out, 'contact.html')
    writeFileSync(contact, contactSheet(m, results))
    console.error(`${m.title ?? basename(manifestPath)}: ${made} made, ${skipped} kept, ${failed} failed → ${out}`)
    print({ ok: failed === 0, title: m.title ?? null, tag: m.tag ?? null, out, contact, made, skipped, failed, panels: results })
    if (failed) process.exit(1)
    break
  }
  default:
    console.error(
      'usage: studio.mjs gen [--model M] [--ratio R] [--size S] [--ref PATH]… [--tag T] [--name N] [--out PATH] "<prompt>"\n' +
        '       studio.mjs list [--limit N] | models | info\n' +
        '       studio.mjs comic <manifest.json> [--out DIR] [--only 1,3,5] [--force]'
    )
    process.exit(1)
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/** The contact sheet: the whole series on one page, no scripts, images beside it by relative name. */
function contactSheet(m, results) {
  const cells = results
    .map((r) => {
      const art = r.file
        ? `<img src="${esc(basename(r.file))}" alt="${esc(r.name)}">`
        : `<div class="missing">${esc(r.error ?? 'not generated')}</div>`
      return `  <figure>\n    <div class="cell">${art}</div>\n    <figcaption><b>${esc(r.name)}</b>${esc(String(r.prompt).trim().slice(0, 140))}</figcaption>\n  </figure>`
    })
    .join('\n')
  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(m.title ?? 'contact sheet')}</title>
<style>
  :root { color-scheme: light dark; --ink: #1b1a17; --muted: #6f6a60; --paper: #f7f3ea; --line: #ddd6c8; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ece6da; --muted: #9a9284; --paper: #1a1815; --line: #332f28; } }
  body { margin: 0; padding: 24px; background: var(--paper); color: var(--ink);
         font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: var(--muted); margin: 0 0 20px; }
  .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px; }
  figure { margin: 0; }
  .cell { aspect-ratio: 1 / 1; background: color-mix(in srgb, var(--ink) 6%, transparent);
          border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
          display: flex; align-items: center; justify-content: center; }
  .cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .missing { color: var(--muted); font-size: 12px; padding: 12px; text-align: center; }
  figcaption { color: var(--muted); font-size: 12px; margin-top: 6px; }
  figcaption b { color: var(--ink); display: block; font-size: 12px; }
</style>
<h1>${esc(m.title ?? 'contact sheet')}</h1>
<p class="sub">${esc([m.tag, m.model || 'default model', m.ratio ?? '1:1', m.size ?? '1K'].filter(Boolean).join(' · '))}</p>
<div class="sheet">
${cells}
</div>
`
}
