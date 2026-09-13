---
title: issue-driven-development
surface: skill
status: active
hue: 30
desc: How a session works an issue so the Issues page stays true — find the issue you are bound to, read its thread before code, report on the thread (prose for reasoning, a widget for shape), let your declarations be the status, hand work over with assign, and never write state the board already derives. Use ONLY when your prompt names an issue thread, when `spex issue mine` returns one, or when a human asks you to take an issue — never volunteer issues or this workflow when the human has not mentioned one.
---

# issue-driven-development

An issue is where the human states the task; you are a session bound to it. The Issues page shows the human
every session on the issue, what each is doing, and what needs them — **from facts you already produce**: your
record's `issue` pointer, your declarations, your posted files and widgets, your replies on the thread. This
skill is about producing those facts in the right place, so the page needs no second channel and you need no
second vocabulary. One rule underneath everything: **say it where it is read**. Reasoning goes on the thread;
state goes in a declaration; shape goes in a widget. Nothing goes in a private note the board cannot see.

**This skill is opt-in, never volunteered.** It applies when your prompt names an issue thread, `spex issue mine`
returns one, or the human asks you to take an issue. When none of that is true — the human simply asked for work
— do the work: do not bring up issues, do not open one to house the task, and do not steer the conversation into
this workflow. An issue is the human's way of stating a task, not a form you make them fill.

## 1. find your issue

- `spex issue mine` prints the issue your session is bound to (the one a thread's `@new` or `--issue`
  created you for, or that a human assigned you), with its thread. `--json` for the machine-readable form.
- No issue bound and your prompt names one? Bind yourself: `spex issue assign <issue-id> .` — the Issues page
  can only show you on the issue if the pointer exists. A worker that silently works an issue is invisible.
- Read the whole thread before any code: `spex issue show <id>`. The concern is the task; the replies are
  the decisions already made; the `[[node]]` links are the specs you work under ([[spec-first]]).

## 2. work under the issue's nodes

The issue's `[[node]]` links name the spec nodes whose contract you are changing. Read their bodies first,
change code and spec together, commit them together with the `Session:` trailer — the ordinary loop. The
issue adds one thing: **the thread is the design record**. A decision you make that the thread does not
already contain goes on the thread as a reply, before or with the commit that acts on it.

## 3. report on the thread, not beside it

- Progress that a human will read again is a **reply**: `spex issue reply <id> --body -`. Short, factual, what
  changed and what is next. One reply per real step, never a running commentary. From your worktree the verb
  reaches the store through the backend you were launched from and signs the reply with your session id — you
  do not commit to the trunk yourself, and you never need to.
- Progress with a **shape** — a checklist of nodes, a before/after measurement, a choice you need — is a
  **widget**: put it with `spex session widget put <name> <file>` and point at it from the reply as
  `[[widget:<name>]]`; the thread draws it in place ([[draw]] has the contract). Redraw under the same name
  when the meaning changes; the reply text stays the sentence, the widget stays the picture.
- Evidence a human must inspect is a posted file ([[files]] — `spex session files add <path>`, referenced as
  `[[file:<name>]]`); the issue's rail lists it under your row.
- Never paste terminal dumps or transcripts into the thread. The thread is read by humans and by every other
  session on the issue.

## 4. your declaration is your status — do not duplicate it

Your lifecycle declarations ([[declaration]]) are what the Issues page shows beside your row, painted in the
board's own colours, with your note as the tooltip:

| you say | the issue shows | when |
|---|---|---|
| `spex session done --propose merge --note "<what to review>"` | **review** · a Merge button on your row | committed work ready for the human |
| `spex session ask --note "<what you need>"` | **asking** · needs-you tone on the issue | a human decision blocks you |
| `spex session park --note "<what wakes you>"` | **parked** | a managed watch or background task will wake you |
| `spex session done --propose close --note "<why nothing to merge>"` | **close-pending** | the issue was already satisfied, or the work is discardable |

So: **do not write "status: done" in a reply**, and do not open a second issue to say you finished. The
declaration IS the status; the thread carries the reasoning behind it. A reply that says "I am blocked on X"
without an `ask` declaration is invisible to the board — the human sees a working row.

## 5. split, hand over, escalate

- **Split:** a sub-task with its own worktree is a child session: `spex session new "<task> [[node]]"` from
  inside your session. It joins the issue's fleet through you — no pointer of its own is needed
  ([[issue-binding]]). Supervise it through `spex session watch`; its declarations show on the issue too.
- **Hand over:** an existing session should take the issue instead of you → `spex issue assign <id> <SEL>`;
  it is told through its own inbox. Then declare your own end honestly.
- **Escalate:** something on the thread needs the human → `ask`, with the question in the note and, if there
  are options, a widget the human can click ([[draw]]).
- **A second concern** you find while working is a **new issue** (`spex issue open "<concern>" --node <id>`),
  linked from a reply on this one — never a silent widening of this thread.

## 6. what you never do

- Never write to the issue's own state (`close`, `promote`) as a worker. Closing is the human's act after
  merge; you declare, they close.
- Never mint a status vocabulary of your own in prose ("DONE", "WIP", emoji). The board has one.
- Never `@new` on a thread from inside a worker unless you mean to spawn a sibling worker — it is a real
  creation, bound to the same issue.
- Never assume the thread is unread: if the thread already resolves your question, act on it and say so.

## the interfaces, in one place

| need | verb | read by |
|---|---|---|
| my issue | `spex issue mine [--json]` | you |
| the thread | `spex issue show <id> [--json]` | you |
| bind / hand over | `spex issue assign <id> <SEL>` (`.` = me) | the Issues page rail, the target's inbox |
| report | `spex issue reply <id> --body -` | the thread, the originator's inbox |
| shape | `spex session widget put <name> <file>` + `[[widget:<name>]]` in a reply | the thread, in place |
| evidence | `spex session files add <path>` + `[[file:<name>]]` | the rail's card, the thread |
| status | `spex session done|ask|park …` | the row's colour, action and tooltip |
| split | `spex session new "…"` (inside your session) | the fleet, nested under you |
| a new concern | `spex issue open "…" --node <id>` | the Issues list |
