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
