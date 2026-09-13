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
