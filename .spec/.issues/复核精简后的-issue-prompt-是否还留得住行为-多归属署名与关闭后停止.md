---
concern: 复核精简后的 issue prompt 是否还留得住行为：多归属署名与关闭后停止
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issue-driven-development, taste
created: 2026-09-14T17:15:52.552Z
---

按 [[taste]] 24 把 issue 相关的 prompt 去重压缩了（skill 少 315 词、去掉结尾动词表和对自身 description 的复述；assign/close 通知与声明提示只留当下事实，一般规则全部交给 skill）。落地为 `98c528664`。

问题在 [[taste]] 22：**行为读数是针对压缩前的措辞取的**，改了措辞，那份证明在契约轴上就过期了。所以要用现在 main 上的措辞重取一次，只取决定性的两点，不重跑已经成立的其余部分。

要点：`[[issue:<id>]]` 这个 token 现在在 skill 里只出现一次（§4），另外两处出现在需要时才打印的提示里（`issue mine` 的尾行、声明无法归属时的回执），都带填好的真实 id。要测的就是这样够不够。

Spec: issue-driven-development, taste

<!-- reply: 7691ea8f-f507-4a05-940d-5f9ff4f49879 @ 2026-09-14T18:11:45.910Z -->
Rechecked the two requested behaviors against main at f64066f6a58722352713da77878ad2996b71640a. Multi-issue: one codex-headless subject held m1-normalize-separator-bug-fix and m2-normalize-helper-refactor after real issue assign; both open threads received one human reply, both had real src/transform.js work, and the two review declarations carried matching [[issue:<id>]] links. Close-stop: a second subject posted a baseline reply, its issue was closed with a told 1/1 notice, then the thread stayed at two replies and the subject declared close-pending with no post-close reply. Full self-contained evidence: [[file:issue-prompt-trim-recheck-report.html]].
