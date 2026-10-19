---
title: snow-harness
status: active
hue: 205
desc: The Snow CLI adapter — a first-class Harness row whose shim is a DIRECTORY of per-hook-type files, dispatched through one node bridge that translates Snow's payload and exit-code protocol. Its gates were silently dead until the bridge announced the right harness id, ran in the worktree, the payload stopped being mistaken for the identity, and the timeout stopped being written in the wrong unit. The same bridge serves the Snow App, which shares the name and nothing else: its launcher flattens every non-zero exit to 1, so the App's block is a decision card on stdout instead of the CLI's stderr.
code:
  - spec-cli/src/snow-harness.ts
related:
  - spec-cli/hooks/snow-bridge.mjs
  - spec-cli/src/harness.ts
  - spec-cli/src/harness-shim.ts
  - spec-cli/src/materialize.ts
  - spec-cli/hooks/dispatch.sh
  - spec-cli/src/harness.test.ts
  - spec-cli/src/snow-harness.test.ts
  - packages/spec-core/src/harness-identity.ts
---

# snow-harness

Snow CLI joins the native [[harness-adapter]] registry as the `snow` row. The adapter owns every Snow fact;
materialization, lifecycle gates, and product code resolve the adapter and never branch on its id.

## what Snow discovers (measured against the CLI bundle)

- **hooks** — `.snow/hooks/<hookType>.json`. The **file name must BE the hook type**; a custom name is never
  loaded. Project-level hooks **replace** the global set rather than merging into it, so every hook we need
  must be in these files (see the gap below).
- **contract** — `AGENTS.md`. Snow does not read `CLAUDE.md`.
- **skills** — `.snow/skills/<name>/SKILL.md` (the agentskills.io primitive: name + description + body).
- **commands** — `.snow/commands/<name>.json` (`{type:'prompt', command, description}`).
- **agents** — `.snow/agents/<name>.md`.

## the two structural facts this row forced onto the interface

**A directory-shaped shim.** Every other adapter's `shimFile` is one file. Snow's is a **directory**, because
its discovery key is the file NAME. The interface grew `shimOwnership: 'hook-file-per-type'`: `shimFile` names
the directory, `shim().hooks` is `{ <hookType>: <body> }`, and materialize lands one `<key>.json` per entry.
The identity stamp is per FILE, and it is not `dispatch.sh` — see the bridge below.

**A command surface.** Snow has a native command surface of its own, so the interface grew the optional
`commandDir(proj)`, the sibling of `skillDir`/`agentDir`.

## event mapping

Snow has nine lifecycle events; five are ones SpexCode's handlers serve, and the mapping is one-way data:

| SpexCode (Claude shape) | Snow                                          |
| ----------------------- | --------------------------------------------- |
| `SessionStart`          | `onSessionStart`                              |
| `UserPromptSubmit`      | `onUserMessage`                               |
| `PreToolUse`            | `beforeToolCall` (the spec-first gate)        |
| `PostToolUse`           | `afterToolCall` (the spec-of-file annotation) |
| `Stop`                  | `onStop`                                      |

The remaining Claude events (`StopFailure`, `Notification`) have **no Snow counterpart**. That is a real gap,
left visible: no substitute event is fabricated, so the Claude-only idle and turn-failure surfaces do not
exist under a snow-only selection.

## the bridge, and why there is one

`hooks/snow-bridge.mjs` is the adapter's edge, not a rewrite. Snow's payload shape
(`{toolName, args:{filePath}}`) and its exit-code protocol differ from Claude's, and `dispatch.sh` plus the
`.plugins` handlers are the product's hook logic. Re-implementing them for Snow would fork the contract and
drift, so the bridge adapts exactly two edges and runs the SAME dispatcher:

- **payload** — Snow's tool vocabulary is its own (`filesystem-read`/`-edit`/`-replaceedit`/`-create`) and is
  reduced to Claude's `Read`/`Edit`/`Write`; a path array takes its first element; a path crossing into bash
  is normalized to forward slashes.
- **exit code** — a Claude `{decision:"block",reason}` becomes Snow's block: **exit 1 with the reason on
  stderr**, which stops THIS call and continues the conversation, exactly the gate's block-once contract. An
  `additionalContext` annotation rides back the same way, because Snow's afterToolCall replaces the tool
  result with stderr. **Anything else, and any failure at all, exits 0 — the bridge fails OPEN, always.** A
  bridge that cannot decide must never block the user's tool call.

**The hook line runs the BRIDGE, never `dispatch.sh`.** dispatch.sh is bash; node cannot run it. The line is
a quoted `node <bridge> <hookType>` with NO environment prefix — `VAR=value cmd` is POSIX-shell syntax and
Snow executes hook commands through the platform shell, where it is just an argument.

## four faults that made the gates silently dead

Each of these alone makes the spec-first gate a no-op, and none of them reported anything. They are the
reason this node exists rather than a one-line registry entry.

**Payload shape is not identity.** The bridge translated Snow's payload into Claude's SHAPE and then
announced itself as `claude` — while materialize had written `snow` into this tree's dispatch allowlist.
`dispatch.sh` greps that allowlist, so every event fell through to exit 0 and no gate ever fired. The tree's
allowlist is the set of harnesses the USER selected; a bridge that borrows another id is rejected by it. The
row therefore declares `dispatchId: 'snow'`, and the bridge passes `snow` — payload and identity are separate
axes.

**The dispatcher resolves the worktree from the PROCESS cwd.** The child had no `cwd`, so it inherited the
launching process's, and `git rev-parse --show-toplevel` resolved against the wrong directory — the gate took
its "not a repo" exit 0 and the block vanished. `CLAUDE_PROJECT_DIR` does not substitute: it selects the hook
manifest, not the process cwd. The bridge pins `cwd: payload.cwd || process.cwd()`.

**A directory cannot be read as one string.** Three sites read `shimFile` as text, and under
`hook-file-per-type` that is a DIRECTORY — `readFileSync` throws `EISDIR`, which **aborted the whole deselect
reconcile** and left the hooks on disk behind an allowlist that no longer named them. Identity for these files
is neither a `dispatch.sh` grep (their command runs the bridge) nor byte-equality with a freshly generated
shim (the generated line embeds THIS process's node path, which differs per shell on a version-manager host,
so the artifact would compare unequal to itself). It is that the command names a hook entry under **this
installation** — stable across processes, and provably ours. Un-landing then removes each stamped file and
drops the directory only when it is empty, so a hand-made hooks folder survives.

**The timeout is milliseconds, and Claude spells it in seconds.** Snow reads this field as milliseconds
(`hooksConfig.ts:40`) and runs the command under `action.timeout || this.defaultTimeout`, where the default
is 5000. The value here was copied from Claude's hook shape, where the same field counts SECONDS, so `30`
asked for a thirty-millisecond budget. The gate is not instant — it is node plus bash plus git plus a spec
lookup, measured at ~2 s on a warm host and up to ~8 s cold — so it was killed before it could print a
single byte, and a governed edit went through with no block and no message. The number is now a named
constant (`SNOW_HOOK_TIMEOUT_MS = 30_000`, the Claude default written in Snow's unit) so the unit cannot
drift back with the value, and the unit is asserted in the unit test.

## the second consumer: the App, which shares the name and nothing else

The bridge serves two products that are configured in two different places. **Snow CLI** reads
`.snow/hooks/<hookType>.json` and reports through exit codes; **Snow App** reads its hook configuration from
its own database and reports through an interactive decision card. Neither store is visible to the other, so
the App's wiring is recorded here rather than in the tree.

Three facts were measured, and each one breaks an assumption the CLI path had already settled:

- **The App's launcher flattens every non-zero exit to 1.** `powershell -Command "node …"` reports 2 as 1;
  the same line with `exit $LASTEXITCODE` reports 2. Exit 1 is the App's *soft warning* — logged and
  ignored — so an exit-2 block would arrive as a WARN line and the governed call would go through. The block
  is therefore spelled per product: **the CLI gets the reason on stderr with exit 1; the App gets
  `{"decision":{"message":…}}` on STDOUT with exit 1**, which is what raises the card. The annotation splits
  the same way (stdout with exit 0 under the App, stderr with exit 1 under the CLI), because the App logs
  stderr on a non-zero exit and reads only stdout as context.
- **The App hands the hook no environment, and rewrites the command line.** `SNOW_PLATFORM`,
  `SNOW_SESSION_ID` and `SPEX` are all empty in the child, and an `--app` argument written into the
  configuration does not appear in `process.argv`. Neither signal can be trusted alone, so `isApp` is the OR
  of three — the flag, `SNOW_PLATFORM=snow-app`, and a payload with no session field (the CLI's payload
  carries `sessionId`; the App's carries none). A launcher that rewrites its own command must not be able to
  downgrade a block into a logged warning.
- **The App's payload carries no session id.** With no payload field and no environment, the sentinel
  degenerates to a fixed string shared by every App conversation, so "fires once per session" means once per
  machine there. The environment read is kept as the seam for the day the App exports one; the gap is left
  visible rather than papered over.

For reference, the App's wiring is `beforeToolCall` → `node <bridge> beforeToolCall --app` over the
filesystem read/edit/write tools on a 20 000 ms budget, and `afterToolCall` → `node <bridge> afterToolCall`
over the edit/write tools. The budget is milliseconds, the App's own unit — the same unit
`SNOW_HOOK_TIMEOUT_MS` is written in.

## the identity line

`snow` with `SNOW_SESSION_ID` is one row of the adapter-neutral `HarnessIdentity` registry
([[harness-adapter]]), so a consumer that only needs identity data never loads the adapter.

## lifecycle posture

Snow has no SpexCode-managed delivery transport (`deliver` refuses by name) and no resume surface; it owns
its process, so `ownsRendezvous` is false and there is no transport to hear from it. `writeTrust` writes
nothing — Snow gates project hooks by folder trust, not by a trust file. The one-shot launcher declares
`headless: true` / `launchOneShot: true` so generic boot logic does not read its intentional exit as a failed
TUI. The lifecycle gates (`mark-active`, `stop-gate`, `session-listen`, `session-fail`, `idle`) act only on a
GOVERNED (dashboard-launched) session and no-op for a self-launched agent; the pinned `repo` profile keeps
only `spec-first | spec-of-file | comment-altitude`, which is the product's answer for exactly that case.

## acceptance

The adapter merges on BEHAVIOR, not on artifact inspection: the generated hook files must be proven to
dispatch, and the gate must be proven to block with its governor and pass on retry. The unit test drives the
real bridge against a stub dispatcher — payload translation, the exit-code contract, and fail-open on every
non-decision — and the end-to-end proof is a materialize round trip on a real worktree (init → deselect →
idempotent → restore), plus the gate firing on a governed file. The timeout is proven the same way: the
generated command is run under both budgets against a real governed file, and only the correct unit is
allowed to reach the block.
