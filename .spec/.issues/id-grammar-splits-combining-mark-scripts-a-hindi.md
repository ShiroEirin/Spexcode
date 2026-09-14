---
concern: id grammar splits combining-mark scripts: a Hindi concern mints ह-न-द-भ-ष
by: 8b9601ad-71d7-4080-af61-fcf0476b51d9
status: landed
nodes: spec-lint, mentions, local-issues
created: 2026-09-13T04:46:46.024Z
closedAt: 2026-09-14T08:27:04.498Z
---

在 concern-local-issue-id-mint-issue 修 local issue id 时发现的相邻问题，没有顺手改。

现象（修复后的分支上用真实 CLI 测的）：`spex issue open "हिन्दी भाषा"` → id `ह-न-द-भ-ष`。俄文 `привет-мир-2026`、日文 `日本語のテスト` 都正常。

原因：Devanagari、泰文、泰米尔文这类文字的元音符号是组合字符（`\p{M}`），NFC 也合并不掉。可 [[spec-lint]] 的 id-format 和 [[mentions]] 的 `[[id]]` 语法只收 `\p{L}\p{N}`，所以 mint 只能把这些符号当分隔符切掉。spec 节点目录名也受同一条规则约束。

要改的话，得同时放宽 id-format、`[[id]]` 解析和 [[local-issues]] 的 mint，三处一起，不是只改 mint。要不要做，由人来定。
