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
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const specCoreEntry = new URL('../../packages/spec-core/src/index.ts', import.meta.url).href
const tsxImport = import.meta.resolve('tsx')
const probeScript = `
  import { PLUGIN_INSTANCE_ROOT, loadSystemConfig } from ${JSON.stringify(specCoreEntry)}
  const result = { root: PLUGIN_INSTANCE_ROOT, presets: [], error: null }
  try {
    result.presets = loadSystemConfig().map(({ name, dir }) => ({ name, dir }))
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  process.stdout.write(JSON.stringify(result))
`

function probe(project: string): { root: string; presets: { name: string; dir: string }[]; error: string | null } {
  return JSON.parse(execFileSync(process.execPath, [
    '--import', tsxImport,
    '--input-type=module',
    '--eval', probeScript,
  ], { cwd: project, encoding: 'utf8' }))
}

const activeSystemNode = (title: string) => `---\ntitle: ${title}\nstatus: active\nsurface: system\n---\n${title}\n`
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('the public plugin instance root drives discovery and the legacy-tree guard', () => {
  const project = mkdtempSync(join(tmpdir(), 'spex-plugin-root-contract-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: project })
    const root = join(project, '.spec', 'project')
    mkdirSync(join(root, '.config'), { recursive: true })
    writeFileSync(join(root, 'spec.md'), '---\ntitle: project\nstatus: active\n---\nproject\n')

    const beforeInstance = probe(project)
    assert.ok(beforeInstance.error, 'the legacy tree is rejected before an instance root exists')

    const instanceNode = join(root, beforeInstance.root, 'instance-system')
    const systemNode = join(root, 'plugin-system', 'system-spec')
    mkdirSync(instanceNode, { recursive: true })
    mkdirSync(systemNode, { recursive: true })
    writeFileSync(join(instanceNode, 'spec.md'), activeSystemNode('instance-system'))
    writeFileSync(join(systemNode, 'spec.md'), activeSystemNode('system-spec'))

    const loaded = probe(project)
    assert.equal(loaded.error, null)
    assert.deepEqual(loaded.presets, [
      { name: 'instance-system', dir: ['.spec', 'project', loaded.root, 'instance-system'].join('/') },
      { name: 'system-spec', dir: ['.spec', 'project', 'plugin-system', 'system-spec'].join('/') },
    ])

    sweepTemp(join(root, loaded.root))
    assert.ok(!existsSync(join(root, loaded.root)))
    const legacy = probe(project)
    assert.match(legacy.error ?? '', new RegExp(`\\.spec/project/\\.config exists but \\.spec/project/${escapeRegex(legacy.root)} does not`))
  } finally {
    sweepTemp(project)
  }
})
