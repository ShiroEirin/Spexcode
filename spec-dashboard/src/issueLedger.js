// The thread's DECLARATION LEDGER ([[issue-binding]]): the status declarations of the sessions on an issue,
// read from each session's own timeline and merged into the reply thread AT READ TIME. Nothing is written to
// the issue: a worker's `done --propose merge`, `ask`, `park` or a died turn already exist as timeline events,
// and the thread shows them where they happened between the replies — so the thread reads as the task's
// ledger without a second write path or a status vocabulary of the agent's own.

// the transitions worth a row: the ones that mean something to a human reading the thread. `active`, `idle`
// and `queued` are the machine's breathing and stay off the ledger.
const LEDGER_STATUSES = new Set(['awaiting', 'asking', 'parked', 'error'])

// one session's timeline → its ledger rows. `display` is the board's display word when the server sent one
// (review / done / close-pending for an awaiting row); a raw lifecycle word otherwise.
export const ledgerFromTimeline = (sessionId, events = []) => (events || [])
  .filter((e) => e?.kind === 'status' && LEDGER_STATUSES.has(e.status))
  .map((e) => ({ kind: 'declaration', by: sessionId, at: e.ts, status: e.display || e.status, note: e.note || null }))

// a sub-issue's OPENING and CLOSE are ledger rows too ([[issues-view]]): the parent's thread shows when each child was
// opened and by whom, and when it closed, each row linked and wearing the child's current state. The close row names no
// one — the wire carries when a close happened, not who made it — and a child whose close has no recorded instant
// (`closedAt: null`) reads closed through its state mark alone.
export const ledgerFromChildren = (children = []) => (children || []).flatMap((c) => {
  if (!c?.id) return []
  const face = { kind: 'sub-issue', id: c.id, concern: c.concern, status: c.status }
  return [
    ...(c.created ? [{ ...face, event: 'opened', by: c.by, at: c.created }] : []),
    ...(c.closedAt ? [{ ...face, event: 'closed', by: null, at: c.closedAt }] : []),
  ]
})

// replies and ledger rows on ONE time line, oldest first; a reply keeps its place before a declaration made
// at the same instant, so what was said precedes what was declared.
export const mergeThread = (replies = [], ledger = []) => {
  const rows = [
    ...(replies || []).map((r) => ({ kind: 'reply', ...r })),
    ...(ledger || []),
  ]
  const time = (row) => { const n = Date.parse(row.at); return Number.isFinite(n) ? n : 0 }
  return rows.sort((a, b) => time(a) - time(b) || (a.kind === 'reply' ? -1 : 1) - (b.kind === 'reply' ? -1 : 1))
}

// the ledger starts where the ISSUE starts: a session bound to an issue later in its life brings a whole day of
// declarations with it, and none of them were about this issue. Rows before the issue's own creation instant are
// cut; a row without a parseable instant is kept (never hidden by a bad timestamp), and no floor means no cut.
export const ledgerSince = (rows = [], since) => {
  const floor = Date.parse(since)
  if (!Number.isFinite(floor)) return rows
  return (rows || []).filter((row) => { const at = Date.parse(row.at); return !Number.isFinite(at) || at >= floor })
}

// One line per session, not a copy of its message stream ([[issue-binding]]): the issue thread answers "who is on
// this and what state is it in", the session's own console answers "what is it doing". So only each session's
// LATEST declaration survives, and the row carries a door into that console. Sub-issue events are the issue's own
// history and are never thinned.
export const latestPerSession = (rows = []) => {
  const newest = new Map()
  for (const row of rows || []) {
    if (row?.kind !== 'declaration') continue
    const at = Date.parse(row.at)
    const held = newest.get(row.by)
    if (!held || !(Date.parse(held.at) > at)) newest.set(row.by, row)
  }
  return (rows || []).filter((row) => row?.kind !== 'declaration' || newest.get(row.by) === row)
}
