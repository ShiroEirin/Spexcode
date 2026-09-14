---
title: issue-binding
status: active
hue: 300
desc: A session records the set of issues it works for — `issues`, provenance beside `parent`, written at create (a thread's @new, `--issue`) and joined at read — so the Issues page can show, act on, and dispatch the sessions bound to an issue without the issue storing anything.
code:
  - spec-dashboard/src/IssueSessions.jsx
related:
  - spec-cli/src/session-record.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/mentions.ts
  - spec-cli/src/issue-assign.ts
  - spec-cli/src/issue-attribution.ts
  - spec-cli/src/issue-attribution.test.ts
  - spec-cli/src/issues.ts
  - spec-cli/src/session-declarations.ts
  - spec-cli/src/issues-cli.ts
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/sessions.test.ts
  - packages/spec-core/src/layout.ts
  - spec-dashboard/src/session.js
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/session.test.mjs
  - packages/spec-core/src/review/session.js
  - spec-dashboard/src/issueLedger.js
  - spec-dashboard/src/issueLedger.test.mjs
  - spec-cli/src/issue-assign.test.ts
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

- **A set, on the session.** The record carries `issues: string[]` — the ids of every issue this
  session works for (`local#…` or a forge id such as `github#12`), stored beside `parent` in the runtime
  envelope (`issues`, conditional like `base`: an unbound record keeps its exact bytes) and projected on the
  public `Session`. It lives on the SESSION, never on the issue: a forge issue cannot hold a local session id,
  a local issue is a git commit per write, and the session record is the store SpexCode already owns for
  provenance. Cardinality is session→issues 0..n and issue→sessions is a read-time join: one supervisor may
  handle several issue threads at once. Like `parent` ([[session-nesting]]) it is provenance and layout only — it never enters
  lifecycle reconciliation, liveness, budgets ([[host-resource-budget]]), or any inferred transition. For
  compatibility, readers expose derived `issue = issues[0] ?? null`; it is not written for new records and will retire.
- **Written at the create boundary, three ways, one owner.** `sessionCreateRequest` accepts `issue` as one
  more closed-shape input (a non-string is refused with `session-create issue must be a string`; it is
  trimmed, bound into the idempotency payload, and copied onto the record). Nothing resolves or validates the
  id against a store: the create boundary records what the caller said, and the Issues page's join is what
  gives it meaning. The three writers: a thread's `@new` ([[mentions]]) passes the containing thread id — a
  Command Box `@new` has no issue to inherit and passes none; `spex session new --issue <id>` (and the peer
  create it forwards) passes it by hand; and an existing session is bound later by the assign verb — `spex issue assign <issue> <SEL>` and
  `POST /api/issues/:id/assign {session}` are one function (`assignIssueSession`): the ordinary session selector
  ([[session-selectors]]) over the working board picks the session (a closed one is off the board and refused; an
  unknown or ambiguous selector fails with the resolver's own words), its record gains the issue in the set under the
  record lock (a duplicate is an idempotent no-op), and a newly-added binding tells the session through the one
  ordinary send path with an assignment message that says it is taking this thread on beside its own task. `spex issue
  unassign <issue> <SEL>` and `POST /api/issues/:id/unassign {session}` remove one member and tell the session that it
  no longer owns the thread; repeated removals are no-ops. Both halves are one verb: a binding nobody told the worker
  about is a lie on the board, and a message without the binding leaves the Issues page blind. The assignment message
  names the issue's id in place of every pronoun and DERIVES its scope clause from the set the assign just wrote: a
  session that now carries several is told the count, the ids, and that each reply belongs on its own thread while
  each declaration note names its issue — measured, a worker told only to "read the thread and act on it" while
  already holding another issue reported its progress on the OTHER thread and left this one empty.
- **A close is the third message of the binding.** Closing an issue ([[issues]]) tells every session whose own
  `issues` set names it that the thread is landed, through the same one send path assign uses: stop working it,
  post no more replies on it, and — if other issues remain in the set — carry on there, naming the issue in what
  you write. It deliberately does neither of the two things a reader might expect: it does not UNBIND (the pointer
  is provenance, and the closed issue's page still shows who worked it) and it does not END the session (that is
  the session's own act, [[state]]) — so the notice says the thread is landed and asks the session to declare its
  own end if it holds unlanded work. Only the pointer holders are told, exactly who assign speaks to: a descendant
  working through its parent's pointer received the work from its parent and hears from it. The notice is advisory
  around a durable write — a close is never undone because a queue was unreachable, its per-session outcome is
  reported beside the close, and a repeat close tells nobody because it changed nothing. Measured before it
  existed: a closed issue reached its fleet as nothing at all, and its workers went on replying to it and
  repeating work.
- **Joined at read, descendants inherited.** The dashboard's `issueFleet(issue, sessions)` is the ONE
  issue→session join: `assigned` are the unarchived board rows whose `issues` contains this issue or any issue below it (the
  read-time tree's `descendants`, [[issues]]) — a parent issue's fleet is its own plus every sub-issue's, so splitting
  work into sub-issues never hides a worker from the issue it serves; `fleet` adds every
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
  state mark. The DETAIL rail carries a **Sessions** section whose rows ARE the one session row every list surface draws
  ([[session-row]]'s `SessionConsoleTreeRow`: glyph, headline, fold pod, tree rails), re-fitted to the rail by CSS
  only — never a second row face — and every control on the page is the ONE `ds-action` rail button (the composer's lifecycle actions wear the same
  control in their own tones). A right-click opens the ONE session context menu (rename, attach,
  detach, close — the menu offers its select row only to a host that owns a selectable list), and at most
  ONE state-gated action button per row on the same facts the console toolbar gates on: `review` → Merge
  (POST `/api/sessions/:id/merge`, the only declaration that offers a clickable merge — [[state]]),
  `retired` → Close (the menu's own confirm), liveness `offline` and not `queued` → Relaunch.
  **The rail is NAVIGATION, the body is the record.** Every session involved leaves its trace in the thread — its
  latest declaration, its replies — and each of those rows is addressable by its author. A plain click on a rail row
  (or a voice chip) scrolls to that session's trace and marks it briefly; it does NOT leave the page. Leaving is the
  trace's own **Open console** door, one step further in, and ctrl/⌘-click on the rail row still opens that console
  directly. A session with no trace yet (queued, nothing declared) has nothing to point at, so its click falls back to
  the console. The rail draws no card of its own: it answers who is on the issue and whether anyone needs the human,
  the body answers what each one said, and the console answers what one is doing.
  section's **New worker** door does not dispatch: it types the grammar's `@new:` trigger into the reply composer —
  the launcher menu opens there as it does for a hand — and the human's send is the act. Every write on the page
  leaves through the composer's send; a door only prepares it ([[mentions]], [[composer]]). The **Assign…** door opens the ONE session picker
  ([[session-picker]]) in a modal over every retained board session not yet on the issue and calls the assign
  verb. Below a hairline in the SAME section, the voices not in the fleet: the originator tagged `opener` (a fleet row that
  filed the issue carries the tag itself), then every other reply author tagged `replier` — each in the one session vocabulary (headline + status dot while on the board; archived name +
  `closed` tag from the archive index once closed; plain value for a human or forge login). The rail keeps no separate
  originator row.
- **The `fleet:` facet.** The join and the work-state rollup live in the shared review package (`@spexcode/spec-core/review`'s
  `issueFleet` / `fleetWorkState`), so the server's issue adapter exposes `fleet:need|run|stopped|none` as one more fixed-value
  facet in [[review-chrome]]'s secondary Filters menu — `fleet:need` lists exactly the rows whose strip reads "needs you",
  because both read the same function over the same board. Like [[live-session-filter]] it is token surgery + a history
  PUSH, hides when the data is one-sided, and never hides an active off-switch.
- **A reply draws its author's widgets, live.** A `[[widget:<name>]]` in a reply written by a board session renders
  THAT session's widget in the thread ([[widgets]]), and a `[[file:<name>]]` opens THAT session's posted file
  ([[files]]): the scope is the author's own lists, so a worker reports shape on the issue with the same picture
  and the same file it shows in its conversation, and a name it never put stays the unresolved chip. The widget is
  as live as in the conversation, because the issue page is one more home of [[widgets]]' one host: a click
  drafts into the thread composer's queue, and the send posts the draft text (with whatever was typed) as ONE
  reply, delivers it to every session whose widget contributed — the question was that session's, so the answer
  reaches it — and commits each state to the session that OWNS the widget. The write carries
  `widgets: [{ session, name, state }]`; the server groups them by owner and commits after the reply is durable and
  before any delivery, whether or not the owner is reachable, naming a commit that failed in the outcome. A worker
  that needs a decision therefore asks it on the issue with a widget, and receives the answer as a message.
  `spex issue mine` is the worker's first read — every issue its record points at, with each thread.
  The behaviour a worker owes the page is the [[issue-driven-development]] skill: say it where it is read.
- **The thread is the ledger.** The declarations of every fleet session — `awaiting` (shown as the board's
  review / done / close-pending word), `asking`, `parked`, `error` — are read from each session's own timeline
  ([[session-timeline]]) and merged into the reply thread at read time, oldest first, a reply before a declaration
  made at the same instant. A ledger row names the session, the status word in the board's colour, and the note;
  `active`, `idle` and `queued` stay off it. Nothing is written to the issue: the worker's `done --propose merge`
  IS its report of readiness, which is why the skill forbids typing a status into a reply. A timeline that cannot
  be read contributes nothing, never a broken thread; the ledger re-reads when a fleet row's status or note moves.
  A note containing `[[issue:<id>]]` is attributed only to that named issue; an unqualified note falls back to the
  session's sole assigned issue, while a session assigned to multiple issues contributes no unqualified row. The
  reference is passive and renders as the same issue-detail link in the session timeline and this thread. Because
  that rule makes an unattributable declaration reach NO reader, it is spoken at the write: `spex session
  done|ask|park` from a session carrying several issues whose note names none of them prints what it just cost
  ([[declaration]]), and `spex issue mine` says the rule at the one moment the count is known. Both are advisories
  around the same one grammar — nothing is stored twice, and no verb gains an issue flag beside the reference.
  **One line per session, and the ledger starts where the issue starts.** The thread keeps only each session's LATEST
  declaration, with a door into that session's console beside it: the issue page answers "who is on this and what state
  is it in", the session's own console answers "what is it doing", and copying its whole message stream here answered
  the second question badly. Sub-issue events are the issue's own history and are never thinned. Declarations dated
  before the issue's own `created` instant are cut: declarations dated before the issue's own `created` instant are cut —
  a session bound to an issue later in its life brings its earlier day with it, and none of it was about this issue
  (the binding instant is not recorded; `created` is the honest floor). A row without a parseable instant is kept.
- **Issue writes go backend-first, except into a disposable store.** `spex issue reply` / `open` post to the reachable
  backend (it serves the trunk and owns the store write) signed with the caller's session id, and fall back to the local
  write only when no backend answers. `SPEXCODE_ISSUES_DIR` is the one override that never leaves the process: a
  disposable store is a local write by definition, so an isolated run can never land on the real trunk through the
  project's recorded live backend — which outranks an unreachable env address for a shell without a session identity.
- **Closing an issue asks about its fleet first.** An issue closed while the sessions carrying it are still open leaves
  the board lying — the issue reads finished, its workers read busy. So while the fleet has any row, **Close issue**
  opens a confirmation over the FLEET only (the thread's other voices carry no work): the rows that have settled
  THEMSELVES (`close-pending`, `retired`) are listed first and pre-picked, the rows still live (working, asking,
  parked, review, error) below them. **The two groups are exclusive**, because they are two different acts: picking
  settled rows closes them with the issue through the same session-close route the console menu uses; picking live
  rows instead asks each to wrap up — one ordinary message telling it to commit or discard, report on the thread, and
  declare its own `done --propose close` — and the issue STAYS OPEN, because ending a session is its own act
  ([[state]]) and closing the issue is the human's. Picking across the boundary switches groups rather than mixing
  them, so nothing live is ever closed by surprise, and what one press does is derived from the picked set alone
  (`issueClose.js`: `closable`, `closeAction`), never a second piece of state. An issue with no fleet closes directly,
  as before.
- **The composer's explicit send door.** The shared reply composer ([[issues-view]]) reads the draft's `@<id>`
  tokens that name a retained board session EXACTLY (`mentionedSessions`; the autocomplete writes full ids, so a
  prefix, a label, or the `@new`/`@parent:` doors are never deliveries) and shows one **Send to @x** button per
  session in its action row. Pressing it posts the reply and hands the same text to that session as one ordinary
  send (`deliverTo` on the reply write; the server posts first, then delivers, and names a failed target in the
  outcome). A delivery is accepted when it is appended to the target's queue, and the handoff to the target's
  harness runs after the response, as the Command Box's does: the human's send never waits on a slow pane. The `@` token itself stays a passive reference ([[mentions]]): the BUTTON is the act, so historical
  prose, quoted tokens, and agent prompts gain no side effect. The plain Send makes one delivery without a button:
  to the owner of a pending widget draft (above). That answer belongs to the widget, so it goes to the session
  that asked the question.
- **Honest faces.** No fleet reads as `no session`, never as an empty control; a refused merge/relaunch/dispatch
  surfaces its error in the detail's action row; everything repaints on the board push the page already
  follows, since the fleet is a join over the board's own `sessions`.
