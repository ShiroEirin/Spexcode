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
    session_id: payload.sessionId || payload.session_id || 'snow-session',
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

  // spec-first: block this one access, name the governing spec, and let the retry through (its per-session
  // sentinel was already spent). Snow's exit 1 is the same shape: the call does not run, the agent sees
  // stderr, the conversation continues.
  if (out.decision === 'block' && out.reason) {
    process.stderr.write(`${out.reason}\n`)
    process.exit(1)
  }

  // spec-of-file: a non-blocking annotation. Snow's afterToolCall replaces the tool result with stderr on
  // exit 1, so the note is appended after the (short) edit result rather than swallowing it.
  const ctx = out.hookSpecificOutput?.additionalContext || out.additionalContext
  if (ctx) {
    const summary = typeof payload.result === 'object' && payload.result ? payload.result.message : ''
    process.stderr.write(summary ? `${ctx}\n\n(${summary})\n` : `${ctx}\n`)
    process.exit(1)
  }

  process.exit(0)
}

main()
