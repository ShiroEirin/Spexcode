import type { Issue } from './issues.js'
import { resolveSession } from './session-selectors.js'
import { readRecord, writeRecord, withRecordLock, type SessRec } from './session-record.js'
import type { Session } from './sessions.js'

// @@@ issue assign - the third writer of a session's `issues` set ([[issue-binding]]) and the twin of
// reparent: reparent moves `parent`, assign adds an issue. It binds a session that ALREADY exists (the two
// create-time writers cover a worker born for the issue) and then tells that session, through the one
// ordinary send path, that the thread is now its work. Both halves are one verb, because a pointer nobody
// told the worker about is a lie on the board, and a message without the pointer leaves the Issues page blind.

export class AssignError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.name = 'AssignError'; this.status = status }
}

export type AssignOutcome = {
  ok: true; issue: string; session: string
  previous: string | null        // legacy compatibility: the first issue previously present, if any
  added: boolean                 // false when the issue was already present (idempotent no-op)
  issues: string[]
  delivered: boolean             // the assignment message reached the session's queue
  deliveryError?: string
}

// the message the assigned session receives: what it now owns, who handed it over, and how to read the thread.
// Deliberately not the @new worker prompt — this session has its own task already and is being asked to take
// this one on, so the text says so instead of pretending the thread is a fresh look.
// @@@ says only what the skill cannot - [[issue-driven-development]] is in the same context and already teaches
// how to report, declare and attribute; repeating it here would be the same words twice in one prompt. So this
// message carries the facts of THIS moment only: which id, who handed it over, and — derived from the set the
// assign just wrote, so the text cannot disagree with the record — how many issues the session now carries.
// Every reference is the id, never "the issue": measured, a worker told to "read the thread" while already
// holding another one reported its progress on that other thread and left this one empty.
export function assignPrompt(issue: Issue, by: string, carries: readonly string[] = [issue.id]): string {
  const node = issue.nodes[0] ? `; the node is [[${issue.nodes[0]}]]` : ''
  const others = carries.filter((id) => id !== issue.id)
  return `You have been assigned issue "${issue.id}" by ${by}: ${issue.concern}\n\n` +
    `Read it first: \`spex issue show ${issue.id}\`${node}. Report progress there: \`spex issue reply ${issue.id} --body -\`.` +
    (others.length ? `\n\nYou now carry ${carries.length} issues: ${carries.join(', ')}.` : '')
}

export type AssignDeps = {
  listSessions: () => Promise<Session[]>
  sendText: (id: string, text: string, from?: string) => Promise<{ ok: boolean; error?: string }>
  readRecord?: (id: string) => SessRec | null
  writeRecord?: (rec: SessRec) => void
  withRecordLock?: <T>(id: string, body: () => Promise<T>) => Promise<T>
}
const liveDeps = async (): Promise<AssignDeps> => {
  const { listSessions, sendText } = await import('./sessions.js')
  return { listSessions: () => listSessions(), sendText: (id, text, from) => sendText(id, text, from) }
}

export async function assignIssueSession(issue: Issue, selector: string, by = 'human', deps?: AssignDeps): Promise<AssignOutcome> {
  const d = deps ?? await liveDeps()
  if (!selector?.trim()) throw new AssignError('missing session selector (id | id-prefix | branch)', 400)
  const sessions = await d.listSessions()
  // the ordinary session selector ([[session-selectors]]) over the working board: a closed session is off
  // the board and cannot be assigned — resume it first, the way every other verb treats it.
  const r = resolveSession(selector.trim(), sessions, undefined)
  if ('none' in r) throw new AssignError(`no such session: ${selector}`, 404)
  if ('ambiguous' in r) throw new AssignError(`ambiguous selector "${selector}" matches ${r.ambiguous.length} sessions: ${r.ambiguous.map((s) => s.id.slice(0, 8)).join(', ')}`, 409)
  const session = r.ok
  const lock = d.withRecordLock ?? withRecordLock
  const read = d.readRecord ?? readRecord
  const write = d.writeRecord ?? writeRecord
  const result = await lock(session.id, async () => {
    const rec = read(session.id)
    if (!rec) throw new AssignError(`session ${session.id} has no record`, 404)
    const issues = [...rec.issues]
    const added = !issues.includes(issue.id)
    if (added) {
      issues.push(issue.id)
      write({ ...rec, issues, issue: issues[0] ?? null })
    }
    return { previous: rec.issue, added, issues }
  })
  if (!result.added) return { ok: true, issue: issue.id, session: session.id, previous: result.previous, added: false, issues: result.issues, delivered: true }
  const sent = await d.sendText(session.id, assignPrompt(issue, by, result.issues), 'issues')
  return { ok: true, issue: issue.id, session: session.id, previous: result.previous, added: true, issues: result.issues, delivered: sent.ok, ...(sent.ok ? {} : { deliveryError: sent.error || 'delivery failed' }) }
}

export const summarizeAssign = (o: AssignOutcome): string =>
  o.added === false
    ? `already assigned ${o.session.slice(0, 8)} to ${o.issue} · no-op`
    : `assigned ${o.session.slice(0, 8)} to ${o.issue}${o.previous && o.previous !== o.issue ? ` (also on ${o.previous})` : ''}${o.delivered ? ' · told' : ` · NOT told: ${o.deliveryError}`}`

export type UnassignOutcome = {
  ok: true; issue: string; session: string
  removed: boolean
  issues: string[]
  delivered: boolean
  deliveryError?: string
}

export function unassignPrompt(issue: Issue, by: string): string {
  return `You are no longer assigned issue "${issue.id}" by ${by}: ${issue.concern}\n\n` +
    `Do not continue work for this thread unless it is assigned again. Read the thread (\`spex issue show ${issue.id}\`) for context.`
}

export async function unassignIssueSession(issue: Issue, selector: string, by = 'human', deps?: AssignDeps): Promise<UnassignOutcome> {
  const d = deps ?? await liveDeps()
  if (!selector?.trim()) throw new AssignError('missing session selector (id | id-prefix | branch)', 400)
  const sessions = await d.listSessions()
  const r = resolveSession(selector.trim(), sessions, undefined)
  if ('none' in r) throw new AssignError(`no such session: ${selector}`, 404)
  if ('ambiguous' in r) throw new AssignError(`ambiguous selector "${selector}" matches ${r.ambiguous.length} sessions: ${r.ambiguous.map((s) => s.id.slice(0, 8)).join(', ')}`, 409)
  const session = r.ok
  const lock = d.withRecordLock ?? withRecordLock
  const read = d.readRecord ?? readRecord
  const write = d.writeRecord ?? writeRecord
  const result = await lock(session.id, async () => {
    const rec = read(session.id)
    if (!rec) throw new AssignError(`session ${session.id} has no record`, 404)
    const removed = rec.issues.includes(issue.id)
    const issues = removed ? rec.issues.filter((id) => id !== issue.id) : [...rec.issues]
    if (removed) write({ ...rec, issues, issue: issues[0] ?? null })
    return { removed, issues }
  })
  if (!result.removed) return { ok: true, issue: issue.id, session: session.id, removed: false, issues: result.issues, delivered: true }
  const sent = await d.sendText(session.id, unassignPrompt(issue, by), 'issues')
  return { ok: true, issue: issue.id, session: session.id, removed: true, issues: result.issues, delivered: sent.ok, ...(sent.ok ? {} : { deliveryError: sent.error || 'delivery failed' }) }
}

export const summarizeUnassign = (o: UnassignOutcome): string =>
  o.removed
    ? `unassigned ${o.session.slice(0, 8)} from ${o.issue}${o.delivered ? ' · told' : ` · NOT told: ${o.deliveryError}`}`
    : `not assigned ${o.session.slice(0, 8)} to ${o.issue} · no-op`

// ───────────────────────── the close notice ─────────────────────────

// @@@ close tells the bound sessions - the third message of the binding ([[issue-binding]]), and the one the
// board could not do without: a close changes the ISSUE's state, while the sessions carrying it keep working
// from a pointer that now names a landed thread. Measured on real workers — a closed issue reached its fleet as
// nothing at all, so they went on replying to it and repeating work. So the close speaks, through the one
// ordinary send path assign already uses. What it deliberately does NOT do: unbind them (the pointer is
// provenance, and the closed issue's page still shows who worked it) and end them (ending a session is the
// session's own act, [[state]]) — it says the thread is landed and leaves both facts alone.
export function closedPrompt(issue: Pick<Issue, 'id'> & { concern?: string }, by: string, others: readonly string[] = []): string {
  const what = issue.concern ? `: ${issue.concern}` : ''
  return `Issue "${issue.id}" was closed by ${by} — its thread is landed${what}\n\n` +
    `Stop work on it and post no more replies there.` +
    (others.length ? ` Still yours: ${others.join(', ')} — continue there.` : '')
}

export type CloseNotice = { session: string; delivered: boolean; error?: string }

// Told: every unarchived board row whose OWN `issues` names this issue — the pointer holders, exactly who assign
// and unassign speak to. A descendant working through its parent's pointer is not told directly: its parent owns
// the thread and the handoff, the same way it received the work in the first place.
export async function notifyIssueClosed(issue: Pick<Issue, 'id'> & { concern?: string }, by = 'human', deps?: AssignDeps): Promise<CloseNotice[]> {
  const d = deps ?? await liveDeps()
  const bound = (await d.listSessions()).filter((s) => s?.id && !s.archived && (s.issues || []).includes(issue.id))
  const notices: CloseNotice[] = []
  for (const s of bound) {
    const others = (s.issues || []).filter((id) => id !== issue.id)
    const sent = await d.sendText(s.id, closedPrompt(issue, by, others), 'issues')
    notices.push({ session: s.id, delivered: sent.ok, ...(sent.ok ? {} : { error: sent.error || 'delivery failed' }) })
  }
  return notices
}

export const summarizeCloseNotices = (notices: readonly CloseNotice[]): string => {
  if (!notices.length) return ''
  const failed = notices.filter((n) => !n.delivered)
  const told = notices.length - failed.length
  return `told ${told}/${notices.length} bound session(s)${failed.length ? `; NOT told: ${failed.map((n) => `${n.session.slice(0, 8)} (${n.error})`).join(', ')}` : ''}`
}
