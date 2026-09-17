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

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-17T16:18:44.955Z -->
Spec: graph-stream, sessions, serve

可执行修复提案（只设计，不在本 issue 直接改代码）

目标不是把所有 timer 粗暴拉长，而是让每个事实只有一个观察者、每次 tick 只做一次 census，并让轮询成本只落在仍需要该事实的 session 上。

Phase 1 — 先消除确定的重复工作（最小风险，优先落地）

1. `sessions.ts:listSessions(includeArchived, snap?)` 增加可选的调用方快照；不传时保持现有行为。`drainQueueUnlocked()` 先取一次 `liveSnapshot()`，把它传给 `listSessions()`，删除当前 `Promise.all([listSessions(), liveSnapshot()])` 中的第二份 snapshot。队列 tick 仍保持 3s、失败仍保持 unknown/fail-loud。
2. 把同一 queue tick 使用的 `sessions`、`LiveSnap`、record 读取冻结成一个 pass。不要在 `listSessions()` 返回后再为 occupancy/readiness 重新做全量 tmux census；只有 readiness 行进入现有 bounded probe。
3. 在 `graphStream.ts` 保持“每个 worker 一组 process-global poller”的事实，明确禁止按 SSE subscriber 或按 session 创建 timer。增加计数诊断：`hot ticks`、`warm ticks`、`liveSnapshot calls`、`rendezvous probes`、`list-panes spawns`，用于证明改前/改后没有隐藏重复。

Phase 2 — 让 session 监督器按债务和状态工作

4. `superviseDelivery()` 不再每秒对所有 session 做 `readRecord + pending`。提交唤醒仍走现有 `wakeCommittedRecipients()`；重试器只维护“有未偿队列/上次探测未证实”的 session 集合，并以一次数据库查询取得 pending recipient 集合。进程重启时做一次全量恢复扫描，之后只对集合成员重试；集合为空时 tick 不做 session 级 I/O。
5. `superviseTurnFailures()` 只在 record/canonical state 变为 `active + harnessSessionId + observeTurnFailures` 时建立观察者，在状态离开 active 或 identity fingerprint 改变时关闭。全量 roster reconciliation 降为低频 bounded fallback，正常变更由 store/database event 唤醒。现有“一次只启动一个 native observer”和指数退避保留。
6. `superviseQueue()` 保持 3s 作为兜底，但空队列/无可启动 slot 时不重复做昂贵 liveness；用 Phase 1 的冻结 snapshot 判断 occupancy，只有发现 queued/readiness debt 才进入逐 session readiness probe。

Phase 3 — 收窄 graph 的 tmux 热路径（必须先有 Phase 1/2 计数）

7. hot tier 继续提供快速死亡检测，但只检查有有效 `agent.pid` 且当前为 live/starting 的 session；无 pid、stopped、archived、queued、已证明 offline 的记录不进入 10Hz 集合。pid 文件 mtime 变化时重新纳入，沿用 `pidRegistry` 的死锁存规则。
8. warm tier 的 tmux `list-panes` 保持每 worker 一次/秒，不按 session spawn；rendezvous connect 仅针对 census 中的 pane 且 adapter 声明拥有该 listener 的 session，最多按现有并发窗口执行。无 delta/plain subscriber 时继续完全停掉 poller。
9. 15s patrol 只承担自愈/漏 watcher 证明，不承担正常刷新；正常刷新必须来自 filesystem/database event 或 hot/warm signature 变化。patrol 触发的 build 继续带 `patrol` attribution，不能静默成为常态。

Phase 4 — hook burst 合并

10. lifecycle commit 到 graph 的入口保留 25ms debounce，但把“事件次数”与“session projection 次数”分开计数；同一 debounce window 内 N 个 hook commit 只能产生一次 sessions projection。正在 build 时只设置一个 dirty/revision 标记，build 结束最多再跑一轮，不得按 commit 数量排队。
11. 不能把 state producer 的正确性依赖在 watcher 上：hook 写入仍先提交 canonical state；watcher/graph 只负责可见性，掉 watcher 由 patrol 修复，不能通过加快轮询掩盖 watcher 失效。

验收门槛（修复前后同一探针、同一主机）

- N=0、N=17、N=50 durable records；分别无 stream、1 个 delta stream、多个 delta streams。记录 worker CPU、RSS、timer 数、tmux `list-panes` spawn 次数、rendezvous probes/min、snapshot calls/min。
- 1700 次 hook state writes（17 session × 100）作为 burst；验收“projection builds”而不是 HTTP 请求数，并确认最终 graph revision 与 canonical DB 一致。
- 正确性：active→offline/unknown、listener timeout、pid recycle、queued readiness、backend restart、subscriber disconnect/reconnect；任何 probe failure 仍投影 `unknown`，不能误判 offline。
- 结构不变量：每个 worker 最多 1 个 hot poller、1 个 warm poller、1 个 patrol、1 个 queue supervisor、1 个 delivery retry、1 个 turn-failure supervisor；SSE subscriber 数增加不增加 timer 数。
- 性能目标先以 macmini 现测基线为参照，建议门槛：空载稳定低于 2%，17 个 idle session 无 hook burst 时低于 5%，hook burst 结束后 10s 内回落到该基线附近；若达不到，继续看计数而不是放宽阈值。

落地顺序：Phase 1 单独提交并测量 → Phase 2 单独提交并测量 → Phase 3/4 分别按 `graph-stream`/`sessions` spec 更新意图、实现、`spex spec lint`、真实 serve YATU fail→pass。不要把“降低轮询频率”作为唯一修复，也不要在 macmini 直接试验。
