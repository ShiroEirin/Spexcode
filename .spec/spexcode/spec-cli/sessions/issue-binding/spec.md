---
title: issue-binding
status: active
hue: 300
desc: A session records the ONE issue it works for — `issue`, provenance beside `parent`, written at create (a thread's @new, `--issue`) and joined at read — so the Issues page can show, act on, and dispatch the sessions bound to an issue without the issue storing anything.
code:
  - spec-dashboard/src/IssueSessions.jsx
related:
  - spec-cli/src/session-record.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/mentions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/sessions.test.ts
  - packages/spec-core/src/layout.ts
  - spec-dashboard/src/session.js
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/session.test.mjs
---
# issue-binding

## raw source

An issue is where a human states a task; a session is the worker that does it. The two had no durable edge:
`@new` in a thread spawned a worker whose PROMPT named the thread, and nothing on the record did, so "which
sessions are on this issue" was unanswerable, and the Issues page — the place a human triaging work actually
reads — could show an originator chip and nothing else. The maintainer's directive: make the Issues page the
place sessions are seen and driven from ("在 Issues 区如何展示 session，其实是 issue 驱动开发的一个关键"),
with one visible fleet per issue, and close/retire/children/acceptance reachable right there.

## expanded spec

- **One pointer, on the session.** The record carries `issue: string | null` — the id of the issue this
  session works for (`local#…` or a forge id such as `github#12`), stored beside `parent` in the runtime
  envelope (`issue`, conditional like `base`: an unbound record keeps its exact bytes) and projected on the
  public `Session`. It lives on the SESSION, never on the issue: a forge issue cannot hold a local session id,
  a local issue is a git commit per write, and the session record is the store SpexCode already owns for
  provenance. Cardinality is the worker's: one worktree, one task, so session→issue is 0..1 and issue→sessions
  is a join. Like `parent` ([[session-nesting]]) it is provenance and layout only — it never enters
  lifecycle reconciliation, liveness, budgets ([[host-resource-budget]]), or any inferred transition.
- **Written at the create boundary, three ways, one owner.** `sessionCreateRequest` accepts `issue` as one
  more closed-shape input (a non-string is refused with `session-create issue must be a string`; it is
  trimmed, bound into the idempotency payload, and copied onto the record). Nothing resolves or validates the
  id against a store: the create boundary records what the caller said, and the Issues page's join is what
  gives it meaning. The three writers: a thread's `@new` ([[mentions]]) passes the containing thread id — a
  Command Box `@new` has no issue to inherit and passes none; `spex session new --issue <id>` (and the peer
  create it forwards) passes it by hand; and an existing session is bound later by the assign verb
  ([[issues-cli]], pending: `spex issue assign <issue> <SEL>` = write the pointer + one ordinary
  `session send` carrying the thread — the twin of [[session-reparent]], moving `issue` instead of `parent`).
- **Joined at read, descendants inherited.** The dashboard's `issueFleet(issueId, sessions)` is the ONE
  issue→session join: `assigned` are the unarchived board rows whose `issue` is this id; `fleet` adds every
  descendant of those rows through the same read-time tree the forest is drawn from — a worker's children
  work its issue without each writing a pointer, exactly as a child is promoted when its parent closes. An
  issue's **work state** is rolled up from the fleet as a fold pod rolls up a subtree (`need` > `run` >
  `offline`, `none` without a fleet); it is derived on every read, stored nowhere, and never written back onto
  the issue's own open/closed lifecycle ([[issues]] keeps that). `issueParticipants` is the separate
  presence list — originator and reply authors that resolve to board rows outside the fleet — because
  talking on a thread is not the fact of being dispatched for it.
- **The Issues page shows it in three places ([[issues-view]]).** The LIST row's trailing meta carries a
  fleet strip: up to four status glyphs in the board's own STATUS_COLOR/STATUS_GLYPH, `+n` past that, the chip
  toned by the work state, every session and status on hover — so the list answers "whose turn is it" without
  re-sorting. The DETAIL status band carries the work-state word and the same strip beside the issue's own
  state mark. The DETAIL rail carries a **Sessions** section: the fleet as the ONE session forest
  (`SessionConsoleTreeRow`, fold pods, [[session-forest]]), a plain click opening the session's console and
  ctrl/⌘ a new tab ([[tab-strip]]), a right-click opening the ONE session context menu (rename, attach,
  detach, close — the menu offers its select row only to a host that owns a selectable list), and at most
  ONE state-gated action button per row on the same facts the console toolbar gates on: `review` → Merge
  (POST `/api/sessions/:id/merge`, the only declaration that offers a clickable merge — [[state]]),
  `retired` → Close (the menu's own confirm), liveness `offline` and not `queued` → Relaunch. The section's
  **New worker** door posts the SAME durable `@new[:<launcher>]` token a hand would type as a reply on the
  thread, so the dispatch is recorded where it happened and spawns through the one grammar; a second launcher
  is chosen through the shared launcher list. A **participants** row lists the other thread voices as
  liveness chips. The originator row is unchanged.
- **Honest faces.** No fleet reads as `no session`, never as an empty control; a refused merge/relaunch/dispatch
  surfaces its error in the detail's action row; everything repaints on the board push the page already
  follows, since the fleet is a join over the board's own `sessions`.
