// Real-browser proof for [[widgets]]' one host in its two homes ([[issue-binding]]). A session puts a three-way
// widget and points at it twice: from its conversation (a declaration note) and from an issue thread (a reply).
// The human answers in the conversation first, then in the issue thread. Everything is isolated: its own
// SPEXCODE_HOME, fake launcher, tmux socket, backend and Vite.
//
//   EXPECT=fixed  both homes draft, send and commit — the thread's send replies, reaches the owner, and commits
//                 the state to the owner; a pending widget block alone enables the composer's send.
//   EXPECT=bug    the reproduction on a tree without the shared host: the thread draws the widget, restores its
//                 committed state, and a click in it reaches nothing.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXPECT = process.env.EXPECT || 'fixed'
if (!['fixed', 'bug'].includes(EXPECT)) throw new Error(`EXPECT must be 'fixed' or 'bug', got '${EXPECT}'`)
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = join(root, 'spec-dashboard')
const tsxCli = [join(root, 'node_modules'), join(cliRoot, 'node_modules')]
  .map((dir) => join(dir, 'tsx', 'dist', 'cli.mjs')).find((path) => existsSync(path))
if (!tsxCli) throw new Error('tsx is missing: no node_modules/tsx beside the repo or spec-cli')
const modules = [join(dashboardRoot, 'node_modules'), join(root, 'node_modules')]
  .find((dir) => existsSync(join(dir, 'vite', 'package.json')))
if (!modules) throw new Error('vite is missing: no node_modules holding vite beside the dashboard or the repo')
const fakeLauncher = join(cliRoot, 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || `/tmp/issue-thread-widget-e2e-${EXPECT}`)
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

// the dispatched shell running this script carries its OWN backend and session identity; none of it may leak in
const baseEnv = { ...process.env }
for (const key of ['PORT', 'SPEXCODE_API_URL', 'SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete baseEnv[key]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-issue-thread-widget-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-issue-widget-${process.pid}`
const observed = { expect: EXPECT, conversation: {}, thread: {}, pageErrors: [] }
let backend
let vite
let browser
let backendLog = ''

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n\n# fixture\n\nfixture\n')
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
    // a slower tick keeps the fake harness's echo of a delivered message on its screen long enough to read
    env: { ...baseEnv, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, FAKE_HARNESS_INTERVAL_MS: '200' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout.on('data', (chunk) => { backendLog += chunk })
  backend.stderr.on('data', (chunk) => { backendLog += chunk })
  try {
    await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')
  } catch (error) {
    throw new Error(`${error.message}\n${backendLog}`)
  }

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot,
    configFile: false,
    logLevel: 'warn',
    plugins: [react()],
    resolve: { alias: {
      react: join(modules, 'react'), 'react-dom': join(modules, 'react-dom'), '@xyflow/react': join(modules, '@xyflow', 'react'),
      katex: join(modules, 'katex'), 'markdown-it': join(modules, 'markdown-it'), '@xterm/xterm': join(modules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'),
    } },
    // the tree under test may sit outside the checkout its node_modules link into
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, fs: { strict: false }, proxy: { '/api': { target: api, ws: true } } },
  })
  await vite.listen()
  const ui = `http://127.0.0.1:${uiPort}`

  // the product CLI of the tree under test, run as the session would run it
  const cli = (args, { session, cwd, input } = {}) => execFileSync(process.execPath, [tsxCli, join(cliRoot, 'src', 'cli.ts'), ...args], {
    cwd: cwd || project, input, encoding: 'utf8',
    env: { ...baseEnv, SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, SPEXCODE_API_URL: api, ...(session ? { SPEXCODE_SESSION_ID: session } : {}) },
  }).trim()

  const issueResponse = await fetch(`${api}/api/issues`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ concern: 'Pick a plan for the widget host', body: 'The worker needs one decision.', store: 'local' }),
  })
  const issue = await issueResponse.json()
  assert.equal(issueResponse.status, 201, JSON.stringify(issue))
  const created = await fetch(`${api}/api/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'widget host fixture worker', launcher: 'fake', issue: issue.id }),
  })
  const { id: owner, ...createBody } = await created.json()
  assert.equal(created.status, 201, JSON.stringify(createBody))
  const ownerRow = await waitFor(async () => {
    const session = await fetch(`${api}/api/sessions/${owner}`).then((response) => response.json())
    return session.liveness === 'online' ? session : null
  }, 'owner session online')
  const as = { session: owner, cwd: ownerRow.path }

  const widgetFile = join(fixture, 'plan.html')
  writeFileSync(widgetFile, `<div class="opts"><button data-v="A">Plan A</button><button data-v="B">Plan B</button><button data-v="C">Plan C</button></div>
<style>.opts{display:flex;gap:6px;padding:6px}
button{font:inherit;padding:4px 10px;border:1px solid var(--line);background:var(--raised);color:var(--fg);border-radius:4px;cursor:pointer}
button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent)}</style>
<script>
  const ui = window.spex || { state: null, draft() {} }
  let current = ui.state?.choice || null
  const paint = () => { for (const b of document.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === current)) }
  for (const b of document.querySelectorAll('button')) b.onclick = () => {
    current = b.dataset.v
    ui.draft('I choose Plan ' + current, { choice: current })
    paint()
  }
  paint()
</script>
`)
  cli(['session', 'widget', 'put', 'plan', widgetFile], as)
  cli(['session', 'ask', '--note', 'Which plan should I build? [[widget:plan]]'], as)
  cli(['issue', 'reply', issue.id, '--body', '-'], { ...as, input: 'Three plans — pick one right here. [[widget:plan]]' })

  const committedChoice = () => JSON.parse(cli(['session', 'widget', 'show', 'plan'], as)).state?.choice ?? null
  const ownerReceived = (needle) => async () => {
    const timeline = await fetch(`${api}/api/sessions/${owner}/timeline?limit=200`, { cache: 'no-store' }).then((response) => response.json())
    return (timeline.events || []).some((event) => event.kind === 'sent' && String(event.text).includes(needle))
  }

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  observed.httpFailures = []
  page.on('pageerror', (error) => observed.pageErrors.push(String(error)))
  // a failed load is recorded with its address (the console line carries none); the rest of the console is kept
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) observed.pageErrors.push(`console: ${message.text()}`) })
  page.on('response', (response) => { if (response.status() >= 400) observed.httpFailures.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`) })

  // ---- home 1: the conversation (phone shell, where the session view IS the conversation) ----
  await page.goto(`${ui}/#/sessions/${owner}`, { waitUntil: 'domcontentloaded' })
  const convFrame = '.m-timeline:visible .wg-frame'
  await page.locator(convFrame).waitFor({ state: 'visible', timeout: 30_000 })
  await page.frameLocator(convFrame).locator('button[data-v="A"]').click()
  const convBlock = page.locator('.m-composer:visible .m-widget-draft')
  await convBlock.waitFor({ state: 'visible', timeout: 10_000 })
  observed.conversation.draftText = (await convBlock.textContent()).trim()
  observed.conversation.composerSendEnabled = !(await page.locator('.m-composer:visible .m-send').isDisabled())
  await page.screenshot({ path: join(out, `${EXPECT}-conversation-draft.png`) })
  // the frame's own send presses the human's send from a closer place
  await page.locator('.m-timeline:visible .wg .wg-actions .wg-btn').first().click()
  observed.conversation.committed = await waitFor(async () => (committedChoice() === 'A' ? 'A' : null), 'conversation send committing A')
  observed.conversation.ownerReceived = await waitFor(ownerReceived('I choose Plan A'), 'owner timeline receiving the conversation send')
  await convBlock.waitFor({ state: 'hidden', timeout: 10_000 })
  await page.screenshot({ path: join(out, `${EXPECT}-conversation-sent.png`) })

  // ---- home 2: the issue thread (desktop) ----
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.goto(`${ui}/#/issues/${issue.id}`, { waitUntil: 'domcontentloaded' })
  const threadFrame = '.fv-reply .wg-frame'
  await page.locator(threadFrame).waitFor({ state: 'visible', timeout: 30_000 })
  const pressed = page.frameLocator(threadFrame).locator('button[aria-pressed="true"]')
  await pressed.waitFor({ state: 'attached', timeout: 10_000 })
  observed.thread.restored = await pressed.getAttribute('data-v')
  await page.frameLocator(threadFrame).locator('button[data-v="B"]').click()
  const threadBlock = page.locator('.fv-compose .m-widget-draft')
  observed.thread.draftAppeared = await threadBlock.waitFor({ state: 'visible', timeout: EXPECT === 'bug' ? 4_000 : 10_000 }).then(() => true, () => false)
  observed.thread.sendEnabled = !(await page.locator('.fv-compose .fv-send').isDisabled())
  await page.screenshot({ path: join(out, `${EXPECT}-thread-click.png`) })
  if (observed.thread.draftAppeared) {
    observed.thread.draftText = (await threadBlock.textContent()).trim()
    const replyWrite = page.waitForResponse((response) => response.url().includes('/reply') && response.request().method() === 'POST', { timeout: 60_000 })
    const pressedAt = Date.now()
    await page.locator('.fv-compose .fv-send').click()
    const replyResponse = await replyWrite
    observed.thread.replyWrite = { ms: Date.now() - pressedAt, status: replyResponse.status(), request: replyResponse.request().postDataJSON(), body: await replyResponse.json() }
    await page.locator('.fv-reply', { hasText: 'I choose Plan B' }).waitFor({ state: 'visible', timeout: 20_000 })
    observed.thread.replyLanded = true
    observed.thread.committed = await waitFor(async () => (committedChoice() === 'B' ? 'B' : null), 'thread send committing B')
    observed.thread.ownerReceived = await waitFor(ownerReceived('I choose Plan B'), 'owner timeline receiving the thread reply')
    // accepted at the queue is not yet handed over: the owner's harness must actually be given the reply
    observed.thread.ownerPaneEcho = await waitFor(async () => {
      const pane = await fetch(`${api}/api/sessions/${owner}/capture`).then((response) => response.text())
      return pane.replace(/\r?\n/g, '').includes('I choose Plan B') || null
    }, 'the owner harness echoing the delivered reply')
    await threadBlock.waitFor({ state: 'hidden', timeout: 10_000 }).catch(async (error) => {
      observed.thread.composerAfterSend = await page.locator('.fv-compose').innerText()
      await page.screenshot({ path: join(out, `${EXPECT}-thread-block-stuck.png`) })
      throw error
    })
    observed.thread.threadReplies = await page.locator('.fv-reply').count()
    await page.screenshot({ path: join(out, `${EXPECT}-thread-sent.png`) })
  } else {
    observed.thread.committedAfterClick = committedChoice()
  }
  await browser.close()
  browser = null
  writeFileSync(join(out, 'result.json'), JSON.stringify(observed, null, 2))

  assert.equal(observed.conversation.draftText.includes('I choose Plan A'), true, 'the conversation queues the widget draft')
  assert.equal(observed.conversation.committed, 'A')
  assert.equal(observed.conversation.ownerReceived, true)
  assert.equal(observed.thread.restored, 'A', 'the thread draws the widget from its committed state')
  if (EXPECT === 'fixed') {
    assert.equal(observed.conversation.composerSendEnabled, true, 'a pending block alone makes the conversation sendable')
    assert.equal(observed.thread.draftAppeared, true, 'the thread queues the widget draft above its composer')
    assert.equal(observed.thread.sendEnabled, true, 'a pending block alone makes the thread sendable')
    assert.equal(observed.thread.replyLanded, true)
    // the reply is accepted at the owner's queue, not after its harness takes the message (that held ~18s here)
    assert.ok(observed.thread.replyWrite.ms < 8_000, `the reply write returns without waiting on the owner's handoff: ${observed.thread.replyWrite.ms}ms`)
    assert.equal(observed.thread.committed, 'B', 'the thread send commits the state to the owner')
    assert.equal(observed.thread.ownerReceived, true, 'the thread send reaches the owner')
    assert.equal(observed.thread.ownerPaneEcho, true, "the owner's harness is handed the reply after the write returned")
    assert.deepEqual(observed.pageErrors, [])
    // the writes and reads this flow is made of never fail; unrelated probes of an isolated fixture are only recorded
    assert.deepEqual(observed.httpFailures.filter((line) => /\/api\/(issues|evidence)\b/.test(line)), [])
  } else {
    assert.equal(observed.conversation.composerSendEnabled, false, 'before: a pending block alone left the conversation send disabled')
    assert.equal(observed.thread.draftAppeared, false, 'before: a click in the thread reached nothing')
    assert.equal(observed.thread.committedAfterClick, 'A', 'before: nothing was committed from the thread')
  }
  console.log(JSON.stringify({ ok: true, out, ...observed }))
} catch (error) {
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ...observed, error: String(error?.stack || error), backendLog: backendLog.slice(-4000) }, null, 2))
  throw error
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
