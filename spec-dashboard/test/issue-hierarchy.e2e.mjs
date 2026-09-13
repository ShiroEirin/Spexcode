// issue-hierarchy.e2e.mjs — the [[issues-view]] sub-issue tree, driven through the real dashboard against a
// SEEDED DISPOSABLE project (never the live store): BASE is the dashboard origin (its /api proxies the backend).
// The seed is the tree this driver reads by concern:
//   Epic (open) ─ Kid A (open, blocked by Blocker, related to Related note) ─ Grandkid A1 (open)
//              └ Kid B (closed)
//   Old epic (closed) ─ Old kid (closed) · Duplicate report (closed as a duplicate of Epic) · Solo (open)
//   sessions: one bound to Epic, one bound to Kid A
// MODE=after walks the implemented page; MODE=before records what the trunk page shows for the same seed.
// Prints PASS/FAIL lines, writes screenshots and results.json under OUT.
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173'
const MODE = process.env.MODE || 'after'
const OUT = process.env.OUT || '/tmp/issue-hierarchy-e2e'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const api = async (path) => (await fetch(`${BASE}${path}`)).json()
const listAll = async () => {
  for (const q of ['is:issue sub:all', 'is:issue']) {
    const body = await api(`/api/issues?q=${encodeURIComponent(q)}&page=1`)
    if (body.items?.length) return body.items
  }
  return []
}
const issues = await listAll()
const id = (prefix) => {
  const hit = issues.find((i) => i.concern.startsWith(prefix))
  if (!hit) throw new Error(`seed issue "${prefix}" not found`)
  return hit.id
}
const T = {
  epic: id('Epic:'), kidA: id('Kid A:'), kidB: id('Kid B:'), grandkid: id('Grandkid A1:'), blocker: id('Blocker:'),
  note: id('Related note:'), oldEpic: id('Old epic:'), oldKid: id('Old kid:'), dup: id('Duplicate report'), solo: id('Solo issue'),
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

const shot = (name) => page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) })
const go = async (hash) => {
  await page.goto(`${BASE}/${hash}`)
  await page.waitForTimeout(400)
}
const until = async (predicate, timeout = 20_000) => {
  const end = Date.now() + timeout
  for (;;) {
    if (await predicate().catch(() => false)) return true
    if (Date.now() > end) return false
    await page.waitForTimeout(200)
  }
}
const rows = () => page.locator('.lp-rows .lp-row:visible').evaluateAll((els) => els.map((el) => ({
  title: el.querySelector('.rl-row-title-text')?.textContent.trim(),
  depth: Number(el.querySelector('.rl-row-grid')?.dataset.depth || 0),
  aside: el.querySelector('.rl-row-aside')?.textContent.replace(/\s+/g, ' ').trim(),
})))
const listSettled = (q) => until(async () => {
  const body = await page.evaluate(() => document.querySelector('.lp-rows:not([aria-busy])') != null)
  return body && (await page.locator('.lp-rows:visible').count()) > 0 && (q ? decodeURIComponent(await page.evaluate(() => location.hash)).includes(q) : true)
})
const sectionCounts = () => page.locator('.rl-section:visible').evaluateAll((els) => Object.fromEntries(els.map((el) => [
  el.firstElementChild?.textContent.trim(), Number(el.querySelector('.rl-section-count')?.textContent || 0),
])))
const detailSettled = (concern) => until(async () => (await page.locator('.ds-title:visible').first().textContent())?.includes(concern))
const sideSection = (label) => page.locator('.ds-side-sec:visible').filter({ has: page.locator('.ds-side-label', { hasText: new RegExp(`^${label}`) }) })

if (MODE === 'before') {
  await go('#/issues')
  await listSettled()
  await until(async () => (await rows()).length > 0)
  const shown = await rows()
  check('before: default list shows sub-issues as flat rows', shown.some((r) => r.title?.startsWith('Kid A:')), shown.map((r) => r.title).join(' | '))
  await shot('list-default')
  await go(`#/issues/${encodeURIComponent(T.epic)}`)
  await detailSettled('Epic: issue tree page')
  await page.waitForTimeout(600)
  check('before: epic detail has no Sub-issues section', (await page.locator('.fv-subissues:visible').count()) === 0)
  await shot('detail-epic')
  const oldKid = await api(`/api/issues/${encodeURIComponent(T.oldKid)}`)
  check('before: a closed parent drops its closed child to a root', oldKid.parent === null, `parent=${oldKid.parent}`)
  await go(`#/issues?q=${encodeURIComponent('is:issue state:open group:parent')}`)
  await listSettled('group:parent')
  await page.waitForTimeout(800)
  await shot('list-grouped')
} else {
  // — 1. the default list: bare address, matched children folded, the parent's N/M, counts = rows —
  await go('#/issues')
  await listSettled()
  await until(async () => (await rows()).length > 0)
  let shown = await rows()
  const titles = shown.map((r) => r.title)
  check('default address stays bare', (await page.evaluate(() => location.hash)) === '#/issues')
  check('default list folds a sub-issue whose parent matched', titles.includes('Epic: issue tree page') && !titles.includes('Kid A: list grouping') && !titles.includes('Grandkid A1: tree tokens'), titles.join(' | '))
  const epicRow = shown.find((r) => r.title === 'Epic: issue tree page')
  const subCount = await page.locator('.lp-row:visible', { hasText: 'Epic: issue tree page' }).locator('.rl-comments').first().evaluate((el) => ({ text: el.textContent, tip: el.dataset.tip })).catch(() => null)
  check('the parent row carries its closed/total sub-issue count', subCount?.text === '1/2' && subCount.tip === '1 of 2 sub-issues closed', `${JSON.stringify(subCount)} · aside ${epicRow?.aside}`)
  let counts = await sectionCounts()
  check('Open count equals the rows the Open section shows', counts.Open === shown.length, `count ${counts.Open} · rows ${shown.length}`)
  await shot('list-default')

  // — 2. group:parent draws the tree —
  await go(`#/issues?q=${encodeURIComponent('is:issue state:open group:parent')}`)
  await listSettled('group:parent')
  await until(async () => (await rows()).some((r) => r.depth > 0))
  shown = await rows()
  const at = (title) => shown.findIndex((r) => r.title === title)
  check('group:parent nests each matched child under its parent, by depth',
    at('Kid A: list grouping') === at('Epic: issue tree page') + 1 && shown[at('Kid A: list grouping')]?.depth === 1
      && at('Grandkid A1: tree tokens') === at('Kid A: list grouping') + 1 && shown[at('Grandkid A1: tree tokens')]?.depth === 2,
    shown.map((r) => `${'·'.repeat(r.depth)}${r.title}`).join(' | '))
  counts = await sectionCounts()
  check('grouped Open count equals its rows', counts.Open === shown.length, `count ${counts.Open} · rows ${shown.length}`)
  await shot('list-grouped')

  // — 3. the Closed section keeps a closed tree; a closed child of an OPEN parent stands on its own —
  await go(`#/issues?q=${encodeURIComponent('is:issue state:closed group:parent')}`)
  await listSettled('state:closed')
  await until(async () => (await rows()).some((r) => r.title === 'Old kid: shipped child'))
  shown = await rows()
  const closedAt = (title) => shown.findIndex((r) => r.title === title)
  check('a closed parent keeps its closed child in the Closed tree', closedAt('Old kid: shipped child') === closedAt('Old epic: shipped tree') + 1 && shown[closedAt('Old kid: shipped child')].depth === 1,
    shown.map((r) => `${'·'.repeat(r.depth)}${r.title}`).join(' | '))
  check('a closed sub-issue of an open parent still stands in Closed', closedAt('Kid B: detail section') >= 0 && shown[closedAt('Kid B: detail section')].depth === 0)
  counts = await sectionCounts()
  check('grouped Closed count equals its rows', counts.Closed === shown.length, `count ${counts.Closed} · rows ${shown.length}`)
  await shot('list-closed-tree')
  const oldKid = await api(`/api/issues/${encodeURIComponent(T.oldKid)}`)
  check('the wire keeps a closed parent', oldKid.parent === T.oldEpic, `parent=${oldKid.parent}`)

  // — 4. the Filters menu carries both dimensions; a pick is token surgery + a PUSH, Back replays —
  await go('#/issues')
  await listSettled()
  await until(async () => (await rows()).length > 0)
  await page.locator('.rl-secondary-filters-trigger:visible').first().click()
  await page.waitForTimeout(300)
  const groups = await page.locator('.rl-secondary-filters-menu .rl-menu-label').allTextContents()
  check('Filters menu offers Sub-issues and Group', groups.includes('Sub-issues') && groups.includes('Group'), groups.join(' | '))
  await shot('filters-menu')
  await page.locator('.rl-secondary-filters-menu .rl-menu-item', { hasText: 'Under parent' }).click()
  await until(async () => decodeURIComponent(await page.evaluate(() => location.hash)).includes('group:parent'))
  check('picking Under parent writes group:parent into the address', decodeURIComponent(await page.evaluate(() => location.hash)).includes('q=is:issue state:open group:parent'))
  await page.goBack()
  await until(async () => (await page.evaluate(() => location.hash)) === '#/issues')
  check('Back returns to the bare default address', (await page.evaluate(() => location.hash)) === '#/issues')

  // — 5. the fleet strip and the server's fleet: facet are one function: the epic holds its sub-issue's worker —
  let serverState = null
  for (const state of ['need', 'run', 'stopped']) {
    const body = await api(`/api/issues?q=${encodeURIComponent(`is:issue state:open fleet:${state}`)}&page=1`)
    if (body.items.some((i) => i.id === T.epic)) serverState = state
  }
  await listSettled()
  const strip = await page.locator('.lp-row:visible', { hasText: 'Epic: issue tree page' }).locator('.fv-fleet').evaluate((el) => ({ cls: el.className, glyphs: el.querySelectorAll('.fv-fleet-glyph').length })).catch(() => null)
  check('the epic strip holds its own worker and its sub-issue worker', strip?.glyphs === 2, JSON.stringify(strip))
  check('strip tone and server fleet: facet agree', serverState && strip?.cls.includes(`fv-fleet-${serverState}`), `server ${serverState} · strip ${strip?.cls}`)

  // — 6. the epic detail: Sub-issues section, progress, rows, hide completed, the door, relations, fleet, ledger —
  await go(`#/issues/${encodeURIComponent(T.epic)}`)
  await detailSettled('Epic: issue tree page')
  await until(async () => (await page.locator('.fv-subissues:visible').count()) > 0)
  const section = page.locator('.fv-subissues:visible')
  check('Sub-issues shows closed/total', (await section.locator('.fv-subissues-count').textContent()) === '1/2 done')
  const bar = await section.locator('.fv-progress').evaluate((el) => ({ now: el.getAttribute('aria-valuenow'), max: el.getAttribute('aria-valuemax'), width: el.firstElementChild.style.width }))
  check('the progress bar reads 1 of 2', bar.now === '1' && bar.max === '2' && bar.width === '50%', JSON.stringify(bar))
  const kidTitles = () => section.locator('.rl-row-title-text').allTextContents()
  check('the children render as list rows', JSON.stringify(await kidTitles()) === JSON.stringify(['Kid A: list grouping', 'Kid B: detail section']), JSON.stringify(await kidTitles()))
  const door = await sideSection('sub-issues').locator('a.ds-action').getAttribute('href')
  check('+ Sub-issue is a real anchor to the compose page with the parent', decodeURIComponent(door || '') === `#/issues/new?parent=${T.epic}`, door)
  const relationsText = (await sideSection('relations').textContent().catch(() => '')) || ''
  check('the rail lists the duplicate pointing here', relationsText.includes('duplicated by') && relationsText.includes('Duplicate report of the tree page'), relationsText)
  const sessionsLabel = await sideSection('sessions').locator('.ds-side-label').textContent().catch(() => '')
  check('the Sessions rail counts the sub-issue worker too', sessionsLabel === 'sessions · 2', sessionsLabel)
  const ledger = await page.locator('.fv-subissue-link:visible').allTextContents()
  check('each sub-issue opening is a thread ledger row', ledger.some((t) => t.includes('Kid A: list grouping')) && ledger.some((t) => t.includes('Kid B: detail section')), ledger.join(' | '))
  // a close is a row of its own at the child's closedAt, naming no author; Kid A is still open, so it has none
  const epicRead = await api(`/api/issues/${encodeURIComponent(T.epic)}`)
  const subRows = await page.locator('.fv-declaration:visible:has(.fv-subissue-link)').evaluateAll((els) => els.map((el) => ({
    word: el.querySelector('.fv-declaration-word')?.textContent.trim(), by: el.querySelector('.fv-reply-by')?.textContent.trim() ?? null,
    at: el.querySelector('.fv-reply-at')?.textContent.trim(), child: el.querySelector('.fv-subissue-link')?.textContent.trim(),
  })))
  const closeRows = subRows.filter((r) => r.word === 'sub-issue closed')
  const kidBOpened = subRows.findIndex((r) => r.word === 'opened a sub-issue' && r.child.includes('Kid B: detail section'))
  check('a closed sub-issue adds its close as a row at its closedAt, after its opening, with no author',
    closeRows.length === 1 && closeRows[0].child.includes('Kid B: detail section') && closeRows[0].at === epicRead.refs?.[T.kidB]?.closedAt
      && closeRows[0].by === null && kidBOpened >= 0 && subRows.indexOf(closeRows[0]) > kidBOpened,
    JSON.stringify(subRows))
  check('Close issue stays offered with children open or done', (await page.locator('.fv-life-close:visible').count()) === 1)
  await shot('detail-epic')
  await section.locator('button.ds-action', { hasText: 'Hide completed' }).click()
  await page.waitForTimeout(200)
  check('Hide completed drops the closed child row', JSON.stringify(await kidTitles()) === JSON.stringify(['Kid A: list grouping']), JSON.stringify(await kidTitles()))
  check('the switch reads pressed', (await section.locator('button.ds-action', { hasText: 'Hide completed' }).getAttribute('aria-pressed')) === 'true')
  await shot('detail-epic-hide-completed')

  // — 7. Kid A: parent breadcrumb, blocked by (orange), related, its own sub-issue —
  await go(`#/issues/${encodeURIComponent(T.kidA)}`)
  await detailSettled('Kid A: list grouping')
  await until(async () => (await sideSection('parent').count()) > 0)
  const parentLink = sideSection('parent').locator('a.ds-val')
  check('Parent names the epic as a real link', (await parentLink.textContent()) === 'Epic: issue tree page' && decodeURIComponent(await parentLink.getAttribute('href')) === `#/issues/${T.epic}`)
  const rel = await sideSection('relations').locator('a.ds-val').evaluateAll((els) => els.map((el) => ({
    key: el.querySelector('.fv-rel-key')?.textContent, text: el.querySelector('.ds-val-text')?.textContent,
    dot: getComputedStyle(el.querySelector('.fv-originator-dot')).backgroundColor,
  })))
  const orange = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--orange)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c })
  const blockedBy = rel.find((r) => r.key === 'blocked by')
  check('blocked by names the blocker with the orange flag', blockedBy?.text === 'Blocker: backend wire fields' && blockedBy.dot === orange, JSON.stringify(rel))
  check('related names the note', rel.some((r) => r.key === 'related' && r.text === 'Related note: Linear display options'))
  check('Kid A lists its own sub-issue', (await page.locator('.fv-subissues:visible .rl-row-title-text').allTextContents()).includes('Grandkid A1: tree tokens'))
  await shot('detail-kid-a')

  await go(`#/issues/${encodeURIComponent(T.blocker)}`)
  await detailSettled('Blocker: backend wire fields')
  await until(async () => (await sideSection('relations').count()) > 0)
  const blocks = await sideSection('relations').locator('a.ds-val').evaluateAll((els) => els.map((el) => ({ key: el.querySelector('.fv-rel-key')?.textContent, dot: getComputedStyle(el.querySelector('.fv-originator-dot')).backgroundColor })))
  const red = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--red)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c })
  check('blocks wears the red flag', blocks.some((r) => r.key === 'blocks' && r.dot === red), JSON.stringify(blocks))
  await shot('detail-blocker')

  // — 8. the duplicate banner; 9. a closed child keeps its closed parent —
  await go(`#/issues/${encodeURIComponent(T.dup)}`)
  await detailSettled('Duplicate report of the tree page')
  await until(async () => (await page.locator('.fv-duplicate:visible').count()) > 0)
  const banner = page.locator('.fv-duplicate:visible')
  check('a duplicate opens with the Duplicate of note linking the canonical', (await banner.textContent()).includes('Duplicate of') && decodeURIComponent(await banner.locator('a').getAttribute('href')) === `#/issues/${T.epic}`)
  await shot('detail-duplicate')
  await go(`#/issues/${encodeURIComponent(T.oldKid)}`)
  await detailSettled('Old kid: shipped child')
  await until(async () => (await sideSection('parent').count()) > 0)
  check('a closed child names its closed parent', (await sideSection('parent').locator('.ds-val-text').textContent()) === 'Old epic: shipped tree')
  await shot('detail-closed-child')

  // — 10. the rail door writes nothing; the compose page does, with the parent, and lands back on the parent —
  await go(`#/issues/${encodeURIComponent(T.epic)}`)
  await detailSettled('Epic: issue tree page')
  await until(async () => (await sideSection('sub-issues').locator('a.ds-action').count()) > 0)
  await sideSection('sub-issues').locator('a.ds-action').click()
  await until(async () => (await page.locator('.fv-new-title:visible').count()) > 0)
  check('the door opens the compose page with the parent in the address', decodeURIComponent(await page.evaluate(() => location.hash)) === `#/issues/new?parent=${T.epic}`)
  await until(async () => (await sideSection('parent').locator('.ds-val-text').textContent()) === 'Epic: issue tree page')
  check('the compose rail names the parent', (await sideSection('parent').locator('.ds-val-text').textContent()) === 'Epic: issue tree page')
  const storeChoices = await page.locator('.fv-store-pick:visible select option').allTextContents()
  check('a sub-issue offers only the local store', JSON.stringify(storeChoices) === JSON.stringify(['local']), JSON.stringify(storeChoices))
  await page.locator('.fv-new-title:visible').fill('Kid C: opened through the door')
  await shot('compose-sub-issue')
  await page.locator('.fv-post:visible').click()
  const hash = async () => decodeURIComponent(await page.evaluate(() => location.hash))
  await until(async () => (await hash()) === `#/issues/${T.epic}` && (await page.locator('.fv-subissues-count:visible').textContent()) === '1/3 done')
  check('Create lands back on the parent, whose Sub-issues now count three', (await hash()) === `#/issues/${T.epic}` && (await page.locator('.fv-subissues-count:visible').textContent()) === '1/3 done', await hash())
  const epicAfter = await api(`/api/issues/${encodeURIComponent(T.epic)}`)
  const kidC = Object.values(epicAfter.refs || {}).find((r) => r.concern === 'Kid C: opened through the door')
  const created = kidC ? await api(`/api/issues/${encodeURIComponent(kidC.id)}`) : {}
  check('the new sub-issue hangs under the epic with its nodes', created.parent === T.epic && JSON.stringify(created.nodes) === JSON.stringify(['project']), `parent=${created.parent} nodes=${JSON.stringify(created.nodes)}`)
  await shot('created-sub-issue')
  await page.goBack()
  await page.waitForTimeout(600)
  check('Back from the parent skips the spent compose page', !(await hash()).startsWith('#/issues/new'), await hash())

  // — 11. phone width: the same pages reflow without sideways scroll —
  await page.setViewportSize({ width: 390, height: 844 })
  await go(`#/issues/${encodeURIComponent(T.kidA)}`)
  await detailSettled('Kid A: list grouping')
  await page.waitForTimeout(800)
  const overflowDetail = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('phone: Kid A detail has no horizontal overflow', overflowDetail <= 0, `overflow ${overflowDetail}px`)
  await shot('phone-detail-kid-a')
  await go(`#/issues?q=${encodeURIComponent('is:issue state:open group:parent')}`)
  await listSettled('group:parent')
  await page.waitForTimeout(800)
  const overflowList = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('phone: grouped list has no horizontal overflow', overflowList <= 0, `overflow ${overflowList}px`)
  await shot('phone-list-grouped')
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '))
await browser.close()
writeFileSync(join(OUT, `${MODE}-results.json`), JSON.stringify({ mode: MODE, base: BASE, ids: T, results }, null, 2) + '\n')
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
