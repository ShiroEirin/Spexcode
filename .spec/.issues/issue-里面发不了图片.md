---
concern: Issue 里面发不了图片
by: human
status: open
created: 2026-09-14T05:56:51.523Z
---

@2499a20b-ae58-4074-87de-3753e02fe63b

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-14T06:00:11.079Z -->
看了代码，原因清楚，是**缺一条通路**，不是坏了：
- 会话页的 composer 有粘贴/拖放（`useAttachQueue`），但 issue 的回复框和 New 页从来没接上它——所以在 issue 里粘贴图片什么都不会发生。
- 而且直接接上也不对：`useAttachQueue` 走的是 `/api/uploads`，插进正文的是一个**文件系统路径**（给 agent 去读的语义）。issue 线程要的是内容寻址的证据 blob：`POST /api/evidence` 返回 hash，正文里写 `![alt](/api/evidence/<hash>)`——Thread.jsx 已经会渲染它（`bodyEvidence` 抽 hash、`BlobMedia` 画图），reply 路由也已经收 `evidence[]`。所以缺的是「粘贴/拖放 → 上传到 evidence → 在光标处插入 markdown 图片链接」这一段。

做法（要做的人按这个来，别新造第二套附件机制）：
1. 给 `useAttachQueue` 加一个 `sink: 'uploads' | 'evidence'`（默认 uploads，保持会话页不变）。evidence 走 `POST /api/evidence`（body 是字节，返回 `{hash}`，413 是超限），插入的文本是 `![<文件名>](/api/evidence/<hash>)`。同一个队列 UI、同一个进度/取消/错误显示。
2. issue 的回复 composer 和 New 页正文都装上它（`onPaste` + 拖放 + 一个「附加」按钮，与会话页同一个控件），`sink: 'evidence'`。
3. 发送时 `evidence[]` 已经由 `bodyEvidence(text)` 从正文里抽出来，不用改协议；`POST /api/issues` 的 create 也要一并接受（正文里的图片链接同样抽 hash）。
4. 非图片文件：evidence 是任意字节的 blob，`BlobMedia` 按 Content-Type 分流（视频会播、图片会显、其它给 sentinel）。所以拖 PDF 也应当可用，别只判断 image/*。
5. 规格：[[issues-view]] 的 composer 能力对齐表加一行「粘贴/拖放附件」（两个 composer 都有，sink=evidence）；[[reply-thread]] 已经写了 blob 的渲染，补一句写入侧；`files` 与 evidence 的区别写清楚（posted file = 路径引用，evidence = 内容寻址字节）。
6. 验收：隔离 fixture + Chromium，往 issue 回复框粘一张 PNG → 队列出现 → 正文出现 `![…](/api/evidence/…)` → 发送 → 线程里图片渲染出来 → `GET /api/evidence/<hash>` 200；New 页同样；会话页原有行为不变（回归）。手机宽度也看一眼。

我自己手上有两个 issue 在做，这条派给 codex worker。

<!-- reply: 102dbd1a-51b2-4f0a-b37c-964a214f8008 @ 2026-09-14T06:25:01.918Z -->
已按 [[issues-view]]、[[reply-thread]]、[[attach-queue]] 的契约实现：同一个 `useAttachQueue` 现在支持默认 `uploads` 与 `evidence` sink；issue 回复和 New 描述接入粘贴/拖放/附加按钮，完成后插入 `![name](/api/evidence/<hash>)`，发送和 create 都从正文抽 `evidence[]`。二进制 evidence 也按 MIME 给出不可预览 sentinel，会话页原 uploads 行为保持不变。

窄化的隔离 fixture + Chromium 已通过回复/New 的 PNG 粘贴、队列、hash、发送后渲染、GET 200、390px 无溢出；会话 uploads 回归也通过。接下来提交、同步 main、重跑 proof 并发布一份报告。
