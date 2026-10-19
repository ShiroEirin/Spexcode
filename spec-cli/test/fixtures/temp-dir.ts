import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// @@@ sweepTemp - a fixture cleanup that must never fail the test on Windows. A child process can still hold
// a handle inside the tree, and rmSync then answers EPERM for as long as it lives; the OS reclaims the temp
// tree anyway, so a bounded retry that gives up silently is the honest shape (POSIX deletes on the first try).
// Synchronous on purpose: every caller is a `finally` in a synchronous test body, and an `await` there would
// change the test's shape. (Atomics.wait is the one portable synchronous sleep Node exposes.)
export function sweepTemp(dir: string): void {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { rmSync(dir, { recursive: true, force: true }); return } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50) }
  }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* OS temp reclamation */ }
}

// Fixtures serialize project paths and bind Unix sockets beneath their homes. Darwin's default
// temp directory is an alias with a long physical path; own a short, canonical directory instead.
const owned = new Set<string>()
process.once('exit', () => {
  // The exit sweep runs on every platform, so it takes the same Windows-safe retry as an in-test cleanup:
  // a handle still held at exit must not turn a green suite into an uncaught EPERM.
  for (const path of owned) sweepTemp(path)
})

export function fixtureTempDir(prefix: string): string {
  const darwin = process.platform === 'darwin'
  const path = realpathSync(mkdtempSync(join(darwin ? '/tmp' : tmpdir(), darwin ? prefix.slice(0, 24) : prefix)))
  owned.add(path)
  return path
}
