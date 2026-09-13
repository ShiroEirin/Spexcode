---
concern: widget 宿主统一：issue 线程里的 widget 要能像 session timeline 里一样草稿、发送、提交 state
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issue-binding, widgets, issues-view
created: 2026-09-13T08:35:16.193Z
---

现状：`[[widget:<name>]]` 在 issue 回复里能渲染（scope = 作者 session 的 widgets），但只读——widget 的桥 `spex.draft(text, state)` 需要宿主提供 `drafts`/`onDraft`，issue 页的宿主没给，state 也没有提交通道（只有 `/api/sessions/:id/input` 的 `widgets` 会 `commitWidgetStates`）。所以「worker 给几个解法、人点一个再发送」在 issue 页里点了没反应；同一个 widget 在 session timeline 里是通的。

目标：**一个宿主契约，多个家**。widget 作者永远只写 `spex.draft/save/state`，不知道自己被画在哪；「家」决定草稿去哪、发送去哪、state 存哪。

做法（建议，读代码后可调）：
1. 把 `TimelineChat.jsx` 里的草稿/提交管线（`widgetDrafts`、`widgetReloads`、`onWidgetDraft`、`discardWidgetDraft`、发送时把 `widgets: [{name,state}]` 带上）抽成一个共享 hook（例如 `useWidgetHost`），TimelineChat 改用它，行为不变（现有 e2e/单测必须继续过）。
2. issue 详情页装同一个宿主：`Replies` 里每条回复的 `SessionWidgetsContext` 用它给的 scope（含 drafts/onDraft/reloads），`ReplyComposer` 上方出现同一个草稿块 UI（`ComposerSurface` 的 `preview` 槽），发送/丢弃与 session 页一致。
3. 发送去哪：issue 页把草稿文本作为线程回复发出，**并自动 `deliverTo` widget 的所有者 session**（复用 `/api/issues/:id/reply` 已有的 `deliverTo`）——问题是它问的，答案该到它手上。
4. state 存哪：永远提交到**拥有该 widget 的 session**。`/api/issues/:id/reply` 加 `widgets: [{ session, name, state }]`，服务端对每个 owner 调 `commitWidgetStates(owner, …)`；线程里可能同时有多个 session 的 widget，所以要带 owner。
5. 把四种引用（`@`、`[[node]]`、`[[file:]]`、`[[widget:]]`）在两个 composer/两个线程里的行为对齐成一张表写进 spec（[[issue-binding]] / [[widgets]] / [[issues-view]]），缺哪个补哪个；文档 `spex guide widget` 补一句「在 issue 线程里一样能用」。

约束：不要新造第二套 widget 机制或第二个草稿 UI；不改 widget 桥的接口；不动 issue 存储格式。

验收：
- 隔离 fixture（`SPEXCODE_HOME` 独立 + fake launcher + `spex serve`/`serve ui`）里：一个 session 用 `spex session widget put` 放一个三选一 widget，回复到 issue 线程；真实浏览器打开该 issue，点一个选项 → composer 上方出现草稿块 → 发送 → 线程里落一条回复、owner session 的 `spex session widget show <name>` 里 state 变成所选值、owner 的 timeline 收到那条消息。
- session timeline 页同一 widget 的行为不变（已有测试 + 一张前后截图）。
- 单测覆盖抽出来的 hook 的纯函数部分；typecheck、`spex spec lint` 0 error、dashboard 单测全绿。
- 一份 review-report（`spex session files add`），然后 `done --propose merge`。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T08:35:17.538Z -->
@new:reclaude 接这个 issue，按线程里的做法和验收做；做之前先读 TimelineChat.jsx 里现有的 widget 草稿管线和 spex guide widget。
