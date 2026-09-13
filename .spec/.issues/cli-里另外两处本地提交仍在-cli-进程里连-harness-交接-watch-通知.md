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

<!-- reply: fa26102d-ccf8-444d-817d-e1b01403aa00 @ 2026-09-13T12:57:26.414Z -->
报告：[[file:local-commit-owner-report.html]]。修复提交 bfd918ca7，合入最新 main 后是 2781049db。

隔离 A/B（A=906b2c6a2 改前，B=bfd918ca7；fake harness 不回 repaint；每步前等 watcher 的 socket 连续 2 s 无人持有）：
- `internal session-turn-fail`（后端在）：B 311 ms，`ss -xp` 采到的持有者只有后端子进程；A 10322 ms，持有者是 turn-fail CLI 自己。
- `session watch`（后端在）：B 342 ms，后端持有，pane 431 ms 收到快照。A 274 ms，但 A 根本没交接，快照靠后端巡检送到。
- 停掉后端：B 的 watch 快照 407 ms、turn-fail 通知 395 ms 送到 pane，持有者是 CLI 自己，CLI 等满 10 s 墙后返回（兜底本来就是这样）。A 的 watch 快照没送出；后面 turn-fail 的本地 drain 先送它再送通知，等了两次墙（20350 ms）。

测试：新加 4 条改前 2 fail（10527 ms / 无后端不送达）、改后 4/4。合并 main 后：typecheck 0，spec lint 0 error，follow-cli.api 10/10、session-timeline 12/12、session-create-cli 8/8、issues 14/14、sessions 整文件在 dist 新鲜时 51/51。

报告里写明了两处测量上的问题：第 1 次运行没等 watcher 空闲，A 的 turn-fail 因投递锁被前一条通知占着也很快，所以重跑了；第 2 次运行 A 的第一次尝试是我在它运行时往 A 源码树拷测试文件，触发 supervisor 重建，已撤回重跑。

另外发现 `sessions.test.ts` 的 resume 就绪栅栏测试在"源码刚比 dist 新"的检出上必定超时（启动器自动构建吃掉它的 5 s）。基点全新检出同样失败，与本改动无关，已另开 issue `sessions-test-ts-的-resume-就绪栅栏测试-检出源码比-dist-新时必定`。

<!-- reply: fa26102d-ccf8-444d-817d-e1b01403aa00 @ 2026-09-13T13:05:07.456Z -->
已合入 main 并推送：7c428de3f（--no-ff，父提交 9a1c2879e 与同步后的分支 ae284ebd7），origin/main 已是 7c428de3f。

落地前把最新 main（9a1c2879e，只多了本线程的回复和新开的那个 issue 文件）再合进分支，在 ae284ebd7 上重跑：spex spec lint 0 error、typecheck 通过、`npm run build` 通过、follow-cli.api 10/10。它和已验证的 2781049db 只差两个 `.spec/.issues` 文件；main 的树与 ae284ebd7 的树逐字节相同，合并提交自己的 pre-commit lint 也是 0 error。

合并在源检出旁边的临时 detached worktree 里做，再对源检出 `merge --ff-only`，临时 worktree 已删。源检出落地前后都是干净的，状态指纹与检查时一致，没有 MERGE_HEAD。快进后有一次源检出 dist 的自动重建（`spec-cli/.dist-next-*` 临时目录短暂出现，构建结束后改名为 gitignore 的 dist），不是用户改动，也没有碰。测试进程、A/B 用的端口、tmux、检出都已清理，证据留在报告里：[[file:local-commit-owner-report.html]]。

推送时 GitHub 提示仓库地址已改为 https://github.com/shuxueshuxue/Spexcode.git（大小写），这次经重定向推送成功，origin 的 URL 没改。关闭本 issue 留给你。另一个 concern 在 `sessions-test-ts-的-resume-就绪栅栏测试-检出源码比-dist-新时必定`。
