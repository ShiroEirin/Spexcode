import test from 'node:test'
import assert from 'node:assert/strict'
import { AssignError, assignIssueSession, assignPrompt, summarizeAssign } from './issue-assign.js'
import type { Issue } from './issues.js'
import type { Session } from './sessions.js'

// [[issue-binding]]: the assign verb resolves its target with the ordinary selector and fails in the resolver's
// words before touching any record; the prompt names the thread and its node.
const issue: Issue = { id: 'local#fold', store: 'local', concern: 'fold count reads 0', by: 'human', status: 'open', nodes: ['session-forest'], created: '2026-09-13', body: '', replies: [], evidence: [], labels: [] }
const row = (id: string, branch: string): Session => ({
  id, branch, path: `/wt/${id}`, label: id, title: id, raw: { name: null, title: null }, parent: null, issue: null,
  harness: 'claude', capabilities: { headless: false }, launcher: null, lifecycle: 'active', proposal: null, merges: 0,
  status: 'working', liveness: 'online', note: null, archived: false, closedAt: null, prompt: null, promptPreview: null,
  created: 1, activity: null, sortKey: null,
})
const deps = (sessions: Session[]) => ({ listSessions: async () => sessions, sendText: async () => ({ ok: true }) })

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
  assert.equal(summarizeAssign({ ok: true, issue: 'local#fold', session: 'aaaa-1111-x', previous: 'local#old', delivered: false, deliveryError: 'offline' }), 'assigned aaaa-111 to local#fold (was local#old) · NOT told: offline')
})
