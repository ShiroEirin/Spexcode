---
title: declaration
status: active
hue: 280
desc: The worker's declaration commands — what a declaration echoes, how its note is stored in full and its table cut taught once, how a declaration that cannot find its record diagnoses itself, and the advisory reminders a declaration carries — resource cleanup and issue closeout on a propose-close, and on every declaration whether the note names an issue that can read it.
code:
  - spec-cli/src/session-declarations.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/issue-attribution.ts
  - spec-cli/src/hook-prompts.ts
  - spec-cli/src/follow-cli.api.test.ts
  - spec-cli/src/sessions.ts
---

# declaration

An agent writes its own [[state]] through `spex session done|ask|park|state`. This node owns the declaration
handler's conversation with the author — the confirmation, the note, the diagnosis when the record is not where
the author stands — every one of them a nudge riding the confirmation, never a gate.

The declaration's own write is local, but the watch notice its commit wakes is not this process's to deliver: the
shared state kit, also used by the machine lifecycle producers under `spex internal`, installs the owner-first
handover ([[remote-client]]), so a declaration returns without waiting on any watcher's harness.

A declaration echoes a one-line confirmation — recorded for
the dashboard, after which the next tool call (via mark-active) flips the record back to `active`, so an agent never reads
that re-flip as a lost proposal. Every note-carrying declaration (`done`/`ask`/`park`/`state`, all of which
accept `--note` — done included, its note reaches the record like the others') stores the note **in full**;
the CLI table may cap it, but that cut must be **transparent to the author**. The table's explicit NOTE column
keeps the first `NOTE_BOARD_LIMIT` **display columns**; dashboard titles do not display notes at all
([[session-label]]). The rule is taught **once per session**: the first time a declared note is cut by the table,
the confirmation states the note's length, what the table leaves, and where the full text is readable (`spex
review <id>` / `spex ls --json`), then drops a sentinel beside the record so later cut notes in the same session
repeat none of it (the rule was taught; a verbatim repeat on every park/ask is noise — a field-reported
irritation). Trimming stays the author's informed choice — never a silent loss — and like every echo addendum
the notice is a nudge riding the confirmation, not a gate.

A record that EXISTS but cannot carry state is a different answer from a missing one, and the writer must not
blur them: an unreadable `runtime.json` or a retired session (worktree gone) is refused with that reason and
its repair — never the wrong-cwd diagnosis below, which would send the author hunting a directory that is fine
([[sessions-core]]). A declaration that genuinely cannot find its record **diagnoses itself** instead of
answering a bare "no session record". The store resolves from the **current directory** (the cwd's git common dir), so the classic failure
is declaring from outside the session's project — and the message must say so: it names the cwd, distinguishes
the actual situations (cwd not a git repository at all — which must never surface as a raw git stack trace —
cwd in a project with no sessions, a store found here that lacks the id, or no session id resolvable from env
at all), and routes the fix for each — cd back into the session's worktree and re-declare, or pass/correct
`--session <id>`. The diagnosis changes only the message; nothing is written either way. A **propose-close** declaration additionally carries a plain reminder to reclaim
the ephemeral things the agent started to test this change — a stray process, a dev/preview server, a bound port,
a throwaway session it spawned — before the worktree is discarded and they orphan (the leak the shared tmux socket made
visible: a torn-down worktree's own backend outliving it). It is **advisory, a nudge and never a gate** (the agent
checks, then carries on; the next tool call re-flips it to `active`), and **project-agnostic**: the criterion is
whether a resource should outlive the task, never who started it — a deliberately long-running service or a
production build is started-by-you yet left alone, and anything you are unsure about is left running.
The sweep's scope is **stated, not implied**, and it **excludes THIS session by name**. `close` is human-only
(above), so the declaration has proposed a close, not performed one — while `spex session close` accepts `.` and a
bare own id like any other selector, so a session reading "shut down a session you started" at the exact moment it
is contemplating its own close can read it as permission to close itself, which deletes the worktree it is running
in mid-turn. Every surface that teaches `close` therefore says which side of the manager/worker split it is on:
`session close <SEL>` retires ANOTHER session and its selector is never `.` nor the caller's own id, while
`done --propose close` only proposes and names the human as the one who performs it. Beside that
resource reminder the same declaration appends a **data-driven issue closeout** line, owned by [[local-issues]]
(the store owns the query and the wording): the still-open local threads this session opened or replied to,
listed by id, with the ask to resolve each or say why it outlives the session — silent when the session owes
nothing or the issues feature is off, and equally a nudge, never a gate (a failure in the store check is
reported loud but the declaration still lands).

**Every** declaration — done, park, ask alike — carries one further advisory, and it is about whether what was
just written can be READ: a session bound to more than one issue attributes a declaration to an issue by the
`[[issue:<id>]]` reference in its note ([[issue-binding]]), so an unqualified note from such a session appears on
no issue page at all. That silence is spoken here, at the moment of the write, naming the issues the session
carries and the reference to add (`issue-attribution`'s `attributionNudge`, the same grammar reading the same
note). One session, one issue, or a note that names one of its issues → nothing is printed. Like its siblings it
is advisory and rides only the SUCCESS branch: the state write is never held up, refused, or altered by whether
an issue page will show it, because the session's own timeline is a declaration's first home.
