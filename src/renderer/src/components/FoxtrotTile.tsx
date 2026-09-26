import { useCallback, useEffect, useRef, useState } from 'react'
import { PawPrint } from 'lucide-react'
import { Fox, type FoxAnim } from './Fox'
import { BarkBursts } from './FoxStatus'
import { BARK_EVERY_MS, BARK_LIFE_MS } from '../lib/bark'
import { onFoxtrotAct, type FoxtrotAct } from '../lib/foxact'
import { FoxField } from '../lib/foxfield'
import { POSTURE_BARK, POSTURE_LEAP_MS, usePostureAlarm } from '../lib/posture'
import { useSettings } from '../lib/theme'

/** Css px per sheet px: the fox is 66×54. */
const SCALE = 3
/** The posture alarm: two leaps where he stands, then he looks around at you until you sit up. */
const POSTURE_ACT: FoxtrotAct = { anim: 'leap', ms: POSTURE_LEAP_MS, words: POSTURE_BARK, alarm: true }

const burstMs = (words: readonly string[]) => BARK_EVERY_MS * (words.length - 1) + BARK_LIFE_MS

/**
 * THE FOXTROT TILE: an endless runner. Foxtrot holds the middle of the tile running left to
 * right — he gains no ground; the grass, the hills, the obstacles and the clouds go
 * by right to left (lib/foxfield.ts) — and jumps every obstacle that comes. He STOPS only for
 * your posture: the Posture tile's alert freezes the world, he leaps twice where he stands
 * barking "SIT UP! STOP SLOUCHING!", then stands looking around until you sit up, and runs on.
 * (The top bar's fox barks the sound; this one is only seen.) Anything else can make him perform
 * with `foxtrotAct` (lib/foxact.ts) — an act stops the run while it plays. A click on him is a
 * jump and a "YIP!". A name tag under his feet, as on slay's Village path.
 */
export function FoxtrotTile() {
  const settings = useSettings()
  const { alarm, barks } = usePostureAlarm()

  // An act (posture, or `foxtrotAct`): a pose held while the world stands still.
  const [act, setAct] = useState<FoxtrotAct | null>(null)
  const actTimer = useRef<number | undefined>(undefined)
  // Bursts over his head, from an act or a poke: `run` re-keys them.
  const [bursts, setBursts] = useState<{ words: readonly string[]; alarm: boolean; run: number } | null>(null)
  const burstTimer = useRef<number | undefined>(undefined)
  const bark = useCallback((words: readonly string[] | undefined, isAlarm = false) => {
    if (!words?.length) return
    setBursts((b) => ({ words, alarm: isAlarm, run: (b?.run ?? 0) + 1 }))
    window.clearTimeout(burstTimer.current)
    burstTimer.current = window.setTimeout(() => setBursts(null), burstMs(words))
  }, [])
  const play = useCallback(
    (a: FoxtrotAct) => {
      setAct(a)
      bark(a.words, a.alarm)
      window.clearTimeout(actTimer.current)
      actTimer.current = window.setTimeout(() => setAct(null), Math.max(a.ms, a.words?.length ? burstMs(a.words) : 0))
    },
    [bark]
  )
  useEffect(
    () => () => {
      window.clearTimeout(actTimer.current)
      window.clearTimeout(burstTimer.current)
    },
    []
  )
  useEffect(() => onFoxtrotAct(play), [play])
  useEffect(() => {
    if (barks) play(POSTURE_ACT)
  }, [barks, play])

  // The world: made once, told to go or stop.
  const fieldEl = useRef<HTMLDivElement>(null)
  const skyEl = useRef<HTMLDivElement>(null)
  const groundEl = useRef<HTMLDivElement>(null)
  const liftEl = useRef<HTMLDivElement>(null)
  const world = useRef<FoxField | null>(null)
  // Each jump bumps this, which re-keys the sprite so the leap starts from its first frame.
  const [jump, setJump] = useState(0)
  const [airborne, setAirborne] = useState(false)
  useEffect(() => {
    const w = new FoxField(fieldEl.current!, skyEl.current!, groundEl.current!, liftEl.current!, (up) => {
      setAirborne(up)
      if (up) setJump((n) => n + 1)
    })
    world.current = w
    return () => {
      w.dispose()
      world.current = null
    }
  }, [])
  const stopped = alarm || act !== null
  useEffect(() => {
    if (stopped) world.current?.stop()
    else world.current?.go()
  }, [stopped])
  // The clouds are painted in the theme's colours: again when it changes.
  useEffect(() => {
    world.current?.retheme()
    const on = () => world.current?.retheme()
    window.addEventListener('deck:glass', on)
    return () => window.removeEventListener('deck:glass', on)
  }, [settings.theme, settings.appearance])

  const pose: FoxAnim = act ? act.anim : alarm ? 'look' : airborne ? 'leap' : 'run'
  const poke = () => {
    if (!stopped) world.current?.jump()
    bark(['YIP!'])
  }

  return (
    <div className={`tile tile-plugin foxtrot ${alarm ? 'foxtrot-alarm' : ''}`} onClick={(e) => e.stopPropagation()}>
      <header className="pane-head">
        <PawPrint size={13} className="foxtrot-glyph" />
        <span className="name">Foxtrot</span>
        {alarm && <span className="badge foxtrot-badge alarm">sit up!</span>}
        <span className="spacer" />
      </header>
      <div className={`foxtrot-field ${stopped ? 'is-stopped' : ''}`} ref={fieldEl}>
        <div className="foxtrot-sky" ref={skyEl} />
        <div className="foxtrot-hills" />
        <div className="foxtrot-ground" ref={groundEl} />
        <div className="foxtrot-fox">
          {bursts && settings.foxBark && (
            <div className={`foxtrot-bursts ${bursts.alarm ? 'alarm' : ''}`}>
              <BarkBursts run={bursts.run} words={bursts.words} />
            </div>
          )}
          <div className="foxtrot-lift" ref={liftEl}>
            <button className="foxtrot-sprite" title="Foxtrot" onClick={poke}>
              <Fox key={pose === 'leap' ? `leap-${jump}` : pose} anim={pose} scale={SCALE} />
            </button>
          </div>
          <span className="foxtrot-shadow" />
          <span className="foxtrot-tag">Foxtrot</span>
        </div>
      </div>
    </div>
  )
}
