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

<!-- reply: b6c9068a-77ca-409e-968b-85dcb48e00bf @ 2026-09-14T07:13:52.872Z -->
已读线程及 [[source-launcher-build]]、[[session-follow]]；实现会保持源码启动器“自身工作区完整构建”的契约，把测试中的 helper 启动路径改成不把该构建时间计入就绪栅栏，并覆盖源码比 dist 新的首轮运行。随后用隔离的 SPEXCODE_HOME、tmux socket、空闲端口和 fake launcher 做整文件验收，清理并留证。

<!-- reply: b6c9068a-77ca-409e-968b-85dcb48e00bf @ 2026-09-14T07:43:18.935Z -->
基线已复现：无 dist 首轮整文件 50/51，目标用例在 5.22s 以 `shared-runtime helper spawn` 超时；修复后先走真实源码 launcher `help` 刷新本工作区，再由同一工作区 `dist/cli.js` 执行内部 helper，且用例上限调至 60s 只覆盖前置构建时间。目标测试 1/1、launcher 测试 8/8、tsc 通过；`spex spec lint` 为 0 error（既有 drift warnings）。完整套件目标用例通过，但另有两个无关的 record-integrity/StopFailure 环境敏感失败，已清理本轮 fixture。

<!-- reply: b6c9068a-77ca-409e-968b-85dcb48e00bf @ 2026-09-14T08:09:23.573Z -->
落地完成：session tip e8550757 已同步 source main 6e92a2a0，并在临时 detached worktree 以唯一 --no-ff merge 生成 2d42ec9a；/home/jeffry/spexcode 已 fast-forward 且推送 origin/main 成功。post-merge build、目标测试 1/1、launcher 测试 8/8、tsc、[[source-launcher-build]] 的 spec lint（0 errors）均通过；source 工作树脏指纹保持为空，临时 worktree、测试进程和 fixture 已清理。[[file:review.html]] 中记录的两个无关环境敏感失败保持原样。
