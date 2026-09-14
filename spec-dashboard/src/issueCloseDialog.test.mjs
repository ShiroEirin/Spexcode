import test from 'node:test'
import assert from 'node:assert/strict'
import { CLOSABLE, closable, closeAction } from './issueClose.js'
import { STATUS_GLYPH } from './session.js'
const STATUS_WORDS = Object.keys(STATUS_GLYPH)

// [[issue-binding]]: what one press does is derived from the picked set, never held as a second piece of state.
// the live statuses come from the board's own projection, not a second list here
const LIVE = STATUS_WORDS.filter((w) => !CLOSABLE.has(w))
const s = (id, status) => ({ id, status, liveness: 'online' })
const settled = (id) => s(id, 'close-pending')
const gone = (id) => s(id, 'retired')
const busyRow = (id) => s(id, 'asking')

test('a session is closable only once it has settled itself', () => {
  assert.equal(closable(settled('a')), true)
  assert.equal(closable(gone('b')), true)
  for (const status of LIVE) assert.equal(closable(s('c', status)), false, status)
})

test('the action follows the picked set: nothing, settled rows, or rows still working', () => {
  const fleet = [settled('a'), gone('b'), busyRow('c')]
  assert.equal(closeAction(new Set(), fleet), 'issue-only')
  assert.equal(closeAction(new Set(['a', 'b']), fleet), 'close-with')
  assert.equal(closeAction(new Set(['c']), fleet), 'wrap-up')
  // a mixed set can only arise from a stale pick; it reads as the honest half — nothing gets closed by surprise
  assert.equal(closeAction(new Set(['a', 'c']), fleet), 'wrap-up')
})
