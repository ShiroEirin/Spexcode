import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bumpWidgetReload, composeWidgetMessage, draftsOfSession, dropWidgetDraft, putWidgetDraft, widgetCommits, widgetOwners,
} from './widgetHost.js'
import { postIssueReply } from './data.js'

// [[widgets]]: one host contract for every home. The queue is keyed by OWNER and name, because an issue thread
// draws the widgets of several sessions at once and two of them may share a name.

test('a draft joins the end, an update keeps its place, an empty text withdraws it', () => {
  let drafts = putWidgetDraft([], 'a', 'plan', 'I choose A', { choice: 'A' })
  drafts = putWidgetDraft(drafts, 'a', 'scope', 'narrow', { scope: 'narrow' })
  drafts = putWidgetDraft(drafts, 'a', 'plan', 'I choose B', { choice: 'B' })
  assert.deepEqual(drafts.map((entry) => [entry.name, entry.text]), [['plan', 'I choose B'], ['scope', 'narrow']])
  assert.deepEqual(drafts[0].state, { choice: 'B' })
  drafts = putWidgetDraft(drafts, 'a', 'plan', '   ', { choice: 'B' })
  assert.deepEqual(drafts.map((entry) => entry.name), ['scope'])
  // withdrawing what is not there hands the same queue back, so nothing re-renders for it
  assert.equal(putWidgetDraft(drafts, 'a', 'missing', '', null), drafts)
})

test('two owners may hold a widget of the same name without touching each other', () => {
  let drafts = putWidgetDraft([], 'a', 'plan', 'from a', { v: 1 })
  drafts = putWidgetDraft(drafts, 'b', 'plan', 'from b', { v: 2 })
  assert.deepEqual(draftsOfSession(drafts, 'a'), { plan: { text: 'from a', state: { v: 1 } } })
  assert.deepEqual(draftsOfSession(drafts, 'b'), { plan: { text: 'from b', state: { v: 2 } } })
  assert.deepEqual(draftsOfSession(drafts, 'c'), {})
  drafts = dropWidgetDraft(drafts, 'a', 'plan')
  assert.deepEqual(drafts, [{ session: 'b', name: 'plan', text: 'from b', state: { v: 2 } }])
})

test('discarding reloads only that owner\'s frame of that name', () => {
  let reloads = bumpWidgetReload({}, 'a', 'plan')
  reloads = bumpWidgetReload(reloads, 'a', 'plan')
  reloads = bumpWidgetReload(reloads, 'b', 'plan')
  assert.deepEqual(reloads, { a: { plan: 2 }, b: { plan: 1 } })
})

test('one send carries every block then the typed words, the owners, and each state for its owner', () => {
  const drafts = [
    { session: 'a', name: 'plan', text: 'I choose A', state: { choice: 'A' } },
    { session: 'b', name: 'ticks', text: 'x and y', state: ['x', 'y'] },
    { session: 'a', name: 'scope', text: 'narrow', state: null },
  ]
  assert.equal(composeWidgetMessage(drafts, 'go ahead'), 'I choose A\n\nx and y\n\nnarrow\n\ngo ahead')
  assert.equal(composeWidgetMessage(drafts.slice(0, 1), ''), 'I choose A')
  assert.equal(composeWidgetMessage([], '  '), '')
  assert.deepEqual(widgetOwners(drafts), ['a', 'b'])
  assert.deepEqual(widgetCommits(drafts), [
    { session: 'a', name: 'plan', state: { choice: 'A' } },
    { session: 'b', name: 'ticks', state: ['x', 'y'] },
    { session: 'a', name: 'scope', state: null },
  ])
})

test('the issue reply write carries widget states beside the deliveries, and omits both when empty', async () => {
  const originalFetch = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  try {
    await postIssueReply('local#t', 'I choose A', [], { deliverTo: ['a'], widgets: [{ session: 'a', name: 'plan', state: { choice: 'A' } }] })
    await postIssueReply('local#t', 'plain', [])
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(bodies[0], { body: 'I choose A', deliverTo: ['a'], widgets: [{ session: 'a', name: 'plan', state: { choice: 'A' } }] })
  assert.deepEqual(bodies[1], { body: 'plain' })
})
