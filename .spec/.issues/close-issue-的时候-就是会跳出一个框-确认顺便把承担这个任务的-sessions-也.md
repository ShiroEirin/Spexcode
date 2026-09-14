---
concern: Close issue 的时候，就是会跳出一个框，确认顺便把承担这个任务的 sessions 也给 close 掉
by: human
status: open
created: 2026-09-14T02:25:58.791Z
---

它是这样的：可以加一个硬限制，就是必须所有承担这个任务的 session 都处于 close pending 或者已经被 Close 了的状态下，才可以去 Close 掉这个 issue。如果说不满足这个条件的话，可以在跳出的那个确认框里面，选一个叫做“nudge all sessions to enter close pending state”的选项
这里有个点，就是这些 sessions 应该是承担这个任务的 session，而不是所有相关联的 session 都在里面。

就是哪些 session 是承担这个任务的？不知道我们之前的数据结构有没有已经区分了？

---

我觉得或许这样子吧，可以弄得更加自由一点，不是说之前的机制全都不搞了，我们改成这样：

如果有未 close 的、承担这个任务的 session，它会跳出一个多选框，你可以多选那些 session。默认会先选中所有 close pending 的 session，但用户也可以去选那些非 close pending 的 session，这两类是互斥的。

如果用户选择了非 close pending 的 session，底下的操作就不是 close 掉这个 session，而是 nudge this session to be close pending。

懂我意思吧？比如说一开始默认选中了三个 close pending 的，但还有一个状态是 asking。当用户点击选中了那个 asking 的 session，其他三个 close pending 就会被 cancel selection，同时底下的操作选项也会从 close issue 变成 nudge session to close（当然我这个 wording 可能不太好，你可以找一个更好的 wording）

@2499a20b-ae58-4074-87de-3753e02fe63b

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T02:30:57.777Z -->
接了。先答你的问题：**数据结构已经区分了**。「承担这个任务的 session」= 记录上 `issue` 指针指向这个 issue 的 session，加上它们的子会话（读时树），就是详情页 Sessions 区上半那些带动作的行（fleet）。「相关联但不承担」= 只在线程上说过话的 voices（opener / replier），没有指针。所以确认框里只列 fleet，不列 voices。

做法（按你第二段的自由版）：
- 点 Close issue 时，若 fleet 里还有未关闭的 session，弹一个多选框；没有就照旧直接关。
- 两组互斥：**可关的**（close-pending、retired）默认全选；**还在干的**（working / asking / parked / review …）默认不选。勾了任何一个「还在干的」，可关组全部取消勾选，反之亦然。
- 底部动作随选择变：只选了可关的 → 「Close issue · 同时关闭 N 个 session」；选了还在干的 → 「请 N 个 session 收尾」（wording 用 "Ask N sessions to wrap up"，中文「请 N 个会话收尾」），发一条消息让它们提交/丢弃后 `done --propose close`，issue 本身**不关**；一个都不选 → 「只关 issue」。
- 关 session 走现有 `/api/sessions/:id/close`；收尾提醒走现有 `/api/sessions/:id/input`；关 issue 走现有 close 路由。全部复用 Modal / SideValue / ds-action，不新造控件。
- 规格写进 [[issues-view]]（Close issue 的确认框）和 [[issue-binding]]（fleet 即「承担」集合）。

隔离 fixture + 真实浏览器验收：一个 issue 下 2 个 close-pending + 1 个 asking 的 worker，截默认选中、切换到 asking 后按钮变化、执行后 session 归档 / 收到消息、issue landed。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T07:27:48.555Z -->
做完了，已落地 main d7b5770fb 并 push。

按你第二段的自由版实现：
- 只要 issue 还有 fleet，Close issue 就先弹确认框；框里**只列 fleet**（承担者），不列线程上其它的 voices。
- 两组互斥：**已收尾的**（close-pending / retired）在上、默认全选；**还在干的**（working / asking / parked / review / error）在下、默认不选。勾了下面的，上面全部取消，反之亦然。
- 底部动作随选择变：默认「Close issue and N sessions」→ 关 session（走 console 菜单同一条 close 路由）再关 issue；勾了还在干的 → 「Ask N sessions to wrap up」，给每个发一条普通消息（该留的提交、该丢的丢弃、在线程上说清楚，然后自己声明 `done --propose close`；确实不能丢就改声明 ask），**issue 保持 open**——结束会话是它自己的事，关 issue 是你的事。一个都不选 → 「Close issue only」。
- 判断哪些「可关」和「按一下会做什么」是两个纯函数（`issueClose.js` 的 `closable` / `closeAction`），从勾选集合派生，不另存状态；「可关」的状态集合登记进了状态词表卫兵。

实测（隔离 fixture + 真实 Chromium，一个 close-pending + 一个 working）：默认勾中 close-pending、按钮是「Close issue and 1 session」；点那个 working 的 → 上面取消、按钮变「Ask 1 session to wrap up」；按下去 issue 仍是 open；再打开、保持默认按下去 → issue 变 landed 且那个 session 从看板上消失。单测 479/479，lint 0。

这条我认为可以关了，按规矩留给你关。
