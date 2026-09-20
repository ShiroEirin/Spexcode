// @@@ snow-harness - the Snow CLI adapter ([[harness-adapter]]).
//
// Snow is a native harness, not a bridge target: `spex init --harness snow` + `spex materialize` write its
// artifacts directly, and `spex uninstall` takes them back. Before this, the same artifacts were produced
// by two hand-run scripts (snow-bridge.mjs, spexcode-to-snow.mjs) — reproducible, but outside the
// materialize pass, so they never counted toward the content hash and could not be cleaned up.
//
// WHAT SNOW DISCOVERS (measured against the Snow CLI bundle):
//   hooks    `.snow/hooks/<hookType>.json`  — the FILE NAME must be the hook type; a custom name is never
//                                            loaded. Project-level hooks REPLACE the global set rather
//                                            than merging into it, so every hook we need must be here.
//   contract `AGENTS.md`                    — Snow does not read CLAUDE.md.
//   skills   `.snow/skills/<name>/SKILL.md` — the agentskills.io primitive (name + description + body).
//   commands `.snow/commands/<name>.json`   — `{type:'prompt', command, description}`.
//   agents   `.snow/agents/<name>.md`
//
// EVENT MAPPING. Snow has nine lifecycle events; the five below are the ones SpexCode's handlers serve.
// The remaining Claude events have no Snow counterpart, which is a real gap and is left visible:
//   SessionStart     -> onSessionStart
//   UserPromptSubmit -> onUserMessage
//   PreToolUse       -> beforeToolCall    (the spec-first gate)
//   PostToolUse      -> afterToolCall     (the spec-of-file annotation)
//   Stop             -> onStop
//   StopFailure, Notification            — no Snow equivalent
//
// THE HOOK COMMAND goes through snow-bridge.mjs rather than dispatch.sh directly: Snow's payload shape
// ({toolName, args:{filePath}}) and its exit-code protocol differ from Claude's, and the bridge is the
// already-verified translator between them. Re-implementing that translation here would fork the contract;
// this adapter only decides WHERE the files land.
import { join } from 'node:path'
import type { HarnessId } from '@spexcode/spec-core'
import { posixPath } from './sh.js'

// SpexCode's hook payload vocabulary reached Snow's own tool names through the bridge's map; the file
// names below must match Snow's hook types exactly.
const SNOW_HOOK_TYPES = ['onSessionStart', 'onUserMessage', 'beforeToolCall', 'afterToolCall', 'onStop'] as const

/**
 * The hook timeout, in Snow's unit — MILLISECONDS.
 *
 * Snow reads this field as milliseconds (`hooksConfig.ts:40` "超时时间（毫秒）") and runs the command with
 * `action.timeout || this.defaultTimeout`, where the default is 5000. Claude's hook contract spells the
 * same field in SECONDS, so the Claude-shaped `30` that used to sit in this file was read as thirty
 * milliseconds: bash had not finished starting before Snow killed it, every gate died on the timeout
 * path, and a governed edit sailed straight through. The value below is the Claude default (30 s)
 * written in Snow's unit.
 */
export const SNOW_HOOK_TIMEOUT_MS = 30_000

/**
 * The `.snow/hooks/<hookType>.json` body for one hook type.
 *
 * Snow's record is `{ "<hookType>": [{description, hooks:[{type,command,timeout,enabled}]}] }` — an array
 * of hook GROUPS, each holding the commands to run. One file carries exactly one type, because the name is
 * the discovery key.
 */
export function snowHookFile(hookType: string, command: string, description: string): string {
  return JSON.stringify({
    [hookType]: [
      {
        description,
        hooks: [{ type: 'command', command, timeout: SNOW_HOOK_TIMEOUT_MS, enabled: true }],
      },
    ],
  }, null, 2) + '\n'
}

/**
 * The per-hook-type command. The bridge takes the hook type as its first argument so it knows which
 * Claude event to synthesize — the same contract the hand-installed files used.
 *
 * NO ENV PREFIX, and both paths quoted with the Node binary that is running:
 *   * `VAR=value cmd` is POSIX-shell syntax. Snow executes hook commands through the platform shell, which
 *     on Windows is cmd.exe, where it is just an argument — node then reads the assignment as a script path.
 *   * The bridge resolves the SpexCode entry itself, so there is nothing to pass in anyway.
 *   * `process.execPath` (not bare `node`) so the line cannot depend on node being on PATH; the quotes
 *     keep it valid where the install directory contains a space.
 */
export function snowHookCommand(bridge: string, spex: string, hookType: string): string {
  void spex // the bridge owns the SpexCode entry resolution (§ header); kept in the signature for parity
  return `"${posixPath(process.execPath)}" "${posixPath(bridge)}" ${hookType}`
}

/** Claude event name -> Snow hook type. The five SpexCode serves; absent means "no Snow counterpart". */
export const SNOW_EVENT_MAP: Readonly<Record<string, string>> = {
  SessionStart: 'onSessionStart',
  UserPromptSubmit: 'onUserMessage',
  PreToolUse: 'beforeToolCall',
  PostToolUse: 'afterToolCall',
  Stop: 'onStop',
}

/**
 * Build the hook-file payload set: one entry per Snow hook type that has a SpexCode handler behind it.
 *
 * `hooks` is keyed by HOOK TYPE (not by Claude event) because that key becomes the FILE NAME. materialize
 * writes one `<key>.json` per entry — that is what `shimOwnership: 'hook-file-per-type'` means.
 */
export function buildSnowHooks(bridge: string, spex: string, events: readonly string[]): {
  files: Record<string, string>
  cmd: (e: string) => string
} {
  // `bridge` is snow-bridge.mjs, NOT dispatch.sh: the latter is a bash script and cannot be run by node.
  // The bridge is the node entry that translates Snow's payload/exit-code protocol and then shells out to
  // dispatch.sh itself — see the module header.
  const files: Record<string, string> = {}
  const description = 'spexcode spec-first gate + spec-of-file annotation (via snow-bridge.mjs)'
  for (const event of events) {
    const hookType = SNOW_EVENT_MAP[event]
    if (!hookType) continue
    files[hookType] = snowHookFile(hookType, snowHookCommand(bridge, spex, hookType), description)
  }
  // The command a consumer sees for one Claude EVENT (trust hashing / parity) resolves through the map.
  const cmd = (e: string) => {
    const hookType = SNOW_EVENT_MAP[e]
    return hookType ? snowHookCommand(bridge, spex, hookType) : ''
  }
  return { files, cmd }
}

/** Snow's hook type for a SpexCode event, or null when Snow has no counterpart. */
export function snowHookType(event: string): string | null {
  return SNOW_EVENT_MAP[event] ?? null
}

/** Every hook type this adapter can write, for clean/erase to sweep without guessing. */
export function snowHookTypes(): readonly string[] {
  return SNOW_HOOK_TYPES
}

export type SnowPaths = {
  hooksDir: string
  skillsDir: string
  commandsDir: string
  agentsDir: string
  contractFile: string
}

/** The one place Snow's layout is expressed. */
export function snowPaths(proj: string): SnowPaths {
  return {
    hooksDir: join(proj, '.snow', 'hooks'),
    skillsDir: join(proj, '.snow', 'skills'),
    commandsDir: join(proj, '.snow', 'commands'),
    agentsDir: join(proj, '.snow', 'agents'),
    contractFile: join(proj, 'AGENTS.md'),
  }
}

/** The harness id this adapter registers under (kept here so the harness table stays a one-line addition). */
export const SNOW_ID: HarnessId = 'snow'
