// Real-browser proof for the New issue composer’s explicit session delivery door ([[issues-view]]).
// The fixture owns its backend, issue store, session runtime, and Chromium page so the two create paths can be
// compared without relying on another checkout’s board state.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = join(root, 'spec-dashboard')
const tsxCli = [join(root, 'node_modules'), join(cliRoot, 'node_modules')]
  .map((dir) => join(dir, 'tsx', 'dist', 'cli.mjs')).find((path) => existsSync(path))
if (!tsxCli) throw new Error('tsx is missing')
const modules = [join(dashboardRoot, 'node_modules'), join(root, 'node_modules')]
  .find((dir) => existsSync(join(dir, 'vite', 'package.json')))
if (!modules) throw new Error('vite is missing')
const fakeLauncher = join(cliRoot, 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => (error ? reject(error) : resolvePort(port)))
  })
})
const waitFor = async (read, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((done) => setTimeout(done, 150))
  }
  throw new Error(`timed out waiting for ${label}`)
}
const stop = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([once(child, 'exit').then(() => true), new Promise((done) => setTimeout(() => done(false), 3_000))])
  if (!exited && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit') }
}

const fixture = mkdtempSync(join(tmpdir(), 'spex-new-issue-send-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-new-issue-send-${process.pid}`
const baseEnv = { ...process.env }
for (const key of ['PORT', 'SPEXCODE_API_URL', 'SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete baseEnv[key]
let backend
let vite
let browser
const out = resolve(process.env.OUT || `/tmp/new-issue-send-to-e2e-${process.pid}`)
mkdirSync(out, { recursive: true })

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n\n# fixture\n')
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: project })

  const apiPort = await freePort()
  const uiPort = await freePort()
  const api = `http://127.0.0.1:${apiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...baseEnv, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, FAKE_HARNESS_INTERVAL_MS: '200' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot, configFile: false, logLevel: 'warn', plugins: [react()],
    resolve: { alias: {
      react: join(modules, 'react'), 'react-dom': join(modules, 'react-dom'), '@xyflow/react': join(modules, '@xyflow', 'react'),
      katex: join(modules, 'katex'), 'markdown-it': join(modules, 'markdown-it'), '@xterm/xterm': join(modules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'),
    } },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, fs: { strict: false }, proxy: { '/api': { target: api, ws: true } } },
  })
  await vite.listen()
  const ui = `http://127.0.0.1:${uiPort}`

  const created = await fetch(`${api}/api/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'new issue delivery fixture', launcher: 'fake' }),
  })
  const session = await created.json()
  assert.equal(created.status, 201, JSON.stringify(session))
  await waitFor(async () => {
    const row = await fetch(`${api}/api/sessions/${session.id}`).then((response) => response.json())
    return row.liveness === 'online' ? row : null
  }, 'target session online')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(`console: ${message.text()}`) })
  await page.goto(`${ui}/#/issues/new`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.fv-new-page')
  const concern = `new issue handoff ${Date.now()}`
  const description = `handoff description ${Date.now()} @${session.id}`
  await page.fill('.fv-new-title', concern)
  await page.fill('.fv-new-compose .fv-textarea', description)
  const sendDoor = page.locator('.fv-new-actions .fv-send-to:visible').first()
  await sendDoor.waitFor({ state: 'visible' })
  const doorState = await sendDoor.evaluate((button) => ({ disabled: button.disabled, text: button.textContent, body: document.querySelector('.fv-new-compose .fv-textarea')?.value, title: document.querySelector('.fv-new-title')?.value }))
  console.log(`send door: ${JSON.stringify(doorState)}`)
  await sendDoor.waitFor({ state: 'attached' })
  assert.equal(await sendDoor.isEnabled(), true, JSON.stringify(doorState))
  const request = page.waitForRequest((candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/issues', { timeout: 5_000 })
  const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/issues' && candidate.status() === 201, { timeout: 5_000 })
  await sendDoor.evaluate((button) => button.click())
  const issueRequest = await request.catch((error) => { throw new Error(`${error.message}; page errors: ${errors.join(' | ')}`) })
  const issueCreated = await (await response).json()
  const issueBody = await issueRequest.postDataJSON()
  assert.deepEqual(issueBody.deliverTo, [session.id])
  const issueResult = await (await fetch(`${api}/api/issues?q=is:issue%20state:open&page=1`)).json()
  const createdIssue = issueResult.items.find((item) => item.concern === concern)
  assert.ok(createdIssue, `created issue missing: ${JSON.stringify(issueResult.items)}`)
  await page.waitForFunction(() => /^#\/issues\/.+/.test(location.hash) && location.hash !== '#/issues/new')
  const timeline = () => fetch(`${api}/api/sessions/${session.id}/timeline?limit=200`, { cache: 'no-store' }).then((r) => r.json())
  await waitFor(async () => (await timeline()).events.some((event) => event.kind === 'sent' && String(event.text).includes(concern) && String(event.text).includes(description)) ? true : null, 'target timeline delivery')
  const delivered = await timeline()
  assert.match(String(delivered.events.find((event) => event.kind === 'sent' && String(event.text).includes(concern))?.text), /opened a new issue/)
  assert.match(String(issueCreated.outcomes || ''), /sent to @/)
  await page.screenshot({ path: join(out, 'handoff-detail.png'), fullPage: false })

  await page.goto(`${ui}/#/issues/new`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.fv-new-page')
  const ordinaryConcern = `ordinary create ${Date.now()}`
  const ordinaryDescription = `ordinary description ${Date.now()} @${session.id}`
  await page.fill('.fv-new-title', ordinaryConcern)
  await page.fill('.fv-new-compose .fv-textarea', ordinaryDescription)
  const ordinaryState = await page.locator('.fv-post:visible').evaluate((button) => ({ disabled: button.disabled, title: document.querySelector('.fv-new-title')?.value }))
  console.log(`ordinary button: ${JSON.stringify(ordinaryState)}`)
  assert.equal(ordinaryState.disabled, false, JSON.stringify(ordinaryState))
  const before = (await timeline()).events.length
  const ordinaryRequest = page.waitForRequest((candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/issues')
  await page.locator('.fv-post:visible').evaluate((button) => button.click())
  const ordinaryBody = await (await ordinaryRequest).postDataJSON()
  assert.equal('deliverTo' in ordinaryBody, false)
  await page.waitForFunction(() => /^#\/issues\/.+/.test(location.hash) && location.hash !== '#/issues/new')
  await new Promise((done) => setTimeout(done, 400))
  const after = await timeline()
  assert.equal(after.events.length, before)
  assert.equal(errors.length, 0, errors.join(' | '))
  await page.screenshot({ path: join(out, 'ordinary-create-detail.png'), fullPage: false })
  const report = { ok: true, issue: createdIssue.id, target: session.id, delivered: true, ordinaryCreateNoDelivery: true, outcomes: issueCreated.outcomes, errors }
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report))
} finally {
  await browser?.close().catch(() => {})
  await vite?.close().catch(() => {})
  await stop(backend)
  rmSync(fixture, { recursive: true, force: true })
}
