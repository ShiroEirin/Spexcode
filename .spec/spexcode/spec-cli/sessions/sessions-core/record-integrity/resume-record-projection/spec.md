---
title: resume-record-projection
status: active
hue: 280
desc: One parser validates a resume transaction's complete frozen original and projects it consistently on every public surface.
code:
  - packages/spec-core/src/layout.ts#rawLaunchReadinessOriginal
  - packages/spec-core/src/layout.ts#projectPublicRecordEntry
related:
  - spec-cli/src/session-record.ts
  - spec-cli/src/session-state.test.ts
  - spec-cli/src/session-public-projection.api.test.ts
---

# resume-record-projection

The runtime envelope can contain a candidate that is not yet public. This shared parser validates its frozen
original using [[session-state-model]]'s complete product lifecycle, including the human-owned archived terminal
marker. A work-state declaration domain is narrower and is never reused to validate retained product history.

Every public record read projects the frozen lifecycle, proposal, note, stopped/archive/close metadata and
offline liveness until the restore owner clears the fence. The public entry also carries a non-lifecycle `pending`
marker for internal consumers that must distinguish this frozen projection from settled archive history; it does
not expose candidate bytes or change the public lifecycle. Raw candidate bytes stay available only to internal
runtime verification. Structurally incomplete or semantically unknown pending bytes remain a present corrupt
entry with unknown liveness; absence, corruption and a valid frozen original are distinct outcomes.

The parser performs no writes, probes, lifecycle transitions or stale transaction recovery. [[record-integrity]]
validates composed fences with this same parser before publication. [[stop-resume]] alone owns beginning,
revalidating and settling a resume transaction; readers never repair pending bytes by inventing another state.
