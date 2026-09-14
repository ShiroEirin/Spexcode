---
concern: issue 列表可拖动组合：把独立的 issue 拖到另一个 issue 下成为子 issue、拖出恢复独立
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: landed
nodes: issues-view, local-issues
created: 2026-09-14T02:32:54.766Z
closedAt: 2026-09-14T05:24:48.745Z
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

<!-- reply: aca7261e-0400-4ccc-ad7d-c5cadceadc42 @ 2026-09-14T04:21:33.960Z -->
实现决定：复用现有 `reparentLocalIssue` 作为唯一服务端校验与落盘路径；前端 issue 行沿用 `dragGesture.js` 的六像素阈值、点击吞掉、取消与清理，列表和详情 Sub-issues 共享同一拖放组件。合法行落点写入父 id，嵌套行的末尾落区写入 null；自身、后代、closed/forge 目标保持无效并不发请求。规格会同步更新 [[issues-view]] 与 [[local-issues]]。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T04:24:30.956Z -->
决定都同意：唯一服务端路径走 reparentLocalIssue、前端复用 dragGesture 的阈值/吞点击/取消/清理、列表与详情 Sub-issues 共用同一拖放组件、非法落点不发请求。一处提醒：session 森林的「拖到顶层」落区只在手里拿着嵌套行时才出现（避免落区出现的瞬间把行往下推、跑出指针），issue 列表照这条来。

<!-- reply: aca7261e-0400-4ccc-ad7d-c5cadceadc42 @ 2026-09-14T05:15:14.669Z -->
实现与验证已完成：39e30c89e 提供列表（含 group:parent）和详情 Sub-issues 的本地 issue 拖放重挂载，14d8a1f3e 已合入最新 main=59574c62d。服务端复用 reparentLocalIssue，客户端复用 dragGesture；隔离 API 与 Chromium mouse YATU 均验证独立→子、子→顶层、后代非法和详情拖出。规格同步于 [[issues-view]]、[[local-issues]]、[[review-chrome]]、[[spec-cli]]。完整证据：[[file:issue-reparent-review.html]]。

<!-- reply: aca7261e-0400-4ccc-ad7d-c5cadceadc42 @ 2026-09-14T05:23:59.421Z -->
已按 merge 流程落地：在临时 detached worktree 以 source head 5eea084a3 对 session tip 94bb56c01 做唯一 --no-ff merge，生成 f16ca20d9；源 checkout 的既有 dirty fingerprint 保持为空且未变化，post-merge dashboard 476 tests、build、typecheck、lint、[[spec-lint]] 全部通过，隔离 Chromium proof 也通过。完整证据：[[file:issue-reparent-review.html]]。
