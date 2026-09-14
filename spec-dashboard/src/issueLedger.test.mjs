import test from 'node:test'
import assert from 'node:assert/strict'
import { declarationBelongsToIssue, issueRefsInNote, latestPerSession, ledgerFromChildren, ledgerFromTimeline, ledgerSince, mergeThread } from './issueLedger.js'

test('a session timeline yields only the declarations a human reads, in the board\'s own words', () => {
  const events = [
    { ts: '2026-09-13T01:00:00Z', kind: 'status', status: 'active', proposal: null, note: null },
    { ts: '2026-09-13T01:05:00Z', kind: 'sent', mid: 'm1', text: 'hello', from: null },
    { ts: '2026-09-13T01:10:00Z', kind: 'status', status: 'asking', proposal: null, note: 'which palette?' },
    { ts: '2026-09-13T01:20:00Z', kind: 'status', status: 'idle', proposal: null, note: null },
    { ts: '2026-09-13T01:30:00Z', kind: 'status', status: 'awaiting', proposal: 'merge', note: 'fix committed', display: 'review' },
  ]
  assert.deepEqual(ledgerFromTimeline('s1', events), [
    { kind: 'declaration', by: 's1', at: '2026-09-13T01:10:00Z', status: 'asking', note: 'which palette?' },
    { kind: 'declaration', by: 's1', at: '2026-09-13T01:30:00Z', status: 'review', note: 'fix committed' },
  ])
  assert.deepEqual(ledgerFromTimeline('s1', undefined), [])
})

test('declaration attribution uses explicit issue references and drops an unqualified multi-issue note', () => {
  const events = [
    { ts: '2026-09-14T01:00:00Z', kind: 'status', status: 'asking', note: 'for A [[issue:A]]' },
    { ts: '2026-09-14T01:05:00Z', kind: 'status', status: 'parked', note: 'for B [[issue:B]]' },
    { ts: '2026-09-14T01:10:00Z', kind: 'status', status: 'error', note: 'no issue named' },
  ]
  assert.deepEqual(ledgerFromTimeline('s1', events, 'A', ['A', 'B']).map((row) => row.note), ['for A [[issue:A]]'])
  assert.deepEqual(ledgerFromTimeline('s1', events, 'B', ['A', 'B']).map((row) => row.note), ['for B [[issue:B]]'])
  assert.equal(declarationBelongsToIssue('no issue named', 'A', ['A', 'B']), false)
})

test('declaration attribution falls back only for a single assigned issue and ignores quoted references', () => {
  assert.equal(declarationBelongsToIssue('plain note', 'only', ['only']), true)
  assert.equal(declarationBelongsToIssue('plain note', 'other', ['only']), false)
  assert.equal(declarationBelongsToIssue('about [[issue:other]]', 'only', ['only']), false)
  assert.equal(declarationBelongsToIssue('`[[issue:other]]`', 'only', ['only']), true)
  assert.deepEqual(issueRefsInNote('`[[issue:other]]` and [[issue:only]]'), ['only'])
})

test('latest declaration is selected after issue attribution, so an unqualified multi-issue row cannot hide a named row', () => {
  const events = [
    { ts: '2026-09-14T01:00:00Z', kind: 'status', status: 'asking', note: 'A declaration [[issue:A]]' },
    { ts: '2026-09-14T01:05:00Z', kind: 'status', status: 'asking', note: 'Unqualified declaration' },
  ]
  assert.deepEqual(ledgerFromTimeline('s1', events, 'A', ['A', 'B']).map((row) => row.note), ['A declaration [[issue:A]]'])
})

test('replies and declarations share one time line, replies first at a tie', () => {
  const replies = [{ by: 'human', at: '2026-09-13T01:10:00Z', body: 'go' }, { by: 'human', at: '2026-09-13T00:50:00Z', body: 'first' }]
  const ledger = [{ kind: 'declaration', by: 's1', at: '2026-09-13T01:10:00Z', status: 'asking', note: null }]
  assert.deepEqual(mergeThread(replies, ledger).map((r) => `${r.kind}:${r.at.slice(11, 16)}`), ['reply:00:50', 'reply:01:10', 'declaration:01:10'])
  assert.deepEqual(mergeThread(undefined, undefined), [])
})

test('a sub-issue opening and close join the parent thread at their own instants, wearing its current state', () => {
  const rows = ledgerFromChildren([
    { id: 'kid', concern: 'do the kid', status: 'landed', by: 's2', created: '2026-09-13T01:15:00Z', closedAt: '2026-09-13T01:40:00Z' },
    { id: 'old', concern: 'closed before instants', status: 'landed', by: 's2', created: '2026-09-13T01:16:00Z', closedAt: null },
    { id: 'undated', concern: 'no instant', status: 'open', by: 's2', created: '', closedAt: null },
  ])
  assert.deepEqual(rows, [
    { kind: 'sub-issue', event: 'opened', by: 's2', at: '2026-09-13T01:15:00Z', id: 'kid', concern: 'do the kid', status: 'landed' },
    { kind: 'sub-issue', event: 'closed', by: null, at: '2026-09-13T01:40:00Z', id: 'kid', concern: 'do the kid', status: 'landed' },
    { kind: 'sub-issue', event: 'opened', by: 's2', at: '2026-09-13T01:16:00Z', id: 'old', concern: 'closed before instants', status: 'landed' },
  ])
  const replies = [{ by: 'human', at: '2026-09-13T01:20:00Z', body: 'go' }]
  assert.deepEqual(mergeThread(replies, rows).map((r) => `${r.event || r.kind}:${r.at.slice(11, 16)}`),
    ['opened:01:15', 'opened:01:16', 'reply:01:20', 'closed:01:40'])
  assert.deepEqual(ledgerFromChildren(undefined), [])
})

test('the ledger starts where the issue starts: earlier declarations are cut, unparseable instants are kept', () => {
  const row = (at, note) => ({ kind: 'declaration', by: 's1', status: 'review', at, note })
  const rows = [row('2026-09-13T01:00:00Z', 'yesterday'), row('2026-09-14T02:30:00Z', 'today'), row('not-a-date', null)]
  assert.deepEqual(ledgerSince(rows, '2026-09-14T02:25:58Z').map((r) => r.note), ['today', null])
  assert.equal(ledgerSince(rows, undefined).length, 3, 'no floor, no cut')
})

test('only each session\'s latest declaration survives; sub-issue events are never thinned', () => {
  const decl = (by, at) => ({ kind: 'declaration', by, at, status: 'review', note: at })
  const rows = [
    decl('s1', '2026-09-14T01:00:00Z'),
    { kind: 'sub-issue', id: 'kid', event: 'opened', at: '2026-09-14T01:30:00Z' },
    decl('s1', '2026-09-14T02:00:00Z'),
    decl('s2', '2026-09-14T00:30:00Z'),
    { kind: 'sub-issue', id: 'kid', event: 'closed', at: '2026-09-14T03:00:00Z' },
  ]
  const kept = latestPerSession(rows)
  assert.deepEqual(kept.filter((r) => r.kind === 'declaration').map((r) => `${r.by}@${r.at.slice(11, 16)}`), ['s1@02:00', 's2@00:30'])
  assert.equal(kept.filter((r) => r.kind === 'sub-issue').length, 2)
  assert.deepEqual(latestPerSession([]), [])
})
