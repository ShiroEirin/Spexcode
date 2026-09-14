---
title: issue-driven-development
surface: skill
status: active
hue: 30
desc: How a session works its issue set so the Issues page stays true — find the issues you are bound to, read their threads before code, report on the threads (prose for reasoning, a widget for shape), let your declarations be the status, hand work over with assign, and never write state the board already derives. Use ONLY when your prompt names an issue thread, when `spex issue mine` returns one, or when a human asks you to take an issue — never volunteer issues or this workflow when the human has not mentioned one.
---

# issue-driven-development

An issue is where the human states the task; you are a session bound to it. The Issues page is drawn from facts
you already produce, so it needs no second channel and you need no second vocabulary. One rule underneath
everything: **say it where it is read.** Reasoning goes on the thread; state goes in a declaration; shape goes in
a widget; nothing goes in a private note the board cannot see.

When no issue is in play, the human simply asked for work: do the work. Do not bring up issues, open one to house
the task, or steer the conversation here. An issue is their way of stating a task, not a form you make them fill.

## 1. find your issue — the first thing you run, before you read any code

- `spex issue mine` prints every issue your session is bound to (`--json` for an array). Run it on your first
  turn, before opening a file: your prompt is not the pointer the board reads, and a second issue may have been
  assigned since.
- No issue bound and your prompt names one? Bind yourself: `spex issue assign <issue-id> .` — a worker the
  pointer does not name is invisible on the page.
- Read the whole thread before any code: `spex issue show <id>`. The concern is the task; the replies are
  the decisions already made; the `[[node]]` links are the specs you work under ([[spec-first]]).
- **More than one back? Then you have no "the issue" any more.** Each report goes on the thread of the issue it
  is about: posted on the other one it is silence here and noise there. Which issue a declaration is about you
  say in the note (§4).

## 2. work under the issue's nodes

The issue's `[[node]]` links name the spec nodes whose contract you are changing. Read their bodies first,
change code and spec together, commit them together with the `Session:` trailer — the ordinary loop. The
issue adds one thing: **the thread is the design record**. A decision you make that the thread does not
already contain goes on the thread as a reply, before or with the commit that acts on it.

## 3. report on the thread, not beside it

- Progress a human will read again is a **reply**: `spex issue reply <id> --body -`. Short, factual, what changed
  and what is next; one per real step, never a running commentary. The verb signs it and stores it for you —
  never commit to the trunk yourself.
- Progress with a **shape** — a checklist of nodes, a before/after measurement, a choice you need — is a
  **widget**: put it with `spex session widget put <name> <file>` and point at it from the reply as
  `[[widget:<name>]]`; the thread draws it in place ([[draw]] has the contract). Redraw under the same name
  when the meaning changes; the reply text stays the sentence, the widget stays the picture.
- Evidence a human must inspect is a posted file (`files` — `spex session files add <path>`, referenced as
  `[[file:<name>]]`); the issue's rail lists it under your row.
- Never paste terminal dumps or transcripts into the thread. The thread is read by humans and by every other
  session on the issue.

## 4. your declaration is your status — do not duplicate it

Your lifecycle declarations are what the issue shows beside your row, in the board's colours, your note as the
tooltip:

| you say | the issue shows | when |
|---|---|---|
| `spex session done --propose merge --note "<what to review>"` | **review** · a Merge button on your row | committed work ready for the human |
| `spex session ask --note "<what you need>"` | **asking** · needs-you tone on the issue | a human decision blocks you |
| `spex session park --note "<what wakes you>"` | **parked** | a managed watch or background task will wake you |
| `spex session done --propose close --note "<why nothing to merge>"` | **close-pending** | the issue was already satisfied, or the work is discardable |

So: **do not write "status: done" in a reply**, and do not open a second issue to say you finished. The
declaration IS the status; the thread carries the reasoning behind it. A reply that says "I am blocked on X"
without an `ask` declaration is invisible to the board — the human sees a working row.

**Which issue a declaration is about you say, with `[[issue:<id>]]` in the note.** Unqualified is read only from
a session carrying exactly one; carrying more, it appears on no issue page, so the human waiting on your `ask`
sees a working row and no question. The declaration verbs say when they could not attribute what you wrote.

**A closed issue is over for you**, even mid-task: you are told, and you stop there. It does not close YOU —
commit or discard anything unlanded, say so in one last reply, then declare your own end.

## 5. split, hand over, escalate

- **Split:** a sub-task is a **sub-issue**. Open it under yours — `spex issue open "<sub-task>" --parent <your-issue>
  --body -` (it takes your issue's nodes unless you name its own) — then reply `@new` on the sub-issue's thread. The
  worker that creates is bound to the sub-issue by the create itself (`issue-binding`), so its thread, its
  declarations and its merge all live there, and the parent issue's fleet is its own sessions plus every
  sub-issue's. Supervise it through `spex session watch`. Closing the sub-issues does not close yours: the parent
  shows how many are closed, and closing it stays the human's act.
- **Hand over:** an existing session should take the issue instead of you → `spex issue assign <id> <SEL>`;
  it is told through its own inbox. To stop a session carrying this issue, use `spex issue unassign <id> <SEL>`;
  the removal is also told through its inbox. Then declare your own end honestly.
- **Escalate:** something on the thread needs the human → `ask`, with the question in the note and, if there
  are options, a widget the human can click ([[draw]]).
- **A second concern** you find while working is a **new issue** (`spex issue open "<concern>" --node <id>`),
  linked from a reply on this one — never a silent widening of this thread.

## 6. what you never do

- Never write to the state of an issue **someone else opened** (`close`, `promote`): that is their judgment,
  taken after your merge lands. A concern **you filed yourself** (§5) is the exception — yours to retire when its
  work is finished. Authorship is the whole test, and `spex issue show <id>` names the opener.
- Never mint a status vocabulary of your own in prose ("DONE", "WIP", emoji). The board has one.
- Never `@new` on a thread from inside a worker unless you mean to spawn a worker for that thread — it is a real
  creation, bound to that thread's issue. On your own issue that is a sibling; on a sub-issue you opened, it is the split.
- Never assume the thread is unread: if the thread already resolves your question, act on it and say so.

