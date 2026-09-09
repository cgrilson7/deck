import type { SessionStatus } from '@shared/types'

const LABEL: Record<SessionStatus, string> = {
  starting: 'starting',
  busy: 'working',
  idle: 'idle',
  blocked: 'needs input',
  dead: 'exited',
  unknown: 'unknown'
}

export function StatusDot({ status, attention }: { status: SessionStatus; attention: boolean }) {
  return (
    <span className={`dot dot-${status} ${attention ? 'dot-attention' : ''}`} title={attention ? `needs you (${LABEL[status]})` : LABEL[status]} />
  )
}
