export const sessionPresent = (sessions, id) => {
  const session = id ? (sessions || []).find((item) => item.id === id) : null
  return session || null
}

export const sessionHeadline = (session) =>
  session?.title || session?.headline || session?.name || session?.activity || session?.note
  || session?.promptPreview || session?.raw?.title || session?.branch || session?.id

export const sessionHandle = (session) =>
  session?.label || session?.name || session?.title || session?.branch || session?.id

export const sessionTitle = sessionHeadline

// @@@ issue fleet - the ONE issue->session join ([[issue-binding]]), shared by the browser (the Issues page's
// strip, band and rail) and the server (the review adapter's `fleet:` facet) so neither can grow its own idea of
// "who is on this issue". A session carries `issue`, the id of the issue it was created for or assigned to, the
// way it carries `parent`. `assigned` are the unarchived rows pointing at the issue; `fleet` adds every
// descendant of those rows through the same parent pointers the forest is drawn from — a worker's children work
// its issue without each writing a pointer. Cycle-safe by construction: a row joins the fleet once.
export const issueFleet = (issueId, sessions = []) => {
  if (!issueId) return { assigned: [], fleet: [] }
  const board = (sessions || []).filter((s) => s?.id && !s.archived)
  const assigned = board.filter((s) => s.issue === issueId)
  const childrenOf = new Map()
  for (const s of board) {
    if (!s.parent || s.parent === s.id) continue
    const list = childrenOf.get(s.parent) || []
    list.push(s)
    childrenOf.set(s.parent, list)
  }
  const fleet = []
  const seen = new Set()
  const walk = (s) => {
    if (seen.has(s.id)) return
    seen.add(s.id)
    fleet.push(s)
    for (const c of childrenOf.get(s.id) || []) walk(c)
  }
  assigned.forEach(walk)
  return { assigned, fleet }
}

// the issue's WORK STATE rolled up from its fleet as a fold pod rolls up a subtree: a row that needs the human
// outranks a running one outranks a stopped one; no fleet is `none`. The buckets are the board's own zones
// (the dashboard's sessionZone reads the same statuses), derived on every read and stored nowhere.
const NEED = new Set(['asking', 'review', 'done', 'close-pending', 'error', 'corrupt'])
const OFFLINE = new Set(['offline', 'retired'])
export const FLEET_STATES = ['need', 'run', 'stopped', 'none']
export const fleetWorkState = (fleet = []) => {
  if (!fleet.length) return 'none'
  let run = false
  for (const s of fleet) {
    const status = s?.status || 'idle'
    if (NEED.has(status)) return 'need'
    if (!OFFLINE.has(status)) run = true
  }
  return run ? 'run' : 'stopped'
}
