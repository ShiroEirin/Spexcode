// Product-level proof for [[service-cwd]]: a real `spex serve`, a real terminal WebSocket, a real tmux pane.
// A) the directory the serve was launched from is removed while the served root lives: a session terminal must
//    still attach, the helper's tmux client stands on `/`, and the pane keeps the cwd its session was given.
// B) the served root itself is removed (a linked worktree trashed by close): the serve exits loudly instead of
//    holding the port over a project that is no longer there.
// C) the host gateway's launch directory is removed: its spawned host doctor still runs.
//
// Run: node spec-cli/test/service-cwd.e2e.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const spex = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'spex.mjs')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const base = realpathSync(mkdtempSync(join(tmpdir(), 'spex-service-cwd-')))
const project = join(base, 'project')
const home = join(base, 'home')
const socket = `service-cwd-${process.pid}`
const tmux = (...args) => execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' }).trim()

mkdirSync(project); mkdirSync(home)
git(project, 'init', '-q', '-b', 'main')
git(project, 'config', 'user.name', 'proof'); git(project, 'config', 'user.email', 'proof@example.test')
writeFileSync(join(project, 'README.md'), 'base\n'); git(project, 'add', '.'); git(project, 'commit', '-qm', 'base')

// The directory a live process actually holds — the kernel's answer, not a format string or a cached path.
const processCwd = (pid) => process.platform === 'linux'
  ? readlinkSync(`/proc/${pid}/cwd`)
  : execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).split('\n').find((line) => line.startsWith('n')).slice(1)

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
})

async function waitFor(read, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(100)
  }
}

// verb: ['serve'] probes /health; ['dashboard'] probes the gateway's public identity route.
async function startServe(cwd, verb = ['serve'], probe = '/health') {
  const port = await freePort()
  // A dispatched shell inherits the live backend's PORT and SPEXCODE_API_URL; this instance owns its own.
  const { SPEXCODE_API_URL: _inherited, ...ambient } = process.env
  const env = { ...ambient, PORT: String(port), SPEXCODE_HOME: home, SPEXCODE_TMUX: socket, SPEXCODE_HOST: '127.0.0.1' }
  const proc = spawn(process.execPath, [spex, ...verb, '--port', String(port)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const serve = { proc, port, log: '', exit: null }
  proc.stdout.on('data', (chunk) => { serve.log += String(chunk) })
  proc.stderr.on('data', (chunk) => { serve.log += String(chunk) })
  proc.on('exit', (code, signal) => { serve.exit = { code, signal } })
  await waitFor(async () => {
    if (serve.exit) throw new Error(`${verb[0]} exited during startup (${JSON.stringify(serve.exit)})\n${serve.log}`)
    try { return (await fetch(`http://127.0.0.1:${port}${probe}`)).ok } catch { return false }
  }, `${verb[0]} readiness`)
  return serve
}

async function stopServe(serve) {
  if (!serve.exit) serve.proc.kill('SIGTERM')
  await waitFor(() => serve.exit, 'serve exit', 10_000)
}

// One visible viewer on the real terminal socket. Resolves with everything the browser would have painted.
async function viewTerminal(port, id, ms) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${id}/socket`)
  ws.binaryType = 'arraybuffer'
  let painted = ''
  ws.onmessage = (event) => { if (typeof event.data !== 'string') painted += Buffer.from(event.data).toString('utf8') }
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('terminal WebSocket failed to open')) })
  ws.send(JSON.stringify({ t: 'resize', cols: 100, rows: 30 }))
  await sleep(ms)
  return { painted: () => painted, type: (data) => ws.send(JSON.stringify({ t: 'input', data })), close: () => ws.close() }
}

async function launchDirectoryRemoved() {
  const launchDir = join(project, 'launched-from-here')
  const paneDir = join(base, 'pane-home')
  mkdirSync(launchDir); mkdirSync(paneDir)
  const serve = await startServe(launchDir)
  try {
    const id = 'service-cwd-pane'
    tmux('new-session', '-d', '-s', id, '-x', '100', '-y', '30', '-c', paneDir)
    tmux('send-keys', '-t', id, '-l', 'echo SERVICE-CWD-MARKER')
    tmux('send-keys', '-t', id, 'Enter')
    rmSync(launchDir, { recursive: true })
    assert.ok(!existsSync(launchDir), 'fixture: the launch directory is gone')

    const view = await viewTerminal(serve.port, id, 4000)
    try {
      assert.ok(!view.painted().includes('[SpexCode terminal unavailable]'), `terminal reported unavailable:\n${view.painted().slice(0, 600)}`)
      assert.ok(view.painted().includes('SERVICE-CWD-MARKER'), `terminal never painted the pane:\n${JSON.stringify(view.painted().slice(0, 600))}`)
      const clients = tmux('list-clients', '-t', id, '-F', '#{client_pid}').split('\n').filter(Boolean)
      assert.deepEqual(clients.map(processCwd), ['/'], 'the helper tmux client stands on the filesystem root')
      // Attaching is transport: the pane and its session keep the directory the session was launched with.
      assert.equal(tmux('display-message', '-p', '-t', id, '#{session_path}'), paneDir)
      assert.equal(realpathSync(tmux('display-message', '-p', '-t', id, '#{pane_current_path}')), paneDir)
      // Even a pane the browser's own client creates (prefix + ") opens in the session's directory, not the helper's.
      view.type('\x02"')
      const panes = await waitFor(() => {
        const rows = tmux('list-panes', '-t', id, '-F', '#{pane_current_path}').split('\n').filter(Boolean)
        return rows.length === 2 && rows
      }, 'the split issued through the terminal socket', 5000)
      assert.deepEqual(panes.map((path) => realpathSync(path)), [paneDir, paneDir])
    } finally { view.close() }

    const instance = await (await fetch(`http://127.0.0.1:${serve.port}/api/instance`)).json()
    assert.equal(processCwd(instance.pid), project, 'the backend child stands on the served root')
    console.log('PASS launch-directory-removed: terminal attached after the launch directory was deleted; pane cwd untouched')
  } finally {
    await stopServe(serve)
  }
}

async function servedRootRemoved() {
  const worktree = join(project, '.worktrees', 'doomed')
  git(project, 'worktree', 'add', '-q', '-b', 'node/doomed', worktree, 'main')
  const serve = await startServe(worktree)
  try {
    // What close does to a session worktree: rename into the trash, then delete.
    const trash = join(project, '.worktrees', '.trash')
    mkdirSync(trash, { recursive: true })
    renameSync(worktree, join(trash, 'wt-doomed'))
    rmSync(join(trash, 'wt-doomed'), { recursive: true })
    const exit = await waitFor(() => serve.exit, 'serve to exit after its served root vanished', 15_000)
    assert.notEqual(exit.code, 0, `a serve that lost its root must exit non-zero (${JSON.stringify(exit)})`)
    assert.ok(serve.log.includes(worktree), `the exit names the vanished root:\n${serve.log}`)
    await assert.rejects(fetch(`http://127.0.0.1:${serve.port}/health`), 'the port is released, not held over a dead project')
    console.log(`PASS served-root-removed: serve exited ${exit.code} and released its port, saying:\n  ${serve.log.split('\n').find((line) => line.includes('served root lost'))}`)
  } finally {
    await stopServe(serve)
  }
}

async function gatewayLaunchDirectoryRemoved() {
  const launchDir = join(base, 'gateway-launched-from-here')
  mkdirSync(launchDir)
  const gateway = await startServe(launchDir, ['dashboard'], '/host/identity')
  try {
    rmSync(launchDir, { recursive: true })
    // loopback is the implicit admin scope until a password exists, so this is the real operator request
    const doctor = await (await fetch(`http://127.0.0.1:${gateway.port}/host/doctor`, { method: 'POST' })).json()
    assert.equal(doctor.ok, true, `host doctor could not run after the launch directory was deleted: ${JSON.stringify(doctor).slice(0, 400)}`)
    console.log('PASS gateway-launch-directory-removed: host doctor still runs')
  } finally {
    await stopServe(gateway)
  }
}

let failed = false
for (const scenario of [launchDirectoryRemoved, servedRootRemoved, gatewayLaunchDirectoryRemoved]) {
  try { await scenario() } catch (error) { failed = true; console.error(`FAIL ${scenario.name}: ${error.message}`) }
}
try { tmux('kill-server') } catch { /* no session was created */ }
rmSync(join(process.env.TMUX_TMPDIR || '/tmp', `tmux-${process.getuid()}`, socket), { force: true })
rmSync(base, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
