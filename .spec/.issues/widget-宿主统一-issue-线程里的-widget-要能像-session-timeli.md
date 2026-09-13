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

<!-- reply: 6b298f70-dbef-4cfa-a4f2-a6b1aa7de246 @ 2026-09-13T08:41:13.735Z -->
接了。读完 TimelineChat 的草稿管线、`spex guide widget`、[[widgets]] / [[issue-binding]] / [[issues-view]] / [[reply-thread]] 之后的做法：

1. 新建 `widgetHost.js`：纯函数（放草稿、丢弃、拼消息、按 owner 出 commits）加 `useWidgetHost()`。草稿按 **(owner session, name)** 存，因为一个线程里会同时画多个 session 的 widget，名字可能重。TimelineChat 改用它，owner 永远是自己。
2. 草稿块 UI 从 TimelineChat 挪进 `SessionWidget.jsx`，两个 composer 用同一个组件。
3. issue 详情页：`Replies` 和 `ReplyComposer` 共用同一个 host。发送时，回复正文 = 草稿文本 + 手打的字；`deliverTo` 自动加上草稿的 owner；`widgets: [{session,name,state}]` 带给 `/api/issues/:id/reply`。
4. 服务端：回复落盘后按 owner 调 `commitWidgetStates`。state 的提交不看投递成没成功，因为回复本身已经是记录在线程上的事件；写失败会写进 outcomes，不会吞掉。

有两处我先定下来，不同意可以直接说：
- **草稿待发时，composer 自己的发送按钮也可以按**，两个页面都这样。现在 session 页输入框为空时发送按钮是灰的，只能点 widget 框上的 send；[[widgets]] 写的是「用户按的是他们平时发消息的同一个发送控件」。这是 session 页唯一会变的可见行为，前后截图会把它标出来。
- 我对了四种引用的现状，发现 **issue 回复里的 `[[file:]]` 不解析**，现在显示成纯文本。我会让它和 widget 一样，按回复作者的 posted files 来解析。对齐表写进 [[issues-view]]。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T08:42:02.046Z -->
做法同意，两处决定都同意：
- 草稿待发时 composer 自己的发送按钮可按：对，[[widgets]] 的原话就是这个意思。守住一条：输入框为空只有草稿时，发送的正文就是草稿文本；两者都有时草稿在前、手打在后（你写的顺序）。
- `[[file:]]` 按回复作者的 posted files 解析：对。作者 session 已关闭、files 已不在时保持 unresolved chip，别猜。

两点补充，不改你的范围：
1. 草稿按 (owner, name) 存是对的；提交 state 时也请按 owner 分组调 `commitWidgetStates`，一个 owner 失败不影响另一个，outcomes 里逐个写清。
2. 完成后把 `spex guide widget` 补一句「在 issue 线程里一样能用，答案会同时投递给 widget 的 owner」，并在 [[issue-driven-development]] 的「升级」一节加半句：需要人选方案时用 `ask` + widget。

<!-- reply: 6b298f70-dbef-4cfa-a4f2-a6b1aa7de246 @ 2026-09-13T09:16:00.694Z -->
做完了，提交 `b149ba70d`，证据在 [[file:report.html]]。

- issue 线程里的 widget 能用了：点一个选项，composer 上方出现草稿块；发送后线程里落一条回复，回复同时送到 widget 的所有者，state 也提交给所有者。session 页和 issue 页共用 `useWidgetHost`，草稿块是同一个组件。
- `/api/issues/:id/reply` 新增 `widgets: [{session,name,state}]`：服务端按 owner 分组提交。顺序是先让回复落盘，再提交 state，最后投递；提交失败会写进 outcomes。
- 四种引用对齐成一张表，写在 [[issues-view]]。补上了之前缺的一项：回复里的 `[[file:]]` 现在按作者的 posted files 解析。[[widgets]]、[[issue-binding]]、[[reply-thread]] 和 `spex guide widget` 已同步。

之前说的两处决定已经照做。另外 e2e 查出一个新问题，也一并修了：
- **回复投递原来要等对方 harness 接手才返回**。实测一次发送卡 18,186 / 18,239 / 18,699 ms，这段时间草稿块一直挂着。现在改成和 Command Box 一样：进了对方队列就算接收，接手放到响应之后做。改完是 108 / 85 / 101 ms，e2e 也确认对方 pane 确实收到了这条回复。原有的 **Send to @x** 按钮走的是同一条路，也一起变快了。

验证：同一个 e2e 脚本，在旧代码上跑 `EXPECT=bug`，复现了「点了没反应」；在本分支上跑 `EXPECT=fixed` 三次都通过。dashboard 单测 468/468，typecheck 通过，`spex spec lint` 0 error，原有的 conversation-command-box e2e 也通过。

没验证到的：一个线程里同时有两个 owner 的 widget 只有单测覆盖；forge 仓库里的 issue 线程；手机宽度下的 issue 页；`timeline-chat-composer.e2e`（要连真实后端，这次没跑）。
