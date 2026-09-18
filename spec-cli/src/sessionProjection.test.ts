import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSessionRows, type OrderedSessionRow } from './sessionProjection.js'

type Row = OrderedSessionRow & { state: string }
const row = (id: string, created: number, state = 'idle', sortKey: number | null = null): Row => ({ id, created, sortKey, state })

test('partial session merge reuses untouched rows and orders replacements', () => {
  const first = row('first', 1, 'idle')
  const second = row('second', 2, 'idle')
  const replacement = row('second', 2, 'working')
  const merged = mergeSessionRows([first, second], [replacement], ['second'])
  assert.ok(merged)
  assert.equal(merged.length, 2)
  assert.equal(merged[0], first)
  assert.equal(merged[1], replacement)
})

test('partial session merge treats a missing known row as removal', () => {
  const first = row('first', 1)
  const second = row('second', 2)
  const merged = mergeSessionRows([first, second], [], ['second'])
  assert.deepEqual(merged, [first])
  assert.equal(merged?.[0], first)
})

test('partial session merge refuses a returned row for an unseen id', () => {
  const first = row('first', 1)
  const added = row('added', 3, 'working')
  const merged = mergeSessionRows([first], [added], ['added'])
  assert.equal(merged, null)
})

test('partial session merge refuses an unseen id with no row', () => {
  const first = row('first', 1)
  assert.equal(mergeSessionRows([first], [], ['missing']), null)
})

test('partial session merge refuses duplicate, unknown, or malformed updates', () => {
  const first = row('first', 1)
  const replacement = row('first', 1, 'working')
  assert.equal(mergeSessionRows([first], [replacement, replacement], ['first']), null)
  assert.equal(mergeSessionRows([first], [row('other', 2)], ['first']), null)
  assert.equal(mergeSessionRows([first], [replacement], ['']), null)
})
