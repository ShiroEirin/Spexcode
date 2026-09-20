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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const bootstrap = join(import.meta.dirname, '..', '..', 'scripts', 'test-home.mjs')
const userHome = resolve(join(homedir(), '.spexcode'))

test('test bootstrap assigns each process a disposable SPEXCODE_HOME outside the user home', () => {
  const home = process.env.SPEXCODE_HOME
  assert.ok(home, 'the test bootstrap must set SPEXCODE_HOME')
  assert.notEqual(resolve(home), userHome)
  assert.ok(resolve(home).startsWith(join(resolve(tmpdir()), 'spexcode-test-home-')))
  assert.match(process.env.NODE_OPTIONS || '', /--import=file:.*scripts\/test-home\.mjs/)
})

test('test bootstrap propagates a disposable home to Node children and preserves explicit fixture homes', () => {
  const env = { ...process.env }
  const inherited = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.SPEXCODE_HOME)'], {
    encoding: 'utf8', env,
  })
  assert.equal(inherited.status, 0, inherited.stderr)
  assert.equal(inherited.stdout, process.env.SPEXCODE_HOME)

  delete env.SPEXCODE_HOME
  const probe = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.SPEXCODE_HOME)'], {
    encoding: 'utf8', env,
  })
  assert.equal(probe.status, 0, probe.stderr)
  const disposableHome = probe.stdout.trim()
  assert.ok(disposableHome, 'the probe must report its assigned test home')
  assert.equal(existsSync(disposableHome), false, 'the bootstrap must remove its test home at process exit')

  const fixtureUserHome = mkdtempSync(join(tmpdir(), 'spex-explicit-test-user-'))
  const fixtureHome = join(fixtureUserHome, '.spexcode')
  try {
    const explicit = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.SPEXCODE_HOME)'], {
      encoding: 'utf8', env: { ...env, HOME: fixtureUserHome, SPEXCODE_HOME: fixtureHome },
    })
    assert.equal(explicit.status, 0, explicit.stderr)
    assert.equal(explicit.stdout, fixtureHome)
  } finally {
    sweepTemp(fixtureUserHome)
  }
})

test('test bootstrap rejects the real home', () => {
  const env = { ...process.env }
  const unsafe = spawnSync(process.execPath, ['--import', bootstrap, '--eval', ''], {
    encoding: 'utf8', env: { ...env, SPEXCODE_HOME: userHome },
  })
  assert.notEqual(unsafe.status, 0)
  assert.match(unsafe.stderr, /Refusing to run tests with SPEXCODE_HOME pointed at the user home/)
})

test('test bootstrap redirects CODEX_HOME into the disposable home and never at the user codex home', () => {
  const codexHome = process.env.CODEX_HOME
  assert.ok(codexHome, 'the test bootstrap must set CODEX_HOME')
  assert.notEqual(resolve(codexHome), resolve(join(homedir(), '.codex')))
  assert.equal(resolve(codexHome), resolve(join(process.env.SPEXCODE_HOME!, 'codex-home')), 'the codex home lives inside the disposable SpexCode home and dies with it')
  assert.ok(existsSync(codexHome), 'the disposable codex home exists so a trust write never has to create the user path')

  const env = { ...process.env }
  const inherited = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.CODEX_HOME)'], { encoding: 'utf8', env })
  assert.equal(inherited.status, 0, inherited.stderr)
  assert.equal(inherited.stdout, codexHome, 'a Node child keeps the parent test process disposable codex home')

  delete env.SPEXCODE_HOME
  delete env.CODEX_HOME
  const probe = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.CODEX_HOME)'], { encoding: 'utf8', env })
  assert.equal(probe.status, 0, probe.stderr)
  assert.ok(probe.stdout.startsWith(join(resolve(tmpdir()), 'spexcode-test-home-')), `a fresh process gets its own disposable codex home: ${probe.stdout}`)
  assert.equal(existsSync(probe.stdout), false, 'the disposable codex home is removed with the test home at process exit')

  const fixtureCodexHome = mkdtempSync(join(tmpdir(), 'spex-explicit-codex-home-'))
  try {
    const explicit = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.CODEX_HOME)'], { encoding: 'utf8', env: { ...env, CODEX_HOME: fixtureCodexHome } })
    assert.equal(explicit.status, 0, explicit.stderr)
    assert.equal(explicit.stdout, fixtureCodexHome, 'an explicit fixture codex home keeps control')
  } finally {
    sweepTemp(fixtureCodexHome)
  }

  const unsafe = spawnSync(process.execPath, ['--import', bootstrap, '--eval', ''], {
    encoding: 'utf8', env: { ...env, CODEX_HOME: join(homedir(), '.codex') },
  })
  assert.notEqual(unsafe.status, 0)
  assert.match(unsafe.stderr, /Refusing to run tests with CODEX_HOME pointed at the user codex home/)
})

// [[test-home-isolation]] — the bootstrap must clear the environment the HOSTING harness stamped into the
// runner. A session identity is the loud half (a fixture reading it sees a foreign session and asserts against
// a value it never wrote); a harness that also exports its workspace is the quiet half. The bootstrap keeps a
// COPY of the adapter's declarations because it has to load before any TypeScript loader is guaranteed, so this
// test reads the adapter source and fails the moment the two drift — a harness added with a new sessionEnvVar
// or scrub cannot be forgotten here.
test('the bootstrap strips every harness identity and scrub the adapters declare', () => {
  const adapter = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'spec-core', 'src', 'harness-identity.ts'), 'utf8')
  const identities = [...adapter.matchAll(/sessionEnvVar: '([A-Z0-9_]+)'/g)].map((m) => m[1])
  const scrubs = [...adapter.matchAll(/sessionEnvScrubs: \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]))
  assert.ok(identities.length > 0, 'the adapter declarations must be readable; a silent zero would pass every check below')

  const source = readFileSync(bootstrap, 'utf8')
  const listed = new Set([...source.matchAll(/^\s+'([A-Z0-9_]+)',$/gm)].map((m) => m[1]))
  for (const name of [...identities, ...scrubs, 'SPEXCODE_SESSION_ID']) {
    assert.ok(listed.has(name), `the bootstrap must clear ${name} — the harness it runs under exports it`)
  }

  // The strip runs ONCE, in the outermost process: this module also loads inside every child a fixture spawns
  // (NODE_OPTIONS propagates it), and a child handed a session identity ON PURPOSE must keep it.
  assert.match(source, /if \(!inheritedTestHome\)/, 'the strip must be gated on being the outermost bootstrap')
})
