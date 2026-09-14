---
title: hook dispatcher runtime
status: active
hue: 280
desc: The one shell runtime that executes a complete manifest dispatch and preserves native hook blocking output.
code:
  - spec-cli/hooks/dispatch.sh
related:
  - spec-cli/src/hook-dispatch.test.ts
---

# hook dispatcher runtime

## raw source

The compiled manifest needs one executable owner. Dispatching is not merely related to the shell script: this
node governs the exact shell entry every harness invokes, including its scratch-state cleanup.

## expanded spec

`dispatch.sh` resolves the current tree's persistent manifest exactly as [[hook-dispatch]] defines and captures the
event input once before invoking any matching handler. A trap cleans up its per-dispatch scratch state on normal
completion, handler failure, signal, or shell exit.

The materialized shim passes its adapter id before the event. The dispatcher consumes each native id — `claude`,
`codex`, `opencode`, `pi`, and `zcode` — plus the plugin form, exports it as `SPEXCODE_HARNESS`, then dispatches
the following event. An unknown or missing adapter id is an error. `zcode` shares the Claude-family payload parser; it
is still an explicit dispatcher id, so its generated `dispatch.sh zcode Stop` command cannot silently turn
`zcode` into an event name.

The same tree slot carries the dispatch-id allowlist from its last successful materialize. A project transport
may remain installed after a selection changes, but an event whose baked harness id is absent from THIS tree's
allowlist exits before any input handling. An absent allowlist means this tree is unmaterialized and is an error.

A missing manifest is an error because silently dropping lifecycle hooks hides a broken installation. All matching handlers preserve the
existing deterministic order, blocking declaration, and Codex stderr reason translation. Their stdout is
COLLECTED and emitted once, as [[output-fold]] defines, rather than written through as each handler returns.
Zero or one structured document is passed through byte for byte, so the ordinary dispatch is unchanged and
boots nothing; only a genuine second speaker reaches the fold.

**EVERY HANDLER RUN IS RECORDED.** Before a handler runs the dispatcher appends a `start` line to this
project's hook ledger and after it returns a `done` line carrying the exit code, whether the run refused the
event, its wall-clock duration, and a refusal's reason — the format and the reader are [[hook-ledger]]'s. The
dispatcher is the only place that sees every hook run, which is what makes those counts exact rather than
sampled. Recording is a side effect and never a participant: an unwritable ledger is named once on stderr and
the dispatch proceeds unchanged, and `SPEX_HOOK_LEDGER=off` disables it. Its session column is the id the payload
names, taken with the shell mirror's own field read and never resolved to a record: resolving means store
lookups, and each one spawns git — two per dispatch on the hottest path in the product, on every tool call,
for a column no count needs. The value is filled on the first handler, so an event with no bound handlers
pays nothing for the ledger at all.

**A HANDLER THAT FAILS SAYS SO, whether or not it may block.** A non-blocking handler's exit code was dropped
and its captured stderr was overwritten by the next handler and deleted on exit, so a lifecycle hook that could
not do its job left no trace anywhere: the board simply kept whatever state it last held, and nobody could tell a
hook that ran and declined from a hook that never ran. That silence is the same class of failure as a missing
manifest, and it gets the same answer — the dispatcher names the event, the handler, and the exit code on its own
stderr and forwards whatever the handler wrote there. Reporting is the whole of it: the dispatch VERDICT stays the
blocking handlers', so a hook declared non-blocking can never become a gate by failing, and a noisy handler cannot
acquire the power to stop a turn.
