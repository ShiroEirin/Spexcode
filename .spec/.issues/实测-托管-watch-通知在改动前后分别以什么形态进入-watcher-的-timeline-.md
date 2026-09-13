---
concern: 实测：托管 watch 通知在改动前后分别以什么形态进入 watcher 的 timeline / 收件箱
by: 2499a20b-ae58-4074-87de-3753e02fe63b
status: open
nodes: session-follow, session-timeline, delivery-queue
created: 2026-09-13T09:11:23.917Z
---

问题：人今天在 Timeline view 里看到大量 `[spex watch] <id> is <state>` 消息；印象里以前 agent 能收到这类变化、但人的 Timeline 上不显示。今天 main 上落了三个投递相关 commit：7171e1788（revoke outbound debt when a sender closes）、35a0c5149（wake watcher delivery after commit）、c0f79e4a6（preserve watch notices and dedupe lock wakes）。纸面审计的结论是「spec 一直规定 watch 通知是 watcher timeline 里的普通 sent 事件，以前只是投递晚/丢」，但这需要实测，不要推断。

任务：在**完全隔离**的环境里，对三个版本各跑一遍同一个剧本，记录 watcher 实际收到的数据。
版本：A = `7171e1788^`（三个改动之前）；B = `c0f79e4a6`（三个改动之后）；C = 2026-09-06 左右的 main（例如 `git rev-list -1 --before=2026-09-06 main`），作为「以前」的参照。

隔离要求（硬约束，违反即失败）：
- 每个版本用 `git worktree add --detach /tmp/watch-ab/<name> <sha>` 建检出，node_modules 用软链指向主检出（`/home/jeffry/spexcode/{,spec-cli/,spec-dashboard/}node_modules`），需要时在该检出里 `npm run build`（packages/spec-core 的 dist 也要 build）。
- 每次运行：独立 `SPEXCODE_HOME=/tmp/watch-ab/home-<name>`、独立 tmux socket `SPEXCODE_TMUX=watch-ab-<name>`、`unset SPEXCODE_API_URL SPEXCODE_SESSION_ID`、用 `node -e` 取空闲端口做 `PORT`；fixture 项目照 `spec-cli/src/session-create-orphan.yatu.test.ts` 的写法（`.spec/project/spec.md` + `.spec/spexcode.json` 里 fake launcher = `spec-cli/test/fixtures/fake-claude`，git init 一个 commit）。绝不能碰 `~/.spexcode`、活后端 :8787、活项目的 store。
- 结束时：kill 自己起的 backend/ui、`tmux -L watch-ab-<name> kill-server`、kill 残留 fake-harness 进程（用 pgrep 列出 pid 再 kill，别 pkill -f 自己的命令行）、`git worktree remove --force` 三个检出并 `git worktree prune`。报告里附一段「清理后 pgrep/ss 为空」的证据。

剧本（每个版本相同）：
1. 起该版本的后端（`node <checkout>/spec-cli/bin/spex.mjs serve --port $PORT`，cwd = fixture 项目），等 `/health`。
2. 用 CLI 建父 P：`spex session new "parent" --launcher fake`；建子 C：`SPEXCODE_SESSION_ID=<P> spex session new "child" --launcher fake`（父子关系会让 P 自动 watch C；如果该版本不会，就显式 `SPEXCODE_SESSION_ID=<P> spex session watch <C>`，并记录是哪种）。
3. 在 C 的 worktree 里以 C 的身份依次声明：`session ask --note q`、`session park --note p`、提交一个文件后 `session done --propose merge --note r`。每步之间 sleep 2，并在每步后**立刻**（≤1s）和 15s 后各读一次：`GET /api/sessions/<P>/timeline?limit=50`（记录 kind=sent 且 text 以 `[spex watch]` 开头的事件：数量、ts、from、text），以及 `spex session dequeue --session <P> --json`（记录 agent 侧收件箱拿到了什么；注意 dequeue 是消费，只在最后一步后做一次）。
4. 另外记录 P 的 `spex session show <P> --json` 里与投递相关的字段（如有）。

要回答的问题（用数据，不用推断）：
- 每个版本里，watch 通知是否出现在 P 的 timeline 里、以什么 kind/from/text 出现、在声明后多久出现（立刻 / 等 patrol ≈ 多少秒 / 不出现）。
- agent 侧收件箱拿到的内容是否与 timeline 一致。
- 三个版本之间的差别归因到哪个 commit。
- 对照 [[session-follow]] 第 49–53 行「appends one normal `sent` event to each watcher's timeline」：哪个版本的行为与之相符。

产出：一份 review-report（表格：版本 × 步骤 × timeline 里的 watch 事件 / 延迟 / 收件箱），原始 JSON 放在 /tmp/watch-ab/evidence 并 `spex session files add` 报告；然后 `done --propose nothing`（这是调研，不合并代码）。不要改产品代码；如果发现 spec 与三个版本都不符，把不符的那句原文引出来。

<!-- reply: 2499a20b-ae58-4074-87de-3753e02fe63b @ 2026-09-13T09:11:25.377Z -->
@new:reclaude 接这个调研 issue，严格按隔离要求做，先读线程正文。
