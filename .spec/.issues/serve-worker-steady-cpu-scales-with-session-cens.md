---
concern: serve worker steady CPU scales with session census and retry supervisors
by: 7690d008-1893-4d77-a6d3-16f051463169
status: open
nodes: graph-stream, sessions, serve
created: 2026-09-17T12:51:15.012Z
---

Spec: graph-stream, sessions, serve

Read-only diagnosis (2026-09-17): the worker is not a daemon-runtime import loop. daemonRuntime() memoizes one load promise (spec-cli/src/daemon-runtime.ts:19-23). The worker starts three resident supervisors in spec-cli/src/index.ts: superviseQueue() every 3000ms, superviseTurnFailures() every 1000ms, and superviseDelivery() every 1000ms.

The concrete repeated work is:
- spec-cli/src/graphStream.ts:1045-1053: each delta/plain graph SSE subscriber enables one process-global 100ms hot poll and one 1000ms warm poll. hotSignature() walks every registered session's agent.pid; warmSignature() calls liveSnapshot(), which runs one tmux list-panes census and then rendezvousListening() per pane/session (bounded in pairs). This is O(N) per second for N sessions, plus a 10 Hz O(N) pid-file/process check.
- spec-cli/src/sessions.ts:1316-1323: queue supervisor runs every 3s. drainQueueUnlocked():1193-1195 calls listSessions() and liveSnapshot() in parallel, while listSessions() itself calls liveSnapshot() at :580-585. Thus one queue tick performs two full liveness snapshots, then rereads every record and may do readiness probes per row.
- spec-cli/src/sessions.ts:1384-1403: delivery retry runs every 1s, enumerates all session ids, reads each record, checks pending delivery, and may drain each queue. :1339-1375 also scans all watchers/events.
- spec-cli/src/sessions.ts:1506-1515: turn-failure reconciliation runs every 1s, enumerates all ids and reads records; active adapter sessions can start/maintain native observers.
- spec-cli/src/graphStream.ts:1062-1068: delta subscribers also get a 15s patrol rebuild. Every canonical lifecycle commit calls notifyBoardChanged('sessions') through index.ts:58-60, so high-frequency PreToolUse/Stop hook state writes can debounce only within 25ms and otherwise trigger repeated board/session projection work.

Local probe (isolated temp git repo, temp SPEXCODE_HOME and tmux socket, Linux 16 CPU; generated dist only, no source edits): a fresh worker settled at 0-2% CPU with no stream and 0 sessions; an empty graph delta SSE stayed 0-1% after cold build. With 17 durable records, no stream averaged 0.8%; with 17 records + delta SSE and 17 tmux panes averaged 0.4% on this smaller host. This proves the timer/census is present and N-shaped but the large board/real hook rate is required to reproduce the fleet symptom; cold graph build briefly consumed tens of percent and grew RSS during warm-up.

macmini read-only ps cross-check via ssh -F ~/YellowPage/ssh_config macmini-tail (no writes/kills):
12819 bin/spex serve; 12821 dist/cli.js serve at 0.1% CPU; worker 12874 dist/index.js at 49.0%, 42.6%, 44.2%, 24.9%, 29.0% in five 2-second samples, RSS 417664-431824 KiB. This isolates the burn to the worker, not launcher/supervisor.

Repair proposal (do not implement in this issue): make one per-tick liveness snapshot the shared input for queue drain, listSessions and graph warm refresh; remove the duplicate liveSnapshot() in drainQueueUnlocked; gate expensive per-session rendezvous probes to sessions that actually need liveness/active delivery; make graph stream changes commit-driven with a bounded low-frequency patrol rather than unconditional 100ms/1s work for every subscriber; coalesce hook-originated session commits into one session projection per debounce window and ensure delivery/turn-failure sweeps consume the same frozen roster/snapshot. Preserve fail-loud unknown liveness semantics and verify with spec-first change, spec lint, and fail/pass product probe at N=0/17/real hook burst.
