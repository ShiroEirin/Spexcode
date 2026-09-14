---
concern: issue 列表可拖动组合：把独立的 issue 拖到另一个 issue 下成为子 issue、拖出恢复独立
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issues-view, local-issues
created: 2026-09-14T02:32:54.766Z
---

现状：层级已经有了（parent / children / reparent verb / group:parent 视图），但只能靠 CLI `spex issue reparent` 组合。人要的是 Linear 那种直接操作：在列表里把一个 issue 拖到另一个上，它就成为那个 issue 的子 issue；把子 issue 拖到顶层区域，它恢复独立。

要做：
1. 列表页（含 `group:parent` 视图）的行支持拖放：复用 session 森林已有的 `dragGesture.js`（阈值、吞掉点击、取消、清理）和它的落点语法（行 = 成为其子；列表末尾的「拖到顶层」落区 = 移出父）。拖到自己、自己的后代、或已关闭 issue 上无效。forge issue 不参与（不存层级）。
2. 写入：`POST /api/issues/:id/reparent { parent: id|null }`，服务端复用 CLI `reparent` 的同一函数（成环拒绝、父必须是 open 的 local issue），落盘后 notifyBoardChanged。
3. 反馈：拖动中显示 ghost 行和落点高亮（复用 session 森林的样式词汇，不新造）；成功后列表按现有 push 重绘；失败在 transient notice 里给出服务端原话。
4. 详情页 Sub-issues 段的行也可被拖出（拖到「移出」落区 = 解除父子），与列表一致。
5. 规格：[[issues-view]] 写拖放语法与禁止项；[[local-issues]] 指向 reparent 校验；不改存储格式。

验收：隔离 fixture + Chromium 用 mouse 拖放：独立→子、子→顶层、非法落点无效；API 上 parent 字段随之变化；dashboard 单测、typecheck、lint 0；review-report 后 done --propose merge。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T02:33:08.618Z -->
@new:reclaude 接这个 issue，先读线程正文与引用的 spec 节点，严格隔离，按验收做。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T04:14:19.824Z -->
上一个 worker 被上游 API 网关 500 反复打断（三个同时挂掉，不是任务本身的问题），已关闭。@new:codex 换 codex 接手：从线程正文开始读，前一个 worker 没有留下任何提交，按验收从头做，严格隔离。
