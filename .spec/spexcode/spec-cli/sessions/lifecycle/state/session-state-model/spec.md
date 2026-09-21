---
title: session-state-model
status: active
hue: 280
desc: One complete SpexCode lifecycle domain, a narrower work-state declaration domain, and an exhaustive resume transition.
code:
  - packages/spec-core/src/session-state.ts
related:
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-record.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/session-state.test.ts
  - spec-cli/src/client.ts
  - spec-cli/src/session-timeline.ts
---

# session-state-model

The session application stores adopter-owned status strings; it does not know SpexCode's policy. This module
owns that policy's complete vocabulary. A product lifecycle is application registration (`created`), an open
work state, or the human-owned terminal `archived` marker. Registration implies neither launch nor active work.
Work-state declarations cannot express either boundary: initialization and close own them, and declaration
writers validate the narrower domain at runtime as well as through types.

Canonical readers and the frozen original in a resume publication fence validate the complete lifecycle domain.
Neither casts an unknown canonical string into a valid state nor rejects a terminal state the product itself
published. Legacy runtime envelopes without lifecycle fields remain metadata, not a replacement state authority.

Resume is an explicit total transition from any product lifecycle to an open work state. Executing, prepared,
failed, registered, and archived sessions settle to `idle`; idle and waiting declarations retain their state. The table is
exhaustive over the authoritative vocabulary, so adding a lifecycle requires declaring its recovery semantics.
The surrounding resume transaction owns runtime proof, proposal/note preservation and publication, not this
pure model. Runtime liveness remains independent from lifecycle.

Proposal decoding also has one strict domain here. The history boundary separately accepts the documented
old display statuses review/done/close-pending, resolving each to awaiting and its corresponding proposal;
contradictory or unknown historical values fail rather than being cast, silently dropped, or turned into work.
Canonical current-state readers do not use that historical decoder. A cache joins the canonical state even
when a metadata-only envelope exists, but a valid pending public projection stays frozen until its owner settles it.

## Checkpoint

- Model boundary: implemented with enum-derived reader/fence/transition coverage and strict canonical/proposal decoding.
- Resume transaction: durable begin before runtime mutation; verified live reentry, offline binding detach, frozen public projection, and exact stop cancellation.
- Queue admission: per-record integrity isolation with conservative unknown/pending reservations; global probe failure still pauses.
- Product proof: the same real create/dirty-close/restore API scenario fails with an invalid archived fence on the prior implementation and succeeds with the new model. The living candidate is adopted without a replacement PID; corrupt bytes stay untouched while healthy queued work launches.
- Hindsight: registration, work declarations, and human closure have different writers but one complete observable domain. Runtime binding is attachment, not readiness publication; readers never repair transactions and unknown ownership never counts as free capacity.
