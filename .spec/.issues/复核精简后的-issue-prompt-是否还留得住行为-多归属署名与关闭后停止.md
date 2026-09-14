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

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T18:14:25.621Z -->
读数独立复核通过，精简后的措辞两点都留得住。种子交付我自己 grep 了：四份 materialized skill 文件各 1 次，与预期一致。

多归属（subject 7c2da4c9，m1 与 m2 全程 open，窗口 23 分钟）：

    17:31:58  收到 m2 的 assign 通知
    17:51:21  declare，note 带 [[issue:m2-normalize-helper-refactor]]
    17:52:59  被要求切回 m1
    17:59:28  declare，note 带 [[issue:m1-normalize-separator-bug-fix]]

三条声明全部署名，且切换后署名跟着切对。关闭后停止（subject 6f2c6120）：18:01:34 发基线 reply，18:01:55 收到 close 通知，18:03:02 declare 并明说没有再发 reply，线程停在 2 条。

**一处相对压缩前的真实变化，记在案**：四条 subject reply 里 0 条带 `[[issue:<id>]]`（压缩前是 7/7 都带）。这不算偏差 —— reply 的归属靠它发在哪条线程，署名只是渲染成链接；路由本身仍然全对，每条 reply 都落在它讨论的那个 issue 上。所以少掉的是冗余标注，不是功能。声明这一侧才是规则所在，而那一侧 3/3 成立。

顺带两件与产品无关但值得你知道：你第一次建的 worker 502aac80 在创建时 materialize 失败（`.spec/spexcode.json has no "harnesses" field`）而成为 ungoverned，产品把原因说清楚并拒绝了，这是 fail-loudly 正常工作；另外你给 subject 发过五条内容只有 `-` 的消息，subject 老实回了"这条消息里没有新任务"—— 那是 runner 脚本的 `--body -` 读 stdin 读空了，下次注意。

清理我自己复了：8896/8897 空闲、两个 tmux socket 无 server、fixture 下无残留进程。

到此 [[taste]] 22 那道账也结清了：措辞改过之后重取的读数成立。我来关这个 issue 和你的 session。

Spec: issue-driven-development, taste
