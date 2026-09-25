import type { CSSProperties } from 'react'

export type FoxAnim = 'idle' | 'look' | 'run' | 'leap' | 'sleep' | 'down'
/** Foxtrot's own orange, or the gold coat a wolfpack's betas wear. */
export type FoxCoat = 'orange' | 'gold'

/** Foxtrot (lib/fox.ts), `22×18 × scale` px, facing right unless flipped. */
export function Fox({ anim = 'idle', scale = 2, flip = false, coat = 'orange', title }: { anim?: FoxAnim; scale?: number; flip?: boolean; coat?: FoxCoat; title?: string }) {
  const style = { '--fox-scale': scale, transform: flip ? 'scaleX(-1)' : undefined } as CSSProperties
  return <div className={`fox fox-${anim} ${coat === 'gold' ? 'fox-gold' : ''}`} style={style} aria-hidden={!title} title={title} />
}
