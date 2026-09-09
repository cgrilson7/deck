// The vocabulary builder's word supply: the bundled SAT-level list (data/esLemmas.ts) plus
// the Spanish side of the user's own languagelog translations, read straight out of its
// SQLite file with the sqlite3 CLI (macOS ships it; no native module to rebuild against
// Electron). Read-only, and any failure just means the bundled list alone.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { VocabWord } from '@shared/types'
import { ES_LEMMAS } from './data/esLemmas'
import { findInPath } from './env'

const run = promisify(execFile)
const MAX_WORDS = 3 // languagelog entries longer than this are sentences, not vocabulary
const TTL_MS = 5 * 60 * 1000

interface Row {
  original_text: string
  translated_text: string
  source_language: 'en' | 'es'
}

let cache: { at: number; db: string; words: VocabWord[] } | null = null

function expand(p: string): string {
  return p.replace(/^~(?=$|\/)/, homedir())
}

async function languagelogWords(dbPath: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const db = expand(dbPath)
  if (!db || !existsSync(db)) return []
  const sqlite3 = findInPath(env.PATH, 'sqlite3') ?? '/usr/bin/sqlite3'
  const sql = 'select original_text, translated_text, source_language from translations order by created_at desc'
  const { stdout } = await run(sqlite3, ['-readonly', '-json', db, sql], { env, timeout: 5000, maxBuffer: 16 * 1024 * 1024 })
  const rows = (stdout.trim() ? JSON.parse(stdout) : []) as Row[]
  const out: string[] = []
  for (const r of rows) {
    const es = (r.source_language === 'es' ? r.original_text : r.translated_text)
      .trim()
      .replace(/^[¡¿"'\s]+|[.!?¡¿"'\s]+$/g, '')
      .toLowerCase()
    if (es && es.split(/\s+/).length <= MAX_WORDS) out.push(es)
  }
  return out
}

/**
 * The supply, with the ♥'d words from the store treated like the user's own: promoted to the
 * front of every pass if they are list words, added if they are not. `liked` changes at any
 * click, so it is merged on each call over the cached base list.
 */
export async function vocabWords(dbPath: string, env: NodeJS.ProcessEnv, liked: string[] = []): Promise<VocabWord[]> {
  const base = await baseWords(dbPath, env)
  if (!liked.length) return base
  const want = new Set(liked)
  const have = new Set(base.map((w) => w.word))
  const extra: VocabWord[] = liked.filter((w) => !have.has(w)).map((word) => ({ word, pos: '', rank: -1, mine: true }))
  return [...extra, ...base.map((w) => (want.has(w.word) && !w.mine ? { ...w, mine: true } : w))]
}

async function baseWords(dbPath: string, env: NodeJS.ProcessEnv): Promise<VocabWord[]> {
  if (cache && cache.db === dbPath && Date.now() - cache.at < TTL_MS) return cache.words
  let mine: string[] = []
  try {
    mine = await languagelogWords(dbPath, env)
  } catch {
    /* no sqlite3, unreadable file, schema drift: bundled list only */
  }
  const seen = new Set<string>()
  const words: VocabWord[] = []
  for (const w of mine) {
    if (seen.has(w)) continue
    seen.add(w)
    words.push({ word: w, pos: '', rank: -1, mine: true })
  }
  ES_LEMMAS.forEach(([word, pos, en], rank) => {
    if (seen.has(word)) return
    seen.add(word)
    words.push({ word, pos, rank, en, mine: false })
  })
  cache = { at: Date.now(), db: dbPath, words }
  return words
}
