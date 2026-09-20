---
title: test home isolation
desc: Default Node test processes keep temporary project roots out of the user's persistent SpexCode store.
code:
  - scripts/test-home.mjs
related:
  - spec-cli/package.json
  - spec-cli/src/test-home.test.ts
---
# test home isolation

Default Node test processes in packages that exercise temporary project roots use a fresh, disposable
`SPEXCODE_HOME`. A test process must never write ANYTHING into the user's persistent `~/.spexcode` store, at
any depth and under any name; the disposable home is removed when its process exits. The bootstrap
propagates itself to descendant Node processes, so a test that invokes a real CLI keeps the parent test's
isolated store at the process boundary. Tests that deliberately set their own isolated `SPEXCODE_HOME` keep
that explicit fixture control.

The invariant is whole-store rather than a list of shapes, because the redirect is whole-store: the
disposable home replaces the store ROOT, so every path derived from it moves with it. A project directory
is only the most visible shape a leak takes — a session record directory written inside a project directory
that already exists is the same leak one level deeper, and an invariant phrased as the first shape lets the
second one through. Whatever proves this holds must therefore be blind to nothing: a criterion that
enumerates named paths goes stale the moment a writer picks a path it does not name, and it fails silently,
which is the property that makes a wrong criterion look like evidence.

An inherited `SPEXCODE_HOME` resolving to the invoking user's real default home is rejected before the test
suite starts. That host home remains the reference even when a fixture supplies its own temporary `HOME`.
This failure is deliberately loud: silently replacing an unsafe host-home input would make a broken test
invocation appear isolated while hiding a persistent-store hazard from its caller.

The same bootstrap pins the session application's SQLite database inside the disposable home and clears any
inherited session-configuration override, so a fixture backend or CLI a test starts can never open the operator's
canonical session database. The isolation is whole-store for SQLite exactly as it is for the record tree: both
live under the redirected root and die with it.

The bootstrap also clears the environment of the harness that HOSTS the suite, because a test runner
inherits everything the hosting agent exports into its children. A session identity is the loud shape: a
fixture that reads one sees the host's session instead of the session it set, so it asserts against a value it
never wrote — a failure that looks like a product defect and is purely an inheritance artifact. A harness that
also exports its workspace is the quieter shape, handing a fixture a cwd that is not its own. The strip runs
ONCE, at the outermost bootstrap: this module propagates into every child a fixture spawns, and a child handed
a session identity ON PURPOSE must keep it, or the fixture's own input is deleted and its assertion flips to
the other path. The mark of an ancestor bootstrap already running is the disposable home it hands down, so the
strip is gated on its absence. The list is a COPY of the adapter's declarations rather than a read of them:
this module must load before any TypeScript loader is guaranteed, so importing the declarations from the
adapter source breaks a plain-`node` caller. A hand-kept list normally fails silently, so a test
reads the adapter source and fails the moment the copy drifts from the declared identities and scrubs — a
harness added later cannot be forgotten here.

`~/.spexcode` is not the only persistent user store a test can reach. Codex keeps project trust in the user's
global `~/.codex/config.toml`, and the codex adapter writes there on every materialize of a codex harness — so a
test that inits a temporary project with codex stamps that user file with a trust block for a path that stops
existing minutes later, and nothing ever removes it (one host accumulated a thousand such fixture blocks, ten
thousand lines, before a concurrent rewrite corrupted the file and took every dispatched codex thread offline).
The bootstrap therefore redirects `CODEX_HOME` with the same rules as `SPEXCODE_HOME`: a disposable codex home
inside the disposable SpexCode home, inherited by Node children, replaced per test worker, left alone when a
fixture sets its own, and rejected loudly when it resolves to the user's real `~/.codex`.
