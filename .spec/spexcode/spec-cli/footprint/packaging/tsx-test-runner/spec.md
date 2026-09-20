---
title: tsx-test-runner
status: active
hue: 280
desc: The source-test runner resolves tsx only for repository tests; release launchers never invoke it.
code:
  - spec-cli/src/tsx-bin.ts
related:
  - spec-cli/package.json
  - spec-cli/src/session-terminal-fixture.test.ts
---

# tsx-test-runner

Source tests and direct source entrypoints sometimes run TypeScript fixtures in child processes. `tsxBin`
resolves the JavaScript entry of the repository's development dependency for that source-only path. The shared
entrypoint chooser selects `node --import tsx/esm src/{cli,index}.ts` only when the caller itself is in
`spec-cli/src`; compiled callers select `dist/{cli,index}.js` through Node. The loader operand is a MODULE SPECIFIER, not a path, and Node parses it as a URL. On Windows a bare
drive-letter path reads as the scheme `c:` and the child dies with `ERR_UNSUPPORTED_ESM_URL_SCHEME` before
any CLI code runs, so `tsxLoader` hands over a `file://` URL while the entry operand stays a plain path
(both forms work as an entry there; a URL entry does not). This is the one place the URL form is load-bearing:
`tsxBin` — the JavaScript entry a caller runs as a script — must stay a path, because a URL there fails as
`ERR_MODULE_NOT_FOUND`. A host or session child spawned through the source chooser therefore reaches the CLI
only when the loader is URL-formed, which is why the dashboard's add-project and session materialize legs
depended on it.

It is not part of the published package's runtime path:
release launchers and their host/session children run compiled JavaScript directly through Node.
