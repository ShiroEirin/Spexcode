#!/usr/bin/env node
/**
 * @@@ snow-bridge - the Snow CLI adapter for SpexCode's hook surface.
 *
 * SpexCode materializes its hooks into each harness's own config file (.claude/settings.json for Claude,
 * .codex/hooks.json for Codex, …). Snow CLI is not one of those harnesses, so this bridge is the adapter:
 * it translates Snow's hook payload into the Claude-shaped payload dispatch.sh already understands, runs
 * the SAME dispatcher, and translates the verdict back into Snow's exit-code protocol.
 *
 * WHY A BRIDGE AND NOT A REWRITE: dispatch.sh + the .plugins handlers are the product's hook logic (the
 * spec-first gate, the spec-of-file annotator). Re-implementing them for Snow would fork the contract and
 * drift. The bridge keeps ONE implementation and only adapts the two edges.
 *
 * PAYLOAD SHAPES
 *   Snow  beforeToolCall: {toolName, args:{filePath,…}, sessionId, cwd}   afterToolCall: + {result, error}
 *
 * HARNESS IDENTITY: the dispatcher is invoked as `dispatch.sh snow <Event>`, never `claude`. The bridge
 * translates the PAYLOAD into Claude's shape, but the harness id is the tree's own selection (materialize
 * wrote `snow` into this tree's allowlist), so borrowing `claude` made the dispatcher reject every event and
 * the gates silently no-opped. The payload shape and the identity are separate axes.
 *   Claude               : {session_id, hook_event_name, tool_name, tool_input:{file_path}}
 *   Snow's tool vocabulary is its own (filesystem-read/edit/replaceedit/create); spec-first and
 *   spec-of-file only recognize Claude's Read/Edit/Write/NotebookEdit, so TOOL_MAP reduces them.
 *
 * EXIT-CODE MAPPING (the two protocols disagree, and this is the whole point of the bridge)
 *   Claude {decision:"block",reason}          → Snow exit 1 + stderr. Snow blocks THIS call and hands the
 *                                               reason to the agent, which reads the spec and retries —
 *                                               exactly spec-first's block-once contract (its sentinel
 *                                               makes the retry pass).
 *   Claude {hookSpecificOutput:{additionalContext}} → Snow exit 1 + stderr. Snow's afterToolCall replaces
 *                                               the tool result with stderr, so the annotation reaches the
 *                                               agent at the moment of the edit (the handler's own design).
 *   anything else / any failure               → exit 0. A bridge that cannot decide must never block the
 *                                               user's tool call: fail OPEN, always.
 *
 * PROFILE: SPEX_PROFILE=repo pins the hook set to spec-first + spec-of-file — the two hooks that serve a
 * user-self-launched agent. The lifecycle hooks (mark-active, stop-gate, session-listen, session-fail,
 * idle) act only on a GOVERNED (dashboard-launched) session and no-op here while still paying a node boot
 * per tool call (measured: ~1.3s for session-state active). `repo` is the product's own answer for this.
 *
 * BASH: dispatch.sh is pure bash. On Windows the bridge locates Git for Windows' bash.exe (the one shell
 * that ships with git, which SpexCode already requires) — never WSL bash, whose path translation would
 * break the Windows paths in the payload.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HOOK_DIR = dirname(fileURLToPath(import.meta.url))
const DISPATCH = join(HOOK_DIR, 'dispatch.sh')
const SPEX = join(HOOK_DIR, '..', 'bin', 'spex.mjs')

// Snow tool name → Claude tool name. Only the file-access tools matter: spec-first gates governed ACCESS
// (read OR mutate) and spec-of-file annotates MUTATIONS; every other Snow tool leaves both silent.
const TOOL_MAP = {
  'filesystem-read': 'Read',
  'filesystem-edit': 'Edit',
  'filesystem-replaceedit': 'Edit',
  'filesystem-create': 'Write',
}

// Snow hook kind (argv[2], from the .snow/hooks/<kind>.json the user installed) → Claude event name.
const EVENT_MAP = {
  onSessionStart: 'SessionStart',
  onUserMessage: 'UserPromptSubmit',
  beforeToolCall: 'PreToolUse',
  afterToolCall: 'PostToolUse',
  onStop: 'Stop',
}

// Hook types that are NOT tool calls. They carry no toolName/filePath, so the tool parts of the payload
// below are simply absent; dispatch.sh's handlers branch on the event, not on the tool.
const NON_TOOL_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop'])

// Git for Windows' bash, in the order a normal install lands. PATH is consulted first so a portable Git
// (scoop, winget, a custom prefix) wins over the conventional location.
function findBash() {
  const fromPath = spawnSync('bash', ['-c', 'exit 0'], { stdio: 'ignore', shell: true })
  if (fromPath.status === 0) return 'bash'
  const candidates = [
    'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/usr/bin/bash.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs/Git/usr/bin/bash.exe'),
  ]
  return candidates.find((p) => p && existsSync(p)) || null
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// forward slashes only: these strings cross into bash, where a backslash is an escape character.
const toPosix = (p) => String(p || '').replace(/\\/g, '/')

function main() {
  const kind = process.argv[2]
  const event = EVENT_MAP[kind]
  if (!event) process.exit(0) // a hook kind this bridge does not serve: fail open

  let payload
  try {
    payload = JSON.parse(readStdin() || '{}')
  } catch {
    process.exit(0)
  }

  // A tool-call event with a tool we do not map has nothing for either handler to say. A NON-tool event
  // (session start, user message, stop) has no tool at all and must still reach dispatch.sh.
  const nonTool = NON_TOOL_EVENTS.has(event)
  const tool = nonTool ? undefined : TOOL_MAP[payload.toolName]
  if (!nonTool && !tool) process.exit(0)

  let args = payload.args
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = {}
    }
  }
  args = args || {}
  let filePath = nonTool ? undefined : (args.filePath ?? args.file_path ?? args.path)
  if (Array.isArray(filePath)) filePath = filePath[0] // filesystem-read takes an array; the first path decides
  if (!nonTool && !filePath) process.exit(0)

  const bash = findBash()
  if (!bash) process.exit(0)

  const claudePayload = {
    // The CLI's payload carries its own session id; the App's beforeToolCall payload carries NONE, and the
    // App hands the hook no environment either (measured: SNOW_SESSION_ID is empty in the child). So under
    // the App this still collapses to the fixed string — "fires once per session" means once per machine
    // there. The env read is the seam kept for the day the App starts exporting one; the CLI never reaches
    // it. Left visible rather than papered over.
    session_id: payload.sessionId || payload.session_id || process.env.SNOW_SESSION_ID || 'snow-session',
    hook_event_name: event,
    // UserPromptSubmit carries the message; the pre-tool events carry the tool. Only include what exists —
    // dispatch.sh's handlers read the field their event defines.
    ...(nonTool
      ? { prompt: payload.message ?? payload.prompt ?? '' }
      : { tool_name: tool, tool_input: { file_path: toPosix(filePath) } }),
  }

  const result = spawnSync(bash, [toPosix(DISPATCH), 'snow', event], {
    input: JSON.stringify(claudePayload),
    encoding: 'utf8',
    timeout: 20000,
    // @@@ cwd - the dispatcher and every handler under it resolve the WORKTREE with `git rev-parse
    // --show-toplevel`, which reads the PROCESS cwd, not CLAUDE_PROJECT_DIR. Inheriting this node process's cwd
    // (wherever the harness happened to launch it) made that resolve against the wrong directory: git fails, the
    // spec-first gate takes its "not a repo" exit 0, and the block vanishes with no diagnostic. The payload's cwd
    // IS the worktree Snow ran the tool in, so pin it here.
    cwd: payload.cwd || process.cwd(),
    env: {
      ...process.env,
      SPEX_PROFILE: 'repo',
      SPEX: toPosix(SPEX),
      CLAUDE_PROJECT_DIR: toPosix(payload.cwd || process.cwd()),
    },
  })

  const stdout = (result.stdout || '').trim()
  if (!stdout.startsWith('{')) process.exit(0)

  let out
  try {
    out = JSON.parse(stdout)
  } catch {
    process.exit(0)
  }

  // @@@ snow-app protocol - the App and the CLI disagree on exit codes, and this bridge serves both.
  //   CLI : exit 1 = the call does not run (and afterToolCall swaps the tool result for stderr).
  //   APP : exit 1 = a soft warning that is only logged; exit 2+ = the block, with stderr shown first;
  //         exit 0 with non-empty stdout = extra context. The same verdict therefore needs a different
  //         code per platform.
  // Which platform is decided by THREE signals, and the redundancy is deliberate: a `--app` flag on the hook
  // command line, SNOW_PLATFORM=snow-app in the environment, or a payload with no session field at all
  // (the CLI's payload carries sessionId; the App's does not — both measured). The flag alone proved
  // untrustworthy: the App ran the --app command line and this process still saw no argument, so a launcher
  // that rewrites the command must not be able to silently downgrade a block to a logged warning.
  const isApp = process.argv.includes('--app')
    || process.env.SNOW_PLATFORM === 'snow-app'
    || !(payload.sessionId || payload.session_id)

  // spec-first: block this one access, name the governing spec, and let the retry through (its per-session
  // sentinel was already spent). Either way the call does not run, the agent sees the reason, and the
  // conversation continues.
  if (out.decision === 'block' && out.reason) {
    if (isApp) {
      // A 2-based block cannot survive the App's launcher: measured, `powershell -Command "node …"` collapses
      // EVERY non-zero exit into 1 (2 → 1, 1 → 1), so an exit-2 block arrives as a logged soft warning and
      // the gate silently passes. The App's own gate is the interactive decision instead: exit 1 whose
      // stdout is {"decision":{"message":…}} raises the card and puts the reason in front of the human.
      process.stdout.write(`${JSON.stringify({ decision: { message: out.reason } })}\n`)
      process.exit(1)
    }
    process.stderr.write(`${out.reason}\n`)
    process.exit(1)
  }

  // spec-of-file: a non-blocking annotation. Under the CLI, exit 1 replaces the tool result with stderr,
  // so the note is appended after the (short) edit result rather than swallowing it. The App logs stderr
  // on exit 1 and only treats STDOUT as context, so there the note goes out as stdout on a passing exit.
  const ctx = out.hookSpecificOutput?.additionalContext || out.additionalContext
  if (ctx) {
    const summary = typeof payload.result === 'object' && payload.result ? payload.result.message : ''
    const note = summary ? `${ctx}\n\n(${summary})\n` : `${ctx}\n`
    if (isApp) {
      process.stdout.write(note)
      process.exit(0)
    }
    process.stderr.write(note)
    process.exit(1)
  }

  process.exit(0)
}

main()
