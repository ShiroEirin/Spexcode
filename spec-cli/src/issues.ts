import type { ForgeIssue, ForgeLabel, ForgePR } from '@spexcode/spec-forge/port'
import { resolveLinks } from '@spexcode/spec-forge/links'
import { FORGE_DRIVERS, forgeDriverFor, forgeIssueStores, resolveForgeHost } from '@spexcode/spec-forge/drivers'
import { closeLocalIssue, loadLocalIssues, loadOne, postLocalIssue, reply, replyLocalIssue } from './localIssues.js'
import { dispatchNewMentions, parseMentions, type DispatchOutcome } from './mentions.js'
import { envSessionId } from '@spexcode/spec-core'
import type { CloseNotice } from './issue-assign.js'
// A Reply is a plain thread post — author, instant, prose — the ONE shape a local thread's replies and a
// forge issue's comments both take, so nothing downstream renders two kinds of discussion.
export type Reply = {
  by: string
  at: string
  body: string
}

export type IssueRelationType = 'blocks' | 'related' | 'duplicate'
export type IssueRelation = { type: IssueRelationType; id: string }

export type Issue = {
  id: string
  store: string
  concern: string
  by: string
  status: string
  nodes: string[]
  created: string
  // when the issue left open, as its store recorded it; null while open, and for a close no store recorded
  closedAt: string | null
  body: string
  replies: Reply[]
  evidence: string[]
  labels: unknown[]
  url?: string
  // `parent` and `relations` are what a store holds; a store read hands the rest over empty. On the merged read
  // all nine are issueHierarchy's projection, so `parent`/`relations` there are the EFFECTIVE values.
  parent: string | null
  relations: IssueRelation[]
  children: string[]
  descendants: string[]
  childCounts: { open: number; closed: number }
  blockedBy: string[]
  relatedBy: string[]
  duplicatedBy: string[]
  duplicateOf: string | null
}

export type IssueLabel = ForgeLabel

export type ForgeState = { issues: ForgeIssue[]; prs: ForgePR[] }
export type ForgeSlice = { host: string; state: ForgeState }
export type IssueStore = { id: string; label: string; kind: 'local' | 'forge'; writable: true }

export function issueStores(): IssueStore[] {
  return [
    { id: 'local', label: 'local', kind: 'local', writable: true },
    ...forgeIssueStores().map((s) => ({ ...s, writable: true as const })),
  ]
}

function inferNodes(concern: string, body: string | undefined, explicit: string[] = []): string[] {
  return [...new Set([...explicit, ...parseMentions(`${concern}\n${body || ''}`).nodes])]
}

function forgeIssueBody(concern: string, body: string | undefined, nodes: string[], evidence: string[] = []): string {
  return [
    (body || `(no detail given — ${concern})`).trim(),
    nodes.length ? `Spec: ${nodes.join(', ')}` : '',
    evidence.length ? `Evidence: ${evidence.join(', ')} (evidence content hashes)` : '',
  ].filter(Boolean).join('\n\n')
}

// forge → Issue, at the adapter boundary: the host's node-naming conventions (`Spec:` body marker +
// transitive PR links — spec-forge links.ts) become plain `nodes[]` HERE, validated against the real node
// ids, so nothing downstream ever knows a marker existed. Every raw issue maps — linked or not — because
// the merged list is the whole set, not just the per-node view.
export function fromForge(slice: ForgeSlice, nodeIds: string[]): Issue[] {
  const nodesByNumber = new Map<number, string[]>()
  for (const link of resolveLinks(slice.state.issues, slice.state.prs, nodeIds))
    for (const i of link.issues) {
      const arr = nodesByNumber.get(i.number) ?? []
      arr.push(link.node)
      nodesByNumber.set(i.number, arr)
    }
  return slice.state.issues.map((i) => ({
    id: `${slice.host}#${i.number}`,
    store: slice.host,
    concern: i.title,
    by: i.author,
    status: (i.state || '').toLowerCase(),
    nodes: nodesByNumber.get(i.number) ?? [],
    created: i.createdAt,
    closedAt: i.closedAt,
    body: i.body,
    // the forge comments ARE the thread — the same Reply shape a local thread carries, so nothing
    // downstream renders two kinds of discussion.
    replies: (i.comments ?? []).map((c) => ({ by: c.author, at: c.createdAt, body: c.body })),
    evidence: [],
    labels: i.labels,
    url: i.url,
    // a forge issue stores no hierarchy: sub-issues and relations live in the local store only.
    parent: null,
    relations: [],
    children: [],
    descendants: [],
    childCounts: { open: 0, closed: 0 },
    blockedBy: [],
    relatedBy: [],
    duplicatedBy: [],
    duplicateOf: null,
  }))
}

// @@@ issue hierarchy - the read-time tree and relation graph over ONE merged set ([[issues]] / [[local-issues]]).
// Stores keep only the forward facts: a direct `parent` pointer and the initiator's `relations`. Everything else is
// rebuilt here on every read, the way the session forest is: a pointer holds while it names another issue in this
// set, whatever its status (a closed tree keeps its shape), so only a missing parent promotes its child to a root; a
// parent cycle promotes its members;
// an edge to an issue outside the set is dropped; and a `blocks` edge whose blocker is no longer open reads as
// `related` — never rewritten in the store. Pure: the input objects are not touched.
const isOpen = (i: Issue): boolean => i.status === 'open'

export function issueHierarchy(issues: Issue[]): Issue[] {
  const byId = new Map(issues.map((i) => [i.id, i]))
  const pointer = new Map<string, string>()
  for (const i of issues) {
    const p = i.parent ? byId.get(i.parent) : undefined
    if (p && p.id !== i.id) pointer.set(i.id, p.id)
  }
  const inCycle = (id: string): boolean => {
    const seen = new Set<string>()
    for (let at = pointer.get(id); at !== undefined && !seen.has(at); at = pointer.get(at)) {
      if (at === id) return true
      seen.add(at)
    }
    return false
  }
  const parentOf = new Map([...pointer].filter(([id]) => !inCycle(id)))

  const relationsOf = new Map(issues.map((i) => {
    const edges = i.relations
      .filter((r) => r.id !== i.id && byId.has(r.id))
      .map((r): IssueRelation => (r.type === 'blocks' && !isOpen(i) ? { type: 'related', id: r.id } : r))
    return [i.id, edges.filter((r, k) => edges.findIndex((s) => s.type === r.type && s.id === r.id) === k)]
  }))

  const children = new Map<string, string[]>()
  const reverse: Record<IssueRelationType, Map<string, string[]>> = { blocks: new Map(), related: new Map(), duplicate: new Map() }
  const add = (m: Map<string, string[]>, key: string, id: string) => {
    const arr = m.get(key) ?? []
    if (!arr.includes(id)) arr.push(id)
    m.set(key, arr)
  }
  const oldestFirst = [...issues].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))
  for (const i of oldestFirst) {
    const p = parentOf.get(i.id)
    if (p) add(children, p, i.id)
    for (const r of relationsOf.get(i.id) ?? []) add(reverse[r.type], r.id, i.id)
  }
  // cycle members were cut from parentOf above, so the children graph is a forest and this walk ends.
  const descendantsOf = (id: string): string[] => (children.get(id) ?? []).flatMap((k) => [k, ...descendantsOf(k)])

  return issues.map((i) => {
    const kids = children.get(i.id) ?? []
    const closed = kids.filter((k) => !isOpen(byId.get(k)!)).length
    const relations = relationsOf.get(i.id) ?? []
    return {
      ...i,
      parent: parentOf.get(i.id) ?? null,
      relations,
      children: kids,
      descendants: descendantsOf(i.id),
      childCounts: { open: kids.length - closed, closed },
      blockedBy: reverse.blocks.get(i.id) ?? [],
      relatedBy: reverse.related.get(i.id) ?? [],
      duplicatedBy: reverse.duplicate.get(i.id) ?? [],
      duplicateOf: relations.find((r) => r.type === 'duplicate')?.id ?? null,
    }
  })
}

// the single-issue read's `refs` ([[issues]]): the compact face of every issue this one's hierarchy fields name —
// parent, children, and both directions of each relation — taken from the SAME merged set, so a detail page can
// title and mark each link it draws without a read per id.
export type IssueRef = Pick<Issue, 'id' | 'store' | 'concern' | 'status' | 'by' | 'created' | 'closedAt' | 'childCounts' | 'descendants'>
export function issueRefs(issue: Issue, merged: Issue[]): Record<string, IssueRef> {
  const byId = new Map(merged.map((i) => [i.id, i]))
  const named = [issue.parent, ...issue.children, ...issue.relations.map((r) => r.id), ...issue.blockedBy, ...issue.relatedBy, ...issue.duplicatedBy]
  const refs: Record<string, IssueRef> = {}
  for (const id of named) {
    const i = id ? byId.get(id) : undefined
    if (i) refs[i.id] = { id: i.id, store: i.store, concern: i.concern, status: i.status, by: i.by, created: i.created, closedAt: i.closedAt, childCounts: i.childCounts, descendants: i.descendants }
  }
  return refs
}

// the one merged read: local issue-store threads + the caller-supplied forge slice, ONE time line — the
// stores are the same abstraction, so they interleave by creation time, newest first (never
// store-grouped; a reader's eye lands on what just happened, whatever store holds it). CALLERS own
// freshness — the server passes the resident cache's state (instant, background reconcile), the CLI a
// live pull — so the merge itself stays pure.
export function mergedIssues(forge: ForgeSlice | null, nodeIds: string[]): Issue[] {
  return allThreads(forge, nodeIds)
}

function allThreads(forge: ForgeSlice | null, nodeIds: string[]): Issue[] {
  const remote = forge ? fromForge(forge, nodeIds) : []
  return issueHierarchy([...loadLocalIssues(), ...remote]).sort((a, b) => b.created.localeCompare(a.created))
}

export function boardThreads(forge: ForgeSlice | null, nodeIds: string[]): { issues: Issue[]; stamp: string } {
  const threads = allThreads(forge, nodeIds)
  return { issues: threads, stamp: threadStamp(threads) }
}

export function threadStamp(threads: Issue[]): string {
  return [
    threads.filter((i) => i.status === 'open').length,
    threads.length,
    threads.reduce((n, i) => n + i.replies.length, 0),
    threads.flatMap((i) => [i.created, ...i.replies.map((r) => r.at)]).reduce((a, b) => (b > a ? b : a), ''),
  ].join(':')
}

export async function createIssue(
  concern: string,
  opts: { store?: string; nodes?: string[]; body?: string; evidence?: string[]; author?: string; parent?: string } = {},
): Promise<{ store: string; id: string; nodes: string[]; parent: string | null; url?: string; outcomes: DispatchOutcome[] }> {
  const store = opts.store || 'local'
  const author = opts.author || envSessionId() || 'unknown'
  if (store === 'local') {
    const { thread, outcomes } = await postLocalIssue(concern, {
      nodes: opts.nodes,
      body: opts.body,
      evidence: opts.evidence,
      author,
      parent: opts.parent,
    })
    return { store: 'local', id: thread.id, nodes: thread.nodes, parent: thread.parent, outcomes }
  }
  if (opts.parent) throw new Error(`a sub-issue is a local issue — '${store}' stores no parent (open it without --store, or without --parent)`)

  const driver = forgeDriverFor(store)
  if (!driver) throw new Error(`unknown issue store '${store}' (known: ${issueStores().map((s) => s.id).join(', ')})`)
  const nodes = inferNodes(concern, opts.body, opts.nodes)
  const { number, url } = await driver.createIssue({
    title: concern,
    body: forgeIssueBody(concern, opts.body, nodes, opts.evidence),
  })
  const id = `${driver.host}#${number}`
  return { store: driver.host, id, nodes, parent: null, url, outcomes: await dispatchNewMentions(opts.body || concern, { threadId: id, node: nodes[0] || null, author, status: 'open' }) }
}

export async function promote(id: string, opts: { author?: string } = {}): Promise<{ url: string; number: number; host: string }> {
  const author = opts.author || envSessionId() || 'unknown'
  const t = loadOne(id)
  if (t.status !== 'open') throw new Error(`'${id}' is ${t.status} — only an open local issue promotes`)
  const host = resolveForgeHost()
  const driver = forgeDriverFor(host)
  if (!driver) throw new Error(`no driver for this repo's forge host '${host}' (known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')}) — promotion needs one`)
  const body = [
    t.body,
    t.nodes.length ? `\nSpec: ${t.nodes.join(', ')}` : '',
    t.evidence.length ? `\nEvidence: ${t.evidence.join(', ')} (evidence content hashes)` : '',
    `\n---\nPromoted from the local issue \`${id}\` (opened by ${t.by} @ ${t.created}; promoted by ${author}).`,
  ].filter(Boolean).join('\n')
  const { number, url } = await driver.createIssue({ title: t.concern, body })
  reply(id, `promoted to the forge: ${url}`, author)
  closeLocalIssue(id)
  return { url, number, host: driver.host }
}

export async function replyIssue(
  id: string,
  body: string,
  opts: { author?: string; node?: string | null; evidence?: string[] } = {},
): Promise<{ store: string; replies?: Reply[]; url?: string; thread?: Issue; author: string; outcomes: DispatchOutcome[] }> {
  const author = opts.author || envSessionId() || 'unknown'
  const forge = /^([A-Za-z0-9-]+)#(\d+)$/.exec(id)
  if (!forge) {
    // evidence hashes accrue onto the local thread's typed evidence[] (a forge thread has no such field —
    // an annotation's frame rides its comment body's image link there, the driver the only network toucher);
    const { thread, outcomes } = await replyLocalIssue(id, body, author, opts.evidence)
    // the thread rides along so [[loop-in]] can resolve this reply's originator chain without a second read.
    return { store: 'local', replies: thread.replies, thread, author, outcomes }
  }
  const driver = forgeDriverFor(forge[1])
  if (!driver) throw new Error(`unknown forge host '${forge[1]}' — known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')}`)
  const { url } = await driver.createComment({ number: parseInt(forge[2], 10), body })
  return { store: forge[1], url, author, outcomes: await dispatchNewMentions(body, { threadId: id, node: opts.node ?? null, author }) }
}

// the close is also where the issue's fleet learns the thread has landed ([[issue-binding]]'s close notice): the
// sessions bound to it hold a pointer that says this thread is their work, and after the close that is no longer
// true. Advisory by construction — a store write that landed is never undone because a queue was unreachable, so a
// failed notice is reported beside the close and nothing else. A repeat close tells nobody: it changed nothing.
async function tellFleetClosed(id: string, concern: string | undefined, by: string | undefined) {
  try {
    const { notifyIssueClosed } = await import('./issue-assign.js')
    return await notifyIssueClosed({ id, concern }, by || 'human')
  } catch (e) {
    console.error(`spex: issue ${id} closed, but its sessions were not told: ${e instanceof Error ? e.message : e}`)
    return []
  }
}

// `duplicateOf` closes a local issue AS a duplicate of its canonical — the relation is written in the same store
// write as the close, so there is no state enum beyond the existing closed reading. A forge issue has nowhere to hold it.
export async function closeIssue(id: string, opts: { duplicateOf?: string; by?: string } = {}): Promise<{ store: string; status: string; url?: string; notified: CloseNotice[] }> {
  const forge = /^([A-Za-z0-9-]+)#(\d+)$/.exec(id)
  if (!forge) {
    // the concern is read before the write so the notice can say WHICH task ended, in the issue's own words
    const concern = (() => { try { return loadOne(id).concern } catch { return undefined } })()
    const closed = closeLocalIssue(id, opts)
    return { store: 'local', status: closed.status, notified: closed.already ? [] : await tellFleetClosed(id, concern, opts.by) }
  }
  if (opts.duplicateOf) throw new Error(`'${id}' is a forge issue — relations live in the local store, so only a local issue closes as a duplicate`)
  const driver = forgeDriverFor(forge[1])
  if (!driver) throw new Error(`unknown forge host '${forge[1]}' — known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')}`)
  const { url } = await driver.closeIssue({ number: parseInt(forge[2], 10) })
  return { store: forge[1], status: 'closed', url, notified: await tellFleetClosed(id, undefined, opts.by) }
}

// ───────────────────────── CLI ─────────────────────────

export function findIssue(id: string, forge: ForgeSlice | null, nodeIds: string[]): Issue | undefined {
  return mergedIssues(id.includes('#') ? forge : null, nodeIds).find((i) => i.id === id)
}
