import type { Issue } from './issues.js'
import { resolveSession } from './session-selectors.js'
import { readRecord, writeRecord, withRecordLock } from './session-record.js'
import type { Session } from './sessions.js'

// @@@ issue assign - the third writer of a session's `issue` pointer ([[issue-binding]]) and the twin of
// reparent: reparent moves `parent`, assign moves `issue`. It binds a session that ALREADY exists (the two
// create-time writers cover a worker born for the issue) and then tells that session, through the one
// ordinary send path, that the thread is now its work. Both halves are one verb, because a pointer nobody
// told the worker about is a lie on the board, and a message without the pointer leaves the Issues page blind.

export class AssignError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.name = 'AssignError'; this.status = status }
}

export type AssignOutcome = {
  ok: true; issue: string; session: string
  previous: string | null        // the issue the session was bound to before, if any — re-pointing is allowed and named
  delivered: boolean             // the assignment message reached the session's queue
  deliveryError?: string
}

// the message the assigned session receives: what it now owns, who handed it over, and how to read the thread.
// Deliberately not the @new worker prompt — this session has its own task already and is being asked to take
// this one on, so the text says so instead of pretending the thread is a fresh look.
export function assignPrompt(issue: Issue, by: string): string {
  const node = issue.nodes[0] ? `; the relevant node is [[${issue.nodes[0]}]]` : ''
  return `You have been assigned issue "${issue.id}" by ${by}: ${issue.concern}\n\n` +
    `Read the thread (\`spex issue show ${issue.id}\`) and act on it${node}. ` +
    `Reply on the thread with \`spex issue reply ${issue.id} --body -\` as you make progress; your declarations already show on the issue.`
}

type Deps = {
  listSessions: () => Promise<Session[]>
  sendText: (id: string, text: string, from?: string) => Promise<{ ok: boolean; error?: string }>
}
const liveDeps = async (): Promise<Deps> => {
  const { listSessions, sendText } = await import('./sessions.js')
  return { listSessions: () => listSessions(), sendText: (id, text, from) => sendText(id, text, from) }
}

export async function assignIssueSession(issue: Issue, selector: string, by = 'human', deps?: Deps): Promise<AssignOutcome> {
  const d = deps ?? await liveDeps()
  if (!selector?.trim()) throw new AssignError('missing session selector (id | id-prefix | branch)', 400)
  const sessions = await d.listSessions()
  // the ordinary session selector ([[session-selectors]]) over the working board: a closed session is off
  // the board and cannot be assigned — resume it first, the way every other verb treats it.
  const r = resolveSession(selector.trim(), sessions, undefined)
  if ('none' in r) throw new AssignError(`no such session: ${selector}`, 404)
  if ('ambiguous' in r) throw new AssignError(`ambiguous selector "${selector}" matches ${r.ambiguous.length} sessions: ${r.ambiguous.map((s) => s.id.slice(0, 8)).join(', ')}`, 409)
  const session = r.ok
  const previous = await withRecordLock(session.id, async () => {
    const rec = readRecord(session.id)
    if (!rec) throw new AssignError(`session ${session.id} has no record`, 404)
    if (rec.issue !== issue.id) writeRecord({ ...rec, issue: issue.id })
    return rec.issue
  })
  const sent = await d.sendText(session.id, assignPrompt(issue, by), 'issues')
  return { ok: true, issue: issue.id, session: session.id, previous, delivered: sent.ok, ...(sent.ok ? {} : { deliveryError: sent.error || 'delivery failed' }) }
}

export const summarizeAssign = (o: AssignOutcome): string =>
  `assigned ${o.session.slice(0, 8)} to ${o.issue}${o.previous && o.previous !== o.issue ? ` (was ${o.previous})` : ''}${o.delivered ? ' · told' : ` · NOT told: ${o.deliveryError}`}`
