---
concern: watch 交接之后，发给父会话的普通 send 等投递锁 30 s 后返回 500
by: d41d59b1-5274-4095-bf8f-9ad4b4101df0
status: open
nodes: delivery-queue, file:send-lock-repro.mjs
created: 2026-09-13T11:17:52.226Z
---

Spec: delivery-queue, session-follow

在最新 main（8a30e3423，已包含 3d9d2d368「CLI 状态提交把 watch 投递交给后端」）上，用隔离 fixture 实测：独立 SPEXCODE_HOME、空闲端口、独立 tmux socket、fake-claude launcher。

1. 父执行 `spex session watch <子>`，子依次执行 `ask` → `park` → `ask`。每一步约 0.5 s 返回，父的 timeline 上 3 条 `[spex watch]` sent 事件都在。
2. 子执行 `spex session send <父> "an ordinary peer message"`：**30.66 s 后 exit 1**，输出 `dispatch failed: bad backend response (500)`。
3. 后端日志：
   - `delivery retry failed for <父>: delivery queue <父>: timed out waiting for transaction lock`
   - `pushed delivery for <父> deferred: delivery queue <父>: timed out waiting for transaction lock`（两次）
   - `Error: delivery queue <父>: timed out waiting for transaction lock`

把脚本里的 spec-cli 换成 node/session-timeline-d41d 分支的版本，结果完全相同。合入 3d9d2d368 之前，我那条 e2e 按同样的顺序（send 在三次声明之后）跑过两次，都通过。

下面是读代码得出的推断，没有单独测量：`drainSession` 在 `withDeliveryLocks` 里调用 `deliver`；fake-claude 不回 `repaint-done`，所以 `replyViaSocket` 每次都要等满 10 s 超时。以前这段等待发生在声明 CLI 的进程里，进程一退出，锁就被回收；现在由常驻后端的 push 和 retry 接连 drain，锁几乎一直被占着，而 `send` 等锁最多只等 30 s。真实 harness 如果在一个很长的 turn 里迟迟不 repaint（也就是代码注释里说的 busy 情况），很可能也会出现同样的问题。

复现脚本：[[file:send-lock-repro.mjs]]。运行 `CLI_ROOT=<SpexCode 检出根> node send-lock-repro.mjs`，输出一段 JSON，包含每一步的 exit 码和耗时，以及后端日志里和锁有关的行。

这个问题是在验收 issue watch-通知在-timeline-view-里画成系统行-wire-上标记托管-watch- 时发现的。那边的 e2e 已经改成先发普通消息、再做声明，只测渲染。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T11:20:09.601Z -->
@new:reclaude 接这个回归。先用线程里的 send-lock-repro.mjs 在隔离 fixture 复现（main 3d9d2d368 之后），再对 3d9d2d368^ 跑一次确认它是这次改动引入的（issue 正文暗示合入前同顺序通过）。
修的方向（读代码后可调）：普通 `send` 的入队是一次事务，不该等在收件方正在进行的交接（`drainSession` 在 `withDeliveryLocks` 里等 replyViaSocket 的 10 s 墙）的锁上；每个收件方同时只跑一个 drain 循环，后来的 `/push` 只标记「还有待投递」而不是再排一个持锁的 drain；投递锁只保护队列头的取/删，不跨越 socket 等待；`send` 超过锁等待也不能变成 500，要么立刻入队返回，要么给出明确的排队回执。目标数字：三次声明后立即 `send`，CLI ≤ 1 s 返回、消息到达父的队列与 timeline；用会回 repaint-done 的 fake harness 和不回的各测一遍。保留 3d9d2d368 的成果（声明 CLI ~350 ms、连接归后端）。spec：[[delivery-queue]] 写清锁的范围与「一个收件方一个 drain」。隔离要求同前，结束清理并在报告里证明；review-report 后 done --propose merge。
