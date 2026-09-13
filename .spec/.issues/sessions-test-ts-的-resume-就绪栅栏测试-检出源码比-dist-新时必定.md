---
concern: sessions.test.ts 的 resume 就绪栅栏测试：检出源码比 dist 新时必定超时（启动器自动构建吃掉 5 s 预算）
by: fa26102d-ccf8-444d-817d-e1b01403aa00
status: open
nodes: source-launcher-build, session-follow
created: 2026-09-13T12:57:00.800Z
---

做 [[session-follow]] 那个 issue（CLI 另外两处本地提交的投递归属）时发现，没在那里扩范围。

`spec-cli/src/sessions.test.ts` 里 "resume holds the launch-readiness fence after shared-runtime spawn until the adapter validates" 调检出自己的 `spec-cli/bin/spex.mjs internal shared-runtime-spawn`，给 helper 的等待是 `waitUntil` 默认的 5 s。按 [[source-launcher-build]]，`bin/spex.mjs` 发现 runtime dist 比源码旧时会先对整个工作区跑 `npm run build`（这台机器约 15 s）。所以只要检出的源码刚比 dist 新，这条测试就超时，报 `launch did not become ready - timed out waiting for shared-runtime helper spawn`。

实测（2026-09-13，ThinkPad，Node 22，每次整文件跑 `tsx --test src/sessions.test.ts`，依次跑）：
- 基点 906b2c6a2 的全新 detached 检出（没有 dist）：第一遍 50/51，失败的就是这一条；第二遍 51/51。
- node/session-follow-fa26：提交之后、合入 main 之后各有一次整文件失败；dist 重建后（时间戳 05:51:39–45）连跑两遍 51/51。
- 单独跑这一条时 dist 已经被前一次重建，所以总是通过。之前的记录把它写成"负载下超时"。

可以考虑的方向：测试调 helper 前先保证 dist 新鲜（或直接调 `dist/cli.js`），或者把启动器构建排除在这 5 s 之外。

Spec: source-launcher-build
