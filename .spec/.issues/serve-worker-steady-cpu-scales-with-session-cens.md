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

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-18T04:39:00.719Z -->
Spec: graph-stream, graph-cache, sessions, serve

更正主要矛盾：之前的“重复 wake/preemption”不是 CPU 主因，代码改动已作废并撤回（工作树基线已恢复）。原因是 `graphCache` 原本已有 `sessionFlight` 单飞；旧 dist 与尝试修改后的 src 在并发 burst 下几乎相同：

- 旧 dist：burst 50.74%，after 28.38%，12 broadcasts
- 新 src：burst 53.18%，after 29.50%，13 broadcasts

真正的主要矛盾是“sessions-only”并不是真正按受影响 session 局部刷新：

`canonical lifecycle commit` → `notifyBoardChanged('sessions')` → `fireChanged` → `invalidateBoard('sessions')` → `getBoardForSessionRefresh()` → `startSessionSplice()` → `graphSnapshot.spliceSessions(prev)` → `listSessions()`。

而 `listSessions()` 每次都会：

- 枚举整个 session roster；
- 读取每个 record/canonical state/prompt/runtime projection；
- 共享 `liveSnapshot()`，做全局 tmux `list-panes` census；
- 对 pane/session 做 liveness/rendezvous 判断；
- 重新读取 session-side files/web/widgets/activity。

因此一个 hook 只改 session A，实际付的是整个 roster 的 projection 成本。并发 A/B 的 debug 日志也证明了这一点：每次 broadcast 的 changed keys 经常包含 9-10 个 `sess:*`，而不是只包含触发 hook 的一个 id；build 平均约 800ms，最高约 6.3s。说明主要成本在“每次 projection 扫全 roster + liveness/capture”，不是 wake 次数。

这也解释了 CPU A/B：

- 678 records 无 stream 稳定约 16.3%
- 同一 roster 一个 delta stream 稳定约 29.5%
- 15 live records + stream 的 hook burst 约 40-50%
- 31 panes + stream 与 records + stream 同量级
- subscriber 数 1/5/14 不线性增长

正确修复方向不是继续调 wake 或 poll interval，而是把 session projection 真正做成局部：

1. canonical commit/DB watcher 传递受影响 session ids 和一个 revision；未知/结构变化才退回 full roster。
2. cache 保留现有 board rows；session splice 只重算受影响 ids，复用其他 rows 的 immutable projection。
3. liveness/capture 也按 affected ids 读取；warm poll 的全局 liveness 仍单独负责它自己的 sessions-domain 更新。
4. 一批 hook commit 合并为一个 affected-id set + 一个 revision；build 期间只保留下一版，不重复扫描全 roster。
5. 用“一条 session 变更”和“15 条并发 hook burst”分别验证 changed keys、listSessions roster reads、tmux/capture 调用数和 CPU。

当前代码未留下这次无收益修复；保留的只有诊断 issue 记录和 A/B 证据。

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-18T04:46:56.679Z -->
Spec: graph-stream, graph-cache, sessions, serve

单变量实验筛选（旧 dist、同一临时 store/一个 delta stream/同一 15 条有效写入 burst；每轮只改一个因素，不叠加）

| 实验 | steady | burst | after | session signals | 结论 |
|---|---:|---:|---:|---:|---|
| 682-record roster，正常 session-db watcher | 35.20% | 51.96% | 31.40% | 18 | 基线 |
| 同一 682 roster，仅 `SPEXCODE_DISABLE_WATCHERS=session-db` | 33.80% | 31.58% | 31.80% | 2 | 关闭 hook→graph 入口后，burst 降约 20.4pp；session-db signal 是主要可变来源 |
| 仅 roster 缩到 15 条，其余不变 | 6.60% | 13.49% | 3.39% | 52 | steady 降约 28.6pp、burst 降约 38.5pp；projection 成本随 roster 规模增长 |

之前的独立 pane 实验（682 records + 一个 delta stream，0 panes vs 31 panes）约 `29.5%` vs `30.4%`，所以 pane 数不是第一矛盾。之前的 stream A/B 也显示第一个 delta subscriber 会增加共享 graph steady cost，但 subscriber 数 1/5/14 不线性。

主要矛盾现在可以定论：

```text
hook lifecycle commit
  -> session-db watcher
  -> notifyBoardChanged('sessions')
  -> sessions-only splice
  -> listSessions() 全量枚举 roster
  -> liveness/tmux/capture/record projection 全量重算
```

“sessions-only”只意味着不重建 spec/Git topology；它并不意味着只重算受影响 session。一个 hook 改 A，实际扫 682 条 roster，所以 CPU 同时受两个因素控制：session-db signal 频率 × roster 规模。

之前做的 wake/coalesce 改动已撤回：`sessionFlight` 已经让底层 splice 单飞，且 before/after CPU 无收益。下一步应该只围绕真正有效的点设计：让 session-db commit 携带 affected session ids/revision，session splice 只重算 affected rows，复用其余 projection；未知/结构变化才 fallback 全 roster。先做一个单变量实验验证“局部 1-row splice”是否把 682 roster 的 burst 从约 52% 拉近 13 条 roster 的量级，再考虑理论抽象和正式实现。

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-18T09:27:19.116Z -->
Spec: graph-stream, graph-cache, sessions, serve

统一局部 projection 已落地并完成验收：

提交链：
- `706b9a554` affected commit subjects + change mask
- `84fb94dbd` cross-process append-only session-event watermark
- `ea7d0ee3c` partial session reader + immutable row merge/fallback
- `bef74ff04` graph cache/stream wiring and partial projection integration
- probe commits `6f339be2c`, `5e13eaac3`, `b64405330`

实现机制：

- canonical commit observer 携带 `subjectSessionIds` + `changeMask`；delivery-only commit 不触发 session projection。
- session-db watcher 维护 append-only event rowid watermark，跨进程 hook commit 恢复 state-event subject ids；cursor failure/unknown event fallback full。
- session store watcher 从 relative path 提取 session id；非 session path fallback full。
- graph cache accumulates affected ids, and a precise session event uses `spliceSessions(prev, {scope:'partial', affectedSessionIds})`。
- partial reader 不枚举全 roster、不读取无关 runtime/canonical/resident rows；只读 affected rows，保留一次共享 project-wide live evidence census。
- immutable merge 保留 untouched row identity；malformed/duplicate/unseen ids fallback authoritative full roster。
- partial splice 跳过 hook 热路径的全量 pre/post `sessionInputRevision()`；patrol 仍负责 aggregate revision validation。

验收：

- session-application 全套 `45/45` 通过。
- projection/graphScope `16/16` 通过。
- graph-stream API `11/11` 通过。
- source acceptance gate：682 records / 667 archived / 15 active，一次 partial hook projection = `0` roster enumerations、`1` runtime read、`1` list-panes、`0` capture、15 working rows；10-build naive = 10 reads/10 census，local one-build约 7-10ms。
- `spex spec lint`：0 errors，仓库已有 warnings。
- eslint 改动文件通过。
- `npm run typecheck/build` 的剩余错误是仓库已有 `DisplayStatus`/`archived` 类型错误，不在本次新增路径。

真实 worker A/B（同一 682-record temp store、一个 delta stream、15 active、并发 lifecycle burst）：

- 旧 dist：burst `54.03%`，after `26.83%`；session cache commits `513/359/316/305/345ms` 级别。
- 当前 src：burst `47.13%`，after `27.33%`；session cache commits `32/20/251/129/340ms` 级别。

主要矛盾已从“全 roster session projection”转为 affected-row partial path，未知变化仍安全退回 full。macmini 未做任何写入或控制。

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-18T09:36:49.664Z -->
Spec: graph-stream, graph-cache, sessions, serve

最终主要矛盾修正：affected-row partial projection 只削掉了 roster record/canonical 读取，不足以显著降低 worker CPU。真正未削掉的成本是全局 live evidence。

当前 partial `listSessions(ids)` 仍然无条件执行：

```text
partial listSessions(affected ids)
  -> liveSnapshot()  // 仍然 project-wide
     -> tmux list-panes -a
     -> parse every pane
     -> rendezvousListening for every census id
```

同时，只要有一个 delta subscriber，graph-stream 仍独立开启：

- hot poll：100ms，按 live pid/socket 做全局快速检查；
- warm poll：1s，一次全局 tmux census + rendezvous evidence。

所以当前 A/B 出现了“build-ms 明显下降，但 worker CPU 只有小幅下降”：

- partial probe：682 roster 的 oneHook 从约 93ms/682 record reads 降到约 7-10ms/1 record read；这是 projection 证据；
- 真实 worker：burst 从 54.03% 降到 47.13%，after 基本不变；说明剩余 CPU 不在 record 枚举，而在 live evidence 和 subscriber-gated pollers；
- 无 stream vs 一个 delta stream 之前已显示约 16% -> 29.5% 的 steady 增量，正是共享 graph liveness 路径的底座。

因此目前不应把“局部 projection 已解决 CPU”当作结论。更准确的主要矛盾是：

```text
每个 hook commit
  -> 局部 row read 已经变轻
  -> 但每次仍触发全局 liveSnapshot
  -> 同时 hot/warm poll 继续全局探测
  -> worker CPU 仍被 liveness evidence 占住
```

下一步真正该做的单变量实验是：给 session projection 注入/复用最近一份 `LiveEvidenceCache`，使纯 lifecycle state change 不再启动新的 global `liveSnapshot`；只在 warm evidence cadence 更新时做 tmux/rendezvous census。然后比较：

- partial projection + fresh global evidence（当前）；
- partial projection + reused evidence（候选）；
- no delta subscriber（底座控制）。

若第二组才接近 no-subscriber baseline，主要矛盾就完成闭环；否则继续拆 rendezvous probes 和 hot pid checks。当前 merge proposal 应先 hold，不能把现有小幅 burst 降幅当成最终 CPU 修复。

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-18T14:06:33.293Z -->
Spec: graph-stream, graph-cache, sessions, serve

最终修复闭环（2026-09-18）：主要矛盾不是 daemon-runtime import，也不是 subscriber 数线性复制，而是第一个 delta subscriber 激活的共享 graph/liveness 路径叠加全 roster 监督扫描。

代码已按 spec 分成可回滚提交：
- `ea7d0ee3c`：partial session projection，只重算 affected session rows，immutable 复用其余 rows。
- `bef74ff04`：commit subject/change mask、SQLite event watermark、graph cache/stream 的 affected-id wiring；未知/游标失败仍 full fallback。
- `356191fa8`：warm liveness evidence 单一 seam。warm poll 的全局 `liveSnapshot()` 发布最近快照，partial projection 只复用 1.25s 内快照，过期/缺失仍 fresh probe，`probeFailed`/`unproven` 三态原样保留。
- `53fa7db7b`：queue drain 只做一次 liveSnapshot；turn-failure supervisor 启动时 full reconcile，之后只处理 event subject ids 和 retry-deadline observers；store/session-db unknown source 才触发 full。
- `458bedcb1`：probe 显式建模 warm owner，gate 允许 cache hit 的 0 次增量 census。

受控 A/B（同一 682 records / 667 archived / 15 active fixture，先让 warm owner 完成一次 census，再测一个 lifecycle projection）：
- 旧 dist：oneHook = 682 record reads、1 roster enumeration、1 list-panes、约 133ms；10 次 naive = 6820 reads、10 list-panes、约 1041ms。
- 当前 source：oneHook = 1 record read、0 roster enumeration、0 增量 list-panes、约 2.6ms；10 次 naive = 10 reads、0 list-panes、约 6.8ms。
- source acceptance gate PASS：affected row=15、roster=0、record reads<=1、capture-pane=0。
- 这组 CPU% 短样本受进程调度影响，不作为稳态百分比承诺；稳定的读取/census/build-ms 计数已经证明主要重复工作被删掉。

已有真实 worker A/B 也保持诚实记录：旧 dist burst 54.03%/after 26.83%，partial source 在 cache 前 burst 47.13%/after 27.33%；本次 cache 后不把未重新测到的稳态百分比写成事实，保留上述同 fixture 可复现的调用计数和 wall-ms 作为验收证据。macmini 只读要求未触碰：没有 ssh 写入、没有杀进程、没有改那 17 条 lane。

验证：session-application 45/45；liveness/hot/graphScope/sessionProjection 31/31；graph-stream 定向 24/24；source probe gate PASS；`spex spec lint` 0 errors（54 条仓库既有 warning）；typecheck/build 仍被既有 `DisplayStatus`/`archived` 类型错误阻断，错误不在本次新增路径。

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-19T01:59:24.472Z -->
Spec: graph-stream, graph-cache, sessions, serve, liveness

隔离真实 worker A/B 已完成（2026-09-19，本机 /tmp 临时环境，不碰 macmini）：

环境完全独立：682 records = 667 archived + 15 active；临时 SPEXCODE_HOME；临时 SQLite；临时 git project；fake tmux executable/socket；真实 worker `index.js`、真实 `/api/graph/stream?mode=delta`、真实 `spex internal session-state` hook 子进程。每轮先取空载 2.5s，再开一个 delta SSE 稳定 5s，再执行 60 次真实 lifecycle hook，最后采样 5s。旧 dist 和当前 noCheck 编译后的 plain Node dist 各跑两轮，排除 tsx loader。

结果：

| build | empty CPU | delta stream CPU | hook burst CPU | tmux list-panes calls | burst RSS peak |
|---|---:|---:|---:|---:|---:|
| old dist run 1 | 58.79% | 36.97% | 54.69% | 114 | 306,816 KiB |
| old dist run 2 | 59.29% | 37.73% | 56.79% | 114 | 318,476 KiB |
| current dist run 1 | 56.73% | 33.96% | 29.74% | 44 | 268,072 KiB |
| current dist run 2 | 56.73% | 34.88% | 29.96% | 44 | 260,328 KiB |

两轮平均：burst CPU `55.74% -> 29.85%`，下降 `25.89` 个百分点，约 `46.5%` 相对降幅；tmux census `114 -> 44`，下降 `61.4%`；burst RSS 峰值均值约 `312.6MB -> 264.2MB`，下降约 `15.5%`。空载均值约 `59.04% -> 56.73%`，说明这次变更主要解决 hook burst/session projection 的可变成本，不会假装消灭所有 steady supervisor 底座；delta stream 稳定段约 `37.35% -> 34.42%`，warm poll 本身仍是固定成本。

日志也直接证实机制变化：旧 dist 的 session broadcasts 多为 `132–164ms`；当前 dist 大多数为 `0–2ms`，只有 warm evidence 过期时回到约 `150–201ms` 的 fresh probe。当前 worker 60 次 hook 仍产生 60 个 session broadcasts，但每次不再全 roster + 重复 census，说明收益来自每次 build 的工作量，而不是丢事件。

结论：这次变更已经在隔离真实 worker 上证明有效。有效点是 affected-row partial projection + warm evidence reuse；之前无效的 wake/coalescing 仍已撤回。macmini 侧只需做一次只读 post-change ps/top 交叉验证，不能再说“没有最终 CPU 降幅”。

<!-- reply: 626f0c29-f847-41c0-8714-889c6fc787a8 @ 2026-09-19T08:10:22.035Z -->
Spec: graph-stream, graph-cache, sessions, serve, liveness

独立复核（session 626f，fresh context）。隔离环境 140 余个 run：两臂由 git archive 导出（merge-base 778491766 对 458bedcb1，dist 只差预期的 9 个模块），真实 dist/index.js worker、真实 delta SSE、真实 `spex internal session-state` hook，fixture 经 `/api/graph` 验证为 682 条 record 中 15 条 online/working。窗口 CPU 取自 `/proc/<pid>/stat` 的 60 s 差分。产品代码、被测两臂、macmini 均未改动；修复只在 /tmp 私有 dist 副本上试。完整表格与方法见 [[file:graph-stream-cpu-audit.html]]，补丁文本见 [[file:PATCHES.md]]。

两条互不混淆的根因：

A. steady 主因是 [[liveness]] 的 hot 100ms tier，与本次改动无关。`hotSignature()` 每 100ms 对含归档的全 roster 做 `statSync(agent.pid)`（N=682 时约 6,800 次/秒，97.8% ENOENT）。单独开启净占 15.90 pp，是带一个 delta 订阅者稳态（24.90%）的 64%，随 roster 总量线性：N=15 / 682 / 2000 → 1.17 / 16.41 / 41.38%（约 2.0 pp / 100 条 record）。其余各项净值：delivery sweep 5.27、queue sweep 4.00、warm 0.74、patrol 0.34、turn-failure old 3.34 → new 0.05 pp；加和检验通过。

B. burst 路径有一个本次改动引入的缺陷。engine 设 `synchronous=FULL`，WAL `write()` 先触发 fs 事件，fsync 之后提交才可见；new 的 session-db watcher 对每个 fs 事件跑一次 cursor，读到空集即当成 unknown，清空已累积的 affected id，整波退回全 roster splice（8–17% 的 hook 波）。归因计数：pathless 0、watcher 失败 0、cursor 失败 0、hot/warm 签名变化 0，`fire UNKNOWN` 在每个 run 里恰好等于空 cursor 读的次数；完全不带探针的纯 dist 对照复现同一模式（多信号波 22 个，22 个慢）。是产品路径，不是夹具。

对问题 1 的回答：当前改动主要降的是 hook burst。每 hook 边际 CPU 145 → 36 ms（396 节点的真实规模 board 上 153 → 51 ms）；4 hook/s 下 hooks 阶段 86.2% → 39.2%，old 此时事件循环已饱和（hot 的 600 次 tick 只跑 282 次）。steady 只降 3–4 pp（nostream 13.40 → 9.67，stream 28.09 → 24.90），且全部来自 turn-failure supervisor 改为事件驱动；steady 窗口里 session splice 一次都没运行，partial projection 与 warm evidence 复用在 steady 下没有东西可省。第一个 delta 订阅者的增量 old +14.7 / new +15.2 pp，改动没有碰到。queue drain 少一次 liveSnapshot 把 list-panes 从每 tick 2 次降到 1 次，worker CPU 无可测差别。

修复候选（同批单变量）：
- fixC（保留 `BEGIN IMMEDIATE` 屏障，同一事务内读 `data_version`，空读且版本未变则丢弃）：低速率 40 个 hook 零迟到、零未投递，投递中位 21–24 ms（new 29–33，old 211–393）；burst 下 hooks CPU 45.6 → 29.2%，慢 splice 62–66 → 7–9，投递中位 64–72 → 20–21 ms，最终 board 与每个 session 的最后一个 hook 一致。未验证：macOS FSEvents 的事件倍数、只改 topology 不落 state 事件的跨进程提交、cursor 失败与 watcher 被 hold 的路径；它不消除写锁等待。
- fixA / fixB / fixAB（无锁的 data_version 门 / 无锁 cursor / 两者）全部否决。fixB 慢 splice 45 → 94、CPU 39.2 → 52.9%；低速率下三者把 10–85% 的变更延后约 2 s（等下一个 hook 的事件，安静系统里是 15 s 的 patrol）。fixAB 在 burst 下的 29% 是靠延后变更换来的。new 里那个包着纯读的写锁无意中充当了「等 writer 提交完」的屏障。
- fixH2（hot tier 的 10 Hz 循环只碰当前活的 pid；候选集派生、死集签名、pidRegistry 按全 roster 修剪全部只在既有的 1 s 刷新块里做）。真实 dogfood store 普查：697 条 record 里 232 个 agent.pid，217 个挂在已归档 session 上，活 pid 17 个。按此造的 fixture 上 stream 稳态 new 25.33 → fixH 16.13 → fixH2 13.50%，RSS 三者相同（约 193 MB），stat 6,698 → 3,036 → 1,018 次/秒。死亡检测（已登记活 pid、归档但物理存活的 pid）三臂都在一个 100 ms tick 内。被延后的只有 pid 文件写入的发现：首次登记 fixH 197–989 ms、fixH2 72–945 ms；resume 重写 mtime 仅 fixH2 延后（142–906 ms）。这两个数是把 store watcher 蒙上测的；store watcher 正常时 pid 文件写入在约 1 ms 内就由它宣告，三臂相同。第一版 fixH 按候选集修剪锁存表，会在首次登记后的 ≤1 s 内反复丢掉 PID recycle 锁存，不建议采用。

本次改动的其它副作用：
- turn-failure 观察者在 worker 启动后、第一次图读取之前是哑的：24 次 hook 提交 → supervisor 读 0 条 record；图读取之后 24 → 24。old 每秒全扫，没有这个空窗。session-db watcher 被 hold 或禁用时同理，patrol 不喂它，[[graph-stream]] 的「降级到 patrol 的节奏，绝不降级为沉默」对这个新消费者不成立。证明在机制层；fixture 无 Codex native observer，未在产品层复现漏报。
- 复用 ≤1.25 s 的 liveness 证据会推出过期帧：pane 刚出现即提交 hook，new 3 次里 2 次先发布 `unknown/unknown`，0.56–0.95 s 后纠正；old 3 次都直接是 `working/online`。
- 写锁事务的成本与事件重复的成本分开：前者几乎不耗 CPU（cursor CPU 0.12 s / 60 s），是事件循环同步阻塞——单独跑 2.4% 墙钟、最长 19 ms；9 个 worker 并发、磁盘争用时 13–14%、单次约 1 s。后者是 CPU：每个被毒化的波一次 150–250 ms 的全 roster splice。两臂共有的既有事实：production.ts 的 17 处读取全部走 `withTransaction`，steady 下每秒约 1,500–1,900 次 `BEGIN IMMEDIATE`，全是读。
- partial splice 跳过 revision 采样，之后每次 patrol 补一次全 roster splice（低速率下 old 0 次，new / fixC 每次 patrol 1 次）；有界，次要。
- 正面：old 在 burst 饱和时每次 run 打出 3–7 条 PATROL-REPAIR 假告警，new 为 0–1 条。

对此前证据的更正：上一条回复里的 A/B 表用的是 `ps -o pcpu`，Linux 上它是进程生命周期平均（实测：烧 2 s 后空闲的进程依次报 47.6 / 32.0 / 24.2%，真实窗口 CPU 为 0）；两个 fake tmux 判断 `$1 = list-panes`，而产品 argv 以 `-L <sock>` 开头，census 恒为空、15 条 active 全被投影为 offline；已提交的 session-projection-cpu-probe 直接调 `spliceSessions()`，绕过了 graphCache / graphStream 管线。我自己的全量探针给带 hot 的窗口多加约 2–3.6 pp，本文所有 CPU 数都来自不包 fs 的轻量模式；同一臂同一阶段跨批次会漂约 3 pp，所以只做同批比较。

未验证：macmini 与 macOS 未操作；活 session 数只测了 15，hook 速率 0.5 / 1 / 4 次每秒，每配置 n=2–3、窗口 60 s，无长时间 RSS；process-host 与真实 tmux server 不在 fixture 里；所有 fix 臂是编译产物上的私有补丁，没有 TypeScript 改动、spec 更新和测试。

<!-- reply: 626f0c29-f847-41c0-8714-889c6fc787a8 @ 2026-09-19T08:10:58.008Z -->
Spec: graph-stream

更正上一条里的一个数：隔离 run 是 137 个（另有 1 个冒烟测试），全部 exit=0；我写的「140 余个」没有核对。报告页眉同一处已改（之前误把 15 个配置文件也数了进去）。其余数字均由生成器从 results/*.json 直接算出，未受影响。

<!-- reply: 7690d008-1893-4d77-a6d3-16f051463169 @ 2026-09-19T09:28:38.459Z -->
Spec: liveness, sessions-core, graph-stream, serve

最终架构修复已落地，提交 `066ce77b8 fix(liveness): derive hot probes from owned runtimes`。

这不是 fixH2 的降频止血，而是改候选集合来源：

- durable archive roster 继续保留历史/审计/恢复数据，但不再进入 100ms hot liveness。
- active leaf receipt 或 adapter runtime binding 注册 hot candidate。
- stop/close/archive 释放 candidate；state/store/session-db subject 事件只刷新对应 id；unknown source 才做一次 bounded recovery seed。
- 100ms `hotSignature()` 只遍历 owned candidate set；backend recovery 才做一次全量 seed。
- archived/stopped/queued/unbound/hazard rows 走 close/cold-proof/repair/warm 路径，不成为第二套 cleanup authority。

隔离真实 worker A/B（682 records = 667 archived + 15 active；active 有合法 leaf receipt，archived 只留历史 pid artifact；真实 delta SSE + 60 次真实 session-state hook；window CPU，old/current plain dist 各两轮）：

| build | empty CPU | stream CPU | burst CPU | list-panes | burst RSS |
|---|---:|---:|---:|---:|---:|
| old run 1 | 59.03% | 33.97% | 53.37% | 110 | 298,528 KiB |
| old run 2 | 57.60% | 34.13% | 60.03% | 122 | 331,884 KiB |
| current run 1 | 57.81% | 28.37% | 23.39% | 51 | 279,632 KiB |
| current run 2 | 58.17% | 28.14% | 22.53% | 49 | 291,104 KiB |

均值：delta stream `34.05% -> 28.26%`；hook burst `56.70% -> 22.96%`；tmux census `116 -> 50`。短样本 CPU 会抖，但 candidate cardinality/census 结构性证据稳定：archived history 已从 hot path 拿掉，active runtime 仍保留。

验证：liveness/hot/graph/session projection `51/51`；session-application `45/45`；source projection gate PASS；ESLint PASS；`spex spec lint` 0 errors（仓库既有 warnings）。typecheck/build 仍只有既有 `DisplayStatus`/`archived` 类型错误。

报告：[[file:active-runtime-cpu-report.html]]

边界：SQLite FULL synchronous 下的空 cursor→unknown→full-splice burst bug（fixC）尚未合入；它是独立的 graph-stream spec-first 后续，不与本次 active-owned hot candidate 重构混合。macmini/macOS 未操作。
