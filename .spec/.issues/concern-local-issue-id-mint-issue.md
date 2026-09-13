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
