import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { anchorServiceCwd, serviceCwdLoss } from './service-cwd.js'

function fixture(t: { after: (fn: () => void) => void }): string {
  const origin = process.cwd()
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'spex-service-cwd-unit-')))
  t.after(() => { process.chdir(origin); rmSync(base, { recursive: true, force: true }) })
  return base
}

test('anchoring moves the process off the directory it was launched from', (t) => {
  const base = fixture(t)
  const launched = join(base, 'launched-here'), served = join(base, 'served')
  mkdirSync(launched); mkdirSync(served)
  process.chdir(launched)
  assert.equal(anchorServiceCwd(served), served)
  assert.equal(process.cwd(), served)
  rmSync(launched, { recursive: true })
  assert.equal(serviceCwdLoss(served), null, 'losing the launch directory is not losing the service directory')
})

test('a trashed, deleted, or replaced service directory is reported while process.cwd() still answers', (t) => {
  const base = fixture(t)
  const served = join(base, 'served'), trash = join(base, 'trash')
  mkdirSync(served)
  anchorServiceCwd(served)
  assert.equal(serviceCwdLoss(served), null)
  assert.equal(process.cwd(), served) // any real service reads it once at boot, and Node caches that answer

  renameSync(served, trash) // what close does to a session worktree before deleting it
  assert.match(serviceCwdLoss(served) ?? '', /is gone \(ENOENT\)/)
  assert.equal(process.cwd(), served, "Node's cached cwd is why the loss has to be asked of the kernel")

  mkdirSync(served) // a fresh directory at the same path is still not the one this process stands on
  assert.match(serviceCwdLoss(served) ?? '', /no longer the directory this process stands on/)

  rmSync(trash, { recursive: true })
  assert.notEqual(serviceCwdLoss(served), null)
})
