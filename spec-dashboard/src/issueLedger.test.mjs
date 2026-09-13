import test from 'node:test'
import assert from 'node:assert/strict'
import { ledgerFromChildren, ledgerFromTimeline, mergeThread } from './issueLedger.js'

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

test('replies and declarations share one time line, replies first at a tie', () => {
  const replies = [{ by: 'human', at: '2026-09-13T01:10:00Z', body: 'go' }, { by: 'human', at: '2026-09-13T00:50:00Z', body: 'first' }]
  const ledger = [{ kind: 'declaration', by: 's1', at: '2026-09-13T01:10:00Z', status: 'asking', note: null }]
  assert.deepEqual(mergeThread(replies, ledger).map((r) => `${r.kind}:${r.at.slice(11, 16)}`), ['reply:00:50', 'reply:01:10', 'declaration:01:10'])
  assert.deepEqual(mergeThread(undefined, undefined), [])
})

test('a sub-issue opening joins the parent thread at its creation instant, wearing its current state', () => {
  const rows = ledgerFromChildren([
    { id: 'kid', concern: 'do the kid', status: 'landed', by: 's2', created: '2026-09-13T01:15:00Z' },
    { id: 'undated', concern: 'no instant', status: 'open', by: 's2', created: '' },
  ])
  assert.deepEqual(rows, [{ kind: 'sub-issue', by: 's2', at: '2026-09-13T01:15:00Z', id: 'kid', concern: 'do the kid', status: 'landed' }])
  const replies = [{ by: 'human', at: '2026-09-13T01:20:00Z', body: 'go' }]
  assert.deepEqual(mergeThread(replies, rows).map((r) => r.kind), ['sub-issue', 'reply'])
  assert.deepEqual(ledgerFromChildren(undefined), [])
})
