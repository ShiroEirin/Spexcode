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

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tsxBin } from './tsx-bin.js'

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = tsxBin(join(SRC, '..'))

test('graph rejects a non-Git workspace with one actionable message and no runtime stack', () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'spex-nongit-graph-')))
  try {
    const result = spawnSync(process.execPath, [TSX, CLI, 'graph', '--json'], { cwd: workspace, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, `spex: workspace is not a Git repository: ${workspace}. Run \`git init\` in that directory, then retry.\n`)
    assert.doesNotMatch(result.stderr, /at node:internal|Command failed:|cannot derive history events/)
  } finally {
    sweepTemp(workspace)
  }
})

test('the cached graph entrance rejects the same non-Git workspace before layout reads', () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'spex-nongit-cache-')))
  try {
    const program = [
      `import { readBoard } from ${JSON.stringify(join(SRC, 'graphCache.ts'))}`,
      'readBoard().then(',
      '  () => { console.log("unexpected success"); process.exitCode = 2 },',
      '  (error) => { console.log(JSON.stringify({ name: error?.name, message: error?.message })) },',
      ')',
    ].join('\n')
    const result = spawnSync(process.execPath, [TSX, '-e', program], { cwd: workspace, encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.notEqual(result.stdout, '', 'a direct read must settle before its process exits')
    assert.deepEqual(JSON.parse(result.stdout), {
      name: 'GitWorkspaceError',
      message: `workspace is not a Git repository: ${workspace}. Run \`git init\` in that directory, then retry.`,
    })
  } finally {
    sweepTemp(workspace)
  }
})
