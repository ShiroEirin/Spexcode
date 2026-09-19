---
title: service-cwd
hue: 190
desc: A long-lived SpexCode process states the directory it stands on and never inherits one from its launcher; a serve whose served root disappears ends loudly.
code:
  - spec-cli/src/service-cwd.ts
related:
  - spec-cli/src/service-cwd.test.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/pty-bridge.ts
---
# service-cwd

A process that lives for days reads two different facts out of "the current directory", and only one of them
is its to keep. The directory a serving verb was *invoked* in answers one question, once — which project is
being asked for — and it belongs to whoever launched the verb: an operator's shell, a boot script, an agent
standing in its own session worktree. The directory the process *stands on* afterwards is held for its whole
life and inherited by everything it starts, so it has to outlive the process. A launcher's directory promises
no such lifetime: a session worktree is renamed into the trash and deleted at close, a scratch directory is
cleaned up, and whatever inherited it keeps running on a directory that no longer exists.

That state is invisible from inside. The runtime caches its first answer to "where am I" and keeps returning
that path, so the process that lost its directory goes on looking healthy, while every *fresh* process it
starts — a terminal helper, a replacement backend child, a spawned doctor — is born onto the dead directory
and fails on its first directory read. The failure therefore surfaces far from its cause: every session
terminal reports itself unavailable, a reload can no longer boot a child, a spawn error names the wrong
missing file.

**So every long-lived process states where it stands, at startup, and none inherits.** Each takes the directory
whose lifetime is at least its own:

- `spex serve` stands on its **served root** — the git toplevel it resolved from the invocation directory —
  and starts its backend child there explicitly ([[serve]]). Being launched from a subdirectory, or from a
  directory that later disappears, changes nothing as long as the root lives.
- The gateways that hold no project of their own, `spex dashboard` ([[host-gateway]]) and `spex serve ui`,
  stand on the user's **home directory**, the host-level home of everything else they own.
- A terminal helper ([[live-view]]) stands on the **filesystem root**: it reads nothing relative to a
  directory, so no session, project, or deployment can bound a viewer's terminal.

Which project a verb serves is unchanged: it is still read from the invocation directory, and a serve started
inside a linked worktree still serves that worktree under its own slot ([[host-gateway]]). Session targets are
not service processes either — an agent's pane is launched into its worktree on purpose and keeps it.

**A served root that disappears ends the serve.** Standing on the served root makes "lost my directory" and
"lost my project" one event, and it is not among the transient faults a serve survives: with its subject gone,
every git read, spec read, and spawn would fail or answer from a stale cache. The supervisor keeps checking
that the directory at the served root's path is still the directory it stands on — asked of the filesystem,
because the cached path cannot say — and when it is not (removed, renamed away, or replaced by a fresh
directory at the same path) it names the root, releases the port and its endpoint record, and exits non-zero.
A deployment's watchdog then starts a coherent serve from the right place, and a throwaway serve started
inside a session worktree ends with that worktree instead of surviving it as an orphan. This is a different
fact from [[worktree-resilience]], which keeps the backend alive when a worktree it merely *lists* vanishes.
The home directory and the filesystem root get no such check; their lifetime is the machine's.

Removing a worktree stays close's right. The remedy for a process that pinned a removable directory is that it
never stood there, not that the directory is kept.
