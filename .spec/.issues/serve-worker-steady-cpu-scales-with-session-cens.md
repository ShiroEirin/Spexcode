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

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-18T02:23:08.207Z -->
Spec: graph-stream, sessions, serve

CPU 分解 A/B（2026-09-18，本机同一份 678-record store，Linux 16 CPU；只读源码/临时复制 store，未改产品代码）

主要矛盾已从“所有 timer 都可疑”收敛为两个层次：

1. 全量 roster 扫描是常驻底座成本：678 条 `runtime.json`，无 graph stream，worker 稳定期 15 秒 `pidstat` 平均 16.3% CPU（单次 10 秒窗口平均 16.8%）。这来自 3s queue drain、1s delivery retry、1s turn-failure reconciliation，以及它们对全 roster 的记录/状态读取；`drainQueueUnlocked()` 还把 `listSessions()` 内部的 `liveSnapshot()` 与自己的 `liveSnapshot()` 重复了一次（sessions.ts:580-585, 1193-1195）。

2. 至少一个 delta graph subscriber 是最大的共享增量：同一 678-record store、无 stream 稳定 16.3%，接入一个 `/api/graph/stream?mode=delta` 后稳定 15 秒平均 29.5%（另一 10 秒窗口 38.96%，受建图/调度抖动影响，但冷启动已在接入前等待 30 秒）。因此 delta subscriber 打开了 graphStream.ts:1045-1053 的 100ms hot + 1s warm poll，以及 15s patrol/rebuild 体系；它不是每 subscriber 一份，而是 process-global 共享一份。

3. subscriber 数没有线性放大：同一 678-record store 稳定采样，1/5/14 个 delta streams 分别约 31.1% / 29.0% / 30.4%。所以“多浏览器 tab 各自创建 timer”不是主因；主因是第一个 subscriber 触发的共享 graph 路径加上 roster 成本。

4. tmux pane 数不是当前主要增量：678 records + 31 个临时 tmux panes + 一个 delta stream 稳定 15 秒平均 30.4%，与 678 records + 一个 stream 的 29.5% 同一量级。warm poll 的 list-panes/rendezvous 成本存在，但当前样本没有显示它是 40-50% 的第一驱动。

5. hook burst 是短时放大器：15 个 live/non-stopped records + 一个 delta stream，300 次真实 `spex internal session-state active` 写入期间 worker 平均 40.85% CPU；burst 后 10 秒窗口回落到 15.6%。这直接证明 canonical commit → `notifyBoardChanged('sessions')` → graph session projection 的路径（index.ts:58-60, graphStream.ts:377-399）是高频 hook 的增量来源，而不是纯空闲 timer。

结论排序：
- 第一主要矛盾：第一个 delta graph subscriber 激活的共享 graph poll/rebuild 路径。
- 第二主要矛盾：678 级别全量 roster 的每秒/每三秒监督扫描，构成稳定底座。
- 第三是触发放大器：PreToolUse/Stop 等 hook 的 canonical state commit，使 session projection 在 burst 期间把 CPU 推到约 41%。
- 不是主要矛盾：subscriber 数量本身的线性复制；31 个 pane 的单独增加；daemon-runtime.ts 动态 import。

修复优先级因此调整为：先对第一个 delta subscriber 激活后的共享 graph 路径做计数和降载（hot/warm poll、session refresh、rebuild build-ms），再消除 queue drain 的重复 liveSnapshot；随后把 hook commit 合并限制到一次 session projection/build dirty rerun。delivery/turn-failure 的 roster 扫描属于第二阶段底座优化，不应先拿它解释 macmini 的全部 40-50%。

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-18T02:55:57.535Z -->
Spec: graph-stream, sessions, serve

共享 graph 路径计数（不改代码；现有 `SPEXCODE_BOARD_DEBUG=1` + `SPEXCODE_TMUX_RECORD`，临时复制 store）

窗口与可观测计数：

- 无 stream 预热 25s：`list-panes` 记录 40 次，约 1.6/s。这里混有 queue supervisor 的全量 snapshot 和其它 liveness 读取，作为底座。
- 接入 1 个 delta SSE 后 25s：新增 `list-panes` 63 次，约 2.5/s；相对无 stream增量 23 次/25s，约 0.92/s，与 warm poll 的 1s cadence 对齐。subscriber 退出前总活跃 span 62.7s，故 hot poll 理论 tick 约 627 次（100ms），warm poll 理论 tick 约 63 次（1s）。hot 不 spawn tmux，当前版本没有日志计数，只能用源码 cadence + warm 的外部 spawn 交叉验证。
- 一次 delta subscriber 已足以打开这组 process-global poller；此前 1/5/14 subscriber 的 CPU 约 31.1/29.0/30.4%，没有按 subscriber 线性增加。

hook/session projection 计数：

- 使用 15 个 `archived=false, stopped=false` 的真实记录，执行 5 轮 idle→active 交替（150 次有效写入尝试）。
- `graph latency ... stage=sessions-signal`：116 次。其余尝试落在同一状态/被状态机拒绝，没有把失败当作 signal。
- `graph broadcast`：69 次，其中 68 次 `sessionRefresh=true`；说明 116 个 signal 被 debounce/in-flight dirty 合并为 68 个 session projection broadcast，而不是一一对应。
- broadcast build-ms：n=69，min=243ms，max=3446ms，avg=404.6ms。日志中出现过 `sessions` build 282/432/243/…ms；初始 session refresh 3495ms，full build 1368ms。
- 触发 tags 主要是 `{sessions}`（58 次）；另有 patrol+sessions / patrol 混合，说明 patrol 也会与 hook signal 竞争 build，不是单独的空闲成本。
- 同窗口 `list-panes` 总数 212，另有 `capture-pane` 116 次；后者来自现有 session projection/route 的 pane capture，不是 warm poll 本身，说明 session refresh 的 build 内部还有 pane 读取成本。

主要矛盾（计数版）：

1. graph 的第一个 delta subscriber 使每秒新增约 1 次全量 warm tmux census，并同时使 hot 100ms poll 常驻；它贡献共享 steady overhead，但不是按 tab 复制。
2. hook burst 时 116 个 sessions signal 只合并成 68 次 projection，但每次平均 build 404.6ms，最大 3.45s；这部分是 CPU 的主要可变项。debounce 目前只能合并同一窄时间窗，无法抵消 build 期间 dirty rerun。
3. queue/roster 读取是 baseline，不能解释 hook burst 的额外 build；`list-panes` 计数的 stream 增量约 1/s 与 warm poll 对齐，说明 warm poll 是固定项，不是本次 69 builds 的全部来源。

下一步降载顺序（仍未实现）：先把 `sessionRefresh` 的 build 次数/build-ms 降下来（build-in-flight 期间只保留一个 dirty session revision，并合并跨 hook 的 session keys），再处理 warm/hot 的固定 census；最后消除 queue drain 重复 `liveSnapshot()`。不要先只改 100ms 为更大的数，因为 69 次 session projection 的 404.6ms 平均才是 hook burst 的主要可变 CPU。

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-18T04:28:36.812Z -->
Spec: graph-stream, graph-cache, serve

已实现第一步“in-flight session refresh 只允许一次 wake，其余 session signal 合并到 dirty/requested wave”。

代码：
- `graphStream.ts` 新增 session-wait 状态闸门：session signal 可以第一次越过一个正在等待的 unrelated full，但当真实 session splice 已在途时，后续 signal 不再 wake/preempt 当前 wait；它们由现有 dirty/sessionRefreshRequested 在当前 producer 完成后消费。
- `graphCache.ts` 暴露 `sessionSpliceInFlight()`，区分“真正 session splice 在途”和“session refresh 只是 join 了 full build”，避免破坏 route-owned full 的 session-over-full 优先级。

提交：`1cc1d5638 fix(graph-stream): coalesce in-flight session refresh wakes`
Spec-OK：`efd682683 ack: Spec-OK graph-cache, graph-stream`

验证：
- `graphStream.api.test.ts` 全量 11/11 通过，包括 blinded patrol、failed refresh recovery、route-owned full/session overtaking、hook-authored commit、database patrol repair。
- eslint 两个改动文件通过。
- `spex spec lint` 0 errors（仓库已有 53 warnings）。
- `npm run typecheck`/`npm run build` 仍被仓库已有的 DisplayStatus/archived 类型错误阻断，错误不在本次改动文件。

CPU A/B（同一临时 678-record store、一个 delta stream、15 个 live records、150 次并发 idle↔active 尝试）：
- 旧 dist：burst 50.74%，after 28.38%，12 broadcasts。
- 新 src：burst 53.18%，after 29.50%，13 broadcasts。

结论保持诚实：这一步没有可测的 CPU 降幅。原因是 `graphCache` 原有 `sessionFlight` 已经把底层 splice 单飞；本次改动只消除重复 wake/preemption 的正确性/边界浪费，而主要 CPU 仍在每次 splice 的全 roster `listSessions()`、tmux/liveness 和 capture 读取。下一步若继续降 CPU，应改 `spliceSessions()` 的输入范围/快照复用（按受影响 session ids 局部重算），而不是继续调整 wake 闸门或只放大 poll interval。
