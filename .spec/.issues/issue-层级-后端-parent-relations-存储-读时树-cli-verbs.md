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

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T08:51:27.390Z -->
@new:reclaude 接这个 issue：按线程正文做后端 + CLI + spec。页面由 issue「issue-层级-页面-按-parent-分组的列表-sub-issues-区-parent-r」承接，它等你的 wire 字段，所以字段一定型就先在线程里回复一下字段清单。

<!-- reply: 949d2dec-30bd-4a13-b43c-b29c59f2dfdb @ 2026-09-13T08:59:37.424Z -->
字段已定型，页面那边可以按这个写（实现正在做，落地前名字不再变）。

`Issue` 新增字段。所有合并读都带：`spex issue ls/show/mine --json`、`GET /api/issues` 的分页行、`GET /api/issues/:id`、board fold。

- `parent: string | null`：读时的有效父。存储的 `parent` 指向的 issue 在合并集里、status 为 open、且不在环里，就是它的 id；否则是 null，子 issue 升根。
- `children: string[]`：有效父是本 issue 的直接子 issue，按 created 升序。子 issue 自己关没关不影响它算不算 child。
- `childCounts: { open: number, closed: number }`：对 `children` 计数，closed 指 status 不是 open。页面的 N/M 就是 closed / (open+closed)。
- `relations: { type: 'blocks'|'related'|'duplicate', id: string }[]`：本 issue 发起的边。本 issue 不是 open 时，`blocks` 读成 `related`。目标不在合并集里的边读时丢弃，所以页面拿到的 id 都能打开。
- `blockedBy: string[]` / `relatedBy: string[]` / `duplicatedBy: string[]`：反向边，按降级后的类型算。阻塞方关闭后，它出现在对方的 `relatedBy` 里，不再出现在 `blockedBy` 里。
- `duplicateOf: string | null`：本 issue 那条 duplicate 边的目标。

forge issue 不存 parent 或 relations，读出来是 `parent: null`、`relations: []`，派生字段为空。

写入口：`POST /api/issues` 的 body 接受 `parent`（New 页 `?parent=` 预填后照常提交即可）；子 issue 没给 nodes 时继承父的 nodes。reparent、relate、`close --duplicate-of` 这一轮只有 CLI，和 `close` 一样直接提交到 trunk，没有 HTTP 路由。

有一处照正文字面实现、但需要知会的后果："父关掉则子升根"意味着关闭的父 issue 读时没有 children，已关闭视图里的树是平的，已关闭的子 issue 也看不到面包屑。如果要保留"已关父 + 已关子"的边，只需改派生函数里的一个判断，说一声就改。
