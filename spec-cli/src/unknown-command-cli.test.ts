import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tsxBin } from './tsx-bin.js'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
// tsx through node, resolved from this package: the `.bin/tsx` shim is an unspawnable sh script on
// Windows, so a bare `spawnSync('tsx', …)` is an ENOENT there ([[tsx-bin]]).
const TSX = tsxBin(pkgRoot)

function run(command: string) {
  return spawnSync(process.execPath, [TSX, cli, command], { cwd: pkgRoot, encoding: 'utf8' })
}

test('unknown top-level commands teach a nearby public repair without inventing one', () => {
  for (const command of ['list', 'nodes']) {
    const result = run(command)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, new RegExp(`unknown command '${command}'`))
    assert.match(result.stderr, /try: spex graph/)
    assert.match(result.stderr, /try: spex help/)
  }

  const unrelated = run('zzzzqqq')
  assert.equal(unrelated.status, 2)
  assert.equal(unrelated.stdout, '')
  assert.match(unrelated.stderr, /unknown command 'zzzzqqq'/)
  assert.match(unrelated.stderr, /try: spex help/)
  assert.doesNotMatch(unrelated.stderr, /— try: spex /)
})
