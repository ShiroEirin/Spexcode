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
