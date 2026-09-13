// A MANAGED WATCH NOTICE IS DRAWN AS THE SYSTEM, measured through the real product: an isolated backend and
// dashboard, two fake-launcher sessions, the parent watching the child through the real CLI, the child declaring
// three times through the real CLI. The API must mark exactly those three deliveries `system: "watch"`
// ([[session-timeline]]), and the parent's Conversation in a real Chromium must draw them as one folded run of
// system lines — never as bubbles — while an ordinary peer message stays a bubble ([[conversation]]).
// PHASE=A drives an older dashboard tree (DASHBOARD_ROOT) against the same fixture and records the old path: the
// three notices drawn as bubbles in the person's grammar, nothing folding them.
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
const PHASE = (process.env.PHASE || 'B').toUpperCase()
const dashboardRoot = process.env.DASHBOARD_ROOT ? resolve(process.env.DASHBOARD_ROOT) : join(root, 'spec-dashboard')
const tsxCli = [join(root, 'node_modules'), join(cliRoot, 'node_modules')]
  .map((dir) => join(dir, 'tsx', 'dist', 'cli.mjs')).find((path) => existsSync(path))
if (!tsxCli) throw new Error('tsx is missing: no node_modules/tsx beside the repo or spec-cli')
const modules = [join(dashboardRoot, 'node_modules'), join(root, 'node_modules')]
  .find((dir) => existsSync(join(dir, 'vite', 'package.json')))
if (!modules) throw new Error('vite is missing: no node_modules holding vite beside the dashboard or the repo')
const fakeLauncher = join(cliRoot, 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || `/tmp/watch-notice-system-row-${PHASE.toLowerCase()}`)
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
const waitFor = async (read, label, timeout = 45_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`timed out waiting for ${label}`)
}
const stop = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([once(child, 'exit').then(() => true), new Promise((r) => setTimeout(() => r(false), 3_000))])
  if (!exited && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit') }
}

// STRICT ISOLATION: a shell dispatched by a live backend inherits its address and its session identity, and a
// fixture that kept them would talk to the live store. Nothing SpexCode- or harness-shaped crosses into the fixture.
const cleanEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(SPEXCODE_|SPEX_|CLAUDE_|CODEX_|OPENCODE_|PI_)/.test(key) && key !== 'PORT'))

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-watch-notice-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-watch-notice-${process.pid}`
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
  const fixtureEnv = { ...cleanEnv, SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux }
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project, env: { ...fixtureEnv, PORT: String(apiPort) }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout.on('data', (chunk) => { backendLog += chunk })
  backend.stderr.on('data', (chunk) => { backendLog += chunk })
  const api = `http://127.0.0.1:${apiPort}`
  await waitFor(() => fetch(`${api}/health`).then((r) => r.ok).catch(() => false), 'isolated backend')

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot,
    configFile: false,
    plugins: [react()],
    resolve: { alias: {
      react: join(modules, 'react'), 'react-dom': join(modules, 'react-dom'), '@xyflow/react': join(modules, '@xyflow', 'react'),
      katex: join(modules, 'katex'), 'markdown-it': join(modules, 'markdown-it'), '@xterm/xterm': join(modules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'),
    } },
    // an older dashboard tree outside this checkout still resolves its packages here, so both are servable
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, fs: { allow: [root, dashboardRoot] }, proxy: { '/api': { target: api, ws: true } } },
  })
  await vite.listen()

  const createSession = async (prompt) => {
    const response = await fetch(`${api}/api/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, launcher: 'fake' }),
    })
    const created = await response.json()
    assert.equal(response.status, 201, JSON.stringify(created))
    await waitFor(async () => (await fetch(`${api}/api/sessions/${created.id}`).then((r) => r.json())).liveness === 'online', `${created.id} online`)
    return created.id
  }
  const parent = await createSession('supervise the watched child')
  const child = await createSession('the watched child')

  // the real CLI, as each session would run it: the caller is named by its own session identity. It runs
  // ASYNCHRONOUSLY on purpose — a synchronous child blocks this loop for the seconds tsx takes to start, the
  // backend closes the idle keep-alive socket meanwhile, and the next fetch reuses a socket already shut.
  const cli = (as, ...args) => new Promise((resolveRun, reject) => {
    const run = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'cli.ts'), ...args], {
      cwd: project, env: { ...fixtureEnv, SPEXCODE_API_URL: api, SPEXCODE_SESSION_ID: as }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    run.stdout.on('data', (chunk) => { output += chunk })
    run.stderr.on('data', (chunk) => { output += chunk })
    run.once('error', reject)
    run.once('exit', (code) => code === 0 ? resolveRun(output) : reject(new Error(`spex ${args.join(' ')} (as ${as}) exited ${code}\n${output}`)))
  })
  const timeline = () => fetch(`${api}/api/sessions/${parent}/timeline`).then((r) => r.json())
  const sentOf = (window) => window.events.filter((event) => event.kind === 'sent')

  // the ordinary message goes in first: what this run measures is how each kind is drawn, and a send accepted
  // before the watch handovers does not wait on the parent's delivery queue behind them
  const peerText = 'an ordinary peer message, still a message'
  await cli(child, 'session', 'send', parent, peerText)
  await waitFor(async () => sentOf(await timeline()).some((event) => event.text.includes(peerText)), 'the peer message on the parent timeline')
  const watched = await cli(parent, 'session', 'watch', child)
  const notes = ['which API should the fixture call?', 'parked until the parent answers', 'second question: keep the old route?']
  await cli(child, 'session', 'ask', '--note', notes[0])
  await cli(child, 'session', 'park', '--note', notes[1])
  await cli(child, 'session', 'ask', '--note', notes[2])
  const final = await waitFor(async () => {
    const window = await timeline()
    return sentOf(window).filter((event) => event.system === 'watch').length >= 3 ? window : null
  }, 'three watch notices on the parent timeline')

  // THE WIRE: the mark sits on exactly the three watch deliveries, and on nothing else
  const system = sentOf(final).filter((event) => event.system === 'watch')
  assert.equal(system.length, 3, `exactly three system messages: ${JSON.stringify(sentOf(final))}`)
  for (const [index, note] of notes.entries()) assert.match(system[index].text, new RegExp(`^\\[spex watch\\] ${child} is (asking|parked) — ${note.replace(/[?]/g, '\\?')}$`))
  const unmarked = sentOf(final).filter((event) => event.system !== 'watch')
  assert.ok(unmarked.some((event) => event.text.includes(peerText)), 'the peer message is present and unmarked')
  assert.ok(unmarked.every((event) => !Object.hasOwn(event, 'system')), 'an unmarked message carries no system field at all')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  const readPage = (page) => page.evaluate(() => ({
    folds: [...document.querySelectorAll('.m-ev-notices .m-notice-fold')].map((fold) => ({ text: fold.textContent.trim(), expanded: fold.getAttribute('aria-expanded') })),
    notices: [...document.querySelectorAll('.m-ev-notice')].map((row) => ({
      who: row.querySelector('.m-notice-who')?.textContent ?? null,
      word: row.querySelector('.m-ev-word')?.textContent ?? null,
      color: row.querySelector('.m-notice-state')?.style.color ?? null,
      note: row.querySelector('.m-notice-note')?.textContent ?? null,
    })),
    bubbles: [...document.querySelectorAll('.m-ev-sent, .m-ev-prompt')].map((row) => row.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)),
  }))
  const facts = { phase: PHASE, dashboardRoot, parent, child, watched: watched.trim(), api: { system: system.map((e) => e.text), unmarked: unmarked.map((e) => e.text.slice(0, 80)) }, views: {} }

  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${uiPort}/#/sessions/${parent}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.tl-chat:visible .m-ev-sent', { hasText: peerText }).waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    const folded = await readPage(page)
    if (PHASE === 'A') {
      // THE OLD PATH: each notice is a bubble in the person's grammar, and nothing gathers them
      assert.equal(folded.bubbles.filter((text) => text.includes('[spex watch]')).length, 3, `${name}: before, the three notices are bubbles`)
      assert.equal(folded.folds.length, 0, `${name}: before, nothing folds them`)
      await page.locator('.tl-chat:visible .m-ev-sent', { hasText: '[spex watch]' }).first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(out, `${name}-before.png`) })
      facts.views[name] = { before: folded }
      await context.close()
      continue
    }
    const fold = page.locator('.tl-chat:visible .m-ev-notices .m-notice-fold')
    await fold.waitFor({ state: 'visible', timeout: 30_000 })
    const settled = await readPage(page)
    assert.deepEqual(settled.folds.map((f) => f.expanded), ['false'], `${name}: one folded run`)
    assert.match(settled.folds[0].text, /^3 status notifications/, `${name}: the run counts its three notices`)
    assert.equal(settled.notices.length, 0, `${name}: folded, the run shows its count and no lines`)
    assert.ok(settled.bubbles.every((text) => !text.includes('[spex watch]')), `${name}: no notice is drawn as a bubble: ${JSON.stringify(settled.bubbles)}`)
    assert.ok(settled.bubbles.some((text) => text.includes(peerText)), `${name}: the peer message is still a bubble`)
    await page.screenshot({ path: join(out, `${name}-folded.png`) })

    await fold.click()
    await page.locator('.tl-chat:visible .m-ev-notice').nth(2).waitFor({ state: 'visible', timeout: 5_000 })
    const opened = await readPage(page)
    assert.equal(opened.folds[0].expanded, 'true', `${name}: the fold opens in place`)
    assert.deepEqual(opened.notices.map((n) => n.word), ['asking', 'parked', 'asking'], `${name}: each line carries its state word`)
    assert.deepEqual(opened.notices.map((n) => n.note), notes, `${name}: each line carries its note`)
    assert.ok(opened.notices.every((n) => n.who && n.color), `${name}: each line names the watched session and paints its state`)
    await page.locator('.tl-chat:visible .m-ev-notice').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(out, `${name}-opened.png`) })
    facts.views[name] = { folded: settled, opened }
    await context.close()
  }

  writeFileSync(join(out, 'facts.json'), JSON.stringify(facts, null, 2))
  console.log(JSON.stringify({ ok: true, phase: PHASE, out, parent, child, system: system.length }))
} catch (error) {
  // a failure is read against what the isolated backend said, not guessed at from the assertion alone
  console.error(`--- isolated backend log (tail) ---\n${backendLog.slice(-6000)}`)
  throw error
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
