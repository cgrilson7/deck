# Red fox vocalisations — free SFX libraries (Freesound)

All 12 files are Freesound "HQ previews" (128 kbps MP3, except #9 which is 64 kbps / 16 kHz because the original is low-rate), pulled without login from `cdn.freesound.org/previews/...-hq.mp3`. Each was checked with `file` and `afinfo`. The license comes from each sound's page. A preview carries the same license as its original. The WAV originals need a Freesound login, so fetch them only if you want lossless audio.

**Nobody has listened to these yet.** Sorting was done by the uploader's description and tags, a loudness-event scan (`tools/events.py`: dB above the clip's noise floor), and a spectral check (`tools/spec.py`). Every chosen event peaks at about 0.85–1.6 kHz, which fits fox barks and screams (vixen screams and barks sit around 1 kHz; big-dog barks sit lower). Listen before shipping.

`trims/` holds suggested cuts: 44.1 kHz mono WAV, 10 ms fade-in, 80 ms fade-out, peak-normalised to −1 dBFS, made by `tools/trim.py`. A trim is a derivative, so it keeps its source's license and attribution.

## CC0: no attribution required (credit is a courtesy)

| # | File | Sounds like | Dur | Source page | Direct file | Author | Trim notes |
|---|---|---|---|---|---|---|---|
| 1 | fs173208_setzilla_single-bark.mp3 | ONE sharp fox bark ("woof"-type, short) | 2.27s | https://freesound.org/people/Setzilla/sounds/173208/ | https://cdn.freesound.org/previews/173/173208_3230528-hq.mp3 | Setzilla | Bark at 0.5–1.4s. Quiet (−30 dBFS peak, SNR ~29 dB), so normalise. Trim: `trims/bark_setzilla.wav` (0.4–1.6) |
| 2 | fs634005_soundburst_screams.mp3 | Vixen SCREAMS, a series. Very clean (noise floor −81 dBFS, likely noise-gated) | 33.6s | https://freesound.org/people/Soundburst/sounds/634005/ | https://cdn.freesound.org/previews/634/634005_13454867-hq.mp3 | Soundburst | Screams at 1.0–1.8, 4.0–8.8 (a long one), 10.7–13.7, 14.3–16.0, 17.2–18.7, 19.3–20.2, 21.2–22.4, 23.4–24.8, 25.0–25.9, 28.4–31.3. Trims: `scream_soundburst_short.wav` (0.9–2.0), `scream_soundburst_2.wav` (17.1–18.9) |
| 3 | fs832436_felixblume_screams-barks.mp3 | Fox SCREAMS / scream-barks at night, S. France. Pro rig (ORTF Schoeps, MixPre 6), very high SNR (~60 dB) | 71.4s | https://freesound.org/people/felix.blume/sounds/832436/ | https://cdn.freesound.org/previews/832/832436_1661766-hq.mp3 | Felix Blume (felix.blume) | Strong events at 1.1–2.5, 3.7–5.2, 9.5–10.5, 24.1–25.2, 30.4–31.6. Weaker at 41.6, 57.0, 63.6. Trims: `scream_felixblume_1.wav` (1.0–2.7), `scream_felixblume_2.wav` (3.6–5.4). Best-quality scream source |
| 4 | fs854733_qubodup_urban-barks.mp3 | Urban fox BARK sequence, one ~0.9s bark every 2–3s, Berlin. Distant plane in the background | 47.2s | https://freesound.org/people/qubodup/sounds/854733/ | https://cdn.freesound.org/previews/854/854733_71257-hq.mp3 | qubodup (Iwan Gabovitch) | Barks at 1.2, 3.1, 5.8, 10.9, 14.0, 15.9, 17.8, 20.1, 22.1, 25.2, 28.2 (each ~0.9s, +35–44 dB). Trim: `bark_qubodup_urban.wav` (15.8–17.0). The uploader says "most likely a fox"; the ~850 Hz peak fits |
| 5 | fs865257_soundslikeyukon_red-fox-barks.mp3 | RED FOX (tagged vulpes-vulpes) BARKING, Whitehorse, Yukon, 5 a.m. The first ~7s include a window being opened | 70.2s | https://freesound.org/people/SoundsLikeYukon/sounds/865257/ | https://cdn.freesound.org/previews/865/865257_1544275-hq.mp3 | SoundsLikeYukon | Skip 0–7.3s (window handling). Clean barks at 21.4, 24.6, 28.3, 31.2, 38.1, 46.1 (each ~0.8s, +44–49 dB). Trim: `bark_yukon.wav` (21.3–22.4). The species ID is the most certain of the set |
| 6 | fs431302_simonspiers_cry.mp3 | Fox CRY / call right outside a window (loud, close) | 46.0s | https://freesound.org/people/Simon%20Spiers/sounds/431302/ | https://cdn.freesound.org/previews/431/431302_213249-hq.mp3 | Simon Spiers | Calls at 2.1–2.9, 5.1–5.8, 9.9–10.6 (+45–47 dB). Weaker at 13.9, 25.8, 43.5. Trim: `cry_simonspiers.wav` (2.0–3.1) |
| 7 | fs546948_timsc_urban-gekker-whine.mp3 | Urban fox calls: GEKKERING / yammering, whines, screeches (the uploader's tags). Near-continuous chatter | 48.5s | https://freesound.org/people/timsc/sounds/546948/ | https://cdn.freesound.org/previews/546/546948_266678-hq.mp3 | timsc | Chatter from 1.1s to ~40s. Denser runs at 8.5–12.9 and 21.3–24.0. Moderate SNR (~32 dB, phone recording). Trim: `gekker_timsc.wav` (8.4–13.1, 4.7s). Cut shorter pieces by ear. The only gekker-type source found |
| 8 | fs397655_gadzooks_barks.mp3 | Fox BARKS, ~100 m away, Surrey Hills UK. Single barks spaced ~3s | 32.0s | https://freesound.org/people/gadzooks/sounds/397655/ | https://cdn.freesound.org/previews/397/397655_44431-hq.mp3 | gadzooks | Barks at 5.7, 8.6, 10.9, 15.6, 19.1 (~0.6s each, +34–38 dB). Trim: `bark_gadzooks.wav` (19.0–19.9). Distant, so it has room tone |
| 9 | fs537587_craigsays_screech.mp3 | Red fox SCREECHING (scream) | 21.6s | https://freesound.org/people/craigsays/sounds/537587/ | https://cdn.freesound.org/previews/537/537587_11971718-hq.mp3 | craigsays | Screeches at 6.8–7.9, 8.4–9.5, 15.1–16.0, 17.2–18.4 (+39–48 dB). Trim: `screech_craigsays.wav` (6.7–8.1). One of its tags is "dogs"; check that no dog is in the part you use |

## CC-BY: attribution REQUIRED (put it in the app's credits / About / LICENSE file)

| # | File | Sounds like | Dur | Source page | Direct file | Author | License | Trim notes |
|---|---|---|---|---|---|---|---|---|
| 10 | fs485009_inspectorj_scream-distant.mp3 | One distant English fox SHRIEK / vocal cry, cleaned in iZotope RX. Already a finished one-shot | 2.17s | https://freesound.org/people/InspectorJ/sounds/485009/ | https://cdn.freesound.org/previews/485/485009_5121236-hq.mp3 | InspectorJ (Jonathan Shaw, www.jshaw.co.uk) | CC BY 4.0 | Usable as is (event at 0.0–1.3). Trim: `scream_inspectorj.wav` (0–1.5, normalised) |
| 11 | fs192782_qubodup-janneair_call-x5.mp3 | Five clean fox CALLS (short yelping mating calls), cleaned up; silent between calls | 9.74s | https://freesound.org/people/qubodup/sounds/192782/ | https://cdn.freesound.org/previews/192/192782_71257-hq.mp3 | qubodup (Iwan Gabovitch); the original recording is by janneair (CC0) | CC BY 3.0 | Calls at 0.7–1.6, 2.1–3.2, 4.0–5.1, 6.0–6.7, 7.9–8.9, each ~1s at +80 dB over silence. Trims: `call_qubodup_1.wav` (0.6–1.8), `call_qubodup_3.wav` (3.9–5.3). The five calls can be cut into five alerts |
| 12 | fs362127_andrewjonesfoto_vixen-call.mp3 | VIXEN CALLING (probably to her cubs): short sharp contact calls / barks, ~2.5s apart | 18.8s | https://freesound.org/people/AndrewJonesFoto/sounds/362127/ | https://cdn.freesound.org/previews/362/362127_6140831-hq.mp3 | AndrewJonesFoto | CC BY 4.0 | Calls at 1.8, 4.5, 6.6, 9.3, 12.7, 14.8, 16.8 (~0.4s each, +23–33 dB). Trim: `vixen_andrewjones.wav` (12.6–13.4). Low-rate preview (16 kHz, 64 kbps): dull top end |

### Attribution lines required

- #10: `"Fox, Vocal Cry, Distant, 01.wav" by InspectorJ (www.jshaw.co.uk) of Freesound.org — https://freesound.org/people/InspectorJ/sounds/485009/ — CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)`. This is the author's own requested form.
- #11: `Fox Call - Cleanup of sound by Janneair — Copyright 2013 Iwan Gabovitch (qubodup), CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/); Fox_noise.mp3 Copyright 2013 janneair — https://freesound.org/people/qubodup/sounds/192782/`. The author's page asks for this form.
- #12: `"vixen calling" by AndrewJonesFoto — https://freesound.org/people/AndrewJonesFoto/sounds/362127/ — CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)`. Note any modification (trimmed / normalised).
- CC0 (#1–9): nothing required. Optional courtesy: "Fox sounds from Freesound.org by Setzilla, Soundburst, felix.blume, qubodup, SoundsLikeYukon, Simon Spiers, timsc, gadzooks, craigsays (CC0)".

## Variety at a glance
- Single sharp barks: #1, #4, #5, #8 (and #12's short vixen calls)
- Screams / screeches (the contact call): #2, #3, #9, #10, #6
- Yelps / calls: #11
- Gekkering / chatter: #7 (only this one; the other agent's bioacoustic archives may have better gekkering)
