import { useEffect, useLayoutEffect, useRef } from 'react'
import { focusTerminal, mount, refit, unmount, type Mode } from '../lib/terminals'

/** Mounts a session's persistent terminal into this component's box. */
export function TermHost({ id, mode, autoFocus = false }: { id: string; mode: Mode; autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const host = ref.current!
    mount(id, host, mode)
    const ro = new ResizeObserver(() => refit(id))
    ro.observe(host)
    return () => {
      ro.disconnect()
      unmount(id, host)
    }
  }, [id, mode])

  useEffect(() => {
    if (autoFocus) focusTerminal(id)
  }, [id, autoFocus])

  return <div ref={ref} className={`termhost termhost-${mode}`} />
}
