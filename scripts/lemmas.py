#!/usr/bin/env python3
"""Regenerate src/main/data/esLemmas.ts: SAT-level Spanish vocabulary.

Every Spanish content word (noun, verb, adjective, adverb) whose English Wiktionary gloss is an
SAT word, attested in real usage but not everyday: rank >= MIN_RANK in the subtitle frequency
list. Each row carries the SAT word it matched, which the vocabulary tile shows as the English
headword ("perspicaz" ↔ "perspicacious", not the translator's "insightful").

Inputs (all in one directory, DIR):
    D=/tmp/vocab; mkdir -p $D
    curl -sL https://raw.githubusercontent.com/doozan/spanish_data/master/frequency.csv -o $D/frequency.csv
    curl -sL https://raw.githubusercontent.com/doozan/spanish_data/master/es-en.data -o $D/es-en.data
    curl -sL "https://raw.githubusercontent.com/lrojas94/SAT-Words/master/Freevocabulary%20Wordlist/freevocabulary_words.json" -o $D/freevocabulary_words.json
    curl -sL "https://raw.githubusercontent.com/lrojas94/SAT-Words/master/MajorTests%20Wordlist/majortests_words.json" -o $D/majortests_words.json
    curl -sL https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt -o $D/google-10000-english.txt
    python3 scripts/lemmas.py $D

- frequency.csv / es-en.data: doozan/spanish_data (CC-BY-4.0; es-en.data is English Wiktionary's
  Spanish entries, CC BY-SA). The frequency rank orders the output (the tile shows commoner
  words sooner) and gates the register.
- The SAT lists: freevocabulary.com's 5000 words (broad, so its everyday words are dropped:
  anything in the top EVERYDAY of google-10000-english) and majortests.com's ~1000 (tight; kept
  whole, and preferred when a Spanish word matches both).
"""
import csv, json, re, sys
from collections import OrderedDict

MIN_RANK = 4000  # content-word frequency rank below which a Spanish word is too ordinary
EVERYDAY = 5000  # freevocabulary words this common in English are not SAT words
KEEP = {'n', 'v', 'adj', 'adv'}
WORD = re.compile(r'^[a-záéíóúñü]{3,}$')
# Glosses marked with any of these are not the word's standard sense.
BAD_Q = re.compile(r'obsolete|archaic|rare|dated|slang|vulgar|derogatory|offensive|figurative|humorous|colloquial|'
                   r'Lunfardo|Latin America|Mexico|Argentina|Chile|Colombia|Spain|Cuba|Venezuela|Peru|Uruguay|Central America|'
                   r'Caribbean|Philippines|Andalusia|El Salvador|Honduras|Guatemala|Nicaragua|Costa Rica|Puerto Rico|Dominican|'
                   r'Ecuador|Bolivia|Paraguay|Panama|Canary|Rioplatense')

d = sys.argv[1].rstrip('/')

# English side: the two SAT lists.
fv = {w['word'].strip().lower() for w in json.load(open(f'{d}/freevocabulary_words.json', encoding='utf8'))}
mt = {w['word'].strip().lower() for w in json.load(open(f'{d}/majortests_words.json', encoding='utf8'))['results']}
everyday = set(l.strip() for l in open(f'{d}/google-10000-english.txt', encoding='utf8').read().split('\n')[:EVERYDAY])
sat = {w for w in fv | mt if re.fullmatch(r'[a-z]+', w) and (w in mt or w not in everyday)}

# Spanish side: content-word frequency rank.
rank = {}
for r in csv.DictReader(open(f'{d}/frequency.csv', encoding='utf8')):
    if r['pos'] in KEEP and not r['flags'] and WORD.match(r['spanish']) and r['spanish'] not in rank:
        rank[r['spanish']] = len(rank)

# es-en.data: blocks separated by _____; "word\npos: x\n  gloss: ...\n    q: qualifier".
entries = []
cur = None
for line in open(f'{d}/es-en.data', encoding='utf8'):
    line = line.rstrip('\n')
    if line == '_____':
        cur = None
    elif cur is None:
        cur = {'w': line, 'pos': '', 'glosses': []}
        entries.append(cur)
    elif line.startswith('pos: '):
        cur['pos'] = line[5:].strip()
    elif line.startswith('  gloss: '):
        cur['glosses'].append([line[9:].strip(), ''])
    elif line.startswith('    q: ') and cur['glosses']:
        cur['glosses'][-1][1] += line[7:] + ' '

def items(gloss):
    gloss = re.sub(r'\([^)]*\)', '', gloss)
    for it in re.split(r'[,;]', gloss):
        it = re.sub(r'^(to|a|an|the) ', '', it.strip().lower())
        if it:
            yield it

found = OrderedDict()  # lemma → (pos, english, rank)
for e in entries:
    w = e['w']
    if e['pos'] not in KEEP or not WORD.match(w) or rank.get(w, -1) < MIN_RANK or w in found:
        continue
    best = None  # (not in majortests, gloss index, english)
    for gi, (g, q) in enumerate(e['glosses']):
        if BAD_Q.search(q):
            continue
        for it in items(g):
            if it in sat:
                cand = (it not in mt, gi, it)
                if best is None or cand < best:
                    best = cand
    if best:
        found[w] = (e['pos'], best[2], rank[w])

rows = sorted(found.items(), key=lambda kv: kv[1][2])
lines = ',\n'.join(f'  [{json.dumps(w, ensure_ascii=False)}, {json.dumps(p)}, {json.dumps(en)}]' for w, (p, en, _) in rows)
open('src/main/data/esLemmas.ts', 'w', encoding='utf8').write(f"""// The vocabulary builder's word supply: {len(rows)} SAT-level Spanish content words (nouns, verbs,
// adjectives, adverbs) in frequency order — every lemma in English Wiktionary's Spanish entries
// (doozan/spanish_data es-en.data, CC BY-SA) whose gloss is an SAT word (freevocabulary.com's
// 5000 minus everyday English, plus majortests.com's list), attested in doozan's subtitle
// frequency list at rank {MIN_RANK}+. Generated by scripts/lemmas.py; do not hand-edit.
// https://github.com/doozan/spanish_data · https://github.com/lrojas94/SAT-Words

/** [lemma, part of speech (n / v / adj / adv), the SAT word it glosses]; the array index is the frequency order. */
export const ES_LEMMAS: readonly (readonly [string, string, string])[] = [
{lines}
]
""")
print(f'wrote {len(rows)} lemmas (sat words: {len(sat)})')
