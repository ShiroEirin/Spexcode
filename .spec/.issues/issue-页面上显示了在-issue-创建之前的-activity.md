---
concern: Issue 页面上显示了在 issue 创建之前的 activity？
by: human
status: open
created: 2026-09-14T02:27:46.081Z
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
