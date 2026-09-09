import type { CSSProperties } from 'react'

export type FoxAnim = 'idle' | 'look' | 'run' | 'leap' | 'alert' | 'sleep' | 'down'

/** Foxtrot (lib/fox.ts), `22×18 × scale` px, facing right unless flipped. */
export function Fox({ anim = 'idle', scale = 2, flip = false, title }: { anim?: FoxAnim; scale?: number; flip?: boolean; title?: string }) {
  const style = { '--fox-scale': scale, transform: flip ? 'scaleX(-1)' : undefined } as CSSProperties
  return <div className={`fox fox-${anim}`} style={style} aria-hidden={!title} title={title} />
}
