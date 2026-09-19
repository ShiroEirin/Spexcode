import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentAlive, hotLivenessRecordEligible, hotSignature, parseLivePanes, needsCodexProcScan, registerHotLivenessCandidate, TMUX_PANE_FORMAT } from './session-liveness.js'
import { sessionStoreDir, sessionArtifactPath } from '@spexcode/spec-core'

// The 100ms hot tier is a launch-registered-pid death detector with a permanent pid-reuse latch, plus the
// single-tmux-call warm parser and the legacy ps-scan gate. See [[state]] (liveness) + the birth registration.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// A launch/receipt registration enters the ownership set immediately; startup recovery is the only full roster
// seed. Poll until the explicit registration appears (or give up) — the LATCH mechanics below then run at once.
async function hotUntil(idSub: string): Promise<string> {
  const deadline = Date.now() + 1400
  for (;;) {
    const sig = await hotSignature()
    if (sig.includes(idSub) || Date.now() > deadline) return sig
    await sleep(60)
  }
}
// write a pid into agent.pid with a DISTINCT, monotonically increasing mtime so agentAlive always sees a
// "relaunch wrote a fresh pid" (mtime change), deterministically resetting the latch — never a coincidental
// same-millisecond mtime that would hide the reset on a coarse-granularity fs.
let mtick = 1000
function writePid(id: string, pid: number): void {
  const p = sessionArtifactPath(id, 'agent.pid')
  writeFileSync(p, String(pid))
  const t = mtick++
  utimesSync(p, t, t)
}
// a pid that is definitely DEAD: a synchronous child that has already exited by the time spawnSync returns.
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
  if (!r.pid) throw new Error('could not spawn a throwaway child for a dead pid')
  return r.pid
}

test('hot registry: alive pid → 1, ESRCH → 0 and LATCHED (pid-reuse guard), a fresh write resets the latch', async () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-hot-'))
  process.env.SPEXCODE_HOME = home
  const id = `hot-latch-${process.pid}`
  try {
    mkdirSync(sessionStoreDir(id), { recursive: true })

    // (1) ALIVE — our own live process pid answers kill-0.
    writePid(id, process.pid)
    registerHotLivenessCandidate(id)
    let sig = await hotUntil(`${id}:1`)
    assert.match(sig, new RegExp(`(^|,)${id}:1(,|\\|)`), `alive → 1 (got ${sig})`)
    assert.ok(sig.includes(`|${id}`) || sig.endsWith(`|${id}`), 'the id set is folded into the fingerprint')

    // (2) DEAD — a spawned-and-exited child's pid reads ESRCH → 0, latched.
    const dead = deadPid()
    writePid(id, dead)
    sig = await hotSignature()
    assert.match(sig, new RegExp(`(^|,)${id}:0(,|\\|)`), `ESRCH → 0 (got ${sig})`)

    // (2b) LATCH — even if that exact pid number is reused by a LIVE process, the (pid,mtime) stays dead: we do
    // NOT rewrite agent.pid, so the same registration must keep reading dead. Simulate reuse by leaving the
    // file untouched (same mtime) — the verdict is frozen regardless of what that pid now maps to.
    sig = await hotSignature()
    assert.match(sig, new RegExp(`(^|,)${id}:0(,|\\|)`), 'a latched-dead registration stays dead on re-poll')

    // (3) RESET — a relaunch REWRITES agent.pid (fresh mtime) with a live pid → the latch clears → 1 again.
    writePid(id, process.pid)
    sig = await hotSignature()
    assert.match(sig, new RegExp(`(^|,)${id}:1(,|\\|)`), `a fresh pid write resets the latch → 1 (got ${sig})`)
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('hot registry: a session with NO agent.pid is skipped (pre-registration → warm tier covers it)', async () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-hot-nopid-'))
  process.env.SPEXCODE_HOME = home
  const id = `hot-nopid-${process.pid}`
  try {
    mkdirSync(sessionStoreDir(id), { recursive: true })   // a store dir, but NO agent.pid file
    // give the 1s id-list refresh a chance, then confirm the id never enters the hot fingerprint.
    await sleep(1100)
    const sig = await hotSignature()
    assert.doesNotMatch(sig, new RegExp(id), 'a pid-less session must not appear in the hot death detector')
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('hot candidates require active owned runtime, never archived history', () => {
  const base = { governed: true, stopped: false, archived: false, status: 'active' as const }
  assert.equal(hotLivenessRecordEligible(base, true), true)
  assert.equal(hotLivenessRecordEligible({ ...base, archived: true }, true), false)
  assert.equal(hotLivenessRecordEligible({ ...base, stopped: true }, true), false)
  assert.equal(hotLivenessRecordEligible({ ...base, status: 'queued' as const }, true), false)
  assert.equal(hotLivenessRecordEligible(base, false), false)
})

test('warm evidence keeps a dead non-hot pane latch until pid rewrite', async () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-hot-warm-latch-'))
  process.env.SPEXCODE_HOME = home
  const id = `warm-latch-${process.pid}`
  try {
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writePid(id, deadPid())
    assert.equal(agentAlive(id), false)
    // This id has no active owned receipt and is therefore absent from the hot candidate set. Warm evidence must
    // not make its ESRCH latch disappear merely because hotSignature() ran.
    await hotSignature()
    assert.equal(agentAlive(id), false)
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('parseLivePanes: one merged list-panes snapshot → id → {panePid, title}, tabs in a title survive', () => {
  const sep = '\\037'
  const out = [
    `sess-a${sep}1234${sep}✳ building the parser`,   // ✳ glyph-led claude title
    `sess-b${sep}5678${sep}bash`,
    `sess-c${sep}9012${sep}title\twith\ttabs`,      // a title containing tabs — kept after the 2nd separator
    `sess-a${sep}4321${sep}SHOULD BE IGNORED`,        // a 2nd pane for sess-a → first pane wins
    `sess-d${sep}0${sep}zero pid`,                    // pid 0 → undefined
  ].join('\n')
  const m = parseLivePanes(out)
  assert.equal(m.get('sess-a')?.panePid, 1234)
  assert.equal(m.get('sess-a')?.title, '✳ building the parser')
  assert.equal(m.get('sess-b')?.panePid, 5678)
  assert.equal(m.get('sess-c')?.title, 'title\twith\ttabs')
  assert.equal(m.get('sess-d')?.panePid, undefined)   // 0 is not a valid pane pid
  assert.equal(m.get('sess-d')?.title, 'zero pid')
  assert.equal(m.size, 4)
})

// The separator we ASK tmux for and the one the parser splits on must be the SAME bytes after tmux has
// printed them. Measured 2026-08-04: tmux 3.6a rewrites a control character in a format string to `_`, while
// 3.4 prints a real 0x1f as the printable escape `\037` — so only a printable separator survives both.
test('the pane snapshot survives the installed tmux: a session name comes back as its own key', () => {
  assert.ok(!/[\x00-\x1f\x7f]/.test(TMUX_PANE_FORMAT),
    `the pane format must carry no control character — tmux >= 3.5 rewrites those to "_": ${JSON.stringify(TMUX_PANE_FORMAT)}`)
  const sock = `spex-panefmt-${process.pid}`
  const name = `panefmt-${process.pid}`
  const tmux = (...args: string[]) => spawnSync('tmux', ['-L', sock, ...args], { encoding: 'utf8' })
  const started = tmux('new-session', '-d', '-s', name, 'sleep 30')
  assert.equal(started.status, 0, `tmux must be available to prove the pane snapshot: ${started.stderr}`)
  try {
    const listed = tmux('list-panes', '-a', '-F', TMUX_PANE_FORMAT)
    assert.equal(listed.status, 0, listed.stderr)
    const probe = parseLivePanes(listed.stdout).get(name)
    assert.ok(probe, `the parser recovers the session name from real tmux output: ${JSON.stringify(listed.stdout)}`)
    assert.ok((probe.panePid ?? 0) > 0, `and its pane pid: ${JSON.stringify(listed.stdout)}`)
  } finally {
    tmux('kill-server')
  }
})

test('needsCodexProcScan: the legacy ps scan fires ONLY for a pid-less codex session', () => {
  assert.equal(needsCodexProcScan([]), false)                                              // no sessions → no scan
  assert.equal(needsCodexProcScan([{ harness: 'claude', hasPid: false }]), false)          // claude never uses the ps walk
  assert.equal(needsCodexProcScan([{ harness: 'codex', hasPid: true }]), false)            // registered codex → hot pid verdict, no scan
  assert.equal(needsCodexProcScan([{ harness: 'codex', hasPid: false }]), true)            // pre-registration codex → legacy scan
  assert.equal(needsCodexProcScan([{ harness: 'codex', hasPid: true }, { harness: 'codex', hasPid: false }]), true)
})
