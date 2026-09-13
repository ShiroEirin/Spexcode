---
concern: CLI 里另外两处本地提交仍在 CLI 进程里连 harness 交接 watch 通知
by: 5d23fcba-2710-4fe5-b87d-eaf6db1d0bf1
status: open
nodes: session-follow
created: 2026-09-13T11:00:10.663Z
---

做 [[session-follow]] 的 drain 归属修复（commit 1d3071ebb）时发现的同类问题，未在那个 issue 里扩范围。

1d3071ebb 之后，CLI 状态写入方（`done/park/ask` 与 `spex internal session-*`，都走 `sessionStateKit`）的 commit wake 用 owner-first handover：调后端 `/push`，只有 ECONNREFUSED 才本地 drain。CLI 进程里还有两处本地提交没有走这条路，仍用默认的原地 drain，所以仍会在 CLI 进程里连 watcher 的 harness socket 并等 repaint：

- `spex session watch <SEL>`：`subscribeSessionWatch` 安装关系时，把目标当前状态入队给调用者自己，wake 在 CLI 里 drain。
- `spex internal session-turn-fail`：直接调 `markHeadlessTurnFailure`，不经过 state kit；`error` 转移的 wake 在该进程里 drain。

可以复用 `setDeliveryHandover`：在这两个入口装 `clientHandOverQueued`。验收形状同原 issue：fake harness 不回 repaint 时命令 ≤ 1 s 返回，`ss -xp` 看到持有连接的是后端。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T12:11:46.123Z -->
@new:reclaude 接这个 issue。按 issue 正文做：在 subscribeSessionWatch 的快照入队和 internal session-turn-fail 两个入口装 setDeliveryHandover/clientHandOverQueued，与 done/park/ask 同一套 owner-first；验收同 drain 归属那次（隔离 fixture，fake harness 不回 repaint 时命令 ≤1 s 返回，ss -xp 连接归后端，无后端时本地兜底仍送达）。别扩范围。

<!-- reply: fa26102d-ccf8-444d-817d-e1b01403aa00 @ 2026-09-13T12:30:13.725Z -->
动手前先在改前代码（906b2c6a2）上跑了新加的回归测试（隔离 SPEXCODE_HOME、fake harness 不回 repaint）。两处情况不一样：

- `spex internal session-turn-fail`：和正文一致。后端在跑时 CLI 耗时 10564 ms，它在 CLI 里原地 drain，停在 watcher 的 10 s 墙上。
- `spex session watch <SEL>`：正文的前提不成立。`subscribeSessionWatch` 用 `attachWatcher` + `enqueueMessage`，这两个都不触发 commit wake，CLI 里根本没有 drain，也不持有连接。有后端时快照靠后端 1 s 巡检送到；没有后端时一直送不到（无后端用例改前 fail）。所以只装 handover 什么都不会变。

做法：快照入队后调同一个 commit wake（`wakeCommittedRecipients([watcher])`），再在 CLI 的三个入口装 owner-first handover：`session watch`、`internal session-turn-fail`、`session new` 装 parent watch 的那一处。最后这处调的是同一个 `subscribeSessionWatch`，不装的话，这次加的 wake 会让 `session new` 在 CLI 里去连调用者自己的 harness，等于本改动引入新的等待，所以一起装了。其他路径没动。

提交 bfd918ca7（代码 + [[session-follow]] [[remote-client]] [[delivery-queue]] [[sessions-core]] 的 spec）。新加 4 条测试改后全过；follow-cli.api 10/10、session-timeline 12/12，typecheck、eslint、import-cycles 通过，spec lint 0 error。接下来跑隔离 A/B（ss -xp 采持有者、停后端看兜底），报告出来再声明。
