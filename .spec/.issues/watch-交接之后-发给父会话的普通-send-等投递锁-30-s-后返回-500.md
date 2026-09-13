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

<!-- reply: de8e66a8-af01-41d3-8bb4-0094bac8ca60 @ 2026-09-13T11:38:37.716Z -->
复现结果。隔离 fixture 同前：独立 SPEXCODE_HOME、空闲端口、独立 tmux socket，每次跑完 fixture 目录已删、tmux server 已退、没有残留进程。

- HEAD 37c0ae4f9（含 3d9d2d368），fake-claude 不回 repaint-done：三次声明各约 0.55 s；send 30.6 s 后 exit 1（500），后端日志 3 条 `timed out waiting for transaction lock`。消息其实已经进了父的队列和 timeline，39 s 后才交到父的 harness。
- 3d9d2d368^1，同一个 harness：send 10.6 s，exit 0；但三次声明分别是 20.6 / 10.5 / 10.5 s，因为那时声明 CLI 自己在等 socket 墙。issue 正文里"每步约 0.5 s"是合入之后的数字。
- 换成回 repaint-done 的 harness：两棵树的 send 都是 0.63 s 左右，不复现。

结论：是 3d9d2d368 引入的。等待从短命的声明 CLI 挪进了常驻后端，锁一直有人占着，send 排在后面等满 30 s。

读完代码，方向上有两处调整：

1. 投递锁仍然跨一次 insert。如果只锁队头的取/删、不锁 socket 等待，两个进程可能把同一个队头各发一次：出队的 CAS 只防重复删除，防不了重复插入。要补上就得加一个"已认领"标记，那只是给同一把锁换个名字。毛病不在锁跨了 socket，在于有人排队等它。所以改成：锁只跨一个队头，发完一条就释放，不再跨整个队列；drain 拿不到锁就直接返回，不等；持锁方释放后要再读一次队列才能停，持锁期间入队的消息由它来发，唤醒不会丢。
2. 不另设"还有待投递"标志，队列里那一行就是这个标记。同一进程里每个收件方最多跑一个 drain 循环，之后来的 send、/push、sweep、commit wake 发现循环在跑就直接返回。sweep 和 commit wake 原先按收件方顺序 await，一个父卡在 10 s 墙上，别的会话的重试也跟着等；现在每个收件方各跑各的循环。

send 提交之后的交接不管因为什么失败，都只记日志、回 `delivery: queued`，不再变成 500。消息已经被接受了，报失败只会让发送方再发一遍。还会等锁的只剩 [[session-reparent]]（它要在两次 insert 之间看到队列），现在最多等一条。锁的范围和"一个收件方一个 drain"写进 [[delivery-queue]]。

回归测试 `a send to a watcher whose harness is holding a watch notice does not wait behind it`：在未修复的 HEAD 上失败（send 10047 ms），修复后通过。下一步用 repro 在两种 harness 上量修复后的数字，然后出 review-report。

<!-- reply: de8e66a8-af01-41d3-8bb4-0094bac8ca60 @ 2026-09-13T11:51:06.796Z -->
修复已经提交，并合入了 main：分支 56a5cfae7 = ec5c7745e（修复）+ 合入 be97fd322。用同一个 fixture、同一步骤顺序，每个场景串行跑一次：

- 不回 repaint-done 的 harness：main be97fd322 上 send 30.64 s 后 exit 1（500）；本分支 0.61 s，exit 0。send 返回时消息已经在父的 timeline 里，队列里排在 4 条 watch 通知后面，39 s 后按顺序交到父的 harness。后端日志里不再出现等锁超时。
- 回 repaint-done 的 harness：main 0.64 s，本分支 0.63 s。
- 声明 CLI：ask/park/ask 最慢 0.57 s（main 上是 0.52–0.65 s），3d9d2d368 的成果保住了。
- 线程里的原脚本 send-lock-repro.mjs（未改动）：main 30.62 s，返回 500；本分支 0.66 s，输出 sent。
- 回归测试在 main 上失败（send took 10050ms），在本分支通过。会话相关测试 96/96 通过，typecheck 通过，spec lint 0 error。
- 清理：每次运行结束时的 teardown 检查都干净（fixture 目录已删、tmux server 已退、backend 已退、没有残留进程）。本会话留下的 14 个 tmux socket 文件、58 个测试 fixture 目录和 3 棵快照树已删除，复查结果为 0。另有 3 个 spex-send-lock socket 文件是 04:11–04:15 留下的，早于本会话创建，我没有动。

没有验证的：真实的 Claude harness；跨进程"拿不到锁就走、持有者释放后再读一次"没有确定性测试；drain 碰到 reparent 持锁、靠 sweep 接手的那条路径没有专门测。

锁的范围和"一个收件方一个 drain"写在 [[delivery-queue]]。报告：[[file:report.html]]

<!-- reply: de8e66a8-af01-41d3-8bb4-0094bac8ca60 @ 2026-09-13T11:57:58.927Z -->
已落地：main f41c82122，由 --no-ff 合入 96dc57025（父提交是 6bca1e58e），已推送 origin/main。

- 落地前最后一次同步了 main 6bca1e58e，它只比上次多了线程回复那个 issue 文件。在同步后的 96dc57025 上重跑：build、typecheck 通过，spec lint 0 error，聚焦测试 12/12，线程原脚本 send 0.635 s、输出 sent、没有等锁日志。
- 落地提交的树和验证过的 96dc57025 完全一致。源检出没有 MERGE_HEAD，也没有脏文件：快进之后一度出现过一个未跟踪文件，推送前复查时已经消失，我没有动过它。本机后端 :8787 的 /health 正常。
- 落地测试留下的 18 个 fixture 目录已删除，复查结果为 0。

改动对应 [[delivery-queue]]。issue 请你来关。
