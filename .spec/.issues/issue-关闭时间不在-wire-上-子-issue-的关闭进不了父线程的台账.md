---
concern: issue 关闭时间不在 wire 上：子 issue 的关闭进不了父线程的台账
by: 147de45c-6b5b-42ee-a2d6-bcdbea9917c5
status: landed
nodes: local-issues, issues-view, issues
created: 2026-09-13T09:59:03.204Z
closedAt: 2026-09-13T13:13:55.262Z
---

背景：[[issues-view]] 的线程台账要把子 issue 的打开和关闭作为读时事件并入父 issue 的线程（issue「issue-层级-页面-按-parent-分组的列表-sub-issues-区-parent-r」第 5 条）。打开可以按 `created` 放进时间线，关闭放不进去：`Issue` wire 上没有关闭时间。[[local-issues]] 的 close 只把 `status` 改成 `landed`，不记时间；forge 适配器也没有把宿主的关闭时间带过来。

要做：
1. local store 在每一次 close 时记 `closed: <iso>`，包括 `--duplicate-of` 和 promote 收尾的那次 close。已经关掉的老 issue 读成 `null`。
2. forge 适配器把宿主的关闭时间映射到同一个字段。
3. [[issues]] 的 `Issue` 加 `closed: string | null`；[[issues-view]] 的 ledger 用它给子 issue 加「关闭」行，时间放在关闭那一刻。

约束：只多存一个时间戳，不引入新状态；没被再写过的老文件字节不变。

Spec: local-issues, issues, issues-view

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T12:11:50.798Z -->
@new:reclaude 接这个 issue。按 issue 正文做：local issue 存储加关闭时间（close 时写，旧记录读为 null），wire 上 Issue 加 closedAt，读时台账把子 issue 的关闭按 closedAt 并进父线程（issueLedger 的 ledgerFromChildren），spec 改 local-issues / issues / issues-view；forge issue 用它自己的 closed_at。存储格式变更要有迁移说明（旧文件不改、读时缺省）。隔离 fixture + Chromium 验收，review-report 后 done --propose merge。

<!-- reply: 6ce4c733-5821-4179-bf40-66d3505a06cb @ 2026-09-13T12:14:41.366Z -->
接了。先定一个名字，和正文、回复里的两种写法对齐：

- 字段叫 `closedAt`，从存储到 wire 一个名字，不做翻译。正文写的是 `closed: string | null`，回复写的是 `closedAt`；取后者，两个理由：`Issue` 上已经有 `childCounts.closed`（一个计数），再来一个时间戳 `closed` 同名不同义；`gh issue list --json` 自己就把 `closed`（布尔）和 `closedAt`（时间）分成两个字段。
- 本地文件 frontmatter 写 `closedAt: <iso>`，只在 open → landed 那一次 close 写（含 `--duplicate-of` 和 promote 收尾）。对已经关掉的 issue 再 close 不改时间、仍是无变化的幂等成功；老的已关闭文件没有这一行，读成 `null`，文件不动。
- forge：`ForgeIssue` 加 `closedAt`，github 取 `closedAt`（gh）/ `closed_at`（REST 增量），gitlab 取 `closed_at`。
- 台账：`ledgerFromChildren` 对有 `closedAt` 的子 issue 多出一行「关闭了子 issue」，时间在关闭那一刻；没有 `closedAt` 的老子 issue 仍只靠状态标记。refs 的紧凑面也带上 `closedAt`，因为详情页的子 issue 是从 refs 取的。

Spec: [[local-issues]]、[[issues]]、[[issues-view]]，外加 [[port]] / [[gitlab]] 两处字段说明。

<!-- reply: 6ce4c733-5821-4179-bf40-66d3505a06cb @ 2026-09-13T12:37:22.153Z -->
做完了，交 review。提交 `6d0d529d0`（功能），另有 `7a15d93e9`（issue-hierarchy e2e 过期了，单独修）。

- 存储 [[local-issues]]：离开 open 的那次 close 写 `closedAt`，普通 close、`--duplicate-of`、promote 收尾都走这一次；重复 close 不改时间，仍是无变化的幂等成功。迁移：磁盘上不动。老的已关闭文件没有这一行，读成 `null`，字节不变，之后被改写（比如回复）也不会补这一行。
- wire [[issues]]：`Issue.closedAt` 和 refs 紧凑面都带上；forge [[port]] / [[gitlab]]：gh 用 `closedAt`，GitHub REST 和 GitLab 用 `closed_at`，缺字段读 null。
- 线程 [[issues-view]]：子 issue 关闭在父线程上多一行「sub-issue closed」，时间取 `closedAt`，不署名（wire 上只有时间，没有谁关的）；没有时间的老子 issue 只靠状态标记。

验收：同一个隔离 fixture、同一份数据，trunk 代码 7/7（文件里有 `closedAt`，wire 丢了，线程上没有关闭行），分支 10/10；issue-hierarchy e2e 42/42（含新加的关闭行断言）；用真实凭据读 GitHub，56 个已关闭的全带 `closedAt`，45 个打开的全是 null。截图和各项检查在 [[file:report.html]]。

没验证：GitLab 真实宿主（这台机器没有凭据）、GitHub REST 增量窗口的 `closed_at`、promote 端到端（会真建 forge issue）。

e2e 为什么单独修：`f0519952b` 把 `+ Sub-issue` 移到侧栏，还让从父 issue 新建子 issue 后回到父 issue，但 e2e 没跟着改，第 6 步就超时，后面的台账断言根本没跑到。
