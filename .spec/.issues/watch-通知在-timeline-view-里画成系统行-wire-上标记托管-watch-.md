---
concern: watch 通知在 Timeline view 里画成系统行：wire 上标记托管 watch 消息，view 折叠而不隐藏
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: session-timeline, conversation-items, session-follow, mobile-ui, rich-conversation
created: 2026-09-13T10:31:48.349Z
---

背景：托管 watch 的每次投递会在 watcher 的 timeline 追加一条 `sent` 事件（[[session-follow]] 的契约，35a0c5149 起真正实现），`from` 是被 watch 的子会话，text 形如 `[spex watch] <id> is asking — <note>`。Timeline view 把每个 `sent` 画成聊天气泡，于是这些系统通知看起来像「子会话对我说了一句 is working」，一个 supervisor watch 4 个 worker 时一屏都是它们。它们是系统在描述子会话的状态，不是子会话说的话；spec 只在 idempotency key 上标了 `watch-event:` / `watch-initial:` / `watch-reparent:` 前缀，wire 上没有任何区分字段。

要做：
1. wire：[[session-timeline]] 的 `sent` 事件加一个可选字段（例如 `system: 'watch'`），由 `publicEvent` 从消息的 `watch-*` idempotency 前缀派生（读时，不改存储）；其它 `sent` 不带该字段。GET /api/sessions/:id/timeline、SSE 都带。
2. view：conversationItems / TimelineChat 把带 `system` 的 sent 画成紧凑系统行（一行：时间 · 被 watch 会话的 headline · 状态词用 STATUS_COLOR/STATUS_GLYPH · note），连续多条可折叠成「N 条状态通知」，**不隐藏**——人应该看得到是什么叫醒了 agent。风格只用现有词汇（issue 线程里台账行的做法可直接参考 `fv-declaration`）。
3. 不改 agent 侧收到的内容：这只是渲染层的区分。手机端 [[mobile-ui]] 同一条规则。
4. spec：[[session-timeline]]（字段）、[[conversation-items]] / [[rich-conversation]]（画法）各补一句。

验收：隔离 fixture（独立 SPEXCODE_HOME、空闲端口、fake launcher）里父 watch 子，子声明三次；真实 Chromium 打开父的会话页：三条通知是系统行、折叠计数正确、普通 agent 消息仍是气泡；API 上 `system: 'watch'` 只出现在这三条上；dashboard 单测、typecheck、lint 0 error；review-report 后 `done --propose merge`。

与另一个 issue「状态提交后的投递 drain 搬回后端进程」并行；两者都碰 spec-cli，但那个改 sessions.ts 的提交路径，这个改 session-timeline.ts 的投影和 dashboard，注意各自同步 main。
