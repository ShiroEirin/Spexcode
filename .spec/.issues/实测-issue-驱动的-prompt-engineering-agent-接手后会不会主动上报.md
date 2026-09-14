---
concern: 实测 issue 驱动的 prompt engineering：agent 接手后会不会主动上报、issue 关闭后会不会停止上报
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issue-driven-development, issue-binding, mentions
created: 2026-09-14T13:18:23.009Z
---

**为什么开这条**：issue 驱动这一整套（skill、`spex issue mine/assign` 的回执、assign/unassign 的通知文本、`@new` 派工的 prompt、`[[issue:<id>]]` 署名语法）是**纯 prompt engineering**，我们从来没有实测过一个 agent 拿到这些文字之后的**实际行为**。已知的可疑点：
- skill 里说「声明即状态」，但 agent 是否真的在**每一步**都声明，而不是只在最后？
- 多归属之后，skill 要求「同时承担多个 issue 时用 `[[issue:<id>]]` 点名」——一个没读过设计讨论的 agent 会不会照做？不点名的比例是多少？
- **issue 被关闭之后**，agent 会不会继续往那条线程上报？（unassign 有通知文本，但**close 没有任何通知**——agent 根本不知道 issue 关了。这可能是一个真的机制缺口。）
- assign 通知说「Read the thread and act on it」，但没说「你要在这条线程上汇报、你的声明会显示在这个 issue 上」——足够吗？

**任务：在一个偏真实的项目上真跑，不要用我们自己的仓库当被试**
1. **建两个隔离的被试项目**（独立 SPEXCODE_HOME、独立端口、独立 tmux socket、真 launcher）：
   - A：一个小而真实的 Node/TS 项目（例如从零 `npm init` + 一个有真实 bug 的小库，或克隆一个 star 数不高的真实小仓库到本地临时目录），`spex init` 采用。
   - B：一个非 JS 的（Python 或 Go 皆可），验证 skill 的措辞不隐含语言假设。
   两个项目都必须在 /tmp 或 ~/spex-evidence 下，绝不能碰 /home/jeffry/spexcode 及其 worktrees、也不能写真 issue store。
2. **每个项目跑三个剧本，各用真 launcher（reclaude 或 codex）派真 worker，不要 fake harness——我们测的是 LLM 的行为，不是管道**：
   - **S1 单 issue**：human 开一个真实 bug 的 issue → `@new` 派 worker → 观察：它有没有先 `spex issue mine`？有没有在线程上汇报（几条）？有没有在该声明的时候声明（ask/review/close-pending）？有没有把状态写成 prose 而不是声明？
   - **S2 多归属**：同一个 worker 被 assign 第二个 issue → 观察：它之后的声明**有没有用 `[[issue:<id>]]` 点名**？不点名的比例？两个 issue 的详情页显示是否正确？
   - **S3 关闭之后**：human 关掉 S1 的 issue（worker 仍在跑）→ 观察：worker 会不会继续往已关闭的线程回复/声明？它有办法知道 issue 关了吗？
3. **记录方式**：每个剧本记下 worker 的**每一次** issue reply 与每一次声明（`spex session ls --json` 的 status/note + `issue show` 的 replies），标注「符合 skill 预期 / 偏离」，偏离的写清偏离成什么样。不要只给结论，要给原始记录。
4. **产出**：一份 review-report（HTML，`spex session files add`），含三张表（S1/S2/S3 × 项目 A/B）和一节「skill / 通知文本该怎么改」的具体建议（引用要改的原句）。**不要在这条 issue 里改产品代码**——先把行为测清楚；发现的每个机制缺口（例如 close 没有通知）各开一个 issue 并在报告里列出。
5. 结束清理：kill 所有起的 backend/worker/tmux、`git worktree` 全部移除、被试项目目录可以留在 ~/spex-evidence 下但要在报告里写明路径；报告里附「清理后 pgrep/ss 为空」的证据。

**约束**：真 launcher 会消耗额度，每个剧本的 worker 给一个**小任务**（一个真 bug、一个小重构），并在它的 prompt 里明确「做完就声明，不要扩范围」。总共 6 个被试 worker 为上限。派工时不要在正文写裸 `@new`（会误派）。
