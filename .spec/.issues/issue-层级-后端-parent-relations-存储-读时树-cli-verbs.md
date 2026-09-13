---
concern: issue 层级（后端）：parent / relations 存储、读时树、CLI verbs
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: local-issues, issues, issues-cli, state, issue-driven-development
created: 2026-09-13T08:51:20.386Z
---

背景：借鉴 Linear（官方文档 parent-and-sub-issues / issue-relations / display-options / conceptual-model 已调研）。Linear 的父子是一个字段 `parentId`；关系是独立的边（blocks / related / duplicate），blocked-by 是读时反向；阻塞方关闭后关系自动降级为 related；duplicate 是一种带 canonical 指向的关闭。

要做（后端 + CLI + spec；dashboard 由另一个 issue 承接，它依赖你这里的 wire 字段）：
1. local issue frontmatter 加 `parent: <issue-id>`（只存直接父；树在读时重建，父关掉/不在则子升根——和 session 的 `parent`、`issue` 同一套纪律）。`Issue` wire 类型加 `parent: string|null`，并在 merged read 上派生 `children: string[]`（读时，不存）。
2. relations 作为边存在**发起方** issue 的 frontmatter：`relations: [{ type: blocks|related|duplicate, id }]`；读时补反向（`blockedBy`、`relatedBy`、`duplicatedBy`）；**阻塞方 status 非 open 时，blocks 在读时呈现为 related**（不改写存储）。
3. duplicate = `spex issue close <id> --duplicate-of <canonical>`：关闭并把 canonical 写进 close 原因/relations；wire 上 `duplicateOf: id|null`。不新增状态枚举。
4. CLI：`spex issue open "…" --parent <id>`（子 issue 继承父的 nodes，除非自己给了 --node）；`spex issue reparent <id> --to <parent|none>`；`spex issue relate <a> blocks|related|duplicate <b>`（duplicate 走 3 的语义）；`spex issue show` 打印 parent / children / relations；`spex issue ls --json` 带这些字段。
5. **状态联动不自动**：不做 Linear 的 auto-close（我们 [[state]] 明文 merge/close 人做）。只在 read 上给出 `children` 的 open/closed 计数，让页面能显示 N/M 并在全部完成时亮出 Close。
6. forge：不做 GitHub sub-issues 同步，但 `Issue` 类型的新字段对 forge issue 读为 null/[]，不能让 forge 列表报错。
7. spec：[[local-issues]]（存储格式 + 读时树 + 降级规则）、[[issues]]（类型字段）、[[issues-cli]]（verbs）；[[issue-driven-development]] 的「拆分」一节改为「拆子任务 = 开 sub-issue（--parent）再 @new，子 worker 自然绑到子 issue；父 issue 的 fleet = 自己的 + 所有子 issue 的」。
8. review API（/api/issues 的 paged read）：行上带 parent/children 计数，供 dashboard 分组用；不改分页语义。

约束：不动 issue id 的 mint 规则；不引入第二个存储；所有读时派生都写成纯函数并单测。

验收：fail→pass 单测（parent 树、反向关系、阻塞降级、继承 nodes、reparent 到 none）；隔离 store（SPEXCODE_ISSUES_DIR）里的真实 CLI 前后对比；typecheck、lint 0 error；review-report 后 `done --propose merge`。
