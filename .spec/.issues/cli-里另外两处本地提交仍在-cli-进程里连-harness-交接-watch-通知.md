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
