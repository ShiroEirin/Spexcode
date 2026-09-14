---
concern: New issue 页与回复 composer 对齐：同一套 @ / [[ / Send to @x / widget 能力
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issues-view
created: 2026-09-14T02:32:53.291Z
---

现状：`#/issues/new` 的正文框和详情页的回复 composer 都用 ComposerSurface + mentions 自动补全，但回复 composer 后来长出的能力——草稿里 `@<session>` 精确命中时的「Send to @x」按钮（发送 + 投递给该 session）、widget 草稿块（useWidgetHost）——New 页都没有。结果新建 issue 时能做的事比回复少得多。

要做：
1. 把回复 composer 的「Send to @x」搬成两个家共用：New 页正文框里精确 @ 到一个看板 session 时，出现同样的按钮；点它 = 创建 issue **并**把 issue（concern + 正文）作为消息投递给该 session。`POST /api/issues` 加 `deliverTo: [id]`，服务端在 createIssue 落盘后逐个 `sendText`（消息形态参照 reply 路由的 mentionDeliveryPrompt，但说明「这是一个新开的 issue」），outcomes 写清。普通 Create 不投递。
2. 顺带对齐：New 页的 `@new` 也走同一套（现在应该已经会派工，确认并写进对齐表）；`[[file:]]` 在 New 页正文里的解析与回复一致；widget：New 页不需要草稿块（没有别人的 widget 可点），对齐表里写明「不适用」而不是留空。
3. 把 [[issues-view]] 里那张四种引用的对齐表扩成「两个 composer × 五种能力」的表，缺哪个补哪个。
4. 组件层面：不要复制按钮代码——把「Send to @x」的按钮组抽成 ReplyComposer 和 NewIssuePage 共用的一个小组件（或让 New 页直接用 ReplyComposer 的 actions 槽）。

验收：隔离 fixture + Chromium：New 页正文 @ 一个 session → 按钮出现 → 点击 → issue 创建、该 session timeline 收到消息、outcomes 显示；普通 Create 不投递。dashboard 单测、typecheck、lint 0；review-report 后 done --propose merge。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T02:33:01.802Z -->
@new:reclaude 接这个 issue，先读线程正文与引用的 spec 节点，严格隔离，按验收做。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T04:14:17.569Z -->
上一个 worker 被上游 API 网关 500 反复打断（三个同时挂掉，不是任务本身的问题），已关闭。@new:codex 换 codex 接手：从线程正文开始读，前一个 worker 没有留下任何提交，按验收从头做，严格隔离。

<!-- reply: fafd3df8-4a5f-43e9-8b40-1f7a0108e077 @ 2026-09-14T04:20:31.325Z -->
已读完线程与 [[issues-view]]、[[reply-thread]]、[[composer]]、[[mentions]] 契约。基线已有回复侧 Send to @x 与 @new/[[file:]] 解析，New 页缺共享发送动作、创建接口投递和规格表更新；接下来补齐并做隔离 API/Chromium 验证。

<!-- reply: 53f823f9-0a65-408a-9756-e9e18656619a @ 2026-09-14T04:21:32.383Z -->
New-page alignment work starts from the thread and current contracts. I’m tracing the shared composer actions, create API, and existing mention delivery before editing; the spec table and New-page delivery contract will be updated with the code.

<!-- reply: fafd3df8-4a5f-43e9-8b40-1f7a0108e077 @ 2026-09-14T04:53:30.499Z -->
实现与验证完成，工作树干净。\n\n- NewIssuePage 与 ReplyComposer 共用 Thread.jsx 的 SendToSessionActions；精确 `@<session>` 只在显式按钮点击时投递。\n- POST /api/issues 支持 deliverTo：先持久化 issue，再逐目标 sendText；消息包含 concern + description，outcomes 报告 sent/NOT sent；普通 Create 不带该字段。\n- 修正 mentions 的 node 解析，使 `[[file:]]` / `[[widget:]]` 不进入 nodes；`@new` / `@parent:` 仍按原有持久化后派工路径。\n- [[issues-view]] 对齐表已改为两个 composer × 五种能力，并明确 New 的 widget 不适用；[[mentions]]、[[spec-cli]]、[[reply-thread]] 契约同步。\n\n验证：隔离 Chromium New 页 handoff 与普通 Create 场景通过；现有 widget/reply Chromium 回归通过；dashboard 476/476，spec-cli 917 通过 + 1 skip，typecheck、dashboard build、lint 通过，spex spec lint 0 errors（46 个既有 drift warnings）。完整证据见 [[file:report.html]]。提交：c236643bf、eeba30144。
