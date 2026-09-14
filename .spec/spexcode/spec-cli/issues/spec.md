---
title: issues
status: active
hue: 30
desc: One Issue object over every store — a concern bound to nodes, with its own lifecycle. Local-store threads and forge issues are the same type behind a per-issue storage adapter; one merged read port serves the CLI, the API, and the board.
code:
  - spec-cli/src/issues.ts
related:
  - spec-cli/src/issues.test.ts
---
# issues

## raw source

A thread in the local issue store and an issue on a forge are **literally the same object on the proper
abstract level** — a recorded concern bound to spec node(s), carrying its own lifecycle, living *beside*
the graph and never *as* node state. Local and remote issues are the SAME data model under the SAME name —
an issue; a store where either needs a different model or a different word is a bug. Where one is stored is a property of the individual issue, not a
mode of the project: a project has **both at once, mixed** — an agent's taste concern living local next
to a human-visible GitHub issue, on the same nodes. Don't build two parallel systems and promise a
bridge; build the one object and let the stores be adapters.

## expanded spec

**The core type.** An `Issue` is `{ id, store, concern, by, status, nodes[], created, closedAt,
body, replies[], evidence[], labels[], url?, parent, relations[], children[], descendants[], childCounts, blockedBy[],
relatedBy[], duplicatedBy[], duplicateOf }`. `store` names the adapter that holds it (`local`, or a forge host
like `github`) — data, not a mode. There is deliberately **no content-kind taxonomy**: a field that does
no mechanical work (nothing branches on it) is a label, not structure — what a thread *is* (a change
suggestion, an annotation, a question) is what its prose says.
`nodes[]` is the binding to the graph; `status` is the issue's OWN lifecycle,
authored in its store, never git-derived (a node *defines*, an issue *does* — [[spec-forge]]'s two-plane
contract holds here unchanged). `evidence[]` is a list of content-addressed evidence hashes — the typed
target video evidence points at when a video finding routes to the responsible node's concern. A reply
is `{by, at, body}` — author, instant, prose — and nothing more: there is one reply shape, no per-reply
state bit and no per-reply lifecycle; what a reply is, its prose says.
`created` and `closedAt` are the store's own instants. `closedAt` is when the issue left open — a local close stamps
it ([[local-issues]]), a forge issue carries its host's close time — and `null` while the issue is open or when its
store never recorded one (a local thread closed before the key existed). It is a timestamp beside `status`, not a
second lifecycle: nothing reads open or closed from it, and it exists so a surface can place a close on a time line.

**The hierarchy is a projection over the merged set, rebuilt on every read.** A store holds two forward facts — an
issue's direct `parent` pointer and the `relations` it initiated (`{type, id}`, type `blocks` / `related` /
`duplicate`; [[local-issues]] owns how they are stored and written) — and `issueHierarchy`, a pure function over the
whole merged set, derives the rest before any caller sees it. A pointer holds while it names another issue present
in the set, whatever that issue's status — a closed tree keeps its shape, so the Closed view still nests and a closed
child still names its parent. An absent parent, or membership in a pointer cycle, reads as `parent: null` — the child
is promoted to a root with no child rewrite, the discipline of [[session-nesting]] (a cycle member's own descendants
stay attached). `children` are the direct children in creation order, closed ones included, and `childCounts` splits
them `{open, closed}`; `descendants` are every issue below through those pointers, depth-first in the same order —
the set an issue's fleet is joined over ([[issue-binding]]). An edge to an id outside the set is dropped, so every id a surface receives resolves; a
`blocks` edge whose initiator is no longer open reads as `related` and is never rewritten in the store; `blockedBy` /
`relatedBy` / `duplicatedBy` are the reverse edges after that downgrade, and `duplicateOf` is the initiator's
`duplicate` target. The projection writes nothing and triggers nothing: a parent never closes because its children
did (closing stays a human act — [[state]]); the counts exist so a surface can show progress and offer Close. A forge
issue stores none of this, so it arrives with `parent: null` and `relations: []` and is otherwise projected like any
other issue. Every merged read carries the projection — `ls` / `show` / `mine`, the `GET /api/issues` rows,
`GET /api/issues/:id`, and the board fold. The single-issue HTTP read additionally carries `refs` (`issueRefs`): for
every id its `parent`, `children` and relation fields name, that issue's compact `{id, store, concern, status, by,
created, closedAt, childCounts, descendants}` from the same merged set, so a detail page titles and marks every link it draws
from the one read instead of a read per id.

**Two stores, one translation rule.** The **local** store is the local issue store ([[local-issues]] owns its whole
mechanism — venue, file format, lock, trunk commit); a local issue thread *is* a local Issue, its `store` implied
by where it lives, never written into the file. The **forge** store rides [[spec-forge]]'s tracer read:
a `ForgeIssue` becomes an Issue at this boundary — id `<host>#<number>`, title → concern, state → status, the host's close time → `closedAt`,
its comments → `replies[]` (the SAME Reply shape a local issue thread carries — both stores' discussions are one
thread type, so every surface renders one kind of thread), and its platform labels → `labels[]` (name plus the
optional display colors the host supplied), and the host's node-naming conventions (`Spec:`
body marker, transitive PR links — [[links]]) translated into `nodes[]` **here**, so product semantics see
only `nodes[]` and never know a marker existed. A local Issue has `labels: []`; label metadata is display-only,
never a second lifecycle, concern taxonomy, or SpexCode-owned label scheme. Platform differences live at the
adapter boundary; nothing downstream branches on store.

**One read, differently freshened — and ONE time line.** `mergedIssues(forgeState, nodeIds)` is a pure
merge that interleaves every store by creation time, **newest first** — the stores are the same
abstraction, so a github issue, a gitlab issue, and a local thread sort as one list, never
store-grouped blocks (that grouping is exactly the two-surfaces smell this node exists to kill). Nothing
is filtered here: every local thread, noded or nodeless, is in the merged set, so the drain, the board badge
and the [[issues-view]] Issues page list all show the same threads. Each
caller supplies the forge slice at the freshness its surface warrants — the server ([[dashboard-issues]]'s
resident cache: instant view, background reconcile) for `GET /api/issues` and the board fold, the CLI
(`spex issue ls [--node] [--store] [--all] [--json]`) via a live driver pull that **degrades loudly
to local-only** (one stderr note) when the forge is unreachable — local reading never hostages on a
network. The **single-thread detail is the same read, narrowed** (`findIssue`): `spex issue show <id>` and
`GET /api/issues/:id` both find the id inside the same merged set — never a second lookup path — with the
same per-surface freshness (live pull on the CLI, resident slice on the server; a local id skips the forge
slice entirely). The board fold attaches each node's merged issues (`issues` / open subset `openIssues`), so every
per-node surface — tile badge, node-info Issues tab, and the [[issues-view]] page — reads the
same mixed set with no second path; the board also carries ONE top-level freshness stamp over the whole
merged set (open/thread/reply counts + latest activity), so any thread write — reply, close, on a noded
or nodeless thread — moves board bytes and reaches a delta-subscribed viewer (write-visibility: the
writer's own post-write refetch never races a stale cache, because the write route nudges the board
atomically with its store persist — [[graph-stream]]) while the per-node fold stays [[graph-lean]]-slim.

**Writes stay where they're owned — and store-routed verbs stay one port, on BOTH surfaces.** Creation is
ONE verb over every store (`createIssue` — `spex issue open [--store <store>]` and `POST /api/issues` are
the same routing): it defaults to local (the [[local-issues]] committed write), and a forge store choice —
the dashboard New form's compact store picker, or the CLI's `--store <host>` — creates the real forge issue
through that store's driver, no local→forge promote round-trip when a concern is born forge-visible. The
created forge issue body carries the same `Spec: <nodes>` marker used by promotion, derived from the
author's `[[node]]` prose links (unioned with explicit `--node` ids), so the tracer links it back on the
next read; no surface-only node field appears. A `parent` (`--parent <id>`, or the create body's `parent`) opens a local
sub-issue on either surface; a forge store refuses one, because it holds no hierarchy. **Replying is ONE
verb over both stores** (`replyIssue` — `spex issue reply <id>` and `POST /api/issues/:id/reply` are the
same routing): a local id goes through the local issue store's committed write, a forge id (`<host>#<n>`) posts a
**real comment** through the driver's `createComment` — the [[port]]'s second write verb, the same seam
discipline as promotion (the driver stays the only network toucher; the tracer stays read-only; a failed
forge write fails loud, never queues). A local reply may carry optional `evidence` hashes (an anchored
annotation's frame blob) that accrue onto the thread's typed `evidence[]`, deduped — a forge reply has no
  such field, so its frame rides the comment body's image link instead. A reply's `@session` text stays a
  passive [[mentions]] reference, while each `@new`/`@new:<launcher>` token is dispatched only after that
  reply or issue body has persisted, returning a visible creation outcome without rolling back the write. The same
  reply may loop in the thread's **originator** as a courtesy if their session is online (the implicit loop-in
  — [[mentions]] owns the mechanism, silent when offline, never a spawn); the originator is a local
thread's author, and a forge issue's github-login author resolves to nobody, so a forge reply loops in no
one. Freshness after a forge write
stays caller-owned: the server forces its resident slice's read-back before answering (the comment shown
is the read-back, never a local echo); the CLI's next read is a live pull anyway.
The explicit local→forge migration verb is **promotion** —
`spex issue promote <id>`: a local concern that outgrows the repo (needs CI or external visibility) moves
to the forge as one recorded action instead of a lossy hand-copy. It composes the forge issue from the
thread itself — concern → title; body + the `Spec: <nodes>` marker + the evidence hashes + a provenance
footer — and creates it through the [[port]]'s driver (the driver stays the only thing that touches the
network; no second `gh` call-site). The marker is the round-trip: the promoted issue links back to the
same nodes through the EXISTING tracer read, so promotion adds no linking code. Order makes failure safe:
the forge issue is created FIRST, and only then is the local thread closed out — marked `landed` with a
reply carrying the permalink (its file remains as the recorded trail); an unreachable forge fails loud
with the local thread untouched, and only an `open` thread promotes. The two-plane contract is untouched
throughout: a forge issue is execution, never node state. Promotion is human-reachable too: the dashboard's
Promote affordance is a thin `POST /api/issues/:id/promote` over this same verb (the provenance footer and
permalink reply carry the caller's surface-derived identity — a session id from the CLI, `'human'` from
the dashboard).
**Closing is ONE verb over both stores, on both surfaces too** (`closeIssue` — `spex issue close <id>`
and `POST /api/issues/:id/close` behind the dashboard's Close button are the same routing). A local id
marks the thread `landed` through the local store; a forge id (`<host>#<n>`) calls the driver's
`closeIssue` — so an agent can close a github issue with the same verb the human clicks. A local close may carry
`duplicateOf` (`spex issue close <id> --duplicate-of <canonical>`), which records the duplicate edge in the same
store write; a forge id refuses it, because a forge issue holds no relations. The server forces
a forge refresh before answering, so the follow-up read shows the store-authored closed state; the CLI's
next read is a live pull. There is no parallel sign/accept/reject lifecycle; an issue is open until it is
closed or promoted. Closing is lifecycle on the issue object, not graph state; it never writes a spec
node's status. **And the close speaks to the issue's fleet**, in the same call: every session whose own
`issues` set names this issue is told the thread is landed ([[issue-binding]]'s close notice), because the
close changes the meaning of a pointer those sessions are working from and nothing else would tell them.
The notice is advisory around a durable write — the close never fails or unwinds because a queue was
unreachable, and each session's outcome comes back on `notified` for the caller to report. A repeat close
tells nobody: it changed nothing. `promote` is deliberately not a close in this sense — the thread moved to
the forge rather than finishing, and its permalink reply is what the thread carries.
