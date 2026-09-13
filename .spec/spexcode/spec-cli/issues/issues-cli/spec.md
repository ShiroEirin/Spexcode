---
title: issues-cli
status: active
hue: 30
desc: The `spex issue` CLI surface, at its own altitude — argv parsing, console output and exit codes for the issue verbs, above the store modules whose verbs it renders.
code:
  - spec-cli/src/issues-cli.ts
related:
  - spec-cli/src/issues.ts
  - spec-cli/src/localIssues.ts
  - spec-cli/src/cli.ts
---

# issues-cli

## raw source

These handlers used to live inside `issues.ts` and `localIssues.ts` — the modules the eval package imports.
A CLI surface is by definition the topmost layer: it reads argv, prints, and returns an exit code. Hosting
one inside a store/feature module gave those files two altitudes at once, and that is what held the
spec↔eval package cycle in place. The loop-in's candidate resolution needs eval knowledge; its only callers
were these handlers; and from below the eval layer they could not reach it. Every cheap alternative failed on
the same wall — moving a store primitive down, lifting the loop-in, extracting the read projection — because
each moved a LEAF of the ring while the ring was held by a module hosting several heights.

## expanded spec

issues-cli owns the `spex issue` verb surface: flag parsing, the flag-decides-the-parse
discriminators, human-readable output, and exit codes. It owns no store state and no issue semantics — it
calls the read/write verbs that `issues.ts` and `localIssues.ts` export, and it renders what they return.
The split is by ALTITUDE, not by domain: the issue domain still belongs to [[issues]] and the local store to
[[local-issues]]; what moved is the part that talks to a terminal.

Its position is what makes it useful. Sitting above the store modules, its own imports of `issues.ts` are
ordinary STATIC imports; the deferred `await import('./issues.js')` that `localIssues.ts` used to carry existed only
because a handler down there had to reach a module that imported it back, and it is gone with the handler.

This module is deliberately NOT merged into `cli.ts`. That file is the thin dispatch hub ([[cli-surface]]),
whose roughly eighty lazy import sites keep a single invocation from loading every verb's implementation;
folding the verb bodies in would trade one two-altitude module for another and cost the startup
property that discipline exists to buy. The hub reaches this module the same way it reaches every other verb:
one lazy line.

The argv helpers travel WITH the surface rather than being exported to it. `fl`, `hasFlag`, `bare`,
`readBody`, `repeated` and the value-flag set are parsing concerns, so they belong at parsing altitude; two
byte-identical copies of `fl` existed while the surface was split across two modules, and one copy is what
remains. A helper that both this module and a store module need is a signal to re-examine which of them is
really asking, not a reason to widen a store module's exports.

**`mine` is the worker's first read.** `spex issue mine [--json]` prints the issue the caller's session record points at
([[issue-binding]]), through the same merged read `show` uses; no session identity, or a session bound to no issue, is
said plainly with the way to bind one (`spex issue assign <id> .`), never guessed from prompt text.

**The hierarchy verbs render the store's forward facts.** `spex issue open --parent <id>` passes the parent through
`open`'s ordinary backend-first path; `spex issue reparent <id> --to <parent-id|none>`, `spex issue relate <id>
blocks|related|duplicate <other-id>` and `spex issue close <id> --duplicate-of <canonical-id>` commit to the local
store directly, the way `close` does, and `relate … duplicate` is spelled as that same close. The store's refusal —
a missing or closed parent, a cycle, a self-edge — is printed as `spex issue <verb>: <message>` with exit 1. `show`
and `mine` print the read-time projection under the header — parent, sub-issues with their closed count, blocks,
blocked by, related (both directions), duplicate of, duplicated by — each line only when it has an id; `ls --json`
carries the same fields on every row with no rendering of its own.

**`assign` binds an existing session to an issue.** `spex issue assign <issue-id> <SEL>` is the CLI leg of the one
assign verb ([[issue-binding]]'s `assignIssueSession`, the same function `POST /api/issues/:id/assign` runs): the
issue is read through the same merged read `show` uses (a forge id pulls the live slice), the session through the
ordinary selector, and the receipt names the binding, any previous issue it replaces, and whether the session was
told — exit 1 when the pointer was written but the message did not land, so a half-done assignment is never silent.
