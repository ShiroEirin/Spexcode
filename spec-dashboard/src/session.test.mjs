import test from 'node:test'
import assert from 'node:assert/strict'
import * as sessionModule from './session.js'
import { sessionAncestorIds, sessionDisplayState, sessionFooterState, sessionForest, sessionPresentationOrder, sessionZone, STATUS_COLOR, STATUS_GLYPH } from './session.js'

test('retired session projection exports stay removed', () => {
  for (const name of ['ZONE_ORDER', 'splitArchived', 'sessionTitle']) {
    assert.equal(name in sessionModule, false, `${name} is a dead compatibility export`)
  }
})

test('display projection uses the package status for both zone and glyph', () => {
  const cases = [
    { session: { status: 'asking', liveness: 'online' }, zone: 'need', glyph: STATUS_GLYPH.asking, status: 'asking' },
    { session: { status: 'working', liveness: 'online' }, zone: 'run', glyph: STATUS_GLYPH.working, status: 'working' },
    { session: { status: 'asking', liveness: 'offline' }, zone: 'need', glyph: STATUS_GLYPH.asking, status: 'asking' },
    { session: { status: 'review', liveness: 'offline' }, zone: 'need', glyph: STATUS_GLYPH.review, status: 'review' },
    { session: { status: 'close-pending', liveness: 'offline' }, zone: 'need', glyph: STATUS_GLYPH['close-pending'], status: 'close-pending' },
    { session: { status: 'done', liveness: 'offline' }, zone: 'need', glyph: STATUS_GLYPH.done, status: 'done' },
    { session: { status: 'working', liveness: 'offline' }, zone: 'run', glyph: STATUS_GLYPH.working, status: 'working' },
    { session: { status: 'retired', liveness: 'offline' }, zone: 'offline', glyph: STATUS_GLYPH.retired, status: 'retired' },
    { session: { status: 'queued', liveness: 'offline' }, zone: 'run', glyph: STATUS_GLYPH.queued, status: 'queued' },
  ]
  for (const { session, zone, glyph, status } of cases) {
    assert.equal(sessionZone(session), zone)
    assert.deepEqual(sessionDisplayState(session), {
      zone, status, color: STATUS_COLOR[status], glyph,
    })
  }
  assert.equal(sessionDisplayState({ archived: true, status: 'offline', liveness: 'offline' }).zone, 'archive')
})

test('forest keeps parentage independent from liveness', () => {
  const items = sessionForest([
    { id: 'parent', status: 'asking', liveness: 'online', sortKey: 20 },
    { id: '66019e9b', parent: 'parent', status: 'asking', liveness: 'offline', sortKey: 30 },
  ], () => true)
  assert.deepEqual(items.filter((item) => item.type === 'zone').map((item) => item.zone), ['need'])
  const child = items.find((item) => item.type === 'row' && item.s.id === '66019e9b')
  assert.equal(child.depth, 1)
})

test('forest keeps a child under its parent even when their statuses use different zones', () => {
  const items = sessionForest([
    { id: 'working-parent', status: 'working', liveness: 'online', sortKey: 20 },
    { id: 'dead-asking-child', parent: 'working-parent', status: 'asking', liveness: 'offline', sortKey: 30 },
  ], () => true)
  assert.deepEqual(items.filter((item) => item.type === 'zone').map((item) => item.zone), ['run'])
  assert.equal(items.find((item) => item.type === 'zone').count, 2)
  const child = items.find((item) => item.type === 'row' && item.s.id === 'dead-asking-child')
  assert.equal(child.depth, 1)
  assert.equal(sessionDisplayState(child.s).glyph, STATUS_GLYPH.asking)
})

test('footer state keeps queued live and archived ahead of offline', () => {
  assert.equal(sessionFooterState({ status: 'queued', liveness: 'offline' }), 'live')
  assert.equal(sessionFooterState({ status: 'offline', liveness: 'offline' }), 'offline')
  assert.equal(sessionFooterState({ status: 'offline', liveness: 'online' }), 'offline')
  assert.equal(sessionFooterState({ archived: true, status: 'offline', liveness: 'offline' }), 'archived')
})

test('session ancestor path reveals every present nesting parent', () => {
  const sessions = [
    { id: 'root' },
    { id: 'mid', parent: 'root' },
    { id: 'leaf', parent: 'mid' },
  ]

  assert.deepEqual(sessionAncestorIds(sessions, 'leaf'), ['mid', 'root'])
  assert.deepEqual(sessionAncestorIds(sessions, 'root'), [])
})

test('session ancestor path stops at missing parents and malformed cycles', () => {
  const sessions = [
    { id: 'orphan', parent: 'gone' },
    { id: 'a', parent: 'b' },
    { id: 'b', parent: 'a' },
  ]

  assert.deepEqual(sessionAncestorIds(sessions, 'orphan'), [])
  assert.deepEqual(sessionAncestorIds(sessions, 'a'), ['b'])
  assert.deepEqual(sessionAncestorIds(sessions, 'missing'), [])
})

test('forest promotes every member of a malformed parent cycle instead of losing the orphaned family', () => {
  const items = sessionForest([
    { id: 'cycle-a', parent: 'cycle-b', status: 'working', sortKey: 20 },
    { id: 'cycle-b', parent: 'cycle-a', status: 'review', sortKey: 10 },
  ], () => true)

  assert.deepEqual(items.filter((item) => item.type === 'row').map((item) => item.s.id), ['cycle-b', 'cycle-a'])
  assert.deepEqual(items.filter((item) => item.type === 'row').map((item) => item.depth), [0, 0])
})

test('presentation order keeps dashboard zones and recursive parent-before-child order', () => {
  const sessions = [
    { id: 'run-old', status: 'working', sortKey: 10 },
    { id: 'need-parent', status: 'asking', sortKey: 20 },
    { id: 'need-child', parent: 'need-parent', status: 'done', sortKey: 100 },
    { id: 'need-new', status: 'review', sortKey: 30 },
    { id: 'run-new', status: 'parked', sortKey: 40 },
    { id: 'offline', status: 'offline', liveness: 'offline', sortKey: 50 },
  ]

  assert.deepEqual(
    sessionPresentationOrder(sessions).map((session) => session.id),
    ['need-new', 'need-parent', 'need-child', 'run-new', 'run-old', 'offline'],
  )
})

test('issueFleet joins sessions to every issue in a set and inherits descendants at read time', () => {
  const { issueFleet, fleetWorkState, issueParticipants } = sessionModule
  const sessions = [
    { id: 'a', issue: 'local#x', status: 'review', liveness: 'online', parent: null },
    { id: 'a1', issue: null, status: 'working', liveness: 'online', parent: 'a' },
    { id: 'a1x', issue: null, status: 'offline', liveness: 'offline', parent: 'a1' },   // a dead child reads `offline` (reconcile publishes liveness as the status)
    { id: 'b', issue: 'local#x', status: 'retired', liveness: 'offline', parent: null, archived: true },
    { id: 'c', issue: 'local#other', status: 'working', liveness: 'online', parent: null },
    { id: 'd', issue: null, status: 'working', liveness: 'online', parent: null },
    { id: 'e', issues: ['local#sub', 'local#x'], issue: 'local#sub', status: 'working', liveness: 'online', parent: null },
  ]
  const { assigned, fleet } = issueFleet({ id: 'local#x' }, sessions)
  assert.deepEqual(assigned.map((s) => s.id), ['a', 'e'], 'all live rows carrying the issue are assigned; an archived row is off the board')
  assert.deepEqual(fleet.map((s) => s.id), ['a', 'a1', 'a1x', 'e'], 'every assigned session and descendant belongs to the fleet')
  assert.equal(fleetWorkState(fleet), 'need', 'a review row outranks working children')
  assert.equal(fleetWorkState(fleet.slice(1)), 'run')
  assert.equal(fleetWorkState([sessions[2]]), 'stopped')
  assert.equal(fleetWorkState([]), 'none')
  assert.deepEqual(issueFleet(null, sessions), { assigned: [], fleet: [] })
  // a parent issue's fleet is its own plus every issue below it, as the read-time issue tree names them
  const parent = issueFleet({ id: 'local#x', descendants: ['local#sub'] }, sessions)
  assert.deepEqual(parent.fleet.map((s) => s.id), ['a', 'a1', 'a1x', 'e'], 'a sub-issue worker belongs to its parent issue too')
  assert.deepEqual(issueFleet({ id: 'local#x' }, sessions).assigned.map((s) => s.id), ['a', 'e'], 'a session can belong to two issues')
  assert.equal(fleetWorkState(parent.fleet), 'need')
  assert.deepEqual(issueFleet({ id: 'local#sub' }, sessions).fleet.map((s) => s.id), ['e'], 'the sub-issue keeps only its own')
  const issue = { by: 'd', replies: [{ by: 'human' }, { by: 'a1' }, { by: 'd' }, { by: 'ghost' }] }
  assert.deepEqual(issueParticipants(issue, sessions, fleet).map((s) => s.id), ['d'], 'participants resolve to board rows outside the fleet, once each')
})

test('mentionedSessions names only exact retained ids a draft @-mentions, once each', () => {
  const { mentionedSessions } = sessionModule
  const sessions = [{ id: 'abc-1', status: 'working' }, { id: 'abc-2', status: 'offline' }, { id: 'gone', archived: true }]
  const text = 'ping @abc-1 and @abc-2, also @abc (a prefix), @new, @gone and @abc-1 again'
  assert.deepEqual(mentionedSessions(text, sessions).map((s) => s.id), ['abc-1', 'abc-2'])
  assert.deepEqual(mentionedSessions('no mentions', sessions), [])
  assert.deepEqual(mentionedSessions('email me@abc-1', sessions), [], 'an @ inside a word is not a mention')
})
