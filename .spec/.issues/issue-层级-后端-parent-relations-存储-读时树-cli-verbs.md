---
concern: issue 层级（后端）：parent / relations 存储、读时树、CLI verbs
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: landed
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

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T09:00:48.349Z -->
字段清单收到，页面那边按这个写。一处改：**父 issue 已关闭不算「不在」**——「父关掉则子升根」我原意是父在合并集里已经不存在（被删/不可读）或成环，不是 status 关闭。Linear 的层级不随状态消失，已关父 + 已关子的树在 Closed 视图里要还在，面包屑也要在。所以有效父的判断改成：存储的 parent 在合并集里且不在环里 → 就是它，不看 status。children / childCounts 同理不看父的状态。其余保持。

<!-- reply: 949d2dec-30bd-4a13-b43c-b29c59f2dfdb @ 2026-09-13T09:15:04.713Z -->
先报一个我造成的问题：做 CLI 前后对比时，我以为 `SPEXCODE_API_URL=http://127.0.0.1:1` 就能让 `spex issue open` 不走 backend。实际没有隔离住，写入经 live backend 落进了真实 trunk store。09:12:12–09:12:42Z 之间 main 上多了 8 个测试 issue 的提交，作者是我这个 session：`epic-issue-hierarchy`、`epic-issue-hierarchy-2`、`sub-one-epic-issue-hierarchy`、`sub-two-epic-issue-hierarchy`、`sub-two`、`blocker`、`blocker-2`、`dup-of-sub-two`。

已处理：逐个确认作者、时间、零回复后，通过 backend 的 close 路由把 8 个都关成了 landed，不会再出现在 open 列表和节点角标里。文件和提交还在 `--all` 里，store 没有删除动词，删文件要往 main 提交，需要人来决定。

后面重跑对比会换成真正隔离的方式，查清 CLI 怎么选 backend 之后再跑。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T09:17:42.083Z -->
收到，处理得对：先核作者/时间/零回复再关，关成 landed 而不是删文件，删不删留给人。这不全是你的错——是我今天刚落的「issue 写操作 backend first」把 `SPEXCODE_ISSUES_DIR` 的隔离绕开了（CLI 去了后端，后端用它自己的 store），我现在就修：设了 `SPEXCODE_ISSUES_DIR` 时 CLI 不走后端、只写那个一次性目录；`SPEXCODE_API_URL` 显式指向一个不可达地址时也不再回落到别的后端。在这条落地之前，你要做 CLI 前后对比就用真正隔离的 fixture 后端（独立 SPEXCODE_HOME + 空闲端口 + fake launcher，`session-create-orphan.yatu.test.ts` 那套），别再依赖环境变量兜底。其余照你定型的字段继续。

<!-- reply: 949d2dec-30bd-4a13-b43c-b29c59f2dfdb @ 2026-09-13T09:26:59.712Z -->
后端、CLI、spec 已提交（`adcb180f6`），main 已合进来（`59754f099`，含 `9732532c1`），合并后的树上重跑了全部证明。报告：[[file:issue-hierarchy-report.html]]

wire 字段和前面定型的清单一致，没有改动。`POST /api/issues` 接受 `parent`，回执里带 `nodes` 和 `parent`。

和正文不完全一样的几处：
- 读时树和降级规则写在 [[issues]]，因为 `issueHierarchy` 是 `issues.ts` 合并读上的纯函数。[[local-issues]] 写存储格式和写入校验，并指过去。
- duplicate 的"关闭原因"写在那次提交的 message 里，store 没有 reason 字段。`relate <a> duplicate <b>` 就是 `close <a> --duplicate-of <b>`。
- 写入时的校验：parent 必须是存在且 open 的 local issue；`reparent` 拒绝成环；`relate` 的目标必须存在，且不能是自己。
- `reparent`、`relate`、`close --duplicate-of` 没有 HTTP 路由，和 `close` 一样直接提交，所以 linked worktree 里的 worker 会被 store 拒绝。只有 `open --parent` 走 backend。
- [[issue-driven-development]] 的拆分一节写了"父 issue 的 fleet 包含子 issue 的"。这句要等页面 issue 改了 `issueFleet` 才成立。
- `drawer-verbs.test.ts` 里 `spex issue mine --help` 那条在 main 上本来就失败，不是这次引入的。

证明方式：隔离 fixture backend，形状照 `session-create-orphan.yatu.test.ts`：独立 git 仓、`SPEXCODE_HOME`、端口，从源码启动。trunk 源码和本分支用同一串 CLI 与 API 命令各跑一遍做 A/B。另有 7 个新单测，fail→pass。typecheck 通过，lint 0 error。

<!-- reply: 949d2dec-30bd-4a13-b43c-b29c59f2dfdb @ 2026-09-13T09:32:30.457Z -->
已落到 main 并推送：`6b1902f1c`（merge node/local-issues-949d），origin/main 已包含。页面 issue 现在可以直接基于 main 上的 wire 字段开发。

落地前又同步了一次 main（到 `b85643d88`，唯一和本分支重叠的文件是 `index.ts`，文本合并干净，`parent` 处理完好），然后在同步后的 tip 上重跑：单测 13/13、typecheck 通过、lint 0 error、隔离 fixture backend 的 A/B 输出与评审时那次逐行一致（时间戳除外）。落地后在 main checkout 上再跑 lint 和单测，结果相同。

留给人决定的两件事：
- 这个 issue 的关闭（按 skill，worker 不关）。
- 之前泄漏到 trunk store 的 8 个测试 issue，已关成 landed，文件是否删除。

另：推送时 GitHub 提示仓库地址已改为 `https://github.com/shuxueshuxue/Spexcode.git`，当前 origin 仍指向旧地址，推送本身成功。
