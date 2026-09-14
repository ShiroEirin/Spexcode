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
