import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { SESSION_LIFECYCLES, SESSION_WORK_LIFECYCLES, SESSION_PROPOSALS, isSessionLifecycle, isSessionWorkLifecycle, parseSessionLifecycle, parseSessionProposal, parseHistoricalSessionState, resumedSessionLifecycle, rawLaunchReadinessOriginal, projectPublicRecordEntry, sessionRecordPath, sessionStoreDir, type RawRecord } from '@spexcode/spec-core'
import { fromRaw, readRecord, writeRecord } from './session-record.js'
import { canonicalRecordProjection, markState } from './sessions.js'
import { configuredSessionApplication } from './session-application.js'
import { localCachedSessions } from './client.js'

function raw(status: string): RawRecord {
  return {
    session_id: `state-model-${process.pid}-${status}`, governed: true, worktree_path: process.cwd(), branch: null,
    title: null, name: null, status, proposal: null, merges: 0, note: null, sortkey: null, createdAt: 1,
    stopped: true, archived: status === 'archived',
  }
}

test('the complete lifecycle and the work declaration domain share one authoritative vocabulary', () => {
  assert.deepEqual(SESSION_LIFECYCLES.filter(isSessionWorkLifecycle), [...SESSION_WORK_LIFECYCLES])
  assert.deepEqual(SESSION_LIFECYCLES.filter((status) => !isSessionWorkLifecycle(status)), ['created', 'archived'])
  for (const status of SESSION_LIFECYCLES) {
    assert.equal(parseSessionLifecycle(status), status)
    const resumed = resumedSessionLifecycle(status)
    assert.ok(isSessionWorkLifecycle(resumed), `resume of ${status} returns an open state`)
    assert.equal(resumed, ['awaiting', 'asking', 'parked', 'idle'].includes(status) ? status : 'idle')
  }
  for (const status of ['launching', '', null]) {
    assert.equal(isSessionLifecycle(status), false)
    assert.throws(() => parseSessionLifecycle(status), /invalid session lifecycle/)
  }
  for (const status of ['created', 'archived', 'launching'])
    assert.throws(() => markState(status as any), /invalid work-state declaration/)
})

test('every product lifecycle round-trips through the same pending fence and public record parser', () => {
  for (const status of SESSION_LIFECYCLES) {
    const record = raw(status)
    record.launch_readiness_pending = {
      version: 1, startedAt: 1,
      original: { status, proposal: null, note: 'frozen', stopped: true, archived: status === 'archived', cold_proof: null, adapter_recovery: null },
    }
    assert.equal(rawLaunchReadinessOriginal(record)?.status, status)
    assert.equal(fromRaw(record).launchReadinessPending?.original.status, status)
    const projected = projectPublicRecordEntry(record.session_id, { kind: 'ok', raw: record })
    assert.equal(projected.kind, 'ok')
    if (projected.kind !== 'ok') assert.fail('valid lifecycle rejected')
    assert.equal(projected.raw.status, status)
    assert.equal(projected.liveness, 'offline')
  }
})

test('typed canonical projection never casts unknown statuses into the product domain', () => {
  assert.throws(() => canonicalRecordProjection(fromRaw(raw('idle')), {
    status: 'launching', proposal: null, note: null, parentSessionId: null,
  }), /invalid session lifecycle/)
})

test('the typed envelope writer refuses an invalid fence before publishing any bytes', () => {
  const record = fromRaw(raw('invalid-writer'))
  record.launchReadinessPending = {
    version: 1, startedAt: Date.now(),
    original: { status: 'launching' as any, proposal: null, note: null, stopped: true, archived: false, closedAt: null, coldProof: null, adapterRecovery: null },
  }
  const path = sessionRecordPath(record.session)
  assert.equal(existsSync(path), false)
  assert.throws(() => writeRecord(record), /invalid launch_readiness_pending fence/)
  assert.equal(existsSync(path), false)
})

test('proposal and historical display decoding are explicit domains rather than lifecycle casts', () => {
  for (const proposal of SESSION_PROPOSALS) assert.equal(parseSessionProposal(proposal), proposal)
  assert.equal(parseSessionProposal(''), null)
  assert.throws(() => parseSessionProposal('deploy'), /invalid session proposal/)
  assert.deepEqual(parseHistoricalSessionState('review', null), { status: 'awaiting', proposal: 'merge' })
  assert.deepEqual(parseHistoricalSessionState('done', null), { status: 'awaiting', proposal: 'nothing' })
  assert.deepEqual(parseHistoricalSessionState('close-pending', null), { status: 'awaiting', proposal: 'close' })
  assert.throws(() => parseHistoricalSessionState('review', 'close'), /conflicting historical/)
  assert.throws(() => parseHistoricalSessionState('launching', null), /invalid session lifecycle/)
})

test('cached metadata joins canonical lifecycle and invalid canonical values remain corrupt rows', () => {
  const application = configuredSessionApplication()
  const id = `canonical-cache-model-${process.pid}`
  application.createSession({ sessionId: id, status: 'asking', note: 'canonical question' })
  writeRecord({ ...fromRaw(raw('idle')), session: id })
  const cached = localCachedSessions(true).find((row) => row.id === id)
  assert.equal(cached?.lifecycle, 'asking')
  assert.equal(cached?.note, 'canonical question')
  application.transitionSession(id, { status: 'launching' })
  assert.throws(() => readRecord(id), /canonical session state is unreadable/)
  assert.equal(localCachedSessions(true).find((row) => row.id === id)?.status, 'corrupt')
  const recordless = `recordless-domain-model-${process.pid}`
  application.createSession({ sessionId: recordless, status: 'launching' })
  mkdirSync(sessionStoreDir(recordless), { recursive: true })
  assert.throws(() => readRecord(recordless), /canonical session state is unreadable/)
  assert.equal(localCachedSessions(true).find((row) => row.id === recordless)?.status, 'corrupt')
})
