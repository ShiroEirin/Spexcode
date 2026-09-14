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
