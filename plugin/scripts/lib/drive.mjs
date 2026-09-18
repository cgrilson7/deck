// The routines the CLI's commands are made of, over any door: read the state, tap a button,
// advance through text, walk a tile at a time with the game's own coordinates as the truth,
// follow a plan across maps, talk to someone. Every routine returns the decoded state it ended
// on, so the caller (Haiku) always sees where things stand.

import * as Y from './yellow.mjs'

const A = Y.A
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))

/** How long one tile may take before we call it blocked, in 8ms steps (a step is ~16 video frames + slack). */
const TILE_BUDGET = 120
const TALK_TAP = 6

export class Driver {
  constructor(door, log = () => {}) {
    this.door = door
    this.log = log
    this.blocked = new Set()
  }

  async ram(ranges) {
    const r = await this.door.call({ op: 'ram', ranges })
    return r.data.map(b64)
  }

  async state() {
    const keys = Object.keys(Y.STATE_RANGES)
    const data = await this.ram(keys.map((k) => Y.STATE_RANGES[k]))
    const r = {}
    keys.forEach((k, i) => (r[k] = data[i]))
    const st = Y.decodeState(r)
    st.quest = Y.questStatus(st)
    return st
  }

  hold(keys, iterations, stop = [], every = 2) {
    return this.door.call({ op: 'hold', keys, iterations, stop, every })
  }

  settle(max = 300, stable = 16) {
    return this.door.call({ op: 'settle', max, stable })
  }

  /** One press: held two video frames, let go two, then the screen is given time to answer. */
  async tap(key, opts = {}) {
    await this.hold([key], opts.frames ?? 4)
    await this.hold([], 4)
    if (opts.settle !== false) await this.settle(opts.max ?? 300, opts.stable ?? 16)
  }

  async press(key, times = 1) {
    for (let i = 0; i < times; i++) await this.tap(key)
    return this.state()
  }

  /** A through text until something wants a decision (a menu, the overworld, a battle menu). */
  async advance(max = 40) {
    let st = await this.state()
    let n = 0
    while (st.waiting === 'text' && n < max) {
      await this.tap('A')
      st = await this.state()
      n++
    }
    return st
  }

  /**
   * Walk `tiles` squares in `dir`. Each square: hold the direction until the coordinate
   * changes (or a battle starts, or the game takes the pad away for a script), then let the
   * step finish. Stops early and says why: 'battle', 'script', 'blocked', 'warped'.
   */
  async walk(dir, tiles = 1) {
    const key = Y.KEY_OF_DIR[dir]
    if (!key) throw new Error(`walk where? ${dir}`)
    let done = 0
    let reason = null
    for (let i = 0; i < tiles; i++) {
      const before = await this.ram([[A.wCurMap, 1]])
      const r = await this.hold([key], TILE_BUDGET, [
        { addr: A.wXCoord, len: 1, when: 'changed' },
        { addr: A.wYCoord, len: 1, when: 'changed' },
        { addr: A.wCurMap, len: 1, when: 'changed' },
        { addr: A.wIsInBattle, len: 1, when: 'ne', value: 0 },
        { addr: A.wJoyIgnore, len: 1, when: 'ne', value: 0 }
      ])
      if (r.stopped === 3) {
        reason = 'battle'
        break
      }
      if (r.stopped === 4) {
        // The pad is ignored during a fade (after a warp) and while a script runs. A fade clears
        // in well under a second: wait that long, and only call it a script if it stays.
        const w = await this.hold([], 150, [{ addr: A.wJoyIgnore, len: 1, when: 'eq', value: 0 }], 4)
        if (w.stopped === 0) {
          i--
          continue
        }
        reason = 'script'
        break
      }
      if (r.stopped == null) {
        reason = 'blocked'
        break
      }
      // Let the step (or the door animation) play out before the next one.
      await this.hold([key], 20, [{ addr: A.wWalkCounter, len: 1, when: 'eq', value: 0 }], 1)
      done++
      if (r.stopped === 2 || (await this.ram([[A.wCurMap, 1]]))[0][0] !== before[0][0]) {
        reason = 'warped'
        await this.afterWarp()
        break
      }
    }
    await this.hold([], 2)
    return { done, reason }
  }

  /** A warp fades the screen and ignores the pad for a moment; wait for the new map to take input. */
  async afterWarp() {
    // Measured: the map byte flips first, the old screen lingers ~70 steps, then the pad is locked
    // (~35 steps) while the new map loads. So: wait for the lock, then for it to lift.
    const lock = await this.hold([], 240, [{ addr: A.wJoyIgnore, len: 1, when: 'ne', value: 0 }], 2)
    if (lock.stopped === 0) await this.hold([], 400, [{ addr: A.wJoyIgnore, len: 1, when: 'eq', value: 0 }], 2)
    await this.settle(120, 8)
  }

  /** Turn to face `dir` without moving: a press too short for a step. */
  async face(dir) {
    await this.hold([Y.KEY_OF_DIR[dir]], 2)
    await this.hold([], 4)
  }

  /**
   * Go to a target (a landmark, MAP@x,y, door:MAP, or a map name) by the planner, re-planning
   * around whatever gets in the way. Returns { arrived, reason, legs, state }. A battle or a
   * script hands control back at once: deal with it, then call again.
   */
  async goto(spec, opts = {}) {
    let st = await this.state()
    const target = Y.resolveTarget(spec, st)
    if (!target) return { arrived: false, reason: `unknown target ${spec}`, state: st }
    const maxLegs = opts.maxLegs ?? 400
    let legs = 0
    let stalls = 0
    let lastKey = ''
    let sameSpot = 0
    const here = () => ({ map: Y.mapById.get(st.map.id), x: st.x, y: st.y })
    while (legs < maxLegs) {
      // Planning from the same square over and over means the plan's first move never lands.
      const k = `${st.map.id}:${st.x}:${st.y}`
      sameSpot = k === lastKey ? sameSpot + 1 : 0
      lastKey = k
      if (sameSpot >= 4) return { arrived: false, reason: 'stuck: the first move keeps failing here', legs, state: st }
      if (st.battle) return { arrived: false, reason: 'battle', legs, state: st }
      if (st.map.id === target.map.id && st.x === target.x && st.y === target.y) {
        if (target.face) await this.face(target.face)
        return { arrived: true, reason: 'arrived', legs, state: await this.state(), note: target.note }
      }
      const from = here()
      if (!from.map) return { arrived: false, reason: `unknown map ${st.map.id}`, legs, state: st }
      // The warp under our feet does not count: a warp is taken by stepping onto it (or pushing on from it once we came that way).
      const steps = Y.plan(from, target, { blocked: this.blocked, cut: false, warpFromStart: false })
      if (!steps) return { arrived: false, reason: 'no path (a locked door, water, a tree, or a map the planner does not join)', legs, state: st }
      this.log(`plan: ${steps.length} steps from ${from.map.const} (${from.x},${from.y})`)
      // Follow the plan until something differs from it, then plan again from where we are.
      for (const s of steps) {
        legs++
        if (s.warp && s.dir) {
          // A push warp: we stand on the square; nudge toward the edge.
          await this.hold([Y.KEY_OF_DIR[s.dir]], 16)
          await this.afterWarp()
          st = await this.state()
          break
        }
        if (s.warp) {
          // An auto warp already fired when we stepped on the square (walk() saw the map change).
          st = await this.state()
          if (st.map.const !== s.to) {
            await this.hold([], 30)
            st = await this.state()
          }
          break
        }
        const r = await this.walk(s.dir, 1)
        st = await this.state()
        if (r.reason === 'battle' || r.reason === 'script') return { arrived: false, reason: r.reason, legs, state: st }
        if (r.reason === 'blocked') {
          // Someone in the way? Wait for them, then try once more; then route around.
          stalls++
          if (stalls > 12) return { arrived: false, reason: 'stuck: blocked twelve times', legs, state: st }
          await this.hold([], 40)
          const again = await this.walk(s.dir, 1)
          st = await this.state()
          if (again.reason === 'blocked') {
            const [dx, dy] = Y.DIRS[s.dir]
            this.blocked.add(`${st.map.id}:${st.x + dx}:${st.y + dy}`)
          }
          if (again.reason === 'battle' || again.reason === 'script') return { arrived: false, reason: again.reason, legs, state: st }
          break
        }
        if (r.reason === 'warped' || s.jump) break
      }
    }
    return { arrived: false, reason: 'too many legs', legs, state: st }
  }

  /** Go stand before someone (a talk landmark) and press A; then A through what they say until a choice or the end. */
  async talk(spec) {
    const g = await this.goto(spec)
    if (!g.arrived) return g
    await this.tap('A', { frames: TALK_TAP })
    const st = await this.advance()
    return { ...g, state: st }
  }

  /** From power-on to Red's bedroom: START at the title, A through Oak, the second preset for both names. */
  async intro(max = 600) {
    for (let i = 0; i < max; i++) {
      const st = await this.state()
      if (st.map.const === 'REDS_HOUSE_2F' && st.waiting === 'free') {
        // The map is set at NEW GAME, long before Oak is done: prove the overworld by taking a step.
        const r = await this.walk('left', 1)
        if (r.done) {
          await this.walk('right', 1)
          return this.state()
        }
      }
      const text = st.screen.text.join(' ')
      if (/NEW NAME/.test(text)) {
        await this.tap('DOWN', { settle: false })
        await this.hold([], 8)
        await this.tap('A')
      } else if (st.waiting === 'text' || st.waiting === 'menu') await this.tap('A')
      else {
        await this.tap('START')
        await this.tap('A')
      }
    }
    return this.state()
  }
}

/** The state as the CLI prints it: short, the things that decide the next move first. */
export function describe(st, opts = {}) {
  const lines = []
  const map = Y.mapById.get(st.map.id)
  lines.push(`${st.map.name} (${st.map.const}) at (${st.x},${st.y}) facing ${st.facing} · ${st.waiting}${st.repel ? ` · repel ${st.repel}` : ''}`)
  if (st.battle) {
    const b = st.battle
    lines.push(`BATTLE (${b.kind}${b.trainer ? `: ${b.trainer}` : ''}): enemy ${b.enemy.nick || b.enemy.name} L${b.enemy.level} ${b.enemy.hp}/${b.enemy.maxHp} ${b.enemy.types.join('/')}${b.enemy.status ? ' ' + b.enemy.status : ''}`)
    lines.push(`  yours: ${b.mine.nick || b.mine.name} L${b.mine.level} ${b.mine.hp}/${b.mine.maxHp} ${b.mine.types.join('/')}${b.mine.status ? ' ' + b.mine.status : ''} · moves ${b.advice.moves.join(', ')}`)
    lines.push(`  best: ${b.advice.best}`)
  }
  lines.push(`party: ${st.party.map((m) => `${m.nick || m.name}${m.nick && m.nick !== m.name.toUpperCase() ? `(${m.name})` : ''} L${m.level} ${m.hp}/${m.maxHp}${m.status ? ' ' + m.status : ''}`).join(' · ') || 'none'}`)
  lines.push(`badges: ${st.badges.join(', ') || 'none'} · money ¥${st.money} · Pikachu happiness ${st.happiness}${st.bag.length ? ` · bag: ${st.bag.map((i) => `${i.item}×${i.n}`).join(', ')}` : ''}`)
  const q = st.quest
  lines.push(`quest: Bulbasaur ${q.bulbasaur ? '✓' : '—'} Charmander ${q.charmander ? '✓' : '—'} Squirtle ${q.squirtle ? '✓' : '—'} · Brock ${q.brock ? '✓' : '—'} Misty ${q.misty ? '✓' : '—'} Surge ${q.surge ? '✓' : '—'} · Bill met ${q.metBill ? '✓' : '—'} HM01 ${q.hm01 ? '✓' : '—'}`)
  if (st.screen.text.length) lines.push('screen: ' + st.screen.text.map((t) => `“${t.trim()}”`).join(' '))
  if (map && opts.map !== false && !st.battle) {
    const people = st.sprites.filter((s) => s.x >= 0 && s.y >= 0)
    lines.push(Y.drawMap(map, st.x, st.y, people, opts.radius))
    lines.push(`exits: ${Y.describeExits(map).join('; ')}`)
    if (people.length) lines.push(`people: ${people.map((p) => `${p.sprite.toLowerCase()} (${p.x},${p.y})`).join(', ')}`)
  }
  return lines.join('\n')
}
