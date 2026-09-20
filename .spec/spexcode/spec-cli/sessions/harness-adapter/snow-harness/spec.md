---
title: snow-harness
status: active
hue: 205
desc: The Snow CLI adapter — a first-class Harness row whose shim is a DIRECTORY of per-hook-type files, dispatched through one node bridge that translates Snow's payload and exit-code protocol. Its gates were silently dead until the bridge announced the right harness id, ran in the worktree, and the payload stopped being mistaken for the identity.
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

## three faults that made the gates silently dead

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
idempotent → restore), plus the gate firing on a governed file.
