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
