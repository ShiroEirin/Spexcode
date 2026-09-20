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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveOpenTarget } from './open-target.js'
import type { Session } from './sessions.js'

function session(id: string, branch: string): Session {
  return {
    id, branch, path: '/fixture', label: id, title: id, raw: { name: null, title: null }, parent: null, issues: [], issue: null,
    harness: 'codex', capabilities: { headless: false }, launcher: 'codex', lifecycle: 'active', proposal: null,
    merges: 0, status: 'working', liveness: 'unknown', note: null, archived: false, closedAt: null,
    prompt: null, promptPreview: null, created: 1, activity: null, sortKey: null,
  }
}

test('resolves nodes before sessions and files into canonical dashboard hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-open-target-'))
  try {
    writeFileSync(join(root, 'same'), 'file')
    const target = resolveOpenTarget('same', {
      root,
      specs: [{ id: 'same' }],
      sessions: [session('same-session', 'same')],
      cwd: root,
    })
    assert.deepEqual(target, { kind: 'node', id: 'same', hash: '#/spec/same' })
  } finally { sweepTemp(root) }
})

test('resolves session selectors to their full id', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-open-target-'))
  try {
    const target = resolveOpenTarget('abc123', {
      root,
      specs: [],
      sessions: [session('abc12345-0000-0000-0000-000000000000', 'node/example')],
      cwd: root,
    })
    assert.deepEqual(target, {
      kind: 'session',
      id: 'abc12345-0000-0000-0000-000000000000',
      hash: '#/sessions/abc12345-0000-0000-0000-000000000000',
    })
  } finally { sweepTemp(root) }
})

test('resolves a project file and refuses paths outside the project', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-open-target-'))
  const outside = mkdtempSync(join(tmpdir(), 'spex-open-outside-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'hello world.ts'), '')
    writeFileSync(join(outside, 'secret'), '')
    assert.deepEqual(resolveOpenTarget('hello world.ts', { root, specs: [], sessions: [], cwd: join(root, 'src') }), {
      kind: 'file', path: 'src/hello world.ts', hash: '#/file/src/hello%20world.ts',
    })
    assert.throws(() => resolveOpenTarget(join(outside, 'secret'), { root, specs: [], sessions: [], cwd: root }), /outside the project/)
  } finally {
    sweepTemp(root)
    sweepTemp(outside)
  }
})

test('fails loudly for an ambiguous session selector or missing file', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-open-target-'))
  try {
    const sessions = [session('abc11111-0000-0000-0000-000000000000', 'node/one'), session('abc22222-0000-0000-0000-000000000000', 'node/two')]
    assert.throws(() => resolveOpenTarget('abc', { root, specs: [], sessions, cwd: root }), /ambiguous/)
    assert.throws(() => resolveOpenTarget('missing', { root, specs: [], sessions: [], cwd: root }), /not a file/)
  } finally { sweepTemp(root) }
})
