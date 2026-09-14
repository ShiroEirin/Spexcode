---
concern: 复测 issue 驱动的 prompt engineering：修好投递之后 agent 是否真的按名署名、关闭后是否真的停
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issue-driven-development
created: 2026-09-14T14:51:40.413Z
---

第一次实测（`8b50b1d4` 的报告）在两个点上给出了否定结论：多归属声明 0/2 使用 `[[issue:<id>]]`，关闭 issue 之后 worker 收不到任何通知、继续回复。

后来查明第二个结论成立，第一个结论**无效**：`spex init` 的种子副本（`spec-cli/templates/spec/project/.plugins`）比 live 节点落后一个版本，`[[issue:<id>]]` 这条规则从来没有进入被试项目的 skill 文件（实测被试项目里 `grep -c '\[\[issue:'` = 0）。也就是说那六个 worker 是被拿一条它们根本没读到的规则去衡量的。

现在已经落地（本 session 的 commit）：close 会给 fleet 发通知；`session done|ask|park` 在无法归属时当场说出代价；`issue mine` 在多归属时说出规则；assign 通知从 assign 刚写入的集合里派生多归属那段话；种子副本已同步。

这个 issue 要的是**复测行为**，不是复测机制（机制已在隔离 fixture 里逐条跑通）：拿修好之后的工具链，让真实 agent 跑一遍，看它是否真的按名署名、关闭后是否真的停。

Spec: issue-driven-development, issue-binding

<!-- reply: a2e66fc6-768d-426d-844f-83831abc7b60 @ 2026-09-14T16:27:02.585Z -->
复测完成，结果只针对本次两个 codex-headless subject，观察契约是 [[issue-driven-development]] / [[issue-binding]]：

- 首轮自己读 issue：2/2 都发出了真实的 `spex issue mine --json` 工具调用，随后读取各自线程。
- 多归属按名署名：health subject 经 `spex issue assign` 绑定第二个 issue 后再次调用 `mine`，收到“两 issue 必须用 [[issue:<id>]]”提示；health issue 关闭后，它没有再向 health 线程回复，只在 statistics 线程回复，声明 note 带 `[[issue:add-inventory-statistics-endpoint]]`。
- 关闭之后停：cache subject 在工作中收到 close 通知后原话是“stopping immediately and will not post another thread reply”，随后只做了 issue-qualified close declaration。
- 关闭后继续别的 issue：health subject 原话是“leaving that thread untouched and continuing only on [[issue:add-inventory-statistics-endpoint]]”，之后只继续 statistics 工作。

本次样本没有显示 wording 仍有缺口；完整逐字 subject 文本、真实调用、reply 所在线程、declaration 原文、种子 grep 的 `3 / 3 / 0` 和清理证明见 [[file:issue-behavior-recheck-report.html]]。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T16:30:51.697Z -->
读数已独立复核 —— 我自己解了 fixture 的 `session_events`、自己 grep 了种子、自己数了 issue 文件里的 reply，不走报告的结论。四点都成立：

    15:57:08  cache subject 在 cache 线程回复
    15:57:10  cache subject 收到 close 通知（间隔 2 秒）
    15:58:24  declare awaiting，note 带 [[issue:fix-cache-recency-for-inventory-reads]]，此后 cache 线程 0 条新 reply
    16:06:09  health subject 收到 statistics 的 assign 通知
    16:07:14  health subject 收到 health 的 close 通知
    16:07:22  它的第一条 statistics reply（间隔 8 秒），四条全部带 [[issue:add-inventory-statistics-endpoint]]
    16:14:57  declare awaiting，note 带 [[issue:add-inventory-statistics-endpoint]]，health 线程 close 之后 0 条新 reply

种子交付我自己复了一遍：fixture 的三份文件（Claude skill、Codex skill、plugin 节点）各 3 次 `[[issue:`，上一次那三份是 0。清理也复了：`issue-behavior-recheck` socket 无 server、18971 空闲、fixture 里无残留进程。

**但报告有一处言过其实，需要记在案**：第一次实测真正失败的那个场景，这次并没有重建。health subject 同时持有两个 open issue 的窗口只有 **65 秒**（16:06:09 拿到第二个，16:07:14 第一个就被关了）。它面对的不是"两个都开着、该往哪条线程汇报"，而是"一个关了、只剩一个"。所以这次能证明的是：close 通知到达并被遵守、assign 之后声明按名署名；**不能**证明持续多归属下 reply 路由正确 —— 那恰好是第一次失败的那一点。

另外两处不算偏差但要说清：cache subject 那条 reply 和 health subject 在 health 线程的三条 reply 都没有 issue 引用，但它们当时都只持有一个 issue，按规则无需限定；health subject 在只有一个 issue 时就已经在声明里署名，比规则要求的更多。

所以这个 issue 还差一个场景。我给你发了一条聚焦的后续：两个 issue 同时开着、都需要真实工作、持续几分钟，看 reply 落在哪条线程上。跑完这一个场景就可以收。

Spec: issue-driven-development, issue-binding
