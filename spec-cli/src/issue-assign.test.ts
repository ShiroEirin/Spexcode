import test from 'node:test'
import assert from 'node:assert/strict'
import { AssignError, assignIssueSession, assignPrompt, closedPrompt, notifyIssueClosed, summarizeAssign, summarizeCloseNotices, summarizeUnassign, unassignIssueSession, type AssignDeps } from './issue-assign.js'
import type { Issue } from './issues.js'
import type { Session } from './sessions.js'

// [[issue-binding]]: the assign verb resolves its target with the ordinary selector and fails in the resolver's
// words before touching any record; the prompt names the thread and its node.
const issue: Issue = { id: 'local#fold', store: 'local', concern: 'fold count reads 0', by: 'human', status: 'open', nodes: ['session-forest'], created: '2026-09-13', closedAt: null, body: '', replies: [], evidence: [], labels: [],
  parent: null, relations: [], children: [], descendants: [], childCounts: { open: 0, closed: 0 }, blockedBy: [], relatedBy: [], duplicatedBy: [], duplicateOf: null }
const row = (id: string, branch: string): Session => ({
  id, branch, path: `/wt/${id}`, label: id, title: id, raw: { name: null, title: null }, parent: null, issues: [], issue: null,
  harness: 'claude', capabilities: { headless: false }, launcher: null, lifecycle: 'active', proposal: null, merges: 0,
  status: 'working', liveness: 'online', note: null, archived: false, closedAt: null, prompt: null, promptPreview: null,
  created: 1, activity: null, sortKey: null,
})
const deps = (sessions: Session[]): AssignDeps => ({ listSessions: async () => sessions, sendText: async () => ({ ok: true }) })

test('assign refuses an unknown or ambiguous selector with the resolver\'s own words', async () => {
  const sessions = [row('aaaa-1111', 'node/x-1'), row('aaaa-2222', 'node/x-2')]
  await assert.rejects(assignIssueSession(issue, 'zzzz', 'human', deps(sessions)), (e: unknown) => e instanceof AssignError && e.status === 404 && /no such session: zzzz/.test(e.message))
  await assert.rejects(assignIssueSession(issue, 'aaaa', 'human', deps(sessions)), (e: unknown) => e instanceof AssignError && e.status === 409 && /ambiguous/.test(e.message))
  await assert.rejects(assignIssueSession(issue, '  ', 'human', deps(sessions)), (e: unknown) => e instanceof AssignError && e.status === 400)
})

test('the assignment message names the thread, the node, and who handed it over', () => {
  const text = assignPrompt(issue, 'human')
  assert.match(text, /assigned issue "local#fold" by human/)
  assert.match(text, /\[\[session-forest\]\]/)
  assert.match(text, /spex issue show local#fold/)
  assert.equal(summarizeAssign({ ok: true, issue: 'local#fold', session: 'aaaa-1111-x', previous: 'local#old', added: true, issues: ['local#old', 'local#fold'], delivered: false, deliveryError: 'offline' }), 'assigned aaaa-111 to local#fold (also on local#old) · NOT told: offline')
})

test('assign is idempotent and unassign removes only the requested issue', async () => {
  const sessions = [row('aaaa-1111', 'node/x-1')]
  let sent = 0
  let current = { session: 'aaaa-1111', governed: true, worktreePath: '/wt/aaaa-1111', branch: 'node/x-1', title: null, name: null, parent: null, issues: ['local#other'], issue: 'local#other', status: 'active', proposal: null, merges: 0, note: null, sortKey: null, createdAt: 1, harness: 'claude', harnessSessionId: null, runtimeStartToken: null, stopped: false, archived: false, closedAt: null, launcher: null, launchCmd: null, launchOwner: null } as any
  const d: AssignDeps = {
    listSessions: async () => sessions,
    sendText: async () => { sent++; return { ok: true } },
    readRecord: () => current,
    writeRecord: (next) => { current = next as typeof current },
    withRecordLock: async (_id, body) => body(),
  }
  const first = await assignIssueSession(issue, 'aaaa-1111', 'human', d)
  assert.equal(first.added, true)
  assert.deepEqual(current.issues, ['local#other', 'local#fold'])
  const repeat = await assignIssueSession(issue, 'aaaa-1111', 'human', d)
  assert.equal(repeat.added, false)
  assert.equal(sent, 1, 'duplicate assignment does not send another prompt')
  const removed = await unassignIssueSession(issue, 'aaaa-1111', 'human', d)
  assert.equal(removed.removed, true)
  assert.deepEqual(current.issues, ['local#other'])
  const repeatRemoval = await unassignIssueSession(issue, 'aaaa-1111', 'human', d)
  assert.equal(repeatRemoval.removed, false)
  assert.equal(sent, 2, 'only the real removal sends a notification')
  assert.match(summarizeUnassign(removed), /unassigned aaaa-111 from local#fold/)
})

test('the assignment message repeats the issue id and, for a session that now carries several, says which to name', () => {
  const alone = assignPrompt(issue, 'human', ['local#fold'])
  assert.match(alone, /Read that thread before you touch anything \(`spex issue show local#fold`\)/)
  assert.doesNotMatch(alone, /You now carry/)
  const many = assignPrompt(issue, 'human', ['local#old', 'local#fold'])
  assert.match(many, /You now carry 2 issues: local#old, local#fold/)
  assert.match(many, /\[\[issue:local#fold\]\]/)
  assert.match(many, /spex issue mine/)
})

test('a close tells every session whose own set names the issue, and leaves ending them to them', async () => {
  const bound = { ...row('aaaa-1111', 'node/x-1'), issues: ['local#fold'], issue: 'local#fold' }
  const twoIssues = { ...row('bbbb-2222', 'node/x-2'), issues: ['local#fold', 'local#other'], issue: 'local#fold' }
  const gone = { ...row('cccc-3333', 'node/x-3'), issues: ['local#fold'], archived: true }
  const elsewhere = { ...row('dddd-4444', 'node/x-4'), issues: ['local#other'], issue: 'local#other' }
  const sent: Array<{ to: string; text: string }> = []
  const notices = await notifyIssueClosed(issue, 'human', {
    listSessions: async () => [bound, twoIssues, gone, elsewhere],
    sendText: async (id, text) => { sent.push({ to: id, text }); return id === 'bbbb-2222' ? { ok: false, error: 'offline' } : { ok: true } },
  })
  assert.deepEqual(sent.map((s) => s.to), ['aaaa-1111', 'bbbb-2222'], 'archived rows and other issues are not told')
  assert.match(sent[0].text, /was closed by human — its thread is landed: fold count reads 0/)
  assert.match(sent[0].text, /Closing the issue did not close you/)
  assert.doesNotMatch(sent[0].text, /still bound to/)
  assert.match(sent[1].text, /still bound to issue "local#other"/, 'a session with work left is pointed at it')
  assert.deepEqual(notices, [{ session: 'aaaa-1111', delivered: true }, { session: 'bbbb-2222', delivered: false, error: 'offline' }])
  assert.equal(summarizeCloseNotices(notices), 'told 1/2 bound session(s); NOT told: bbbb-222 (offline)')
  assert.equal(summarizeCloseNotices([]), '', 'an issue with no fleet says nothing')
})

test('the close notice works from an id alone, when the store cannot say what the concern was', () => {
  assert.match(closedPrompt({ id: 'github#12' }, 'human'), /^Issue "github#12" was closed by human — its thread is landed\n/)
})
