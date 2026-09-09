// The vocabulary store: every translation the translator tile settles on, and every word the
// vocabulary tile actually shows (not prefetches), with the full merged entry, so flash cards
// can be built from them later. SQLite through node:sqlite (in Electron's Node; no native
// module to rebuild). File: <userData>/vocab.db. Peek at it with the sqlite3 CLI.
//
// Tables: translations (unique en+es pair, seen count, source side), words (unique es+en
// pair, the VocabResult as JSON, optional translation it came from, seen count, and the
// SM-2 fields (due / interval / ease / reps / lapses / known) that flash cards will drive),
// reviews (one row per graded card, for the history). Flash-card scheduling itself is not
// here yet; the columns are so the data model does not have to change when it lands.

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { TranslateResult, VocabResult, VocabStats } from '@shared/types'

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

const now = () => new Date().toISOString()

export class VocabStore {
  private db: DatabaseSync

  constructor(userData: string) {
    this.db = new DatabaseSync(join(userData, 'vocab.db'))
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;')
    this.db.exec(SCHEMA)
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
  saveWord(r: VocabResult, translationId: number | null): number {
    const es = (r.es?.word ?? '').trim()
    const en = (r.en?.word ?? r.es?.senses[0]?.glosses[0] ?? '').trim()
    if (!es && !en) return 0
    const t = now()
    this.db
      .prepare(
        `insert into words (es, en, source, entry, translation_id, first_seen, last_seen) values (?, ?, ?, ?, ?, ?, ?)
         on conflict (es, en) do update set
           entry = excluded.entry, seen = seen + 1, last_seen = excluded.last_seen,
           translation_id = coalesce(excluded.translation_id, translation_id)`
      )
      .run(es, en, r.source, JSON.stringify(r), translationId, t, t)
    return (this.db.prepare('select id from words where es = ? and en = ?').get(es, en) as { id: number }).id
  }

  stats(): VocabStats {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n
    return {
      words: one('select count(*) n from words'),
      translations: one('select count(*) n from translations'),
      due: one("select count(*) n from words where known = 0 and (due is null or due <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))")
    }
  }

  close(): void {
    this.db.close()
  }
}
