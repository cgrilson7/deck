// The vocabulary store: every translation the translator tile settles on, and every word the
// vocabulary tile actually shows (not prefetches), with the full merged entry, so flash cards
// can be built from them later. SQLite through node:sqlite (in Electron's Node; no native
// module to rebuild). File: <userData>/vocab.db. Peek at it with the sqlite3 CLI.
//
// Tables: translations (unique en+es pair, seen count, source side), words (unique es+en
// pair, the VocabResult as JSON, optional translation it came from, seen count, and the
// SM-2 fields (due / interval / ease / reps / lapses / known) that flash cards will drive),
// reviews (one row per graded card, for the history). The flash cards in the vocabulary tile
// drive those columns through `gradeWord` (SM-2); `deck` deals the cards and `list` is the
// review list behind them.

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { SavedWord, StoredWord, TranslateResult, VocabResult, VocabStats, WordSchedule } from '@shared/types'

const SCHEMA = `
create table if not exists translations (
  id          integer primary key,
  en          text not null,
  es          text not null,
  source      text not null check (source in ('en', 'es')),
  seen        integer not null default 1,
  first_seen  text not null,
  last_seen   text not null,
  unique (en, es)
);
create table if not exists words (
  id              integer primary key,
  es              text not null,
  en              text not null,
  source          text not null check (source in ('en', 'es')),
  entry           text not null,
  translation_id  integer references translations(id) on delete set null,
  seen            integer not null default 1,
  first_seen      text not null,
  last_seen       text not null,
  due             text,
  interval        real not null default 0,
  ease            real not null default 2.5,
  reps            integer not null default 0,
  lapses          integer not null default 0,
  known           integer not null default 0,
  unique (es, en)
);
create table if not exists reviews (
  id          integer primary key,
  word_id     integer not null references words(id) on delete cascade,
  grade       integer not null,
  reviewed_at text not null
);
create index if not exists words_due on words(due);
`

/** Columns added after the first release; each is applied once to older files. */
const MIGRATIONS: [table: string, column: string, ddl: string][] = [
  ['words', 'liked', 'alter table words add column liked integer not null default 0']
]

const now = () => new Date().toISOString()

const DAY_MS = 86_400_000
/** A missed card comes back inside the same sitting. */
const LAPSE_MS = 10 * 60_000
const MIN_EASE = 1.3
const MAX_EASE = 2.8
/** Once a word survives this many days between reviews it is known and leaves the deck. */
const KNOWN_DAYS = 120

/** A `words` row as SQLite hands it over. */
interface Row {
  id: number
  es: string
  en: string
  entry: string
  seen: number
  due: string | null
  interval: number
  ease: number
  reps: number
  lapses: number
  known: number
  liked: number
}

const toStored = (r: Row): StoredWord => ({
  id: r.id,
  es: r.es,
  en: r.en,
  entry: parseEntry(r.entry),
  liked: r.liked === 1,
  known: r.known === 1,
  seen: r.seen,
  due: r.due,
  interval: r.interval,
  ease: r.ease,
  reps: r.reps,
  lapses: r.lapses
})

const parseEntry = (json: string): VocabResult | null => {
  try {
    return JSON.parse(json) as VocabResult
  } catch {
    return null
  }
}

export class VocabStore {
  private db: DatabaseSync

  constructor(userData: string) {
    this.db = new DatabaseSync(join(userData, 'vocab.db'))
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;')
    this.db.exec(SCHEMA)
    for (const [table, column, ddl] of MIGRATIONS) {
      const cols = this.db.prepare(`pragma table_info(${table})`).all() as { name: string }[]
      if (!cols.some((c) => c.name === column)) this.db.exec(ddl)
    }
  }

  /**
   * Record a finished translation. `supersede` is the row this same edit produced a moment
   * ago (the debounced translator fires on pauses, so "where is" precedes "where is the
   * library"); that row is rewritten instead of leaving the fragment behind.
   */
  saveTranslation(r: TranslateResult, supersede: number | null): number {
    const en = (r.source === 'en' ? r.text : r.translated).trim()
    const es = (r.source === 'es' ? r.text : r.translated).trim()
    if (!en || !es) return 0
    const t = now()
    if (supersede) {
      const existing = this.db.prepare('select id from translations where en = ? and es = ?').get(en, es) as { id: number } | undefined
      if (existing && existing.id !== supersede) {
        this.db.prepare('delete from translations where id = ?').run(supersede)
        this.db.prepare('update translations set seen = seen + 1, last_seen = ? where id = ?').run(t, existing.id)
        return existing.id
      }
      const r2 = this.db.prepare('update translations set en = ?, es = ?, source = ?, last_seen = ? where id = ?').run(en, es, r.source, t, supersede)
      if (r2.changes) return supersede
    }
    this.db
      .prepare(
        `insert into translations (en, es, source, first_seen, last_seen) values (?, ?, ?, ?, ?)
         on conflict (en, es) do update set seen = seen + 1, last_seen = excluded.last_seen`
      )
      .run(en, es, r.source, t, t)
    return (this.db.prepare('select id from translations where en = ? and es = ?').get(en, es) as { id: number }).id
  }

  /** Record a word the vocabulary tile showed, with its full entry (refreshed on every sighting). */
  saveWord(r: VocabResult, translationId: number | null): SavedWord {
    const es = (r.es?.word ?? '').trim()
    const en = (r.en?.word ?? r.es?.senses[0]?.glosses[0] ?? '').trim()
    if (!es && !en) return { id: 0, liked: false }
    const t = now()
    this.db
      .prepare(
        `insert into words (es, en, source, entry, translation_id, first_seen, last_seen) values (?, ?, ?, ?, ?, ?, ?)
         on conflict (es, en) do update set
           entry = excluded.entry, seen = seen + 1, last_seen = excluded.last_seen,
           translation_id = coalesce(excluded.translation_id, translation_id)`
      )
      .run(es, en, r.source, JSON.stringify(r), translationId, t, t)
    const row = this.db.prepare('select id, liked from words where es = ? and en = ?').get(es, en) as { id: number; liked: number }
    return { id: row.id, liked: row.liked === 1 }
  }

  /** The ♥ on the vocabulary card: a word worth keeping. Liked words rejoin the cycle like your own. */
  setLiked(id: number, liked: boolean): void {
    this.db.prepare('update words set liked = ? where id = ?').run(liked ? 1 : 0, id)
  }

  /** Every liked word's Spanish side, newest like first, for the vocabulary supply. */
  likedWords(): string[] {
    return (this.db.prepare("select es from words where liked = 1 and es != '' order by last_seen desc").all() as { es: string }[]).map((r) => r.es)
  }

  /**
   * The flash-card deck. Due first (a word never graded is due now), then whatever comes
   * soonest, so there is always something to review — the tile says when you are ahead of
   * schedule. Retired words are left out. The entry rides along, so a card needs no lookup.
   */
  deck(limit = 40): StoredWord[] {
    const rows = this.db
      .prepare(
        `select * from words where known = 0
         order by (due is null) desc, due asc, last_seen desc limit ?`
      )
      .all(limit) as unknown as Row[]
    return rows.map(toStored)
  }

  /** Every word for the review list, soonest due first (never-graded ones lead). */
  list(limit = 300): StoredWord[] {
    const rows = this.db
      .prepare(`select * from words order by (due is null) desc, due asc, last_seen desc limit ?`)
      .all(limit) as unknown as Row[]
    return rows.map(toStored)
  }

  /**
   * Grade one card, SM-2: `grade` is the answer quality (0 again, 3 hard, 4 good, 5 easy).
   * A miss resets the repetition count and comes back in ten minutes; a pass steps the
   * interval by the word's own ease. Past KNOWN_DAYS the word retires and leaves the deck.
   * Every grade is kept in `reviews`.
   */
  gradeWord(id: number, grade: number): WordSchedule {
    const row = this.db.prepare('select interval, ease, reps, lapses from words where id = ?').get(id) as
      | { interval: number; ease: number; reps: number; lapses: number }
      | undefined
    if (!row) return { id, due: null, interval: 0, known: false }
    const q = Math.max(0, Math.min(5, Math.round(grade)))
    let { interval, ease, reps, lapses } = row
    if (q < 3) {
      ease = Math.max(MIN_EASE, ease - 0.2)
      reps = 0
      lapses += 1
      interval = 0
    } else {
      ease = Math.min(MAX_EASE, Math.max(MIN_EASE, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))))
      reps += 1
      interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.round(interval * ease))
    }
    const known = interval >= KNOWN_DAYS ? 1 : 0
    const due = new Date(Date.now() + (interval > 0 ? interval * DAY_MS : LAPSE_MS)).toISOString()
    this.db
      .prepare('update words set due = ?, interval = ?, ease = ?, reps = ?, lapses = ?, known = ? where id = ?')
      .run(due, interval, ease, reps, lapses, known, id)
    this.db.prepare('insert into reviews (word_id, grade, reviewed_at) values (?, ?, ?)').run(id, q, now())
    return { id, due, interval, known: known === 1 }
  }

  stats(): VocabStats {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n
    return {
      words: one('select count(*) n from words'),
      translations: one('select count(*) n from translations'),
      liked: one('select count(*) n from words where liked = 1'),
      due: one("select count(*) n from words where known = 0 and (due is null or due <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))")
    }
  }

  close(): void {
    this.db.close()
  }
}
