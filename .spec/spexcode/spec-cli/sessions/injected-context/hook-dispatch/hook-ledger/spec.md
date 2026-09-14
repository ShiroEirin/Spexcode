---
title: hook ledger
status: active
hue: 280
desc: The dispatcher's own record of every hook run — two lines per handler, appended where it happens — and the reader that aggregates it into exact per-hook counts over a stated window.
code:
  - spec-cli/src/hook-ledger.ts
related:
  - spec-cli/hooks/dispatch.sh
  - spec-cli/src/hook-ledger.test.ts
  - spec-cli/src/index.ts
---

# hook ledger

A project's automation runs constantly and left no trace. [[dispatcher-runtime]] ran every handler and
recorded nothing: its scratch stderr was deleted on exit, so nobody could tell a hook that ran and declined
from a hook that has never fired in its life, and nobody could say what a lifecycle hook costs the turn it
sits in. That absence is why the board could only ever describe declarations.

## the count is exact because the counter is the runner

This is not sampling, instrumentation, or inference. The dispatcher IS the single entry point every harness
invokes for every event in every tree of this project, so a line written there is one run of one handler, and
the absence of a line is the absence of a run. No other reader could make this claim: a log scraper would
miss what never printed, a session transcript sees only its own session, and a count derived from
declarations is not a count at all — that is the mistake the retired health bar made, and the difference is
that this number's denominator exists.

What is counted is a DISPATCH. A hook the active profile turned off is still dispatched and returns as a
clean no-op, so it appears here as a run, because that is the truth about what its event paid for it. The
ledger does not model intent; it records execution.

## two lines, because a run that was killed is not a run that did not happen

Each handler writes `start` before it runs and `done` after. A dispatch the harness killed mid-way is
therefore a start with no done, which is reported on its own rather than folded into the totals: a run with
no outcome has no exit code, no duration, and no verdict, and averaging it in would quietly corrupt every
number beside it. Only `done` lines are counted as runs.

A line is one append of one short record — the acting session, event, hook, order, exit code, whether it
refused, its wall-clock duration, and the refusal's reason flattened to a single line. The session is the id
the harness's payload named, unresolved: a hook fires on the hot path, where resolving a record id costs a git
spawn per lookup, so the writer records what it was handed and any reader that needs the SpexCode record
resolves the alias itself, once, off that path. Concurrent sessions of one project write to
one day file, and a single write far under a page never interleaves, so the file needs no lock. The reason is
carried because a refusal a reader cannot explain is a number they will not trust.

## the window is part of the answer

Day files, and the reader takes the most recent thirty of them and reports which day it started from. A
reader that promised all-time would grow without bound and would start lying the day someone trimmed the
directory. Every count this surface hands out is therefore paired with the window it covers, and a page
drawing them must say so too.

## it never changes the verdict, and it can be turned off

The ledger is a side effect of dispatching, never a participant in it: an unwritable directory is reported
once on the dispatcher's stderr and the dispatch proceeds exactly as before, because a bookkeeping failure
that could block a turn would be a worse bug than having no bookkeeping. `SPEX_HOOK_LEDGER=off` silences it
entirely for a run that must leave nothing behind.

It lives in the per-project runtime store beside the session records, not in a worktree, for the same reason
everything else materialized does: it is a fact about the project's automation, not a file the project's
source should carry.
