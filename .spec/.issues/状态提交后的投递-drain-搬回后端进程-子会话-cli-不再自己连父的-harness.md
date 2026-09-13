---
concern: 状态提交后的投递 drain 搬回后端进程：子会话 CLI 不再自己连父的 harness
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: session-follow, delivery-queue
created: 2026-09-13T10:31:46.968Z
---

实测（隔离 A/B，报告 watch-ab-report.html，session 5deeedca 的 files 里）：35a0c5149 在状态提交路径上写了 `if (sessionHasPendingDelivery(recipient)) await drainSession(recipient)`（spec-cli/src/sessions.ts 约 1293 行）。`drainSession` 不是「催后端」——它拿投递锁、取队列头、调 harness adapter 的 `deliver`，adapter 走 `replyViaSocket`（harness.ts:576）直接连收件方的 rendezvous socket、等对方回 `repaint-done`，墙 10 s。状态提交发生在**子会话的 CLI 进程**里（`spex session done/ask/park`），于是子的 CLI 自己连父的 socket 等回应：fixture（fake harness 不回 repaint-done）下 `session park/done` 卡 10.3 s、`ask` 23.8 s；`ss -xp` 看到子 CLI 进程持有那条 socket 连接。改动前（7171e1788^ 与 09-06 的 main）投递连接始终由后端子进程持有。

这违反 [[session-follow]] 的原文："The subject's backend only appends the event; it does not attempt delivery on a channel it does not own."

要做：
1. 提交路径上把 `await drainSession(recipient)` 换成「叫拥有通道的后端去 drain」：有后端可达时用 `client.ts` 已有的 `clientPushQueued(id)`（注释原话 "Ask the live backend to drain messages already enqueued by a local broadcast"）或等价的后端路由，CLI 立刻返回；只有确认没有后端（连接被拒）时才本地 drain。后端进程自己提交时（例如 HTTP 路由触发的转移）仍可直接 drain。
2. 保留 35a0c5149 带来的正确部分：watcher timeline 的 `sent` 事件仍在提交时追加（[[session-follow]] "appends one normal `sent` event to each watcher's timeline"），wake 仍带 recipient 集合，patrol 仍是恢复路径。
3. spec：[[session-follow]] / [[delivery-queue]] 把「谁 drain、在哪个进程」写清楚一句；不要改动「后端才拥有通道」那句的意思。

验收（照 5deeedca 那套隔离 A/B 的形状：独立 SPEXCODE_HOME、空闲端口、独立 tmux socket、fake launcher；结束清理进程/端口/worktree 并在报告里证明）：
- 子会话 `session ask/park/done` 在 fake harness 不回 repaint-done 的 fixture 里 ≤ 1 s 返回（改前 10.3 / 23.8 s）。
- 父的 timeline 在声明后 ≤ 1 s 出现对应的 `[spex watch]` sent 事件（与 B 相同）。
- `ss -xp` 采样：向父 harness 的投递连接由后端进程持有，不是子 CLI。
- 没有后端时（fixture 不起 serve，只跑 CLI）通知仍能到达（本地 drain 兜底）。
- 现有 session-follow / delivery 单测与 yatu 测试全过；typecheck、lint 0 error；review-report 后 `done --propose merge`。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T10:31:50.848Z -->
@new:reclaude 接这个 issue，先读线程正文和它引用的 spec 节点，按验收做，严格隔离。

<!-- reply: 5d23fcba-2710-4fe5-b87d-eaf6db1d0bf1 @ 2026-09-13T11:00:33.271Z -->
修复与隔离 A/B 报告：[[file:drain-owner-report.html]]。提交 1d3071ebb（修复 + spec）、0f078d85a（404 断言）。

做法：commit wake 仍在提交所在进程里把 watch 事件翻译成父队列的 prompt 和父 timeline 的 `sent` 事件；把队列交给 harness 改走按进程决定的 handover。默认原地 drain（后端、测试）；CLI 的 state kit（`done/park/ask` 与 `spex internal session-*` 共用）装 owner-first：调 `/push`，只有 ECONNREFUSED 才本地 drain。`/push` 启动 drain 后立即回 ok，不再等交接完成；对本后端没有记录的会话回 404。`reconcileWatchDeliveries` 去掉了内部 drain，因为它的两个调用方紧接着都会交接。spec 改了 [[session-follow]] [[delivery-queue]] [[sessions-core]] [[remote-client]] [[declaration]]，"backend only appends the event" 那句原样保留。

A/B（fake-claude 不回 repaint；A=32dcc53e4，B=1d3071ebb）：
- 声明 CLI 耗时：B ask/park/done 346/326/349 ms；A 16908/10346/10362 ms。
- 父 timeline 的 sent 事件：B 在 CLI 启动后 255–265 ms 写入，376–424 ms 读到。
- `ss -xp` 持有者：B 三步都只有后端子进程；A 的 park/done 是声明 CLI 自己。
- 杀掉后端再声明：CLI 自己交接，pane 380 ms 收到，重启后 final timeline 里有这条事件。
- 新回归测试改前 fail（CLI 10622 ms）、改后 pass；相关 11 个套件合跑时有 1 条 resume 就绪测试因负载超时，单跑在 A、B 上都过；sessions.test.ts 单跑 51/51；yatu 5 过、1 个跳过（需要真 Codex）；typecheck、eslint、import-cycles 通过，spec lint 0 error。进程、端口、tmux、worktree 已清理，记录在报告末节。

同类但没在这里扩范围：`spex session watch <SEL>` 装关系时给自己入队的快照、`spex internal session-turn-fail`，仍在 CLI 进程里原地交接。已另开 issue `cli-里另外两处本地提交仍在-cli-进程里连-harness-交接-watch-通知`。
