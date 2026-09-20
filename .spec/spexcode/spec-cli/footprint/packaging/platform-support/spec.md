---
title: platform-support
status: active
hue: 330
desc: SpexCode's supported runtime is POSIX — Linux, macOS, or Windows via WSL2. Native Windows now runs the read-only tool AND the hook plane, both measured end to end; what stays gated is the session runtime, whose live-terminal bridge rides tmux control mode and has no native analog. A host missing a load-bearing primitive is detected and fails loudly toward that primitive instead of crashing cryptically.
code:
  - spec-cli/src/runtime-guard.ts#assertSessionRuntime
related:
  - spec-cli/bin/spex.mjs
  - spec-cli/src/cli.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/runtime-guard.test.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/windows-hide-console.ts
  - packages/spec-core/src/kill-tree.ts
  - spec-cli/src/sh.ts
---
# platform-support

SpexCode's supported runtime is **POSIX**: Linux, macOS, or Windows **via WSL2**. WSL2 remains the
recommended Windows path — it is a real Linux kernel, so nothing below has to be true. But native Windows is
no longer *deferred*: the read-only half **and the hook plane** both run there, measured on real hardware, and
the test suite runs natively. What is still gated is the **session runtime**, and the gate is unchanged in
shape: it keys on the missing *primitive*, not on the OS name.

## what runs on native Windows (measured, not inferred)

- **The read-only half.** `spex --version`, `graph`, `doctor`, `guide`, `spec search`, `spec owner`,
  `issue ls`, `diagram check`, `materialize` — all of it. Pure Node; it runs wherever the launcher does, and
  the launcher runs the package's compiled JavaScript through `node`, never a shell shim or a TS loader.
- **The hook plane.** The dispatcher and every hook handler are pure bash and POSIX shell, and they run
  under the Git-for-Windows `bash.exe` that SpexCode already requires. The spec-first gate blocks a governed
  access and names its governor; spec-of-file annotates a mutation; a governed retry passes (the sentinel is
  one-shot). Verified end to end on a real worktree, under both the `claude` and `snow` shims.
- **The dashboard.** `spex serve` publishes the static page and its API on a native host.
- **Build and typecheck.** `npm run build` and `npm run typecheck` both exit 0.
- **The test suite.** It runs natively, in batches, and the failures that remain are platform skips carrying
  written reasons — not silently disabled tests.

Getting there was mostly removing POSIX assumptions that had never been exercised off POSIX, and each one is
a real defect the moment a Windows user hits it:

- **Process reaping.** A negative-PID process-group kill is a silent no-op on Windows (it throws `ESRCH`),
  so a caught-and-ignored failure left the child alive, holding a pipe, and the test hung. Reaping is now one
  shared process-tree helper, not a signal a platform may or may not honour.
- **Paths crossing into a shell.** A Windows backslash is an escape character to bash, so an interpolated
  path was eaten and the file was "not found". Every path that crosses into a shell is spelled with forward
  slashes through one helper.
- **Spawning a `.cmd`.** `npm`/`npx`/`tsx` are batch shims on Windows and are not found by a shell-less
  spawn; and `VAR=value cmd` is POSIX-shell syntax that the platform shell passes to the program as an
  argument. Both spellings are fixed at the call sites.
- **Escaping, once, for the file format.** A Windows path interpolated into a TOML basic string produces an
  illegal unicode escape (`\U`), so the write was rejected and the harness's trust never landed. The writer
  and the stripper now share one escape function — they are compared as strings, so they must agree.
- **Identity stamps that had to agree with the shell side.** The project key the shell derives and the key
  the TypeScript derives must be the same string; a divergence made the hook manifest unreachable, and the
  dispatcher exited quietly instead of blocking.
- **Hidden consoles.** A child process on Windows allocates a console window unless asked not to, so a hook
  storm became a window storm. `windowsHide` is applied at one choke point rather than at hundreds of call
  sites.

## what stays gated: the session runtime

The gate is on the **primitive**, not the OS: `spex serve` — the entry to the session runtime — checks for
tmux and, when it is absent, prints ONE actionable line and exits before any cryptic downstream failure. A
session-lifecycle command refuses by name (`launcher 'claude' uses claude, which requires an attachable tmux
host`) rather than half-starting. The read-only CLI is never walled.

- **The deciding gap — the live-terminal bridge rides tmux control mode.** The browser Sessions console
  ([[session-console]]) streams over `tmux -CC`, tmux's structured control-mode protocol. No native
  multiplexer is confirmed to speak it, so a native port must **rewrite that live streaming** — poll
  capture-pane, or attach another way. That rewrite, not a config swap, is the real cost.
- **Two lesser costs a mux swap does not pay.** The hand-written bash launchers and hooks still want
  git-bash on PATH (or a Node rewrite), and the filesystem-path AF_UNIX rendezvous socket becomes a Windows
  named pipe — an adaptation, not a wall.

Deferral of *that* is a considered call, not neglect: Anthropic's own Claude Code declined the identical
request (native Windows tmux agent-teams via psmux) as *not planned* and hit harness-level Windows quirks —
this is a real project to land, not a switch to flip.

The clean path, **if and when** the session runtime is pursued, is to extract a **session-holder** interface
(hold / list / capture / send / attach) so tmux, psmux, or wmux become pluggable backends — turning "port to
Windows" from a scattered rewrite into "write one backend." The intended direction; no code implements it
now.

## WSL2 is the Windows path for the session runtime (proven on real hardware)

WSL2 is not an emulation shim — it is a real Linux kernel, so every blocker above disappears inside it.
Proven live on the fleet's Windows box (windows-chole, kernel `6.18-microsoft-standard-WSL2`): tmux, bash,
git, and AF_UNIX sockets all work, and `nvm install 22` supplies the pinned Node the distro's own package is
too old to give. Mirrored networking makes the dashboard reachable at `localhost` from the Windows browser.
So the supported Windows story for **sessions** is: install WSL2, run SpexCode inside it — the same POSIX
runtime as Linux, not a second codepath. The tool and the hooks do not need it.

## fail loudly, never cryptically

Two mechanisms keep the contract honest at the boundary rather than only in prose:

- **The launcher stays cross-platform** so the read-only commands reach a Windows user at all: it runs the
  package's compiled JavaScript through `node`, never a shell shim or TypeScript loader. That keeps `spex init`
  independent of a platform-specific build-chain executable.
- **The session runtime is gated.** See above: one actionable line, a distinct exit code, before any cryptic
  downstream failure. The gate keys on the missing **primitive**, not on the OS name, so it is honest
  for both; and it is narrow — only the session-launch path is walled, never the read-only CLI.

This is the same shape as [[merge-tooling-resilience]]: the single launcher entry degrades an expected
adverse condition — there a mid-merge tree, here a missing runtime primitive — into one legible line and a
distinct exit code, never a stacktrace.
