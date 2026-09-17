---
title: delivery-queue
status: active
hue: 280
desc: What a session is still OWED — a small ordered queue of messages not yet handed to its agent, drained by adapter insert, empty when nothing is owed.
related:
  - packages/session-protocol/src/engine.ts
  - spec-cli/src/delivery-lock.ts
  - spec-cli/src/sessions.ts
  - packages/session-events/src/schema.ts
  - spec-cli/src/index.ts
  - packages/session-protocol/src/engine.test.ts
---

# delivery-queue

> Migration boundary: this file queue is a legacy adapter for records that have not crossed the SQLite
> application fence. Canonical sessions use `session-application`'s protocol queue and never read or write
> `pending.json`; the canonical CLI queue is application-owned and the legacy file is migration input only.

## raw source

A message has two entirely different lives, and giving one file both is what made this mechanism drift. Its
first life is **history**: it was said, it is part of the conversation, it is evidence, and it must survive as
long as the session does — that is [[session-timeline]]. Its second life is a **debt**: it has not yet been put
in front of the agent, and it stops existing the moment it has. A debt is not history. It is small, it is
ordered, it is consumed, and its natural resting state is EMPTY.

Reading the history to compute the debt is what a cursor into the log was: `pos` said "everything before here
is settled", so answering "what do I still owe?" meant parsing a file that only grows, and a session's own
declarations had to be *consumed* as if they were mail because they shared the counter. The queue below asks
for none of that. Nothing is owed exactly when the queue is empty, which is a fact about a small file rather
than a computation over a large one.

A queue is only ever filled by an enqueue, so nothing is owed that was not sent, and a log stays history no
matter how many thousands of lines it grows to. A terminal sender is the one exception to "owed until taken":
closing a session revokes its **unhanded** outbound debt everywhere, because a dead coordinator must not regain
control merely because a target was temporarily unavailable.

Text sends reject an empty or whitespace-only body at the CLI and HTTP input boundaries with a structured error;
the canonical `sendText` seam repeats that guard, so no timeline event, queue row, or adapter delivery is created.

## expanded spec

The canonical application queue, in the session database, is an ordered list of messages that have been recorded
but not yet handed to the agent. `pending.json` is migration input only, never a live queue. Each canonical entry is
self-contained — the message id, the sender, and the text exactly as it will be handed over, mechanism inserts
already composed in ([[session-timeline]] owns that seam;
the log keeps the raw conversational text, the queue keeps the transport form). A caller-keyed entry also
carries the operation plus request digest that its private timeline receipt names, never the raw key. A protocol
producer may add immutable string attributes; keyed drain compares them with the same frozen receipt bytes before
calling the consumer, so structured historical facts cannot silently drift to a newer read-model state. The ordinary
delivery path never reads the log. Only a retry of that keyed acceptance reconciles the two durable
sides: if its receipt exists without its exact message id in the queue, it restores the receipt's frozen
transport bytes under this queue's lock. Transport state and record remain independent for every ordinary
read: history could be trimmed, archived, or read by anyone without changing what is owed. An empty queue is
deleted rather than stored as an empty list, so "is anything owed?" is the existence of a file.

**The enqueue rides the append.** `sendText` records the `sent` line and enqueues the same message inside one
hold of the session's record lock ([[dispatch]]); a keyed acceptance additionally holds this queue's lock, in
the common record-then-delivery order. A proven-unreachable adapter transport joined to a still-live registered
agent is the one pre-append refusal: that session is stranded and new text must name the cause, debt count, and
raw-key bypass instead of creating more unclaimable debt. A transient/unproven probe, or a dead worker that a
later resume can address, keeps the ordinary acceptance rule: the queue is what the accepted message is owed,
not an immediate-poke receipt. Queue acceptance does not make the target `active`: lifecycle freshness changes
only after the exact message is handed to the native runtime and removed from this queue. The record is written first — a crash between the two
writes leaves a message that is visible but undelivered, never one delivered but unrecorded. For the keyed
merge intent, the receipt carries the already-composed transport bytes, so the same request reconstructs that
one missing debt rather than mistaking the durable receipt for completed delivery.

**Draining is claim-insert-remove, one head per hold of the queue's own lock.** A delivery loop takes the queue
lock, composes the head's prompt through the one seam ([[session-timeline]]), hands it to the resolved adapter,
removes it on a confirmed insert, and releases the lock before it reads the next head. An insert the adapter
refuses, cannot reach, or that throws ENDS the loop with the entry still queued, and everything behind it stays
behind it — order is a property of a conversation, so a message is never skipped to deliver a later one. A loop
that ends on a held head logs the adapter's reason once per message and reason, so owed debt is never silent and
a retried refusal does not repeat.
An attached runtime that is still inside [[stop-resume]]'s pending publication transaction is not yet admitted
for ordinary input. Both the drain entry and each claimed head recheck the same fence, retaining debt until
readiness publication completes. A binding alone cannot bypass that ordering boundary; interrupted recovery
settles the transaction before handing over the messages owed during restore.

The lock spans one insert deliberately, never a whole queue, and it is NOT the record lock: the record lock cannot
span an adapter call (a native turn runs lifecycle hooks that re-enter the record writer, which is a deadlock),
while nothing in the delivery path takes this one. Holding it across the insert is what makes "claim" real, so two
processes draining the same session at the same moment cannot both hand over the same message; releasing it
between heads bounds how long anyone can find it held to one adapter call, however much is owed. A keyed entry that the
adapter accepts appends its private timeline settlement before this lock removes the debt. That settlement is
what distinguishes "receipt exists because it was accepted" from "receipt exists and the agent already saw
it" after a restart. Before any adapter call, drain reconciles a keyed head against its exact receipt. A matching
settled receipt consumes the leftover debt without handing it over again; missing receipt, different message id,
or different frozen transport bytes refuses and leaves the head in place. Thus process death between settlement
and removal cannot duplicate an agent prompt, while corrupt authority can never silently discard one. A later
replay of the response therefore never needs to reopen the session.

**Nobody waits behind a handover.** A drain that finds the lock held does not wait for it. The holder is handing
over this same queue and reads it once more after it releases, before it may stop, so a message enqueued during
its hold is the holder's to deliver: no wake is lost and no second drain lines up behind the first. Within one
process each recipient has at most one delivery loop; a wake that finds it running — a send's own pass, a commit
wake, `/push`, a sweep tick — returns at once, because the queued row already marks what is owed and the loop reads
the queue before it stops. The sweep and the commit wake start one loop per owed recipient and never await one
recipient before the next, so a harness that keeps an insert on its rendezvous wall delays only its own queue. The
one caller that does wait for the lock is [[session-reparent]], which must see a moved child's queue between
inserts: it waits for one head, and a drain that found it busy is taken up by the retry sweep.

**Close revokes a sender, not history.** A successful close writes a durable sender-revocation marker outside
the closing session's store (which is about to disappear). Agent-to-agent dispatch takes the claimed sender's
record lock as well as the target's before it appends, while close keeps that same sender lock through record
removal and marker publication. Thus a send either finished before close began and becomes revocable debt, or
observes the marker and never records a new message; this holds across every backend sharing the store. A drain
that sees a revoked sender removes that queue entry without calling the adapter, then continues so dead debt
cannot block later mail. The target's `sent` history is intentionally unchanged: it is evidence that the message
was accepted, not permission to hand it over after the sender died. An adapter insert already claimed before
the close/reparent transaction obtains the queue lock may arrive before that operation returns; no unhanded
entry from that sender may arrive after a successful close returns.

Managed watch messages are system debt, marked with a `watch-*` idempotency key, and survive sender revocation;
they describe the subject's state rather than outbound work authored by that subject. The canonical CLI adopter
orders concurrent sends with the sender's session record lock, then writes a hashed
revocation marker under the runtime root after the retained archive record is durable. A send after the marker
is refused; a process crash between archive publication and marker write is an explicit recovery gap, not a
claim of one SQLite transaction spanning both stores.

**Supervisor transfer revokes only former control debt.** Reparent holds each moved child's record lock, its
former parent's sender lock, and the moved queues' delivery locks in one ordered transaction. It replaces the
parent/watch relation and removes unhanded entries whose `from` is that former parent, rolling both queue and
record bytes back if a later write fails. Ordinary peer messages and the target's history remain intact. This
is deliberately narrower than an authorization system: a still-live former session can explicitly send a new
peer message after reparent, but a command it had already queued cannot cross the supervisory handoff.

**Any process may drain; one process is expected to.** A pass costs nothing when the queue is empty, so
`sendText` runs one immediately in whatever process accepted the message — that is what puts the text in a
live agent's current turn instead of at the next sweep tick. When a handover to that recipient is already in
flight, the send does not wait behind it and answers `delivery: queued`; a pass that fails after the commit is
logged and still answered `queued`, because the message is accepted and a sender told otherwise would send it
twice. The retry belongs to the `spex serve` that owns the project root:
it watches the queues of its bound sessions, which is every running session whatever its adapter
([[sessions-core]]), and drains what an earlier pass could not. So a message owed to an agent whose harness was
busy or restarting, or whose handover a concurrent connection displaced ([[claude-rendezvous]]), is delivered when
it can be, rather than waiting for that agent to happen to take a turn or for the next message to arrive. A commit's
post-commit wake keeps the same owner: inside that serve it drains the woken queue directly, while a process that is
only its guest — a CLI command that committed locally ([[remote-client]]) — asks it to drain with `POST /api/sessions/:id/push` and
drains locally only when that request's connection is refused, because then no serve is there to do it. The route
answers once the drain has started, never after the handover, so no guest waits on an agent's harness; a serve that
holds no record for the session answers `404` instead of an `ok` it cannot honour. A stopped
or closed session holds no binding, so its debt is kept but not polled: retrying a runtime that is not there would
be work that grows with every such session and delivers nothing, and the resume that binds it hands the debt over.
Neither is privileged — the lock, not the process, is the guarantee.

**Delivery has exactly one shape: an ordinary prompt.** The agent receives a message the same way it receives
anything else a human types, through the harness adapter's control channel. There is no second injection path
and specifically no hook-injected mail: a turn-boundary hook reports freshness ([[mark-active]]) and never
carries conversation. This is what makes an inter-agent message indistinguishable from a human one at the
point of arrival, which is the only thing that lets an agent answer it without knowing which it was.

A queue dies with its session's store dir. It is transport state with no evidentiary value — what was actually
said is in the log, and what an agent was shown is in its own transcript.
