import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { platformOpener, resolveOpenDashboardUrl } from './open-dashboard.js'

const here = dirname(fileURLToPath(import.meta.url))
const project = realpathSync(join(here, '..', '..'))
const main = realpathSync(dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: project, encoding: 'utf8' }).trim()))

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'cli.ts'), ...args], {
      cwd: project, env: { ...process.env, ...env },
    }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }))
  })
}

test('platform opener spelling is explicit on Linux, macOS, and Windows', () => {
  assert.deepEqual(platformOpener('http://example.test', 'linux'), { command: 'xdg-open', args: ['http://example.test'] })
  assert.deepEqual(platformOpener('http://example.test', 'darwin'), { command: 'open', args: ['http://example.test'] })
  assert.deepEqual(platformOpener('http://example.test', 'win32'), {
    command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', 'http://example.test'],
  })
})

test('spex open prints the scoped URL and invokes xdg-open exactly once', { skip: process.platform !== 'linux' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-open-home-'))
  const bin = join(home, 'bin')
  const capture = join(home, 'opened.txt')
  const instanceId = 'open-dashboard-test'
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/host/identity') res.end(JSON.stringify({ gateway: { instanceId } }))
    else if (req.url === '/projects') res.end(JSON.stringify({ projects: [{ id: 'project-id', root: main }] }))
    else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as import('node:net').AddressInfo).port
  try {
    mkdirSync(bin)
    writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${capture}"\n`)
    chmodSync(join(bin, 'xdg-open'), 0o755)
    writeFileSync(join(home, 'host.json'), JSON.stringify({
      version: 1, url: `http://127.0.0.1:${port}`, pid: process.pid, instanceId, startedAt: new Date().toISOString(),
    }))
    const result = await runCli(['open', 'desktop-deep-link'], {
      SPEXCODE_HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
    })
    const expected = `http://127.0.0.1:${port}/p/project-id/#/spec/desktop-deep-link`
    assert.equal(result.stdout.trim(), expected)
    assert.equal(result.stderr, '')
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && !readFileSync(capture, { encoding: 'utf8', flag: 'a+' }).trim()) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(readFileSync(capture, 'utf8').trim(), expected)

    const printed = await runCli(['open', 'desktop-deep-link', '--print-only'], {
      SPEXCODE_HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
    })
    assert.equal(printed.stdout.trim(), expected)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(readFileSync(capture, 'utf8').trim(), expected, '--print-only starts no second opener')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
})

test('spex open accepts the gateway login redirect when the password is correct', async () => {
  const instanceId = 'locked-open-dashboard-test'
  let projects = 0
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/host/identity') return res.end(JSON.stringify({ gateway: { instanceId } }))
    if (req.url === '/login' && req.method === 'POST') {
      res.statusCode = 302
      res.setHeader('set-cookie', 'spex_admin=valid; Path=/')
      return res.end()
    }
    if (req.url === '/projects') {
      projects++
      if (req.headers.cookie !== 'spex_admin=valid') { res.statusCode = 401; return res.end('{}') }
      return res.end(JSON.stringify({ projects: [{ id: 'project-id', root: main }] }))
    }
    res.statusCode = 404; res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as import('node:net').AddressInfo).port
  try {
    const url = await resolveOpenDashboardUrl('desktop-deep-link', {
      readRecord: () => ({ version: 1, url: `http://127.0.0.1:${port}`, pid: process.pid, instanceId, startedAt: new Date().toISOString() }),
      password: 'correct-password', root: main, specs: [{ id: 'desktop-deep-link' }], sessions: [], cwd: main,
    })
    assert.equal(url, `http://127.0.0.1:${port}/p/project-id/#/spec/desktop-deep-link`)
    assert.equal(projects, 2, 'the catalog is retried once after the login redirect')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('spex open keeps authentication failures distinct from an unreachable gateway', async () => {
  const record = { version: 1, url: 'http://gateway.test', pid: process.pid, instanceId: 'auth-diagnosis', startedAt: new Date().toISOString() }
  const fetchFn: typeof fetch = async (url) => {
    const path = new URL(String(url)).pathname
    if (path === '/host/identity') return new Response(JSON.stringify({ gateway: { instanceId: record.instanceId } }), { status: 200 })
    if (path === '/projects') return new Response('{}', { status: 401 })
    if (path === '/login') return new Response('{}', { status: 401 })
    return new Response('{}', { status: 404 })
  }
  const options = { readRecord: () => record, fetch: fetchFn, root: main, specs: [{ id: 'desktop-deep-link' }], sessions: [], cwd: main }
  await assert.rejects(() => resolveOpenDashboardUrl('desktop-deep-link', options), /requires authentication.*SPEXCODE_PASSWORD/)
  await assert.rejects(() => resolveOpenDashboardUrl('desktop-deep-link', { ...options, password: 'wrong' }), /rejected the supplied password \(HTTP 401\)/)
})
