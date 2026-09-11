import { useEffect, useLayoutEffect, useRef } from 'react'
import { focusTerminal, mount, refit, setTerminalCwd, unmount, type Mode } from '../lib/terminals'

/** Mounts a session's persistent terminal into this component's box. */
export function TermHost({ id, cwd, mode, autoFocus = false }: { id: string; cwd: string; mode: Mode; autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  // A path clicked in the terminal is resolved against the session's folder.
  useEffect(() => setTerminalCwd(id, cwd), [id, cwd])

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
