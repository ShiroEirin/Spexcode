import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

import { fromForge } from './issues.js'
import { loadLocalIssues, openIssue } from './localIssues.js'

test('fromForge preserves platform labels and their display colors on the unified Issue', () => {
  const [issue] = fromForge({
    host: 'gitlab',
    state: {
      issues: [{
        number: 42,
        title: 'Retain platform labels',
        body: '',
        url: 'https://gitlab.example/acme/spex/-/issues/42',
        state: 'open',
        labels: [
          { name: 'bug', color: '#d73a4a', textColor: '#ffffff' },
          { name: 'triage' },
        ],
        author: 'octavia',
        createdAt: '2026-08-09T00:00:00Z',
        comments: [],
      }],
      prs: [],
    },
  }, [])

  assert.deepEqual(issue.labels, [
    { name: 'bug', color: '#d73a4a', textColor: '#ffffff' },
    { name: 'triage' },
  ])
})

test('legacy rejected local issues stay closed in the current two-state lifecycle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-legacy-rejected-'))
  const previous = process.env.SPEXCODE_ISSUES_DIR
  process.env.SPEXCODE_ISSUES_DIR = dir
  try {
    writeFileSync(join(dir, 'old.md'), '---\nconcern: old decision\nby: human\nstatus: rejected\ncreated: 2026-01-01T00:00:00Z\n---\n\nNo action.\n')
    assert.equal(loadLocalIssues()[0]?.status, 'rejected')
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_ISSUES_DIR
    else process.env.SPEXCODE_ISSUES_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})


// The landing merge is authored in a TEMPORARY DETACHED WORKTREE ([[local-issues]] and the merge skill's
// step 4), so the post-merge nudge normally runs where a store write is refused. It must not name a command
// that tree rejects; from the trunk itself nothing changes. `repoRoot()` is resolved once per process, so the
// predicate is only observable across real invocations — the same shape the hook uses.
test('post-merge nudge names `issue open` only where the store would accept it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-nudge-tree-'))
  const trunk = join(dir, 'trunk')
  const linked = join(dir, 'landing')
  const cli = join(import.meta.dirname, 'cli.ts')
  const run = (cwd: string) =>
    execFileSync('npx', ['tsx', cli, 'internal', 'nudge', 'node/demo'], { cwd, encoding: 'utf8' })
  try {
    mkdirSync(trunk, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: trunk })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: trunk })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: trunk })
    mkdirSync(join(trunk, '.spec', 'project'), { recursive: true })
    writeFileSync(join(trunk, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\nScope.\n')
    execFileSync('git', ['add', '-A'], { cwd: trunk })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: trunk })
    execFileSync('git', ['worktree', 'add', '-q', '--detach', linked, 'main'], { cwd: trunk })

    const fromTrunk = run(trunk)
    assert.match(fromTrunk, /spex issue open/, 'the trunk can commit, so it still offers the open')

    const fromLinked = run(linked)
    assert.doesNotMatch(fromLinked, /spex issue open/, 'a tree that refuses the write must not ask for it')
    assert.match(fromLinked, /does NOT work from this tree/)
    assert.match(fromLinked, /spex issue ls/, 'reads still resolve to the trunk, so keep offering the read')
    assert.match(fromLinked, /CLOSE what you finished/, 'the close half is unaffected')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// A minted id keeps the concern's unicode letters and numbers — the characters [[spec-lint]]'s id-format and a
// `[[id]]` link already accept ([[local-issues]]), so a concern in any script gets a readable address.
test('a local issue id keeps the unicode letters and numbers of its concern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-issue-id-'))
  const previous = process.env.SPEXCODE_ISSUES_DIR
  process.env.SPEXCODE_ISSUES_DIR = dir
  const mint = (concern: string) => openIssue(concern, { author: 'test' }).id
  try {
    assert.equal(mint('还没人认领的第二个 issue'), '还没人认领的第二个-issue')
    assert.equal(mint('纯中文 concern 开 local issue 时 id 被 mint 成 issue'), '纯中文-concern-开-local-issue-时-id-被-mint-成-issue')
    assert.equal(mint('Ελληνικά, Ünïcode!'), 'ελληνικά-ünïcode')
    assert.equal(mint('cafe\u0301 menu'), 'caf\u00e9-menu')              // NFC: a combining accent is not a separator
    assert.equal(mint('界'.repeat(47) + '𠀀尾'), '界'.repeat(47) + '𠀀')         // 48 code points: an astral letter stays whole
    assert.equal(mint('!!! ???'), 'issue')                                      // no letter or number at all → `issue`
    assert.equal(mint('——'), 'issue-2')
    assert.equal(mint('New'), 'new-2')                                          // the reserved address word still steps aside
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_ISSUES_DIR
    else process.env.SPEXCODE_ISSUES_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
