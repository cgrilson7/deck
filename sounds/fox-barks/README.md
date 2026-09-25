# Fox barks

Real red fox recordings, gathered Sept 25 2026 for Foxtrot's bark library. Every one may be redistributed:
public domain, CC0, CC BY or CC BY-SA, never NonCommercial. **Nothing here is bundled into the app**; a clip
goes into the deck by being copied to `src/renderer/src/assets/barks/` with a line in its `CREDITS.md`
and an import in `lib/barks.ts`.

- `index.html`: the audition page. Open it in a browser and click ▶, or use the arrow keys and space.
- `clips/`: 27 trims, about 1 s each (the two gekker cuts are 3–5 s). 44.1 kHz mono WAV, faded, normalised
  to −1 dBFS. An `a…` clip was cut from `SOURCES-archives.md`, an `s_…` one from `SOURCES-freesound.md` (that
  file calls them `trims/<name>.wav`; here they are `clips/s_<name>.wav`).
- `SOURCES-*.md`: for every recording, the page and file URLs, author, license, the attribution line it
  requires, what it sounds like and where else in it the good calls are. Other clips can be cut from those.
- `tools/`: the scripts that scanned, pitch-checked and cut the Freesound files (Python + sox).
- The ORIGINAL recordings (127 MB, too big for git) are in `~/Music/fox-barks-originals/` (`archives/`,
  `freesound/`); each is re-downloadable from its URL in the sources files.

A trim keeps its source's license: CC BY and CC BY-SA clips need their credit line wherever they ship,
and a CC BY-SA trim stays CC BY-SA. The descriptions come from spectrograms, not listening: clip 26's
source has a "dogs" tag.

| # | Clip | Sounds like | Recorded by | License |
| --- | --- | --- | --- | --- |
| 1 | `clips/a01_bark_yellowstone_1.wav` | bark | NPS / Shan Burson, Yellowstone | public domain |
| 2 | `clips/a02_bark_yellowstone_2.wav` | bark | NPS / Shan Burson, Yellowstone | public domain |
| 3 | `clips/a03_barkrun_xc_rutting.wav` | bark run | Pascal Dubois, xeno-canto | CC0 |
| 4 | `clips/a04_yap_rain_1.wav` | yap | Peter Cusack, radio aporee | public domain |
| 5 | `clips/a05_yap_rain_2.wav` | yap | Peter Cusack, radio aporee | public domain | **in the deck** (`assets/barks/yap-rain.wav`)
| 6 | `clips/a06_bark_garden_1.wav` | bark | Tiago CarvE, radio aporee | CC BY 3.0 |
| 7 | `clips/a07_bark_garden_2.wav` | bark | Tiago CarvE, radio aporee | CC BY 3.0 |
| 8 | `clips/a08_gekker_kilburn.wav` | gekker | Tiago CarvE, radio aporee | public domain |
| 9 | `clips/a09_bark_bellender.wav` | bark | Jugrü, Wikimedia Commons | CC BY-SA 3.0 |
| 10 | `clips/a10_wowwow_britishlib.wav` | wow-wow bark | A. J. Williams / British Library | CC BY-SA 4.0 |
| 11 | `clips/a11_scream_fuchsschreit.wav` | scream | Livlandfahrer, Wikimedia Commons | CC BY-SA 4.0 |
| 12 | `clips/a12_scream_colchester.wav` | scream | philipmill6, radio aporee | public domain |
| 13 | `clips/s_bark_setzilla.wav` | bark | Setzilla, Freesound | CC0 |
| 14 | `clips/s_bark_qubodup_urban.wav` | bark | qubodup, Freesound | CC0 |
| 15 | `clips/s_bark_yukon.wav` | bark | SoundsLikeYukon, Freesound | CC0 |
| 16 | `clips/s_bark_gadzooks.wav` | bark (distant) | gadzooks, Freesound | CC0 |
| 17 | `clips/s_vixen_andrewjones.wav` | vixen call | AndrewJonesFoto, Freesound | CC BY 4.0 |
| 18 | `clips/s_call_qubodup_1.wav` | yelp | qubodup / janneair, Freesound | CC BY 3.0 |
| 19 | `clips/s_call_qubodup_3.wav` | yelp | qubodup / janneair, Freesound | CC BY 3.0 |
| 20 | `clips/s_cry_simonspiers.wav` | cry | Simon Spiers, Freesound | CC0 |
| 21 | `clips/s_scream_soundburst_short.wav` | scream | Soundburst, Freesound | CC0 |
| 22 | `clips/s_scream_soundburst_2.wav` | scream | Soundburst, Freesound | CC0 |
| 23 | `clips/s_scream_felixblume_1.wav` | scream | Felix Blume, Freesound | CC0 |
| 24 | `clips/s_scream_felixblume_2.wav` | scream | Felix Blume, Freesound | CC0 |
| 25 | `clips/s_scream_inspectorj.wav` | scream (distant) | InspectorJ, Freesound | CC BY 4.0 |
| 26 | `clips/s_screech_craigsays.wav` | screech (check: maybe dogs) | craigsays, Freesound | CC0 |
| 27 | `clips/s_gekker_timsc.wav` | gekker | timsc, Freesound | CC0 |
