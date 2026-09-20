import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  snowHookFile, snowHookCommand, SNOW_EVENT_MAP, buildSnowHooks, snowHookType, snowHookTypes, snowPaths,
} from './snow-harness.js'
import { snowHarness } from './harness.js'

// the mechanical layer of [[snow-harness]]: the `.snow/hooks/<hookType>.json` files this adapter writes, the
// command line inside them, and the bridge those commands run — driven against a STUB dispatcher so the
// payload translation and the exit-code protocol are exercised without a Snow install or a materialized tree.

const toPosix = (p: string): string => p.replace(/\\/g, '/')
const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks')
const BRIDGE_SRC = join(HOOKS_DIR, 'snow-bridge.mjs')

// bash is the bridge's one hard dependency (dispatch.sh is pure bash); without it the protocol tests are inert
const hasBash = spawnSync('bash', ['-c', 'exit 0'], { stdio: 'ignore', shell: true }).status === 0

test('snowHookFile: the file name IS the hook type, and the record is {hookType:[{description,hooks:[{…}]}]}', () => {
  const body = snowHookFile('beforeToolCall', '"node" "bridge.mjs" beforeToolCall', 'the gate')
  const parsed = JSON.parse(body) as Record<string, Array<{ description: string; hooks: Array<Record<string, unknown>> }>>
  assert.deepEqual(Object.keys(parsed), ['beforeToolCall'], 'exactly one type per file — the name is the discovery key')
  assert.equal(parsed.beforeToolCall[0].description, 'the gate')
  assert.deepEqual(parsed.beforeToolCall[0].hooks, [
    { type: 'command', command: '"node" "bridge.mjs" beforeToolCall', timeout: 30, enabled: true },
  ])
  assert.ok(body.endsWith('\n'), 'a trailing newline so the file is a clean text artifact')
})

test('snowHookCommand: no env prefix, both paths quoted, the hook type last, and posix separators throughout', () => {
  const cmd = snowHookCommand('C:/pkg/hooks/snow-bridge.mjs', 'C:/pkg/bin/spex.mjs', 'onUserMessage')
  assert.equal(cmd, `"${toPosix(process.execPath)}" "C:/pkg/hooks/snow-bridge.mjs" onUserMessage`)
  // @@@ the two Windows lessons this command encodes: `VAR=value cmd` is POSIX-shell syntax and Snow runs hook
  // commands through cmd.exe, where it is just an argument (node then reads the assignment as a script path);
  // and a backslash path crossing into either shell is an escape character. Neither may reappear.
  assert.ok(!cmd.includes('SPEX='), 'no env prefix — cmd.exe would pass it to node as a script path')
  assert.ok(!/\\/.test(cmd), 'no backslashes: the line is executed by a platform shell')
  assert.ok(cmd.startsWith('"') && cmd.includes('" "') && cmd.endsWith('onUserMessage'), 'both paths quoted, type last')
})

test('SNOW_EVENT_MAP: exactly the five events Snow and SpexCode share, one direction', () => {
  assert.deepEqual(SNOW_EVENT_MAP, {
    SessionStart: 'onSessionStart',
    UserPromptSubmit: 'onUserMessage',
    PreToolUse: 'beforeToolCall',
    PostToolUse: 'afterToolCall',
    Stop: 'onStop',
  })
  assert.deepEqual([...snowHookTypes()].sort(), ['afterToolCall', 'beforeToolCall', 'onSessionStart', 'onStop', 'onUserMessage'])
  assert.equal(snowHookType('PreToolUse'), 'beforeToolCall')
  assert.equal(snowHookType('Notification'), null, 'a Claude event with no Snow counterpart is null, not a guess')
})

test('buildSnowHooks: one file per hook type, keyed by type, plus the per-event command resolver', () => {
  const { files, cmd } = buildSnowHooks('C:/pkg/hooks/snow-bridge.mjs', 'C:/pkg/bin/spex.mjs', Object.keys(SNOW_EVENT_MAP))
  assert.deepEqual(Object.keys(files).sort(), ['afterToolCall', 'beforeToolCall', 'onSessionStart', 'onStop', 'onUserMessage'])
  for (const [type, body] of Object.entries(files)) {
    assert.deepEqual(Object.keys(JSON.parse(body)), [type], `${type}.json carries only its own type`)
    assert.ok(body.includes(type), 'the command names the hook type so the bridge knows which event to synthesize')
  }
  assert.equal(cmd('PreToolUse'), cmd('PreToolUse'), 'stable')
  assert.equal(cmd('Notification'), '', 'no Snow counterpart → empty, never a wrong type')
  assert.ok(files.beforeToolCall.includes('beforeToolCall') && !files.beforeToolCall.includes('onStop'), 'per-type isolation')
})

test('snowPaths + snowHarness surface: the layout is declared once, and the adapter reports it', () => {
  const p = snowPaths('/w')
  assert.deepEqual(p, {
    hooksDir: join('/w', '.snow', 'hooks'),
    skillsDir: join('/w', '.snow', 'skills'),
    commandsDir: join('/w', '.snow', 'commands'),
    agentsDir: join('/w', '.snow', 'agents'),
    contractFile: join('/w', 'AGENTS.md'),
  })

  assert.equal(snowHarness.id, 'snow')
  // @@@ the dispatcher's allowlist is written from dispatchId (materialize.ts), and the hook line must ANNOUNCE
  // the same id — a bridge that borrowed `claude` was rejected by a snow-only tree and every gate silently
  // no-opped. The two sides are one contract.
  assert.equal(snowHarness.dispatchId, 'snow')
  assert.equal(snowHarness.shimFile('/w'), p.hooksDir, 'a DIRECTORY: one file per hook type')
  assert.deepEqual(snowHarness.contractFiles('/w'), [p.contractFile], 'AGENTS.md — Snow does not read CLAUDE.md')
  assert.equal(snowHarness.skillDir('/w'), p.skillsDir)
  assert.equal(snowHarness.commandDir?.('/w'), p.commandsDir, 'the command surface the interface grew a slot for')
  assert.equal(snowHarness.agentDir('/w'), p.agentsDir)
  assert.equal(snowHarness.shimScope, 'tree')
  assert.equal(snowHarness.shimOwnership, 'hook-file-per-type')
  assert.equal(snowHarness.ownsRendezvous, false, 'Snow owns its own process; SpexCode has no transport to it')
  assert.equal(snowHarness.sessionIdArg('rec-1'), '', 'Snow mints its own ids; there is no flag to pin one')
  assert.equal(snowHarness.resumeArg({ session: 'x' }), '', 'no resume surface')
  assert.deepEqual(snowHarness.writeTrust('/w', () => 'x'), [], 'Snow gates hooks by folder trust, not a trust file')
  assert.doesNotThrow(() => snowHarness.removeTrust('/w'))
})

test('shim: the hook line runs snow-bridge.mjs (a node entry), never dispatch.sh (bash), and carries hooks per type', () => {
  const shim = snowHarness.shim('/d/hooks/dispatch.sh', '/s/spex.mjs')
  assert.ok(shim.hooks, 'hook-file-per-type hands materialize one entry per hook type')
  assert.deepEqual(Object.keys(shim.hooks!).sort(), ['afterToolCall', 'beforeToolCall', 'onSessionStart', 'onStop', 'onUserMessage'])
  for (const [type, body] of Object.entries(shim.hooks!)) {
    const command = JSON.parse(body as string)[type][0].hooks[0].command as string
    assert.ok(command.includes('snow-bridge.mjs'), 'the bridge is the node entry: dispatch.sh is bash and node cannot run it')
    assert.ok(!command.includes('dispatch.sh'), 'never dispatch.sh')
    assert.ok(command.includes(toPosix(join(dirname('/d/hooks/dispatch.sh'), 'snow-bridge.mjs'))), 'sibling of dispatch.sh, so a package move keeps them together')
    assert.ok(command.endsWith(type), 'the hook type is the bridge argument')
    assert.ok(!command.includes('SPEX='), 'no env prefix')
  }
  assert.ok(shim.content.includes('beforeToolCall'), 'content mirrors the file set')
})

test('bridge source: announces `snow` to the dispatcher and pins the child cwd (the two silent-no-op regressions)', () => {
  const src = readFileSync(BRIDGE_SRC, 'utf8')
  // bug #44: an id of 'claude' was rejected by a snow-only tree's allowlist → dispatch.sh exited 0 silently.
  assert.match(src, /'snow',\s*event/, "spawnSync passes 'snow' as the harness id, never 'claude'")
  assert.ok(!/'claude',\s*event/.test(src), 'the borrowed identity is gone')
  // bug #45: without a child cwd the dispatcher's `git rev-parse --show-toplevel` ran in the harness's launch
  // directory, so the spec-first gate took its "not a repo" exit 0 and the block vanished.
  assert.match(src, /cwd:\s*payload\.cwd\s*\|\|\s*process\.cwd\(\)/, 'the child inherits the payload worktree, not this process cwd')
})

test('bridge protocol: payload translation and the exit-code contract, against a stub dispatcher', { skip: hasBash ? false : 'bash is unavailable (the bridge shells out to bash)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'snow-bridge-'))
  cpSync(BRIDGE_SRC, join(dir, 'snow-bridge.mjs'))
  const capture = join(dir, 'captured.json')
  // the stub sits where the bridge looks for its dispatcher (sibling), and answers per STUB_MODE
  writeFileSync(join(dir, 'dispatch.sh'), [
    '#!/usr/bin/env bash',
    'cat > "$STUB_CAPTURE"',
    'case "${STUB_MODE:-silent}" in',
    '  block) printf \'{"decision":"block","reason":"read the governing spec first"}\' ;;',
    '  ctx)   printf \'{"hookSpecificOutput":{"additionalContext":"governed by calc"}}\' ;;',
    '  exit2) printf \'declare it\\n\' >&2; exit 2 ;;',
    '  quiet) exit 0 ;;',
    '  *)     printf \'not json at all\' ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'))

  const bridge = join(dir, 'snow-bridge.mjs')
  const run = (kind: string, payload: unknown, mode: string) => spawnSync(process.execPath, [bridge, kind], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, STUB_MODE: mode, STUB_CAPTURE: toPosix(capture) },
  })

  const toolPayload = (toolName: string, args: Record<string, unknown>) => ({
    toolName, args, sessionId: 'sid-1', cwd: toPosix(tmpdir()),
  })

  // A. a decision:block becomes Snow's block: exit 1 with the reason on stderr (the call does not run)
  let r = run('beforeToolCall', toolPayload('filesystem-edit', { filePath: '/w/a.ts' }), 'block')
  assert.equal(r.status, 1, 'block → exit 1')
  assert.match(r.stderr, /read the governing spec first/, 'the reason reaches the agent on stderr')
  assert.equal(r.stdout, '', 'nothing on stdout for a block')

  // B. the payload the stub received is Claude-shaped, with Snow's tool + path vocabulary reduced
  const seen = JSON.parse(readFileSync(capture, 'utf8')) as Record<string, unknown>
  assert.equal(seen.session_id, 'sid-1', 'sessionId → session_id')
  assert.equal(seen.hook_event_name, 'PreToolUse', 'beforeToolCall → PreToolUse')
  assert.equal(seen.tool_name, 'Edit', 'filesystem-edit → Edit')
  assert.deepEqual(seen.tool_input, { file_path: '/w/a.ts' })

  // C. each tool maps, and the first path of an array decides (filesystem-read takes a list)
  for (const [snowTool, claudeTool] of Object.entries({
    'filesystem-read': 'Read', 'filesystem-edit': 'Edit', 'filesystem-replaceedit': 'Edit', 'filesystem-create': 'Write',
  })) {
    const rr = run('beforeToolCall', toolPayload(snowTool, { filePath: ['/w/first.ts', '/w/second.ts'] }), 'quiet')
    assert.equal(rr.status, 0)
    const body = JSON.parse(readFileSync(capture, 'utf8')) as { tool_name: string; tool_input: { file_path: string } }
    assert.equal(body.tool_name, claudeTool, `${snowTool} → ${claudeTool}`)
    assert.equal(body.tool_input.file_path, '/w/first.ts', 'the first path decides')
  }

  // D. a backslash path is normalized before it crosses into bash
  run('beforeToolCall', toolPayload('filesystem-edit', { filePath: 'C:\\w\\a.ts' }), 'quiet')
  assert.equal((JSON.parse(readFileSync(capture, 'utf8')) as { tool_input: { file_path: string } }).tool_input.file_path, 'C:/w/a.ts')

  // E. a non-tool event carries the message instead of a tool
  run('onUserMessage', { message: 'hello', sessionId: 'sid-2', cwd: toPosix(tmpdir()) }, 'quiet')
  const msg = JSON.parse(readFileSync(capture, 'utf8')) as Record<string, unknown>
  assert.equal(msg.hook_event_name, 'UserPromptSubmit')
  assert.equal(msg.prompt, 'hello')
  assert.equal(msg.tool_name, undefined, 'no tool on a non-tool event')

  // F. an annotation rides back as stderr + exit 1 (Snow's afterToolCall replaces the result with stderr)
  r = run('afterToolCall', toolPayload('filesystem-edit', { filePath: '/w/a.ts' }), 'ctx')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /governed by calc/)

  // G. FAIL OPEN, always: a dispatcher that cannot decide must never block the user's call
  for (const mode of ['quiet', 'garbage']) {
    r = run('beforeToolCall', toolPayload('filesystem-edit', { filePath: '/w/a.ts' }), mode)
    assert.equal(r.status, 0, `${mode} → exit 0`)
    assert.equal(r.stderr, '', 'no stderr — the call proceeds untouched')
  }
  r = run('beforeToolCall', toolPayload('filesystem-edit', { filePath: '/w/a.ts' }), 'exit2')
  assert.equal(r.status, 0, 'a bare exit 2 without a JSON decision is not a block Snow understands')

  // H. an unmapped tool, a tool event with no path, and an unknown hook kind never reach the dispatcher
  for (const [kind, payload] of [
    ['beforeToolCall', toolPayload('bash', { command: 'ls' })],
    ['beforeToolCall', toolPayload('filesystem-edit', {})],
    ['onNotification', { sessionId: 'sid-3' }],
  ] as Array<[string, unknown]>) {
    const rr = run(kind, payload, 'block')
    assert.equal(rr.status, 0, `${kind}/${JSON.stringify(payload)} fails open`)
  }
})

test('bridge protocol: a missing bash or malformed stdin fails open rather than throwing at the user', { skip: hasBash ? false : 'bash is unavailable (the bridge shells out to bash)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'snow-bridge-'))
  cpSync(BRIDGE_SRC, join(dir, 'snow-bridge.mjs'))
  const bridge = join(dir, 'snow-bridge.mjs')
  const r = spawnSync(process.execPath, [bridge, 'beforeToolCall'], {
    input: '{ not json',
    encoding: 'utf8',
    env: { ...process.env, PATH: '/nonexistent' },
  })
  assert.equal(r.status, 0, 'a bridge cannot parse or cannot find bash never blocks')
})

// @@@ bug #46 - a shim that IS a directory. The single-file shim path read the path as text
// (`readFileSync(shim)`), which threw EISDIR on `.snow/hooks` and aborted the whole deselect reconcile: the
// hooks stayed on disk and the allowlist still named the dropped harness. These two guards pin the shape that
// broke, before any git fixture is involved (the investflow e2e covers the same ground through the CLI).
test('clean: a hook-file-per-type shim is a DIRECTORY, so clean must not read it as one file (bug #46)', () => {
  const proj = mkdtempSync(join(tmpdir(), 'snow-clean-'))
  const hooksDir = join(proj, '.snow', 'hooks')
  const shim = snowHarness.shim(join(HOOKS_DIR, 'dispatch.sh'), '/s/spex.mjs')

  // write exactly what materialize would, then clean like an uninstall/deselect does
  mkdirSync(hooksDir, { recursive: true })
  for (const [type, body] of Object.entries(shim.hooks!)) writeFileSync(join(hooksDir, `${type}.json`), body as string)
  assert.doesNotThrow(() => snowHarness.clean(proj, { skills: [], agents: [] }),
    'cleanHarness must survive a shim that is a directory (was EISDIR)')
  assert.ok(!existsSync(hooksDir), 'the swept directory is gone once it holds nothing of the user’s')
})

test('deselect: hook files under the installation hook dir are swept; a hand-made folder is never touched (bug #46)', () => {
  const proj = mkdtempSync(join(tmpdir(), 'snow-sweep-'))
  const hooksDir = join(proj, '.snow', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  // ours: names a hook entry under THIS installation (`<PKG>/hooks`) — stable across processes, unlike the
  // generated line, whose node path differs per shell on a version-manager host
  writeFileSync(join(hooksDir, 'beforeToolCall.json'), JSON.stringify({
    beforeToolCall: [{ description: 'x', hooks: [{ type: 'command', command: `"node" "${toPosix(join(HOOKS_DIR, 'snow-bridge.mjs'))}" beforeToolCall`, timeout: 30, enabled: true }] }],
  }, null, 2))
  // theirs: a hand-made hook folder the user owns — no reference to our installation
  writeFileSync(join(hooksDir, 'my-own.json'), JSON.stringify({ beforeToolCall: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] }))

  snowHarness.clean(proj, { skills: [], agents: [] })
  assert.ok(!existsSync(join(hooksDir, 'beforeToolCall.json')), 'our hook file is un-landed')
  assert.ok(existsSync(join(hooksDir, 'my-own.json')), 'a hand-made hook file survives our clean')
})
