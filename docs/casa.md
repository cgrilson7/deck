# Casa: the house as a deck plugin

*Direction note, 2026-09-15. Nothing here is built yet. It records where the deck is headed so
work on the casa repo (~/casa) and on the deck stays one project.*

## The idea in one line

Foxtrot is the Mac mini. The mini is Foxtrot. He is the always-on machine that watches the
house, hears the day, and has Claude sessions for hands; the deck window and the phone are where
you look him in the eye.

## How the pieces line up

The repos in ~ are all senses or hands of the same head:

| Repo | Role |
| --- | --- |
| deck | the head: Foxtrot, the sessions, the wolfpack, the phone |
| casa | the house: light switches, cameras, threat recognition |
| dictator | the ears: a wearable mic, transcribed locally |
| whoop | the body: heart rate, temperature, sleep, over Bluetooth |

Foxtrot today is phase one, "senses only, rules and no model" (`src/main/foxtrot.ts`). Casa is the
first sense that comes from outside the deck, and it lands on the same log, the same bark, the
same top bar. A stranger at the front door and a permission prompt nobody answered are the same
kind of thing to him.

## Casa is a plugin, in both of the deck's senses

1. **Tiles.** The grid already has plugin tiles (Wikipedia, music, changes, vocabulary,
   translator): a main-process module that fetches, a renderer component that draws, and the
   phone gets it for free through the relay. Casa adds tiles of the same kind: cameras (live
   frame, last event, click for the clip), lights and switches, and whatever else the house has.
   They pin, page and drag like any plugin tile, wear the plugin frame, and cost no slot.
2. **Skills.** Every deck session already gets `plugin/` on `--plugin-dir` (the wolfpack). Casa
   adds skills and tools there, so any session can ask the house a question or act on it: who
   was at the door at nine, kill the porch light, pull the clip. The house becomes something a
   session can use, not only something a tile shows.
3. **A sense for Foxtrot.** House events arrive as entries in his log and, when a rule says so, as
   barks. The rules start as rules, like his session rules; a model comes when phase two does.

## The split between the two repos

- **~/casa is the house side.** A small service on the mini that talks to the cameras and
  switches, runs detection on the mini's Neural Engine (CoreML; the `~/Things` CreateML
  classifier on the mini is the same muscle), records, and publishes events on a bus. It knows
  nothing about the deck.
- **The deck side lives here**, as the casa plugin: the tiles, the skill, and Foxtrot's
  subscription. It knows nothing about camera brands.
- The seam between them is the event bus plus a small local API. That is casa's first
  deliverable, before any tile: an event like `person at front door, unknown face, 21:14` that
  Foxtrot can subscribe to the way he subscribes to session state.

## The mini as the always-on host

Deck's main process is already a server (the hooks server, the phone server, sessions that
outlive the window in tmux). The step this direction asks of the deck is the one its structure
already leans toward: main runs headless on the mini, and the Electron window on a laptop is a
client of it, the way the phone already is. Until then the deck runs on the laptop and casa's
service runs on the mini, and the seam is the bus.

State of the mini on 2026-09-15: Apple M2, 8 GB, macOS 15.5, reached from the laptop as
`ssh foxtrot` (an alias in `~/.ssh/config` for `colin@foxtrot.local` with a key). Homebrew, Node 22, Xcode, tmux 3.7c, ffmpeg 9 and Claude Code
2.1.273 are on it. A clone of the deck is at `~/deck` there and its smoke test passes; a user launch agent runs
`caffeinate` so it never sleeps. Done at its screen on 2026-09-16: renamed `foxtrot`, FileVault off, automatic login, never
sleeps, restarts after power failure, Screen Sharing on, Tailscale (100.67.175.62 on the tailnet,
the reliable path; its LAN IPv4 does not answer from the laptop), Claude logged in. 90 GB free.
Claude's credentials live in the login keychain, which SSH sessions cannot read: anything that runs
`claude` on the mini starts inside the GUI session (a `gui/<uid>` launch agent, or a tmux server
started from Terminal there). Deck's main on the mini will be a gui-domain launch agent. The Raspberry Pi
is a satellite at most: GPIO, a Zigbee stick, an edge camera.

## The first deliverables, and what they ask of the deck

Foxtrot is the home of everything: every device and person interacts with the house through the
deck served from foxtrot, never through a vendor app. In order:

1. Casa's event stream and local API (house side only).
2. **A camera tile that works on the phone page.** Live view, snapshot, record, the event
   timeline; photos and clips land on foxtrot and the tile lets a phone save one. Deck side: a
   `casa` plugin tile of the same shape as the others, and the phone relay carrying a live stream,
   which the relay does not do today.
3. **A household pairing.** A second kind of `remote.json` token that shows only the house tiles
   (cameras, lights) and never sessions or terminals. Colin's pairing shows the whole deck; his
   wife's shows the house. Deck side: roles on the phone socket, and the phone page hiding what a
   role may not see.

Memory on the mini is the constraint on all of it: 8 GB, no Docker, no Electron main there. The
deck's presence on foxtrot is a small plain-Node agent reusing the session, tmux, transcript and
hooks modules and speaking the phone's socket protocol; the Electron deck on the laptop connects
to it and shows its sessions and the house tiles as remote.

## Open questions

- Cameras: decided. Wired RTSP/ONVIF with PoE (Reolink doorbell, RLC-810A, Amcrest turrets). The
  Ring goes back; the battery MUBVIEW is an event source at most.
- Detection: decided. Our own ffmpeg + CoreML pipeline; Scrypted and Frigate are out on memory.
- Lights: Home Assistant as the switch layer (in Docker on the mini, or on the Pi) vs talking to
  the switches' APIs directly. Home Assistant unless the house is all one brand.
- Whether Foxtrot's phase two (a model in the loop) starts with house events or session events.

See also `docs/foxtrot-portrait.md` for how he looks off the screen.
