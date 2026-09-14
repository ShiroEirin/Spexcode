---
concern: Issue 页面上显示了在 issue 创建之前的 activity？
by: human
status: landed
created: 2026-09-14T02:27:46.081Z
closedAt: 2026-09-14T13:00:21.410Z
---

感觉这是一个 bug：我在创建一个 issue 之后，去 assign 到一个 session，结果这个 session 竟然会把之前的一些 activity 也显示出来，感觉这个是不对的

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T02:31:08.130Z -->
是 bug，根因清楚：线程台账是读时从 fleet 里每个 session 的 timeline 合并进来的，取的是该 session 的**全部**声明，没有按 issue 的创建时间截断。所以把一个已经干了一天活的 session assign 到新 issue 上，它一天的 review/ask 声明全跑进这个新线程。

修法：台账只收 `at ≥ issue.created` 的声明行（子 issue 的打开/关闭事件本来就晚于父的创建，不受影响）。理想是按「绑定时刻」截，但 assign 时刻目前没有落记录，`issue.created` 是诚实可用的下界；要更精确得在 assign 时写一个时间戳，我先不扩范围。规格写进 [[issue-binding]] 的台账一条。

顺带说一个这次暴露出来的设计后果：session→issue 是 0..1 的指针，你把我先 assign 给「Close issue 确认框」那个 issue、再 assign 给这个，我的指针就从前者移到了后者——前者的 Sessions 区现在没有我。一个 supervisor 同时经手多个 issue 时会这样。两个我都会做，但这个限制值得你知道。

<!-- reply: human @ 2026-09-14T05:59:28.710Z -->
@2499a20b-ae58-4074-87de-3753e02fe63b 
感觉即便是像现在这样去显示所有之后的 activity 那也是太多了，或许需要变成默认只有最近一条，然后可以点击去正经的 session 界面，就和右侧边栏的 open console 一样？
然后这样的话点击右侧边栏的 session 就不会展开显示信息了，而是一种 focus 视角的感觉，focus 到那个对应的主消息流的 session 就可以

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T06:01:22.315Z -->
懂了，而且比我那个截断更对：**issue 线程不该复制 session 的消息流**。改成这样：
- 台账每个 session 只保留**最近一条**声明（不是全部之后的），一行：session 名 + 状态词 + note 摘要 + 时间。
- 那一行右侧一个「Open console」样式的门，点进 `#/sessions/<id>`——和侧栏那个门同一个动作、同一个控件。
- 侧栏点 session **不再原地展开卡片**，而是 focus 到那个 session（进它的 console）。卡片里现在那些东西（branch、posted files、web、widgets）在 console 页本来都有；侧栏只留状态点 + 名字 + 状态门控动作（Merge / Relaunch / Close），保持「一眼看谁在等我」，细节都去 console 看。
- 子 issue 的打开/关闭事件保留在台账里（它们是这个 issue 自己的事，不是别人的消息流）。

这样 issue 页的定位就干净了：issue 页回答「谁在做、现在什么状态、需要我吗」，session 页回答「它到底在干什么」。我把它当这条 issue 的正式做法，接着做（我另外还在做 Close 确认框那条）。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T06:59:34.468Z -->
按你的设计做完了，已落地 main 8b4139bd3 并 push：
- 台账每个 session 只留**最近一条**声明，行尾一个「Open console」门（和侧栏那个同一个控件）；子 issue 的开/关事件不做削减，它们是这个 issue 自己的历史。
- 侧栏点 session **不再展开卡片**，直接 focus 进它的 console（⌘/ctrl 点开新 tab）；卡片整块删掉了——branch、它承担的其它 issue、posted files / web / widgets 在 console 页本来都有。
- 原先那条「只收 ≥ issue.created 的声明」的截断保留，两条叠在一起：先按 issue 创建时间截，再每个 session 留最近一条。
- 实测（隔离 fixture + Chromium）：点侧栏行后地址变成 `#/sessions/<id>`、页面上 0 个卡片；单测 477/477，lint 0。

这条 issue 我认为可以关了（修法与你的设计都已落地）；按规矩由你关。
