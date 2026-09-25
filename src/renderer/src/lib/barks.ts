// Foxtrot's bark, out loud: a library of real red fox recordings (assets/barks/, credited in
// CREDITS.md there), one picked at random per bark. For now only the top-bar Foxtrot barks aloud,
// at your posture (FoxHead); the sessions' foxes stay silent. `foxBark` off silences it.

import yapRain from '../assets/barks/yap-rain.wav'

/** Every clip in the library. Add one: the file in assets/barks/, a line in CREDITS.md, an import here. */
export const BARK_SOUNDS: readonly string[] = [yapRain]

let last = -1

export function playBark(volume = 0.8): void {
  if (!BARK_SOUNDS.length) return
  // Never the same clip twice running, once there is more than one.
  let i = Math.floor(Math.random() * BARK_SOUNDS.length)
  if (BARK_SOUNDS.length > 1 && i === last) i = (i + 1) % BARK_SOUNDS.length
  last = i
  const a = new Audio(BARK_SOUNDS[i])
  a.volume = volume
  void a.play().catch(() => {})
}
