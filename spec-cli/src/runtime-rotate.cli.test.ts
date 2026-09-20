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
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { tsxBin } from './tsx-bin.js'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
// tsx through node, resolved from this package: the `.bin/tsx` shim is an unspawnable sh script on
// Windows, so a bare `spawnSync('tsx', …)` is an ENOENT there ([[tsx-bin]]).
const TSX = tsxBin(pkgRoot)

test('doctor repair app-server reads launcher configuration from the project, not its runtime store', { skip: process.platform === 'win32' ? 'the fixture configures a codex launcher, and resolving it stops at the tmux requirement before the app-server repair is reached — Windows has no tmux, so the store-vs-project distinction this test proves cannot be exercised here' : false }, () => {
  const home = mkdtempSync(`${tmpdir()}/spex-runtime-rotate-`)
  const project = mkdtempSync(`${tmpdir()}/spex-runtime-rotate-project-`)
  try {
    mkdirSync(join(project, '.spec'), { recursive: true })
    writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
      sessions: {
        launchers: { codex: { harness: 'codex', cmd: 'codex' } },
        defaultLauncher: 'codex',
      },
    }, null, 2) + '\n')
    writeFileSync(join(project, 'README.md'), 'fixture\n')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    execFileSync('git', ['-c', 'user.name=runtime-fixture', '-c', 'user.email=runtime@example.test', 'add', '.'], { cwd: project })
    execFileSync('git', ['-c', 'user.name=runtime-fixture', '-c', 'user.email=runtime@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
    const result = spawnSync(process.execPath, [TSX, cli, 'doctor', 'repair', 'app-server'], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, SPEXCODE_HOME: home },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /there is no proven canonical app-server generation to switch/)
    assert.doesNotMatch(result.stderr, /sessions\.defaultLauncher is required/)
  } finally {
    sweepTemp(home)
    sweepTemp(project)
  }
})

test('doctor repair app-server has a precise non-mutating help probe', () => {
  const result = spawnSync(process.execPath, [TSX, cli, 'doctor', 'repair', 'app-server', '--help'], {
    cwd: pkgRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage: spex doctor repair app-server \[--launcher <name>\]/)
  assert.doesNotMatch(result.stdout, /runtime rotate/)
})

test('the removed runtime drawer signposts the doctor repair without executing it', () => {
  const result = spawnSync(process.execPath, [TSX, cli, 'runtime', 'rotate', 'codex'], {
    cwd: pkgRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /`spex runtime` was removed/)
  assert.match(result.stderr, /use: spex doctor repair app-server/)
})
