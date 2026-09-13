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
  - spec-cli/src/issue-assign.ts
  - spec-cli/src/issues-cli.ts
  - spec-cli/src/index.ts
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
  create it forwards) passes it by hand; and an existing session is bound later by the assign verb — `spex issue assign <issue> <SEL>` and
  `POST /api/issues/:id/assign {session}` are one function (`assignIssueSession`): the ordinary session selector
  ([[session-selectors]]) over the working board picks the session (a closed one is off the board and refused; an
  unknown or ambiguous selector fails with the resolver's own words), its record gains the pointer under the
  record lock (re-pointing from another issue is allowed and named in the outcome), and the session is TOLD through
  the one ordinary send path with an assignment message that says it is taking this thread on beside its own task.
  Both halves are one verb: a pointer nobody told the worker about is a lie on the board, and a message without the
  pointer leaves the Issues page blind. It is the twin of [[session-reparent]], moving `issue` instead of `parent`.
- **Joined at read, descendants inherited.** The dashboard's `issueFleet(issueId, sessions)` is the ONE
  issue→session join: `assigned` are the unarchived board rows whose `issue` is this id; `fleet` adds every
  descendant of those rows through the same read-time tree the forest is drawn from — a worker's children
  work its issue without each writing a pointer, exactly as a child is promoted when its parent closes. An
  issue's **work state** is rolled up from the fleet as a fold pod rolls up a subtree (`need` > `run` >
  `stopped`, `none` without a fleet); it is derived on every read, stored nowhere, and never written back onto
  the issue's own open/closed lifecycle ([[issues]] keeps that). `issueParticipants` is the separate
  presence list — originator and reply authors that resolve to board rows outside the fleet — because
  talking on a thread is not the fact of being dispatched for it.
- **The Issues page shows it in three places ([[issues-view]]).** The LIST row's trailing meta carries a
  fleet strip: up to four status glyphs in the board's own STATUS_COLOR/STATUS_GLYPH, `+n` past that, the chip
  toned by the work state, every session and status on hover — so the list answers "whose turn is it" without
  re-sorting. The DETAIL status band carries the work-state word and the same strip beside the issue's own
  state mark. The DETAIL rail carries a **Sessions** section drawn in [[review-chrome]]'s OWN vocabulary — never the console
  sidebar's row: each fleet row is the rail's SideValue (a status dot in the board's STATUS_COLOR leading a
  truncating headline), indented by its depth in the forest with the icon-system chevron as its only fold control,
  and every control on the page is the ONE `ds-action` rail button (the composer's lifecycle actions wear the same
  control in their own tones). A right-click opens the ONE session context menu (rename, attach,
  detach, close — the menu offers its select row only to a host that owns a selectable list), and at most
  ONE state-gated action button per row on the same facts the console toolbar gates on: `review` → Merge
  (POST `/api/sessions/:id/merge`, the only declaration that offers a clickable merge — [[state]]),
  `retired` → Close (the menu's own confirm), liveness `offline` and not `queued` → Relaunch. A plain click on a
  row opens its **card** in place (a second click closes it): the session's status word and declaration note,
  its branch, and its posted files / web services / widgets as REAL anchors into the console surface that shows
  each ([[resource-tabs]]' address grammar) — every fact already on the wire, no second viewer — plus an **Open
  console** anchor, the door a plain click used to be; ctrl/⌘-click still opens the console in a new tab. The
  section's **New worker** door posts the SAME durable `@new[:<launcher>]` token a hand would type as a reply on
  the thread, so the dispatch is recorded where it happened and spawns through the one grammar; a second
  launcher is chosen through the shared launcher list. The **Assign…** door opens the ONE session picker
  ([[session-picker]]) in a modal over every retained board session not yet on the issue and calls the assign
  verb. A **participants** row lists the other thread voices as liveness chips. The originator row is unchanged.
- **The `fleet:` facet.** The join and the work-state rollup live in the shared review package (`@spexcode/spec-core/review`'s
  `issueFleet` / `fleetWorkState`), so the server's issue adapter exposes `fleet:need|run|stopped|none` as one more fixed-value
  facet in [[review-chrome]]'s secondary Filters menu — `fleet:need` lists exactly the rows whose strip reads "needs you",
  because both read the same function over the same board. Like [[live-session-filter]] it is token surgery + a history
  PUSH, hides when the data is one-sided, and never hides an active off-switch.
- **A reply draws its author's widgets.** A `[[widget:<name>]]` in a reply written by a board session renders THAT
  session's widget in the thread ([[widgets]]): the scope is the author's own widget list, so a worker reports
  shape on the issue with the same picture it draws in its conversation, and a name it never put stays the
  unresolved chip. `spex issue mine` is the worker's first read — the issue its record points at, with its thread.
  The behaviour a worker owes the page is the [[issue-driven-development]] skill: say it where it is read.
- **The thread is the ledger.** The declarations of every fleet session — `awaiting` (shown as the board's
  review / done / close-pending word), `asking`, `parked`, `error` — are read from each session's own timeline
  ([[session-timeline]]) and merged into the reply thread at read time, oldest first, a reply before a declaration
  made at the same instant. A ledger row names the session, the status word in the board's colour, and the note;
  `active`, `idle` and `queued` stay off it. Nothing is written to the issue: the worker's `done --propose merge`
  IS its report of readiness, which is why the skill forbids typing a status into a reply. A timeline that cannot
  be read contributes nothing, never a broken thread; the ledger re-reads when a fleet row's status or note moves.
- **The composer's explicit send door.** The shared reply composer ([[issues-view]]) reads the draft's `@<id>`
  tokens that name a retained board session EXACTLY (`mentionedSessions`; the autocomplete writes full ids, so a
  prefix, a label, or the `@new`/`@parent:` doors are never deliveries) and shows one **Send to @x** button per
  session in its action row. Pressing it posts the reply and hands the same text to that session as one ordinary
  send (`deliverTo` on the reply write; the server posts first, then delivers, and names a failed target in the
  outcome). The `@` token itself stays a passive reference ([[mentions]]): the BUTTON is the act, so historical
  prose, quoted tokens, and agent prompts gain no side effect.
- **Honest faces.** No fleet reads as `no session`, never as an empty control; a refused merge/relaunch/dispatch
  surfaces its error in the detail's action row; everything repaints on the board push the page already
  follows, since the fleet is a join over the board's own `sessions`.
