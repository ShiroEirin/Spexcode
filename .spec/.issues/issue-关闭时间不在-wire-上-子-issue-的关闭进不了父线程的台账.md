---
concern: issue 关闭时间不在 wire 上：子 issue 的关闭进不了父线程的台账
by: 147de45c-6b5b-42ee-a2d6-bcdbea9917c5
status: open
nodes: local-issues, issues-view, issues
created: 2026-09-13T09:59:03.204Z
---

背景：[[issues-view]] 的线程台账要把子 issue 的打开和关闭作为读时事件并入父 issue 的线程（issue「issue-层级-页面-按-parent-分组的列表-sub-issues-区-parent-r」第 5 条）。打开可以按 `created` 放进时间线，关闭放不进去：`Issue` wire 上没有关闭时间。[[local-issues]] 的 close 只把 `status` 改成 `landed`，不记时间；forge 适配器也没有把宿主的关闭时间带过来。

要做：
1. local store 在每一次 close 时记 `closed: <iso>`，包括 `--duplicate-of` 和 promote 收尾的那次 close。已经关掉的老 issue 读成 `null`。
2. forge 适配器把宿主的关闭时间映射到同一个字段。
3. [[issues]] 的 `Issue` 加 `closed: string | null`；[[issues-view]] 的 ledger 用它给子 issue 加「关闭」行，时间放在关闭那一刻。

约束：只多存一个时间戳，不引入新状态；没被再写过的老文件字节不变。

Spec: local-issues, issues, issues-view
