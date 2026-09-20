// @@@ console suppression ([[platform-support]]) - loaded FIRST so the patch is in place before any
// consumer binds child_process; see spec-cli/src/windows-hide-console.ts for why one point covers every
// spawn site. The guard keeps a plain-`node` consumer (no tsx loader, so no TypeScript) working: the
// suppression is a Windows comfort, never a precondition for running the suite.
try {
  await import('../spec-cli/src/windows-hide-console.ts')
} catch { /* no TypeScript loader — skip the suppression, keep the isolation this module exists for */ }
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const userHome = resolve(process.env.SPEXCODE_TEST_USER_HOME || join(homedir(), '.spexcode'))
const inheritedTestHome = process.env.SPEXCODE_TEST_HOME
process.env.SPEXCODE_TEST_USER_HOME = userHome

// The harness that HOSTS this suite stamps its own environment into every process it spawns, and the runner
// inherits all of it. The session identity is the loud half: a fixture that reads it sees a foreign session
// (the runner's) instead of the one it set, so it asserts against a value it never wrote. The quiet half is
// worse — a harness that also exports its WORKSPACE hands a fixture a cwd that is not its own.
//
// Cleared ONCE, in the outermost process, because this module also loads inside every child a fixture spawns
// (NODE_OPTIONS propagates it). A child that was handed a session identity ON PURPOSE must keep it — that is
// how a fixture exercises the agent path — so an unconditional strip would delete the fixture's own input and
// flip its assertion to the human path. \`SPEXCODE_TEST_HOME\` is the existing mark of "an ancestor
// bootstrap already ran": absent here means this IS the entry point.
//
// The list is a COPY of the adapter declarations, not a read of them: the bootstrap must load before any
// TypeScript loader is guaranteed, so importing spec-cli/src/harness-shim.ts breaks a plain-\`node\` caller
// outright. A hand-kept list is normally a defect that fails silently, so spec-cli/src/test-home.test.ts reads
// the adapter source and fails the moment this drifts from the declared identities and scrubs.
if (!inheritedTestHome) {
  const HOST_HARNESS_ENV = [
    'SPEXCODE_SESSION_ID',
    // A declaration of which identities a session's children carry. A runner is not that session.
    'SPEXCODE_SESSION_IDENTITY_VARS',
    'CLAUDE_CODE_SESSION_ID',
    'CODEX_THREAD_ID',
    'OPENCODE_SESSION_ID',
    'PI_SESSION_ID',
    'ZCODE_SESSION_ID',
    'SNOW_SESSION_ID',
    // Snow's non-identity half: the workspace it was launched in, and its own platform tag.
    'SNOW_CWD',
    'SNOW_PLATFORM',
  ]
  for (const key of HOST_HARNESS_ENV) delete process.env[key]
}
// Codex keeps project trust in the user's GLOBAL ~/.codex/config.toml, and the codex adapter writes there on
// every materialize. That file is a second persistent user store, so it gets the same redirect as ~/.spexcode.
const userCodexHome = resolve(process.env.SPEXCODE_TEST_USER_CODEX_HOME || join(homedir(), '.codex'))
const inheritedTestCodexHome = process.env.SPEXCODE_TEST_CODEX_HOME
process.env.SPEXCODE_TEST_USER_CODEX_HOME = userCodexHome

function assertNotUserHome(home) {
  if (resolve(home) === userHome) {
    throw new Error(`Refusing to run tests with SPEXCODE_HOME pointed at the user home: ${userHome}`)
  }
}

const configuredHome = process.env.SPEXCODE_HOME
if (configuredHome) assertNotUserHome(configuredHome)
const configuredCodexHome = process.env.CODEX_HOME
if (configuredCodexHome && resolve(configuredCodexHome) === userCodexHome) {
  throw new Error(`Refusing to run tests with CODEX_HOME pointed at the user codex home: ${userCodexHome}`)
}

const inheritedDefault = configuredHome && inheritedTestHome && resolve(configuredHome) === resolve(inheritedTestHome)
const testWorker = process.execArgv.includes('--test')
if (!configuredHome || (testWorker && inheritedDefault)) {
  const testHome = mkdtempSync(join(tmpdir(), 'spexcode-test-home-'))
  process.env.SPEXCODE_HOME = testHome
  process.env.SPEXCODE_TEST_HOME = testHome
  // A test worker inherits the shell's environment. Pin every session-runtime lookup to the
  // worker's isolated store so a fixture backend can never open the operator's canonical SQLite.
  process.env.SPEX_SESSION_DATABASE_PATH = join(testHome, 'sessions.sqlite')
  delete process.env.SPEX_SESSION_CONFIG
  assertNotUserHome(testHome)
  // An explicit fixture CODEX_HOME keeps control; unset, or inherited from the parent test's disposable home,
  // it moves into this process's own disposable home and dies with it.
  const inheritedDefaultCodexHome = configuredCodexHome && inheritedTestCodexHome && resolve(configuredCodexHome) === resolve(inheritedTestCodexHome)
  if (!configuredCodexHome || inheritedDefaultCodexHome) {
    const codexHome = join(testHome, 'codex-home')
    mkdirSync(codexHome)
    process.env.CODEX_HOME = codexHome
    process.env.SPEXCODE_TEST_CODEX_HOME = codexHome
  }

  process.once('exit', () => {
    try {
      rmSync(testHome, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 })
    } catch (error) {
      console.error(`Failed to remove test SPEXCODE_HOME ${testHome}:`, error)
      process.exitCode = 1
    }
  })
}

const preload = `--import=${import.meta.url}`
if (!process.env.NODE_OPTIONS?.includes(preload)) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} ${preload}`.trim()
}
