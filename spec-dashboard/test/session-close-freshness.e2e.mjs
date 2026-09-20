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
const cliRoot = resolve(process.env.CLI_ROOT || join(root, 'spec-cli'))
const dashboardRoot = resolve(process.env.DASHBOARD_ROOT || join(root, 'spec-dashboard'))
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')) ? root : sharedRoot
const dependencyModules = join(dependencyRoot, 'node_modules')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-close-freshness-e2e')
const sessionId = 'close-freshness-target'

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 10_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await read()) return
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const stop = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((done) => setTimeout(() => done(false), 3_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-close-freshness-'))
const project = join(fixture, 'project')
const worktree = join(fixture, 'target-worktree')
const home = join(fixture, 'home')
const branch = 'node/close-freshness-target'
const recordDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', sessionId)
const started = Date.now()
const events = []
const step = (label) => events.push({ at: Date.now() - started, step: label })

let backend
let viteServer
let browser
let context
let page
let failure = null
let backendLog = ''
try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), [
    '---', 'title: fixture', 'status: active', 'hue: 180', 'desc: close freshness fixture', '---',
    '# fixture', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fixture: { harness: 'claude', cmd: join(cliRoot, 'test/fixtures/fake-claude') } }, defaultLauncher: 'fixture' },
  }))
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')
  git(project, 'worktree', 'add', '-q', '-b', branch, worktree, 'main')
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(join(recordDir, 'session.json'), JSON.stringify({
    session_id: sessionId, governed: true, worktree_path: worktree, branch,
    title: 'close freshness target', name: '', parent: '', status: 'awaiting', proposal: '',
    merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '',
    stopped: true, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture', launch_cmd: 'true',
    launch_owner: 'http://fixture.invalid', create_request_id: '', create_payload_hash: '', launch_readiness_pending: null,
  }, null, 2) + '\n')

  const apiPort = await freePort()
  const uiPort = await freePort()
  const base = `http://127.0.0.1:${uiPort}`
  const fixtureEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SPEXCODE_') && !key.startsWith('SPEX_SESSION_'))),
    SPEXCODE_HOME: home,
    SPEX_SESSION_DATABASE_PATH: join(home, 'sessions.sqlite'),
  }
  execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e',
    `import { configuredSessionApplication } from ${JSON.stringify(pathToFileURL(join(cliRoot, 'src/session-application.ts')).href)};
     const app = configuredSessionApplication();
     app.close();`], { cwd: project, env: fixtureEnv })
  backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: {
      ...fixtureEnv,
      PORT: String(apiPort),
      SPEXCODE_HOME: home,
      SPEX_SESSION_DATABASE_PATH: join(home, 'sessions.sqlite'),
      SPEXCODE_TMUX: `spex-close-freshness-${process.pid}`,
      SPEXCODE_DISABLE_WATCHERS: 'store,worktrees,refs',
      SPEXCODE_BOARD_DEBUG: '1',
      SPEXCODE_API_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout.on('data', (chunk) => { backendLog += String(chunk) })
  backend.stderr.on('data', (chunk) => { backendLog += String(chunk) })
  await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((r) => r.ok).catch(() => false), 'isolated backend')
  const initialGraph = await (await fetch(`http://127.0.0.1:${apiPort}/api/graph`)).json()
  assert.ok(initialGraph.sessions?.some((row) => row.id === sessionId), `fixture session missing: ${JSON.stringify(initialGraph.sessions)}`)

  const { createServer } = await import(pathToFileURL(join(dependencyModules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(dependencyModules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  viteServer = await createServer({
    root: dashboardRoot,
    configFile: false,
    plugins: [react()],
    resolve: { alias: {
      react: join(dependencyModules, 'react'),
      'react-dom': join(dependencyModules, 'react-dom'),
      '@xyflow/react': join(dependencyModules, '@xyflow', 'react'),
      katex: join(dependencyModules, 'katex'),
      'markdown-it': join(dependencyModules, 'markdown-it'),
      '@xterm/xterm': join(dependencyModules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(dependencyModules, '@xterm', 'addon-fit'),
    } },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } } },
  })
  await viteServer.listen()
  await waitFor(() => fetch(base).then((r) => r.ok).catch(() => false), 'isolated dashboard')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
  page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })

  await page.goto(`${base}/#/sessions/${sessionId}`, { waitUntil: 'domcontentloaded' })
  const row = page.locator(`.si-item[data-sid="${sessionId}"]`)
  await row.waitFor({ state: 'visible', timeout: 10_000 })
  await waitFor(() => /graph watcher 'store' disabled/.test(backendLog) && /graph watcher 'worktrees' disabled/.test(backendLog), 'disabled board watchers')
  await page.screenshot({ path: join(out, 'before-close.png'), fullPage: true })
  step('row visible with board watchers disabled')

  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^close$/i }).click()
  const confirm = page.getByRole('dialog')
  await confirm.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(out, 'close-confirm.png'), fullPage: true })
  let releaseClose
  const closeGate = new Promise((resolveGate) => { releaseClose = resolveGate })
  let closeRequests = 0
  await page.route(`**/api/sessions/${sessionId}/close`, async (route) => {
    closeRequests += 1
    await closeGate
    await route.continue()
  })
  const clickAt = Date.now()
  await confirm.locator('.danger').evaluate((button) => { button.click(); button.click() })
  await confirm.waitFor({ state: 'detached', timeout: 1_000 })
  await row.locator('.sess-close-spinner').waitFor({ state: 'visible', timeout: 1_000 })
  step(`dialog released and row feedback visible in ${Date.now() - clickAt}ms`)
  await waitFor(() => closeRequests === 1, 'single close request')
  await row.click({ button: 'right' })
  assert.equal(await page.getByRole('menuitem', { name: 'closing…' }).isDisabled(), true)
  await page.keyboard.press('Escape')
  await page.locator('.si-pill.new').click()
  const composer = page.locator('.composer-textarea:visible').first()
  await composer.fill('keep working while another session closes')
  assert.equal(await composer.inputValue(), 'keep working while another session closes')
  await page.locator('.si-list .dock-toggle').click()
  await page.locator('.si-list').waitFor({ state: 'detached' })
  await page.locator('.dock-toggle:visible').first().click()
  await row.locator('.sess-close-spinner').waitFor({ state: 'visible' })
  await page.locator('.si-list').evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)))
  assert.equal(closeRequests, 1, 'dock remount must not replay the request')
  await page.screenshot({ path: join(out, 'working.png'), fullPage: true })
  await row.click()
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === `/api/sessions/${sessionId}/close` && r.request().method() === 'POST'),
    Promise.resolve().then(releaseClose),
  ])
  assert.equal(response.ok(), true, 'close response must succeed before freshness is measured')
  assert.equal((await response.json()).ok, true)
  const responseAt = Date.now()
  step('close response received')
  await row.waitFor({ state: 'detached', timeout: 2_000 })
  const removedInMs = Date.now() - responseAt
  await page.locator('.tn-notice.success').filter({ hasText: 'close confirmed' }).waitFor({ state: 'visible' })
  await page.screenshot({ path: join(out, 'succeeded.png'), fullPage: true })
  assert.ok(removedInMs <= 2_000, `closed row took ${removedInMs}ms to leave the live dashboard`)
  assert.equal(page.url().split('#')[1], `/sessions/${sessionId}`, 'closing the selected session must keep its routed document')
  const tabTitle = page.locator('.tab-label').filter({ hasText: 'close freshness target' })
  await waitFor(() => tabTitle.count().then((count) => count === 1), 'closed session tab title')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitFor(() => tabTitle.count().then((count) => count === 1), 'persisted closed session tab title after reload')
  await page.locator('.tl-chat:visible [data-footer-state="archived"], .tl-chat:visible [data-footer-state="offline"]').waitFor({ state: 'visible', timeout: 5_000 })
  assert.match(await page.locator('.tl-chat:visible .m-coldline').innerText(), /只读|read[ -]only/i, 'closed session did not become the read-only Conversation')
  assert.ok(browserErrors.every((message) => /404 \(Not Found\)/.test(message)), `unexpected browser errors: ${browserErrors.join('\n')}`)
  await page.screenshot({ path: join(out, 'after-close.png'), fullPage: true })
  step(`row removed from dashboard in ${removedInMs}ms`)

  // Use controlled responses through the full dashboard to exercise otherwise nondeterministic races.
  await context.close()
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => { window.EventSource = class { constructor() { throw new Error('fixture disables SSE') } } })
  page = await context.newPage()
  const batchIds = ['batch-close-a', 'batch-close-b']
  const graph = structuredClone(initialGraph)
  graph.sessions = batchIds.map((id) => ({ ...initialGraph.sessions[0], id, title: id, parent: '' }))
  await page.route('**/api/graph*', (route) => route.fulfill({ json: graph }))
  const requests = []
  let releaseSibling
  const siblingGate = new Promise((resolveGate) => { releaseSibling = resolveGate })
  await page.route('**/api/sessions/*/close', async (route) => {
    const id = route.request().url().split('/').at(-2)
    requests.push(id)
    if (id === batchIds[1]) await siblingGate
    const refused = id === batchIds[0] && requests.filter((value) => value === id).length === 1
    await route.fulfill({ status: refused ? 409 : 200, json: refused ? { ok: false, error: 'active turn fixture' } : { ok: true } })
  })
  await page.goto(`${base}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.locator(`.si-item[data-sid="${batchIds[0]}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'select…' }).click()
  await page.locator(`.si-item[data-sid="${batchIds[1]}"]`).click()
  await page.locator('.si-selbar .danger').click()
  await page.getByRole('dialog').locator('.danger').click()
  await waitFor(() => requests.length === 2, 'both batch requests')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.si-selbar').count(), 0, 'submission releases selection mode immediately')
  await page.getByRole('alert').waitFor({ state: 'visible' })
  assert.match(await page.getByRole('alert').innerText(), /active turn fixture/)
  assert.equal(await page.locator('.sess-close-spinner').count(), 1, 'one failure must not hide the pending sibling')
  await page.screenshot({ path: join(out, 'partial-failure.png'), fullPage: true })
  await page.locator(`.si-item[data-sid="${batchIds[1]}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'select…' }).click()
  await page.locator('.si-selbar .danger').click()
  await page.getByRole('dialog').locator('.danger').click()
  assert.equal(requests.length, 2, 'bulk confirmation must deduplicate an already pending target')
  await page.getByRole('alert').click()
  await page.locator('.tn-notice.success').filter({ hasText: batchIds[0] }).waitFor({ state: 'visible' })
  assert.deepEqual(requests, [batchIds[0], batchIds[1], batchIds[0]], 'retry must not close successful siblings again')
  assert.equal(await page.getByRole('alert').count(), 0, 'retry withdraws the preceding error notification')
  releaseSibling()
  await page.locator('.tn-notice.success').filter({ hasText: batchIds[1] }).waitFor({ state: 'visible' })
  await page.screenshot({ path: join(out, 'batch-succeeded.png'), fullPage: true })
  step('batch releases UI immediately; independent failure, selective retry, and pending sibling settlement passed')
  await page.unroute('**/api/sessions/*/close')
  await page.route('**/api/sessions/*/close', (route) => route.fulfill({ json: {} }))
  await page.locator(`.si-item[data-sid="${batchIds[0]}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'select…' }).click()
  await page.locator('.si-selbar .danger').click()
  assert.equal(await page.getByRole('dialog').getAttribute('aria-label'), 'close 1 selected session?')
  await page.getByRole('dialog').locator('.danger').click()
  await page.getByRole('alert').waitFor({ state: 'visible' })
  assert.match(await page.getByRole('alert').innerText(), /unconfirmed/)
  assert.equal(await page.getByRole('dialog').count(), 0)
  step('single-selection title and HTTP 200 without acknowledgement rejection passed')
  graph.sessions = graph.sessions.filter((session) => session.id !== batchIds[0])
  await page.unroute('**/api/sessions/*/close')
  await page.route('**/api/sessions/*/close', (route) => route.fulfill({ json: { ok: true } }))
  await page.locator(`.si-item[data-sid="${batchIds[1]}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^close$/i }).click()
  await page.getByRole('dialog').locator('.danger').click()
  await page.locator(`.si-item[data-sid="${batchIds[0]}"]`).waitFor({ state: 'detached' })
  await page.getByRole('alert').waitFor({ state: 'detached' })
  step('authoritative board removal withdraws the stale failure and retry callback')

  // Start through the actual composer so the receipt cache is born in this same page and tab.
  await context.close()
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  page = await context.newPage()
  await page.goto(`${base}/#/sessions/new`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-input:visible').fill('hello')
  const [createdResponse] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/sessions' && response.request().method() === 'POST'),
    page.locator('.si-input:visible').press('Enter'),
  ])
  const created = await createdResponse.json()
  assert.equal(createdResponse.status(), 201, JSON.stringify(created))
  const createdRow = page.locator(`.si-item[data-sid="${created.id}"]`)
  await createdRow.waitFor({ state: 'visible', timeout: 15_000 })
  await waitFor(async () => {
    const session = await (await fetch(`http://127.0.0.1:${apiPort}/api/sessions/${created.id}`)).json()
    return session.liveness === 'online'
  }, 'fixture launcher online', 20_000)
  const reply = 'Hello! What would you like to work on?'
  const declaration = await fetch(`http://127.0.0.1:${apiPort}/api/session-runtime/${created.id}/state`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'asking', note: reply }),
  })
  assert.equal(declaration.ok, true)
  await page.locator('.tl-chat:visible').getByText(reply, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
  await page.screenshot({ path: join(out, 'created-replied.png'), fullPage: true })
  await createdRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^close$/i }).click()
  await page.getByRole('dialog').locator('.danger').click()
  await createdRow.waitFor({ state: 'detached', timeout: 20_000 })
  await page.locator('.tl-chat:visible [data-footer-state="archived"]').waitFor({ state: 'visible' })
  const remainingSpinners = await page.locator('.tab-spinner').count()
  const replyCopies = await page.locator('.tl-chat:visible').getByText(reply, { exact: true }).count()
  step(`created→replied→closed in one page: tab spinners=${remainingSpinners}, reply copies=${replyCopies}`)
  await page.screenshot({ path: join(out, 'created-closed.png'), fullPage: true })
  assert.equal(remainingSpinners, 0, 'closed tab must not resurrect its creation receipt')
  assert.equal(replyCopies, 1, 'archive is a terminal marker, not another authored reply')
  const retained = await (await fetch(`http://127.0.0.1:${apiPort}/api/sessions/${created.id}`)).json()
  assert.equal(retained.note, reply, 'record still retains the final reply')
  assert.equal(retained.archived, true)
  assert.equal(existsSync(created.path), false, 'close removed the actual fixture worktree')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat:visible [data-footer-state="archived"]').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.tl-chat:visible').getByText(reply, { exact: true }).count(), 1)
  assert.equal(await page.locator('.tab-spinner').count(), 0)
  step('reload retains one reply, archived state, and no startup spinner')
} catch (error) {
  failure = error
  step(`failure: ${String(error?.message || error)}`)
  if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  const video = page?.video()
  await context?.close().catch(() => {})
  const videoPath = video ? await video.path().catch(() => null) : null
  await browser?.close().catch(() => {})
  await viteServer?.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', `spex-close-freshness-${process.pid}`, 'kill-server'], { stdio: 'ignore' }) } catch { /* fixture server already stopped */ }
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2) + '\n')
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: !failure, error: failure ? String(failure.stack || failure) : null, video: videoPath, backendLog }, null, 2) + '\n')
  rmSync(fixture, { recursive: true, force: true })
}

if (failure) throw failure
console.log(JSON.stringify({ ok: true, out }))
