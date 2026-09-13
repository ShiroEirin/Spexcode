---
concern: issue 层级（页面）：按 parent 分组的列表、Sub-issues 区、Parent/Relations 侧栏、duplicate banner
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issues-view, issue-binding
created: 2026-09-13T08:51:23.747Z
---

依赖：先落地「issue 层级（后端）」那个 issue 的 wire 字段（parent / children / relations / blockedBy / duplicateOf / 子 issue 计数）。

Linear 页面逻辑（官方 display-options / parent-and-sub-issues / issue-relations 文档）：层级首先是**一个分组维度 + 一个显示开关**，不是一种新页面；详情页 = 标题 · 描述 · Sub-issues 区（描述正下方，`+ Add sub-issues`，可隐藏已完成）· 活动/评论 · 右侧属性栏（含 parent 与 relations：Blocked by 橙旗 / Blocks 红旗 / Related）；duplicate 顶部 banner + 侧栏链接指向 canonical；子 issue 页顶部父面包屑。

要做（全部复用 review-chrome 现有零件：token query、Filters 菜单、ReviewListRow、SideSection/SideValue、ds-action、IssueCard；不新造树控件）：
1. 列表：加 token `group:parent`（子 issue 缩进在父下面、父行带 `N/M` 进度）和 `sub:all|top`（默认 top = 只显示父级和无子级），两者进 Filters 菜单，走现有 URL 手术 + Back 回放。
2. 详情主列：正文和线程之间加 **Sub-issues** 段：`N/M 完成` 进度条 + 子 issue 行（IssueCard/ReviewListRow）+ `+ Sub-issue` 门（= 打开 New 页并预填 parent；不直接创建）+「隐藏已完成」开关。
3. 详情侧栏：**Parent** 一节（SideValue 链接，面包屑感）；**Relations** 一节（Blocked by 橙点 / Blocks 红点 / Related，用 fleet 行同款 SideValue + 状态点）。全部子完成时 composer 的 Close issue 保持可按，不自动关。
4. duplicate：`duplicateOf` 非空时详情顶部 banner「Duplicate of <link>」+ 侧栏链接。
5. 线程台账：子 issue 打开/关闭作为读时事件并入现有 ledger（和 fleet 声明同一条线程）。
6. New 页：接受 `?parent=<id>` 预填并在侧栏显示 Parent。
7. spec：[[issues-view]] 补契约；[[issue-binding]] 的 fleet 卷起加一句「父 issue 的 fleet = 自己的 + 所有子 issue 的」。

约束：风格统一（只用 review-chrome 词汇），组件复用；不改 API order 的默认排序；dashboard 单测、typecheck、lint 0 error。

验收：隔离 fixture（SPEXCODE_HOME 独立 + fake launcher + serve/serve ui）+ 真实浏览器：父子 issue 各一组，列表 group:parent 与 sub:top 的截图、详情 Sub-issues 段与进度、Relations 旗子、duplicate banner；review-report 后 `done --propose merge`。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T09:33:12.661Z -->
@new:reclaude 接这个页面 issue。后端字段已在 main（6b1902f1c）：parent / children / childCounts / relations / blockedBy / relatedBy / duplicatedBy / duplicateOf，POST /api/issues 接受 parent；详情见 issue「issue-层级-后端-parent-relations-存储-读时树-cli-verbs」的线程。按正文做，风格只用 review-chrome 词汇，组件复用；另外把 issueFleet 改成父 issue 的 fleet 包含所有子 issue 的 fleet（读时，树给的）。

<!-- reply: 147de45c-6b5b-42ee-a2d6-bcdbea9917c5 @ 2026-09-13T09:41:27.061Z -->
接手了。先报一个发现，再说做法。

**发现：后端线程里定的「父 issue 关闭不算不在」没有落到 main。** `issueHierarchy` 仍要求父是 open（`spec-cli/src/issues.ts` 的 pointer 判断），单测断言 "a closed parent promotes the child"，[[issues]] 正文也是旧说法。结果是 Closed 视图里的树是平的，已关子 issue 没有 Parent。本页验收依赖它，我在本分支一起改：去掉 status 判断、翻转那条单测、改 [[issues]] 那句。写入时「parent 必须 open」的校验不动。

**做法**
1. 列表：`sub:all|top` 和 `group:parent` 两个 token，进 Filters 菜单。语义放进 [[review-filters]] 引擎，在服务端分页之前生效，Open/Closed 计数和行数因此一致。`sub:top`（默认）只让没有父的 issue 做顶层行；`group:parent` 让父也在结果里的子 issue 紧跟父行缩进（行上带 depth）。所以 `group:parent` 默认是整棵树，加 `sub:all` 再补上父不在结果里的子 issue。父行带 `N/M`（childCounts）。
2. 详情：正文和线程之间加 Sub-issues 段（进度条、子 issue 行复用列表的行组件、「隐藏已完成」、`+ Sub-issue` 是指向 `#/issues/new?parent=<id>` 的真链接）。侧栏加 Parent 和 Relations（Blocked by 橙点 / Blocks 红点 / Related / Duplicate of / Duplicated by）。`duplicateOf` 非空时主列顶部出 banner。
3. 标题和状态从哪来：wire 上 parent/children/relations 只有 id。给 `GET /api/issues/:id` 加 `refs`，即这些 id 各自的 `{id, concern, status, store, by, created, childCounts, descendants}`，一次读够，页面不逐个请求。
4. fleet：父 issue 的 fleet 要所有后代 issue 的 id，分页行上只有直接 children，而列表条和服务端 `fleet:` facet 必须是同一个函数。所以读时树再加一个 `descendants: string[]`，`issueFleet` 改为接收 issue（id + descendants）。fleet 卡片里，挂在子 issue 上的 session 多一行指向那个子 issue。
5. 线程台账：子 issue「打开」按 `created` 进 ledger，行上带子 issue 当前的状态标记。「关闭」放不进时间线：wire 上没有关闭时间，local close 只改 status。要做得在存储里记关闭时间，是后端存储格式的变更，这次不做；需要的话我另开 issue。
6. New 页接受 `?parent=`，侧栏显示 Parent，store 只留 local（forge 不存层级）。

验收照正文：隔离 fixture + 真实浏览器截图，review-report 后 `done --propose merge`。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T09:46:47.335Z -->
做法同意，六条都按你写的做。发现的那处（父 open 才算父）就在你分支里一起改，写入校验不动，对。
三点补充：
1. `sub:top` 成为默认会改变今天列表的默认可见集（子 issue 默认隐藏）。这是 Linear 的做法，我接受；但默认地址仍必须是裸 `#/issues`（不出现在 URL 里），Open/Closed 计数与行数一致——你已经说了放进引擎在分页前生效，就是要这个。
2. `refs` 只在 `GET /api/issues/:id` 上加，列表行不带，好；`descendants` 加进读时树、`issueFleet` 改接收 issue 也对——注意它现在住在 `@spexcode/spec-core/review`，服务端 `fleet:` facet 和前端条必须继续是同一个函数。
3. 「关闭时间不在 wire 上」照你说的另开 issue，不在这次范围里。
