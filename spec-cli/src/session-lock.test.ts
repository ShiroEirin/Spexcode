import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runtimeRoot } from '@spexcode/spec-core'

import { claimDeliveryLock, withDeliveryLocks } from './delivery-lock.js'
import { trySessionRecordLockSync, withSessionRecordLock } from './session-record-lock.js'

const isolatedHome = (): void => { process.env.SPEXCODE_HOME = mkdtempSync(join(tmpdir(), 'spex-lock-')) }

test('record lock excludes a second local writer and releases after the body', () => {
  isolatedHome()
  const release = trySessionRecordLockSync('lock-session')
  assert.ok(release)
  assert.equal(trySessionRecordLockSync('lock-session'), null)
  release!()
  assert.ok(trySessionRecordLockSync('lock-session'))
})

test('record lock releases when an async operation throws', async () => {
  isolatedHome()
  await assert.rejects(() => withSessionRecordLock('lock-session', async () => { throw new Error('boom') }), /boom/)
  assert.ok(trySessionRecordLockSync('lock-session'))
})

test('a delivery claim never waits: a live holder answers null, a dead holder is reclaimed', async () => {
  isolatedHome()
  const release = claimDeliveryLock('claimed')
  assert.ok(release)
  assert.equal(claimDeliveryLock('claimed'), null)
  release!()
  const lock = join(runtimeRoot(), '.delivery-locks', 'claimed.lock')
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  try {
    writeFileSync(lock, String(holder.pid))
    const started = Date.now()
    assert.equal(claimDeliveryLock('claimed'), null, 'another live process holds the queue')
    assert.ok(Date.now() - started < 1_000)
  } finally {
    holder.kill()
    await once(holder, 'exit')
  }
  const reclaimed = claimDeliveryLock('claimed')
  assert.ok(reclaimed, 'the lock of a process that is gone is taken over')
  reclaimed!()
})

test('delivery locks acquire ids in sorted unique order and release on failure', async () => {
  isolatedHome()
  const seen: string[] = []
  await withDeliveryLocks(['b', 'a', 'b'], async () => { seen.push('body') })
  assert.deepEqual(seen, ['body'])
  await assert.rejects(() => withDeliveryLocks(['a'], async () => { throw new Error('delivery boom') }), /delivery boom/)
  await withDeliveryLocks(['a'], async () => { seen.push('reused') })
  assert.deepEqual(seen, ['body', 'reused'])
})
