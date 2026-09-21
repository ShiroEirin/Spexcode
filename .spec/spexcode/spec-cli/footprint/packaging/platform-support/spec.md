---
title: platform-support
status: active
hue: 330
desc: SpexCode's supported runtime is POSIX — Linux, macOS, or Windows via WSL2. Native Windows now runs the read-only tool, the hook plane AND headless sessions, all measured end to end; what stays gated is the INTERACTIVE half of the session runtime, whose live-terminal bridge rides tmux control mode and has no native analog. A host missing a load-bearing primitive degrades to the capability it still has and names what it lost, instead of crashing cryptically.
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
no longer *deferred*: the read-only half, **the hook plane**, and **headless sessions** all run there,
measured on real hardware, and the test suite runs natively. The gate has not disappeared — it moved DOWN a
level, and that distinction is load-bearing: it no longer walls a subsystem, it selects which adapters a host
can carry. It keys on the *primitive* (a host with no tmux has no attachable terminal), not on the OS name,
so it reads identically on a bare POSIX box and on native Windows.

## what runs on native Windows (measured, not inferred)

- **The read-only half.** `spex --version`, `graph`, `doctor`, `guide`, `spec search`, `spec owner`,
  `issue ls`, `diagram check`, `materialize` — all of it. Pure Node; it runs wherever the launcher does, and
  the launcher runs the package's compiled JavaScript through `node`, never a shell shim or a TS loader.
- **The hook plane.** The dispatcher and every hook handler are pure bash and POSIX shell, and they run
  under the Git-for-Windows `bash.exe` that SpexCode already requires. The spec-first gate blocks a governed
  access and names its governor; spec-of-file annotates a mutation; a governed retry passes (the sentinel is
  one-shot). Verified end to end on a real worktree, under both the `claude` and `snow` shims.
- **The dashboard.** `spex serve` publishes the static page and its API on a native host. It stays up on a
  tmux-less host: the session runtime selects **process-host**, prints one line saying so, and serves on.
- **Headless sessions.** `spex session new --launcher <headless adapter>` **succeeds** on a tmux-less host —
  measured with `snow`, which is `headless: true` and `ownsRendezvous: false`. The session is created, it
  appears in `session ls`, and its hooks and gates work. What a headless adapter does not get is a terminal
  anyone may attach to; that is the next section.
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

## what stays gated: the INTERACTIVE session, not the session runtime

The gate separates two things the old wording ran together, and the code already implements the split — this
node was the straggler:

- **Headless adapters are accepted.** A host without tmux runs **process-host**, and process-host carries every
  adapter that does not need an attachable terminal. `spex session new --launcher snow` succeeding on a
  tmux-less native-Windows host is the measured proof, not a reading of a flag.
- **A launcher that needs a terminal is refused by name**, not half-started: `launcher 'claude' uses claude,
  which requires an attachable tmux host; process-host offers headless adapters only`. The refusal names the
  launcher and the reason, so the user repairs the CHOICE rather than guessing at a missing subsystem.
- **Nothing is walled wholesale.** `spex serve` starts, `session ls` answers (falling back to the local store
  when no backend is up), and the read-only CLI was never in scope.

**Honest gap in the code, recorded rather than papered over.** `assertSessionRuntime` short-circuits on the
tmux-less path with a warning and a `return`, so the `EX_UNAVAILABLE` (69) exit beneath it is unreachable, and
`sessionRuntimeBlock` is consulted only where `hasTmux()` is true — where it always returns null. Both are
phase-1 remains: they were written when the loud refusal *was* the sole non-tmux outcome, and the process-host
landing (which added the early return) superseded them without deleting them. Treating them as live would be
describing a gate the product does not have.

- **The deciding gap is the live-terminal bridge, and it gates ONE adapter class.** The browser Sessions
  console ([[session-console]]) streams over `tmux -CC`, tmux's structured control-mode protocol, so an
  attachable TUI needs a host that speaks it. No native multiplexer is confirmed to, so serving an interactive
  session natively means **rewriting that live streaming** — poll capture-pane, or attach another way. That
  rewrite, not a config swap, is the real cost — and it is a cost the headless path does not pay, because a
  headless adapter never opens a pane to attach to.
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
- **The session runtime degrades by capability.** See above: a tmux-less host selects process-host with one
  line saying so, carries every headless adapter, and refuses an attachable-terminal launcher by name. The gate
  keys on the missing **primitive**, not the OS name, so it is honest for both; and it never walls a subsystem —
  it selects which adapters a host can carry.

This is the same shape as [[merge-tooling-resilience]]: the single launcher entry degrades an expected
adverse condition — there a mid-merge tree, here a missing runtime primitive — into one legible line and a
distinct exit code, never a stacktrace.
