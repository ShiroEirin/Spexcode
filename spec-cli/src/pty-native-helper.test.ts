// @@@ sweepTemp - a fixture cleanup that must never fail the test on Windows. A child process can still hold
// a handle inside the tree, and rmSync then answers EPERM for as long as it lives; the OS reclaims the temp
// tree anyway, so a bounded retry that gives up silently is the honest shape (POSIX deletes on the first try).
// Same synchronous shape as rmSync: a successful delete is unchanged. (A function declaration is hoisted, so
// this sits above the imports on purpose — the anchor cannot land after a call site.)
function sweepTemp(dir: string): void {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { rmSync(dir, { recursive: true, force: true }); return } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50) }
  }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* OS temp reclamation */ }
}

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const moduleUrl = pathToFileURL(join(import.meta.dirname, 'pty-native-helper.mjs')).href

test('repairs a native spawn helper execute mode idempotently', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-node-pty-'))
  t.after(() => sweepTemp(dir))
  const helper = join(dir, 'spawn-helper')
  writeFileSync(helper, '#!/bin/sh\n')
  chmodSync(helper, 0o644)

  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { ensureExecutableIfPresent } from ${JSON.stringify(moduleUrl)}
    ensureExecutableIfPresent(${JSON.stringify(helper)})
    ensureExecutableIfPresent(${JSON.stringify(helper)})
  `])

  assert.equal(statSync(helper).mode & 0o777, 0o755)
})

test('derives spawn-helper from the native addon node-pty actually loaded', { skip: process.platform === 'win32' ? "chmodSync is a no-op on win32 and statSync().mode is synthesized, so the exec bit can be neither staged nor observed" : false }, () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as pty from 'node-pty'
    import { createRequire } from 'node:module'

    import { nodePtySpawnHelperPath } from ${JSON.stringify(moduleUrl)}
    const require = createRequire(import.meta.url)
    const nativeAddon = Object.values(require.cache).find((loaded) => loaded?.exports === pty.native)?.filename
    process.stdout.write(JSON.stringify({ nativeAddon, helper: nodePtySpawnHelperPath(pty.native) }))
  `], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' })
  const resolved = JSON.parse(output)

  assert.ok(resolved.nativeAddon)
  assert.equal(dirname(resolved.helper), dirname(resolved.nativeAddon))
  assert.equal(basename(resolved.helper), 'spawn-helper')
})
