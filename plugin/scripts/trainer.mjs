#!/usr/bin/env node
// The trainer's CLI: how a Claude session (Haiku, as a rule) plays the Game Boy on the deck's
// Pokemon tile. Every command ends by printing the state — where you are, what the screen says,
// the map around you, your party, the quest — so the loop is look → one command → look. The
// game is Pokémon Yellow; the knowledge (WRAM layout, maps, the planner) is lib/yellow.mjs, the
// routines lib/drive.mjs, and the emulator is reached through lib/door.mjs: the deck's
// `POST /gameboy` (DECK_HOOK_PORT, like studio.mjs), or `--headless <rom>` for serverboy in
// this process (the state carried between calls as a save state under --dir). Its absolute
// path is DECK_TRAINER in every deck session's env.
//
//   trainer.mjs look [--shot] [--radius X,Y] [--no-map]   the state (+ a screenshot's path)
//   trainer.mjs shot                                       a screenshot only
//   trainer.mjs press <A|B|START|SELECT|UP|DOWN|LEFT|RIGHT> [n]
//   trainer.mjs advance                                    A through text until a choice
//   trainer.mjs walk <up|down|left|right> [tiles]
//   trainer.mjs goto <target>                              a landmark, MAP@x,y, door:MAP, or a map
//   trainer.mjs talk <target>                              go stand before someone and press A
//   trainer.mjs fight <slot>                               in a battle: that move, then the turn
//   trainer.mjs save <name> | load <name>                  checkpoints (save states)
//   trainer.mjs speed <1|2|4> | pause | resume             the tile's pace (deck only)
//   trainer.mjs rom [path]                                 list / load a cartridge (deck only)
//   trainer.mjs intro                                      a new game up to the bedroom
//   trainer.mjs where [target]                             the landmarks, or one of them
//   trainer.mjs map                                        the whole current map
//   trainer.mjs cut                                        use Cut on the tree you face (needs HM01 taught)
//   trainer.mjs party "<spec>" [--add] [--ot NAME] [--dv N] [--ev N]
//                                                          FORGE a party: "Alakazam 65: Psychic, Recover; Snorlax 65"
//                                                          --add appends instead of replacing; --ot names another original trainer
//                                                          (moves default to the level-up set at that level)
//   trainer.mjs elite [--level N]                          the preset Elite Four team, all badges, money
//   trainer.mjs warp <MAP_CONST> [warpId]                  bend this map's doors: the next one leads there
//   trainer.mjs badges [all|none]  |  money <n>
//   trainer.mjs learnset <pokemon> [level]                 what it knows by then
//   trainer.mjs sprite [watch] [--front PNG] [--back PNG] [--front-name N] [--back-name N]
//                                                          THE SPRITE GAG, in a battle: the enemy mon's picture becomes the Notes
//                                                          icon named NOTES APP, the mon you send out the Village logo named
//                                                          VILLAGE (56×56 four-grey PNGs, plugin/data/sprites/), "Wild X
//                                                          appeared!" reads "A boring X appeared!", your first party mon's moves
//                                                          are A, B, C, ALL THE ABOVE — Solar Beams all, a turn to charge — and the
//                                                          enemy knows only SPLASH. VRAM, the battle-only copies of names and
//                                                          moves, and the LOADED ROM's text and move table, so no save or file
//                                                          ever holds it; the game redraws its own at every send-out —
//                                                          `sprite watch` repaints every 20ms until ^C
//
// Add --json for the state as JSON instead of text.

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DeckDoor, HeadlessDoor } from './lib/door.mjs'
import { Driver, describe } from './lib/drive.mjs'
import * as Y from './lib/yellow.mjs'
import * as F from './lib/forge.mjs'
import * as S from './lib/sprites.mjs'

const argv = process.argv.slice(2)
const flags = {}
const args = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const k = a.slice(2)
    if (k === 'shot' || k === 'json' || k === 'no-map' || k === 'add') flags[k] = true
    else flags[k] = argv[++i]
  } else args.push(a)
}
const [cmd, ...rest] = args

function port() {
  if (process.env.DECK_HOOK_PORT) return Number(process.env.DECK_HOOK_PORT)
  const sock = (process.env.TMUX ?? '').split(',')[0]
  const name = sock.slice(sock.lastIndexOf('/') + 1)
  return name === 'deck' ? 47800 : 47801
}

function die(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

const HELP = `trainer.mjs — play Pokémon Yellow on the deck's Game Boy
  look [--shot] [--radius X,Y] [--no-map]   press KEY [n]     advance     walk DIR [n]
  goto TARGET     talk TARGET     fight SLOT     save NAME | load NAME     shot
  speed 1|2|4 | pause | resume    rom [path]     intro     where [TARGET]     map     cut
  party "Name Lvl: move, move; Name Lvl; …"    elite [--level N]    warp MAP_CONST [id]    badges all|none    money N    learnset NAME [lvl]
  sprite [watch] [--front PNG] [--back PNG] [--front-name N] [--back-name N]    in a battle: NOTES APP (Splash only) vs VILLAGE (A, B, C, ALL THE ABOVE = Solar Beam)
Targets: ${Object.keys(Y.LANDMARKS).join(', ')}; or MAP_CONST@x,y, door:MAP_CONST, MAP_CONST.`

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(HELP)
  process.exit(0)
}

// ---- the door -----------------------------------------------------------------------------

let door
let headlessSave = null
if (flags.headless) {
  const dir = flags.dir ?? join(process.cwd(), '.trainer')
  mkdirSync(dir, { recursive: true })
  door = new HeadlessDoor(dir, { modulesFrom: flags.modules ? join(flags.modules, 'package.json') : undefined })
  door.loadRom(flags.headless)
  headlessSave = 'session'
  if (existsSync(join(dir, 'session.state'))) await door.call({ op: 'load', name: 'session' })
} else door = new DeckDoor(port())

const d = new Driver(door, (m) => flags.json || console.error('  · ' + m))

// ---- output -------------------------------------------------------------------------------

const radius = flags.radius ? (([x, y]) => ({ x: +x || 12, y: +y || 8 }))(flags.radius.split(',')) : undefined

async function finish(note, st, extra = {}) {
  if (!st) st = await d.state()
  let shot = null
  if (flags.shot) shot = (await door.call({ op: 'screen', scale: 3 })).path
  if (headlessSave) await door.call({ op: 'save', name: headlessSave })
  if (flags.json) {
    const { events, screen, sprites, ...rest } = st
    console.log(JSON.stringify({ note, shot, ...extra, state: { ...rest, screen: screen.text, people: sprites } }))
    return
  }
  if (note) console.log(note)
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  console.log(describe(st, { map: !flags['no-map'], radius }))
  if (shot) console.log(`screenshot: ${shot}`)
}

const KEYS = ['A', 'B', 'START', 'SELECT', 'UP', 'DOWN', 'LEFT', 'RIGHT']
/** The sprite watch's pace: a read of the deck's door is under a millisecond, and a name is printed ~20 core steps after it is set. */
const SPRITE_POLL_MS = 20

/** In a battle: bring the cursor to FIGHT, open the move list, land on `slot`, choose it, then A through the turn. */
async function fight(slot) {
  let st = await d.state()
  if (!st.battle) return finish('not in a battle', st)
  // Back out of any submenu, then walk the 2×2 battle menu to FIGHT (item 0).
  await d.tap('B')
  for (let i = 0; i < 4; i++) {
    st = await d.state()
    if (st.waiting === 'menu' && st.menu.item === 0) break
    await d.tap(st.menu.item === 1 || st.menu.item === 3 ? 'LEFT' : 'UP')
  }
  await d.tap('A')
  // The move list: the cursor is wCurrentMenuItem, 0-based.
  for (let i = 0; i < 6; i++) {
    st = await d.state()
    if (st.menu.item === slot - 1) break
    await d.tap(st.menu.item > slot - 1 ? 'UP' : 'DOWN')
  }
  await d.tap('A')
  // The turn: text until the menu is back, the battle is over, or the game asks something else.
  st = await d.advance(30)
  return finish(`used move ${slot}`, st)
}

// ---- commands -----------------------------------------------------------------------------

try {
  switch (cmd) {
    case 'look':
      await finish(null)
      break
    case 'shot': {
      const r = await door.call({ op: 'screen', scale: Number(flags.scale ?? 3) })
      console.log(r.path)
      break
    }
    case 'press': {
      const key = String(rest[0] ?? '').toUpperCase()
      if (!KEYS.includes(key)) die(`press what? one of ${KEYS.join(' ')}`)
      const n = Math.max(1, Math.min(20, Number(rest[1] ?? 1)))
      const st = await d.press(key, n)
      await finish(`pressed ${key}${n > 1 ? ` ×${n}` : ''}`, st)
      break
    }
    case 'advance': {
      const st = await d.advance()
      await finish('advanced through the text', st)
      break
    }
    case 'walk': {
      const dir = String(rest[0] ?? '').toLowerCase()
      if (!Y.DIRS[dir]) die('walk up|down|left|right [tiles]')
      const n = Math.max(1, Math.min(40, Number(rest[1] ?? 1)))
      const r = await d.walk(dir, n)
      await finish(`walked ${dir} ${r.done}/${n}${r.reason ? ` — stopped: ${r.reason}` : ''}`)
      break
    }
    case 'goto': {
      const target = rest.join(' ')
      if (!target) die(`goto what? ${HELP}`)
      const r = await d.goto(target)
      await finish(`goto ${target}: ${r.arrived ? 'arrived' : `stopped — ${r.reason}`} (${r.legs} legs)`, r.state, { note: r.note })
      break
    }
    case 'talk': {
      const target = rest.join(' ')
      const r = await d.talk(target)
      await finish(`talk ${target}: ${r.arrived ? 'spoke' : `could not get there — ${r.reason}`}`, r.state, { note: r.note })
      break
    }
    case 'fight':
      await fight(Math.max(1, Math.min(4, Number(rest[0] ?? 1))))
      break
    case 'save': {
      const name = rest[0] ?? 'checkpoint'
      await door.call({ op: 'save', name })
      await finish(`saved state “${name}”`)
      break
    }
    case 'load': {
      const name = rest[0] ?? 'checkpoint'
      await door.call({ op: 'load', name })
      await d.hold([], 4)
      await finish(`loaded state “${name}”`)
      break
    }
    case 'speed': {
      const r = await door.call({ op: 'speed', speed: Number(rest[0] ?? 1) })
      console.log(`speed ${r.speed}×`)
      break
    }
    case 'pause':
    case 'resume': {
      const r = await door.call({ op: 'pause', on: cmd === 'pause' })
      console.log(r.paused ? 'paused' : 'running')
      break
    }
    case 'rom': {
      if (rest[0]) {
        await door.call({ op: 'rom', path: rest[0] })
        await finish(`loaded ${rest[0]}`)
      } else {
        const info = await door.call({ op: 'info' })
        console.log(info.rom ? `cartridge: ${info.rom}` : 'no cartridge loaded: open the Pokemon pane (⌘⇧G) and pick one, or `rom <path>`')
      }
      break
    }
    case 'intro': {
      const st = await d.intro()
      await finish(st.map.const === 'REDS_HOUSE_2F' ? 'in the bedroom: a new game has begun' : 'the intro did not finish; look and press on', st)
      break
    }
    case 'where': {
      if (!rest[0]) {
        for (const [k, v] of Object.entries(Y.LANDMARKS)) console.log(`${k.padEnd(24)} ${v.map}${v.warp ? ` (door to ${v.warp})` : v.talk ? ` (person at ${v.talk.x},${v.talk.y})` : ` (${v.x},${v.y})`}${v.note ? ` — ${v.note}` : ''}`)
      } else {
        const st = await d.state()
        const t = Y.resolveTarget(rest[0], st)
        if (!t) die(`unknown target ${rest[0]}`)
        const steps = Y.plan({ map: Y.mapById.get(st.map.id), x: st.x, y: st.y }, t, { warpFromStart: true })
        console.log(`${rest[0]} = ${t.map.name} (${t.map.const}) at (${t.x},${t.y})${t.face ? `, then face ${t.face}` : ''}${t.note ? ` — ${t.note}` : ''}`)
        console.log(steps ? `${steps.length} steps from here, through ${[...new Set(steps.filter((s) => s.edge || s.warp).map((s) => s.edge ?? s.to))].join(' → ') || 'this map'}` : 'no path from here (a locked door, water, a tree, or a map the planner does not join)')
      }
      break
    }
    case 'map': {
      const st = await d.state()
      const map = Y.mapById.get(st.map.id)
      if (!map) die('unknown map')
      console.log(`${map.name} (${map.const}) ${map.w * 2}×${map.h * 2}, you at (${st.x},${st.y})`)
      console.log(Y.drawMap(map, st.x, st.y, st.sprites, { x: Math.max(st.x, map.w * 2 - st.x), y: Math.max(st.y, map.h * 2 - st.y) }))
      console.log(`exits: ${Y.describeExits(map).join('; ')}`)
      if (map.people.length) console.log(`people (from the map data): ${map.people.map((p) => `${p.sprite.toLowerCase()}${p.trainer ? ` [trainer ${p.trainer.class.toLowerCase()}]` : ''} (${p.x},${p.y})`).join(', ')}`)
      break
    }
    case 'cut': {
      // START → POKéMON → the first party member that knows CUT → CUT. Haiku can also do this by hand.
      await d.tap('START')
      let st = await d.state()
      const text = st.screen.text.join(' ')
      if (!/POK.MON/.test(text)) await finish('the start menu did not open; look and try by hand', st)
      else await finish('the start menu is open: choose POKéMON, the one that knows CUT, then CUT (press A on each)', st)
      break
    }
    case 'party': {
      const spec = rest.join(' ')
      if (!spec) die('party "Alakazam 65: Psychic, Recover, Thunder Wave, Reflect; Snorlax 65; …" (up to six; moves optional)')
      const team = F.parseTeam(spec)
      const mons = await F.writeParty(door, team, { add: !!flags.add, ot: flags.ot, dv: flags.dv != null ? +flags.dv : 15, statExp: flags.ev != null ? +flags.ev : 65535 })
      await finish(`${flags.add ? 'added to the party' : 'forged a party'}:\n` + mons.map((m) => `  ${m.name} L${m.level} HP ${m.maxHp} — ${m.moves.join(', ')}`).join('\n'))
      break
    }
    case 'elite': {
      const level = flags.level ? +flags.level : null
      const team = F.ELITE_TEAM.map((t) => (level ? { ...t, level } : t))
      const mons = await F.writeParty(door, team)
      await F.setBadges(door, 0xff)
      await F.setMoney(door, 300000)
      await finish(`the Elite Four team is in your party, with every badge and ¥300000:\n` + mons.map((m) => `  ${m.name} L${m.level} HP ${m.maxHp} — ${m.moves.join(', ')}`).join('\n') + '\nNow `warp INDIGO_PLATEAU_LOBBY` and walk through any door.')
      break
    }
    case 'warp': {
      const target = String(rest[0] ?? '').toUpperCase()
      if (!Y.mapByConst.has(target)) die(`warp where? a map constant like INDIGO_PLATEAU_LOBBY, PEWTER_CITY, CERULEAN_CITY`)
      const r = await F.pointWarps(door, target, Number(rest[1] ?? 1))
      await finish(`${r.count} door${r.count === 1 ? '' : 's'} on this map now lead to ${Y.mapByConst.get(target).name}: walk through one${r.outside ? ` (outside from there = ${r.outside})` : ''}`)
      break
    }
    case 'badges': {
      const which = rest[0] ?? 'all'
      await F.setBadges(door, which === 'none' ? 0 : which === 'all' ? 0xff : parseInt(which, 2))
      await finish(`badges set: ${which}`)
      break
    }
    case 'money': {
      await F.setMoney(door, Number(rest[0] ?? 0))
      await finish(`money set`)
      break
    }
    case 'learnset': {
      const id = F.species(rest[0] ?? '')
      const p = Y.DATA.pokemon[id]
      const level = rest[1] ? +rest[1] : 100
      console.log(`${p.name} (#${p.dex}) ${p.types.join('/')} · base ${p.hp}/${p.atk}/${p.def}/${p.spd}/${p.spc} · ${p.growth.toLowerCase().replace('_', ' ')}`)
      console.log(`starts with: ${p.start.map((m) => Y.DATA.moves[F.move(m)].name).join(', ') || '-'}`)
      console.log(`by level: ${p.learnset.map(([l, m]) => `${l} ${Y.DATA.moves[F.move(m)].name}`).join(', ') || '-'}`)
      console.log(`at L${level} it would know: ${F.movesAtLevel(id, level).map((m) => Y.DATA.moves[m].name).join(', ')}`)
      console.log(`TM/HM: ${p.tmhm.map((m) => Y.DATA.moves[F.move(m)].name).join(', ')}`)
      break
    }
    case 'sprite': {
      const art = (flag, file, name) => ({
        tiles: S.tilesOf(S.shadesOf(S.decodePng(readFileSync(flags[flag] ?? new URL(`../data/sprites/${file}`, import.meta.url))))),
        name: flags[`${flag}-name`] ?? name
      })
      const want = { front: art('front', 'notes.png', 'NOTES APP'), back: art('back', 'village.png', 'VILLAGE') }
      S.encodeName(want.back.name)
      if ([...S.encodeName(want.front.name)].filter((b) => b !== 0x50).length > S.FRONT_NAME_MAX) die(`the front name is at most ${S.FRONT_NAME_MAX} characters: "A boring " goes before it`)
      const told = (r) => (r.battle ? ['front', 'back'].map((k) => `${k}: picture ${r[k].pic}, name ${r[k].name}`).join(' · ') : 'not in a battle')
      // The text patch first: it is in the loaded ROM, which a state load resets, so the watch renews it as each battle starts.
      const boring = async () => ((await S.boring(door)) + (await S.quizPatch(door)) ? 'text patched' : 'text on')
      const quiz = (q) => `moves ${q.mine}${q.enemy !== 'none' ? `, enemy ${q.enemy}` : ''}`
      if (rest[0] !== 'watch') {
        const text = await boring()
        const r = await S.apply(door, want)
        const q = await S.quizMoves(door)
        await finish(`sprite — ${told(r)} · ${text}${r.battle ? ` · ${quiz(q)}` : ''}`)
        break
      }
      console.error(`watching: repainting the battle pictures and names every ${SPRITE_POLL_MS}ms (^C to stop) · ${await boring()}`)
      let last = ''
      let inBattle = false
      let patchedAt = Date.now()
      for (;;) {
        const r = await S.apply(door, want).catch((err) => ({ error: err.message }))
        if (!r.error && r.battle && (!inBattle || Date.now() - patchedAt > 2000)) {
          patchedAt = Date.now()
          if (await S.boring(door).catch(() => 0)) console.error('  · text patched')
        }
        inBattle = !!r.battle
        const q = r.battle ? await S.quizMoves(door).catch((err) => ({ mine: err.message, enemy: 'none' })) : null
        if (q && (q.mine === 'set' || q.enemy === 'set')) console.error(`  · ${quiz(q)}`)
        const idle = r.error ?? (r.battle ? '' : 'not in a battle')
        const did = r.battle && ['front', 'back'].some((k) => r[k].pic === 'painted' || r[k].pic === 'missed' || r[k].name === 'written')
        if (did || (idle && idle !== last)) console.error(`  · ${idle || told(r)}`)
        last = idle
        await new Promise((done) => setTimeout(done, SPRITE_POLL_MS))
      }
    }
    default:
      die(`unknown command ${cmd}\n${HELP}`)
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err))
}
