---
concern: 一个 session 可以承担多个 issue：session.issue 从单指针改成集合
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issue-binding, issues-cli, issue-driven-development
created: 2026-09-14T02:32:50.190Z
---

现状：session 记录上的 `issue` 是 0..1 的单指针（与 `parent` 同款）。`spex issue assign <issue> <SEL>` 会**改写**指针，于是把同一个 session 先后 assign 到两个 issue，前一个 issue 的 Sessions 区就失去了它——人看起来像「assign 记录消失了 / 有竞争」。这不是竞争，是设计限制，现在要去掉：一个 session 可以同时承担多个 issue。

要做：
1. 记录：`issue: string|null` → `issues: string[]`（runtime.json 键 `issues`，条件写入；旧记录的 `issue` 读时并进 `issues`，字节不改）。wire 上 `Session.issues: string[]`；为兼容读方保留 `issue` = `issues[0] ?? null` 一段时间，spec 里标明它是派生、将退役。
2. 写入：create boundary 的 `issue` 入参（`@new` 传 thread id、`--issue`）写成初始集合；`spex issue assign <issue> <SEL>` 变成**加入**集合（重复无操作）；新增 `spex issue unassign <issue> <SEL>`（移出集合）；两者各有 HTTP 路由（assign 已有，加 unassign），并把 session 告知（assign 已有的通知；unassign 通知「不再承担」）。
3. 读时：`issueFleet` 改成 `s.issues.includes(issueId)`（在 `@spexcode/spec-core/review`，服务端 facet 与前端条同一函数）；`spex issue mine` 列出全部承担的 issue（多个时逐个打印，`--json` 数组）。
4. dashboard：Sessions 区、fleet 条、facet 自动跟随；Assign 门的候选去掉「已在本 issue 的 fleet」但允许已承担其它 issue 的 session；fleet 行的卡片列出它承担的其它 issue（SideValue 链接）。
5. spec：[[issue-binding]]（cardinality 改成 0..n，说明为何：一个 supervisor 会同时经手多个 issue）、[[issues-cli]]（unassign）、[[issue-driven-development]]（`mine` 可能返回多个；hand over 一节补 unassign）。
6. 测试：fromRaw 旧记录迁移（`issue` → `issues`）、assign 幂等、unassign、issueFleet 多归属；隔离 fixture 的 CLI 前后对比（注意 SPEXCODE_ISSUES_DIR 已能隔离 issue 写，但 session 写要独立 SPEXCODE_HOME）。

约束：不改 `parent`；不引入第二个 join；typecheck、lint 0、dashboard 单测全绿；review-report 后 done --propose merge。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T02:32:56.120Z -->
@new:reclaude 接这个 issue，先读线程正文与引用的 spec 节点，严格隔离，按验收做。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T04:14:16.235Z -->
上一个 worker 被上游 API 网关 500 反复打断（三个同时挂掉，不是任务本身的问题），已关闭。@new:codex 换 codex 接手：从线程正文开始读，前一个 worker 没有留下任何提交，按验收从头做，严格隔离。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T04:14:44.699Z -->
上一个 worker 被上游 API 网关 500 反复打断（三个同时挂掉，不是任务本身的问题），已关闭。@new:codex 换 codex 接手：从线程正文开始读，前一个 worker 没有留下任何提交，按验收从头做，严格隔离。

<!-- reply: 3fb33aa6-067a-41c1-abc9-54de831f9212 @ 2026-09-14T04:44:59.109Z -->
已完成集合化主路径：runtime.json 读取兼容旧 issue 并投影 issues，create 初始集合，assign 幂等加入，新增 unassign CLI/HTTP 与通知，mine 输出全部线程；共享 issueFleet 与 dashboard 卡片支持多归属。定向 assign、fromRaw、issueFleet 测试通过，正在跑完整 lint 与最终验证。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T04:46:12.276Z -->
进展收到，路径都对。三点提醒，别漏：1) wire 上保留的 `issue` 派生字段（= issues[0]）要在 spec 里写明「派生、将退役」，且 dashboard 不要再有任何地方读它——现在读集合；2) 旧记录迁移是读时并入、**不重写字节**，请有一条测试断言旧 runtime.json 读过之后文件未被改写；3) unassign 的通知措辞要让 worker 明白它不再承担这个 issue、但不要读成「你被解雇了」——它可能还承担别的 issue。等你的 review。

<!-- reply: 3fb33aa6-067a-41c1-abc9-54de831f9212 @ 2026-09-14T05:02:24.348Z -->
实现已提交 059ac83ad（Spec: [[issue-binding]], [[issues-cli]], [[issue-driven-development]]）：runtime.json 使用 issues 集合并兼容旧 issue，assign/unassign/API/CLI 幂等更新并通知，mine 输出多个线程，共享 issueFleet 与 dashboard 卡片支持多归属。typecheck/build/lint 通过，dashboard 475/475，绑定单测 3/3；完整 spec-cli 首跑有两个并发/资源敏感失败，独立重跑均通过。完整证据见 [[file:issue-multi-binding-059ac83ad.html]]。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T05:03:25.130Z -->
改动我看过，方向和范围都对，同意合并。**但你的分支和 main 已经冲突了**（composer 对齐那条 lane 刚落地，同样碰了 index.ts / issues-cli.ts / issue-binding 的 spec）。按 merge skill：先把最新 main 合进你的分支、在那里解冲突，然后在同步后的树上**重跑**证明（不是复用之前的结果），再落地。两个「首跑失败、独立重跑通过」的用例请在同步后的树上再各跑一次，报告里写清它们是并发/资源敏感而非本改动引入。

<!-- reply: 3fb33aa6-067a-41c1-abc9-54de831f9212 @ 2026-09-14T05:14:30.098Z -->
已完成 landing：session tip 82d6d2c80 与最新 main 同步后，在临时 detached worktree 以唯一 no-ff merge 生成 59574c62d；主 checkout 与 origin/main 已快进到该提交。源 checkout 无 MERGE_HEAD，clean，dirty fingerprints 保持空；post-merge typecheck/build/lint、spec lint 0 errors、dashboard 476/476 与绑定定向测试均通过。[[file:issue-multi-binding-059ac83ad.html]]
