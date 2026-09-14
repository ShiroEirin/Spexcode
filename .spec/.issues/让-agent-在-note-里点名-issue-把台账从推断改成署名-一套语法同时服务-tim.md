---
concern: 让 agent 在 note 里点名 issue：把台账从推断改成署名，一套语法同时服务 timeline 与 issue 详情
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: issue-binding, mentions, issues-view, issue-driven-development
created: 2026-09-14T09:37:44.045Z
---

**问题（现在的机制是推断，所以一直在打补丁）**
issue 详情的台账是这样来的：读 fleet 里每个 session 的 timeline，把它的声明搬进这条线程。这是一次推断——「这个 session 承担这个 issue，所以它的声明属于这个 issue」。后果我们已经连续踩了三次：
1. 绑定之前的声明也进来了（补了「只收 ≥ issue.created」）。
2. 太多，看起来像把 session 的消息流复制过来（补了「每个 session 只留最近一条」）。
3. **根本性的**：一个 session 现在可以同时承担多个 issue（`issues` 集合已落地），而它只有**一条**声明流；哪条声明是关于哪个 issue 的，推断不出来。三条 issue 的详情页会显示同一批声明。

**做法（人的想法，采纳）：让 agent 自己在 note 里点名**
沿用已有的限定引用语法（`[[file:<name>]]`、`[[widget:<name>]]` 的同一条路）新增 `[[issue:<id>]]`：
- **语法**：`[[issue:<id>]]` 是一个被动引用（不派工、不改状态），词汇表同 id（含刚放宽的 `\p{M}`）。解析在 `mentions.ts` 与 dashboard 的 `proseTokens.js` 各加一个 token，和 file/widget 完全同形（要跑在 node 引用之前，否则 `issue:` 会被当成 node id）。
- **timeline view**：渲染成一个链接，点进 `#/issues/<id>`——和 `[[node]]` 在会话里渲染成节点链接是同一回事。所以同一句话在会话页读起来是「我在说这个 issue」，不需要第二种写法。
- **issue 详情**：台账**不再读整条 timeline 再猜**，而是只收点名了本 issue 的声明行。这把推断换成署名。
- **兜底（我定的，不同意就说）**：一条声明没有点名任何 issue 时，如果作者只承担一个 issue，就归到那个 issue（今天的 worker 不必改写法）；承担多个而没点名，则**哪条详情都不显示**（它仍在自己的 timeline 里），因为猜错比不显示更糟。「只留最近一条」的规则保留，作用在点名之后。
- **skill**：[[issue-driven-development]] 的「声明即状态」一节补一句：**同时承担多个 issue 时，在 note 里用 `[[issue:<id>]]` 点名这条声明是关于哪个 issue 的**；并把这条写进那张接口表。
- **不要做的**：不要给声明加一个 issue 字段（那是第二个真相，且要改状态机）；不要让 `[[issue:]]` 有副作用；不要动 `issues` 集合的语义。

**验收**
- 隔离 fixture：一个 session 同时承担 A、B 两个 issue，声明三次——一条点名 A、一条点名 B、一条不点名；A 的详情只显示点名 A 的那条，B 只显示点名 B 的那条，不点名的那条两边都不显示（且在会话页的 timeline 里能看到，`[[issue:]]` 渲染成可点链接）。
- 只承担一个 issue 的 session 不点名时，声明照旧出现在那个 issue 上（兜底生效）。
- 真实 Chromium 截图：会话页里的链接、issue 详情里的归属。
- 单测覆盖解析（含 `issue:` 不被当 node）、归属函数（点名/兜底/多归属不点名）；dashboard 单测、typecheck、`spex spec lint` 0 error；review-report 后 done --propose merge（不要用 ask 等我看报告）。

<!-- reply: 193390db-0ddf-4b01-b397-9dec9a520d4a @ 2026-09-14T10:50:03.125Z -->
已按 [[issue-driven-development]] 完成实现：[[issue:<id>]] 解析与 dashboard token 共用限定语法；timeline 与 issue thread 渲染为 issue detail 链接；ledger 先按点名归属过滤，再保留单 issue 兜底与多 issue 未点名丢弃。单测、dashboard 测试、typecheck、spex spec lint（0 error）已通过；下一步跑隔离 Chromium 证据并提交。
