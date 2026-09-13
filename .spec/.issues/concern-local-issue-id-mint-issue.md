---
concern: 纯中文 concern 开 local issue 时 id 被 mint 成 issue
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: local-issues, spec-lint, mentions
created: 2026-09-13T04:36:59.051Z
---

复现：`spex issue open "还没人认领的第二个 issue"` → id 变成 `issue`（再开一个就是 `issue-2`）。
原因：`localIssues.ts` 的 slug 基底 `concern.toLowerCase().replace(/[^a-z0-9]+/g, '-')` 把所有非 ASCII 字符都吃掉了，剩空串就回退到 `issue`。
期望：id 保留 unicode 字母/数字（[[spec-lint]] 的 id-format 已允许 `\p{L}\p{N}`，[[mentions]] 的 `[[id]]` 语法也认），例如 `纯中文-concern-开-local-issue-时-id-被-mint-成-issue`（截到 48 个字符）；纯符号的 concern 才回退到 `issue`。同时确认 `new` 这个保留字的处理不变。
验收：fail→pass 的一对测试（中文 concern 现在 mint 成 `issue`，改后 mint 成可读 id），[[local-issues]] 的 spec 补上 id 的 unicode 规则。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T04:37:27.593Z -->
@new:reclaude 接这个 issue：按线程里的复现和验收把 local issue 的 id minting 修好（保留 unicode 字母/数字），带 fail→pass 测试和 [[local-issues]] 的 spec 更新，做完 done --propose merge。

<!-- reply: 8b9601ad-71d7-4080-af61-fcf0476b51d9 @ 2026-09-13T04:47:52.402Z -->
已修，分支 `node/local-issues-8b96`：修复提交 `1995376e9`，已合入 main，同步后是 `285f16b97`。

- `uniqueId` 现在先做 NFC、再转小写，保留 `\p{L}\p{N}`，其余字符串成一个 `-`，在 48 个 code point 处截断。`还没人认领的第二个 issue` → `还没人认领的第二个-issue`，本线程的 concern → `纯中文-concern-开-local-issue-时-id-被-mint-成-issue`。纯符号 concern 仍回退到 `issue`，`new` 仍变成 `new-2`。
- fail→pass：新测试在修复前的代码上失败（actual `issue`），同步后的分支上 `issues.test.ts` 4/4 通过；tsc 通过；lint 0 error。
- 真实 CLI 前后对比用的是隔离 store，trunk 的 `.spec/.issues` 没被动过。[[local-issues]] 的 spec 加了一条 id 规则。
- 已有 id 不会重命名。live backend 跑的是 main，合并前还是按旧规则 mint。

证据和没验证的部分见 [[file:report.html]]。

顺手发现一个没改的相邻问题，另开了 `id-grammar-splits-combining-mark-scripts-a-hindi`：印地文这类带组合符号（`\p{M}`）的文字会被切碎，`हिन्दी भाषा` → `ह-न-द-भ-ष`。要修得同时放宽 [[spec-lint]] 和 [[mentions]] 的 id 语法，不在这个 issue 的范围里。
