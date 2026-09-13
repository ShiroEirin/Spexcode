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
