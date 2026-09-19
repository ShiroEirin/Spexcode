export const SESSION_WORK_LIFECYCLES = ['active', 'idle', 'awaiting', 'parked', 'error', 'asking', 'queued'] as const
export const SESSION_LIFECYCLES = ['created', ...SESSION_WORK_LIFECYCLES, 'archived'] as const
export const SESSION_PROPOSALS = ['merge', 'nothing', 'close'] as const
export type SessionWorkLifecycle = typeof SESSION_WORK_LIFECYCLES[number]
export type SessionLifecycle = typeof SESSION_LIFECYCLES[number]
export type SessionProposal = typeof SESSION_PROPOSALS[number]

const workLifecycles = new Set<string>(SESSION_WORK_LIFECYCLES)
const lifecycles = new Set<string>(SESSION_LIFECYCLES)
const proposals = new Set<string>(SESSION_PROPOSALS)
export const isSessionWorkLifecycle = (value: unknown): value is SessionWorkLifecycle =>
  typeof value === 'string' && workLifecycles.has(value)
export const isSessionLifecycle = (value: unknown): value is SessionLifecycle =>
  typeof value === 'string' && lifecycles.has(value)
export const isSessionProposal = (value: unknown): value is SessionProposal =>
  typeof value === 'string' && proposals.has(value)

export function parseSessionLifecycle(value: unknown): SessionLifecycle {
  if (!isSessionLifecycle(value)) throw new Error(`invalid session lifecycle '${String(value)}'`)
  return value
}

export function parseSessionProposal(value: unknown): SessionProposal | null {
  if (value == null || value === '') return null
  if (!isSessionProposal(value)) throw new Error(`invalid session proposal '${String(value)}'`)
  return value
}

const HISTORICAL_PROPOSAL: Readonly<Record<string, SessionProposal>> = {
  review: 'merge', done: 'nothing', 'close-pending': 'close',
}
export function parseHistoricalSessionState(status: unknown, proposal: unknown): { status: SessionLifecycle; proposal: SessionProposal | null } {
  const historical = typeof status === 'string' && Object.hasOwn(HISTORICAL_PROPOSAL, status) ? HISTORICAL_PROPOSAL[status] : null
  const parsed = parseSessionProposal(proposal)
  if (historical && parsed && historical !== parsed) throw new Error(`conflicting historical status '${status}' and proposal '${parsed}'`)
  return { status: historical ? 'awaiting' : parseSessionLifecycle(status), proposal: parsed ?? historical }
}

const RESUMED_LIFECYCLE: Record<SessionLifecycle, SessionWorkLifecycle> = {
  created: 'idle',
  active: 'idle',
  idle: 'idle',
  awaiting: 'awaiting',
  parked: 'parked',
  error: 'idle',
  asking: 'asking',
  queued: 'idle',
  archived: 'idle',
}
export const resumedSessionLifecycle = (status: SessionLifecycle): SessionWorkLifecycle =>
  RESUMED_LIFECYCLE[parseSessionLifecycle(status)]
