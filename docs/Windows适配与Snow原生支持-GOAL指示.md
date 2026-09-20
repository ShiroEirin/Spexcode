# SpexCode — Windows 适配测试 + Snow 原生支持 — GOAL 模式执行指示

> **本文件是 goal 的唯一执行依据**。每轮开始先读本文件，按阶段勾选推进，每轮结束更新勾选状态。
> 生成时间：2026-09-18 | 适用仓库：`C:\Users\12971\skills\Spexcode`（分支 `feature/snow-integration`）

---

## 0. 一句话目标

**三件事：① 让测试在原生 Windows 上跑通（修掉真 bug + 平台适配测试）；② 端到端验证 Windows 适配的每条链路；③ 把 Snow CLI 从「桥接脚本」升级为「原生 harness」。**

---

## 1. 环境与工具（已由哈雷酱验证，直接用）

### 1.1 关键路径

| 用途 | 路径 |
| --- | --- |
| 仓库（本任务主体） | `C:\Users\12971\skills\Spexcode` |
| 当前分支 | `feature/snow-integration` |
| 上游基线 | `778491766`（origin/main） |
| 全局命令 | `spex`（Junction → `node_modules\spexcode`） |
| Git Bash | `C:\Program Files\Git\usr\bin\bash.exe` |
| Snow CLI 源码（参考） | `D:\github\VCP\snow-cli-raw\bundle\cli.mjs` |
| 实战验证场（后端） | `C:\project\zy\investflow` |
| 实战验证场（前端） | `C:\project\zy\investflow-web` |
| 临时产物 | `C:\Users\12971\skills\TEMP\` |

### 1.2 常用命令速查

```powershell
cd C:\Users\12971\skills\Spexcode

# 构建（改代码后必跑）
npm run build

# 类型检查
npm run typecheck

# 全量 lint（含 spec lint + init-plugin parity + dead-words）
npm run lint

# 单包测试（spec-cli 是主战场）
cd spec-cli; npm test

# 单文件测试（推荐——全量会超时，见 §6）
npx tsx --import ../scripts/test-home.mjs --test "src/<file>.test.ts"

# spec 工具
spex spec owner <file>    # 查文件的 spec 归属（改代码前必做！）
spex spec lint            # 硬门槛：0 error
spex doctor               # 诊断
```

### 1.3 仓库性质（关键认知）

**SpexCode 自己就是 spec-driven 仓库**——`.spec/` 下有 **396 个 spec 节点**，`spec-cli/src/**` 全部受 spec 治理。

**改任何 `spec-cli/src/` 下的文件前，必须先跑 `spex spec owner <file>`**，然后：
- 读该文件的 spec 正文
- 如果改动**改变了意图** → **spec 与代码同提交**（这是 SpexCode 自己的规矩）
- 如果只是实现细节 → spec 不动

**已查明的关键文件归属**：

| 文件 | 受治理于 |
| --- | --- |
| `spec-cli/src/harness.ts` | `harness-adapter`（+ `claude-rendezvous` scoped、`zcode-harness` shared） |
| `spec-cli/src/codex-harness.ts` | `codex-runtime` |
| `spec-cli/src/materialize.ts` | `harness-delivery`（scoped） |
| `spec-cli/src/harness-select.ts` | `harness-select`（scoped） |
| `spec-cli/src/runtime-guard.ts` | `platform-support` |

**`platform-support` 节点位置**：`.spec/spexcode/spec-cli/footprint/packaging/platform-support/spec.md`

---

## 2. 现状盘点（实测，不是猜的）

### 2.1 已完成的工作（21 个 Windows 修复 + Snow 桥接）

**分支 `feature/snow-integration` 的提交**：

```
c994050b5 fix: write .gitignore patterns with forward slashes (Windows)
4205b6ebf chore: drop two stray pi-extension temp files
6ae62595e fix: clean exit on the fatal path (Windows libuv crash)
15c54bf61 spec: spec-body-edit — edited in the dashboard   ← 用户在 dashboard 编辑 spec 的自动提交（机制，非意外）
e00e1c2c7 feat: Windows support + Snow CLI integration
778491766 (upstream main)
```

**21 个 Windows 修复**（详见 notebook 与 `git show e00e1c2c7`）：

| # | 文件 | 问题 |
| --- | --- | --- |
| 1 | `packages/spec-core/src/git.ts` | Windows 变量名 `Path` → `envVar()` 大小写不敏感 |
| 2 | `spec-cli/src/doctor.ts` | `resolveOnPath` 硬编码 `:` 分隔符 → 用 `delimiter` |
| 3 | `spec-cli/src/materialize.ts` | PATH 拼接大小写+分隔符 |
| 4 | `packages/session-application/src/storage-path.ts` | 无 `HOME` → `USERPROFILE` 回退 |
| 5 | `packages/spec-core/src/project-store.ts` | `encodeProject` 留 `C:` 冒号（文件名非法） |
| 6 | `packages/session-application/src/storage-locality.ts` | 新增 win32 检测器 |
| 7 | `packages/spec-core/src/process-identity.ts` | 无 `ps` → PowerShell `Get-Process` |
| 8 | `packages/spec-core/src/specs.ts` | `relative()` 反斜杠 → `split('/')` 全挂 |
| 9 | `spec-dashboard/package.json` | POSIX 内联语法 → `cross-env` |
| 10 | 静态页资产 | 手动构建 |
| **11** | `specs.ts` `parseFrontmatter` | **CRLF 下 `events:` 列表解析全空 → hook manifest 0 字节** |
| **12** | `spec-cli/hooks/harness.sh` | bash 侧 `sed` 不替换冒号 → dispatch.sh 找不到 manifest |
| **13** | `specs.ts` `claimMatcher` | 只认 POSIX 绝对路径 → spec-first 门永不触发 |
| **14** | 模板 `spec-of-file.sh` | 只认 POSIX 绝对路径 |
| **15** | `specs.ts` `bundleFiles` | `relative()` 反斜杠 |
| **16** | 模板 `session-fail/spec.md` | 硬编码 `.spec/project/` |
| **17** | `storage-locality.ts` | `fsutil` 输出本地化（GBK）→ 改用 PowerShell `.NET DriveInfo` |
| **18** | `spec-cli/src/machine-peer.ts` | `peer.sock` Unix socket → Windows named pipe |
| **19** | `spec-cli/src/host-facts.ts` | runtime 判定缺 win32 |
| **20** | `spec-cli/src/cli.ts` `fatal()` | `process.exit(1)` → libuv 断言崩溃 → `process.exitCode = 1` |
| **21** | `spec-cli/src/materialize.ts` | `.gitignore` 反斜杠 → git 不认 |

**Snow 桥接产物**（当前是"桥接"方案）：

| 文件 | 作用 |
| --- | --- |
| `spec-cli/hooks/snow-bridge.mjs` | Snow payload ⇄ Claude payload 双向翻译 + 退出码协议 |
| `spec-cli/hooks/spexcode-to-snow.mjs` | skill/command 转换器（`.plugins` → `.snow/skills`、`.snow/commands`） |

### 2.2 测试体系现状

- **测试文件总数 323 个**（不含 node_modules/dist）
  - `spec-cli/src`: **127 个**（主战场）
  - `spec-dashboard`: 91（test/）+ 67（src/）
  - `packages/*`: 各 1-5 个
  - `scripts/`: 9 个
- **CI 只有 `ubuntu-latest`**（`.github/workflows/ci.yml`）——**没有 Windows CI**
- **全量测试在 Windows 上 15 分钟超时**（实测，见 §6 陷阱）
- 已有平台跳过机制：`{ skip: process.platform !== 'win32' }`（如 `git.test.ts:29`）

### 2.3 已知测试失败（实测）

| # | 测试 | 失败原因 | 性质 |
| --- | --- | --- | --- |
| 1 | `packages/session-application/src/migration.test.ts` — `'residue migration is re-entrant'` | `chmodSync(dir, 0o500)` 在 Windows 不影响 ACL → 不抛 `EACCES/EPERM` → `assert.throws` 失败 | **测试自身 POSIX-only** |
| 2 | `migration.test.ts` — `'residue migration refuses a retired envelope...'` | 正则 `/retired envelope .*ghost\/runtime\.json/` 用正斜杠，Windows tmpdir 是反斜杠 | **测试自身 POSIX-only** |
| 3 | `spec-cli/src/materialize.test.ts` — `'one per-tree materialize projection survives a sibling pass...'` | **TOML 转义 bug（#22）**：`codex-harness.ts` 把 Windows 路径直接内插进 TOML | **真 bug（产品缺陷）** |

### 2.4 **真 bug #22 详情**（本小姐实测抓到）

**位置**：`spec-cli/src/codex-harness.ts:1793` 与 `:1796`

```ts
// writeCodexTrust() 内：
const lines = [`[projects."${proj}"]`, 'trust_level = "trusted"']
// ...
lines.push(`[hooks.state."${hooksJson}:${snake}:0:0"]`, `trusted_hash = "..."`)
```

**问题**：Windows 路径 `C:\Users\12971\...` 直接内插进 TOML basic string（双引号）→ `\U` 是**非法 unicode 转义** → `parseToml` 抛错 → `assertCodexConfigParses` 拒绝写入。

**实测错误**：
```
spex materialize: refusing to rewrite C:\Users\...\config.toml:
it does not parse as TOML (Invalid TOML document: invalid non-hex character in unicode escape
4:  [hooks.state."C:\Users\12971\AppData\Local\Temp\spex-narrow-h4Rv7D\.codex\hooks.json:session_start:0:0"]
```

**影响**：Windows 上 **codex harness 的 trust 写入完全失败**（materialize 报错退出）。当前 investflow 选的是 `claude` harness 所以没触发，但选 codex 就挂。

**修复方向**（执行时定稿，以下是候选）：
- 方案 A：写一个 `tomlString(s)` 转义函数（`\` → `\\`，`"` → `\"`），写入与 strip 都用它
- 方案 B：用 TOML **literal string**（单引号 `'...'`）——反斜杠不转义；路径含 `'` 时 fallback 到方案 A
- **注意**：`stripCodexTrustFor` 用字符串比较（`t === projHeader`），**写入与 strip 必须用同一形式**，否则删不掉旧块
- **注意**：`materialize.test.ts:402` 断言 `cfg.includes(`[projects."${proj}"]`)`——若改形式，测试同步改

### 2.5 Snow 适配现状（当前=桥接，目标=原生）

**Snow CLI 机制实证**（源码 `D:\github\VCP\snow-cli-raw\bundle\cli.mjs`）：

| 项 | Snow 的约定 |
| --- | --- |
| hook 文件 | **`.snow/hooks/<hookType>.json`**（文件名必须是 hookType，自定义名不加载） |
| hook 覆盖 | **项目级完全覆盖全局**（非合并）→ 必须把全局规则一起复制进项目文件 |
| 契约文件 | **`AGENTS.md`**（不读 CLAUDE.md） |
| skills | `.snow/skills/<name>/SKILL.md`（agentskills.io 格式） |
| commands | `.snow/commands/<name>.json`（`{type:'prompt', command, description}`） |
| agents | `.snow/agents/**/*.md`（frontmatter: id/name/description/tools/role） |
| 占位符 | `$ARGUMENTS`（与 Claude Code slash 命令一致） |

**Snow 的 9 种 hook 事件**：`onSessionStart` / `onUserMessage` / `beforeToolCall` / `toolConfirmation` / `afterToolCall` / `beforeSubAgentStart` / `onSubAgentComplete` / `beforeCompress` / `onStop`

**Claude 的 7 种事件**：`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` / `StopFailure` / `Notification`

**映射可行性**：5/7 可映射（`SessionStart→onSessionStart`、`UserPromptSubmit→onUserMessage`、`PreToolUse→beforeToolCall`、`PostToolUse→afterToolCall`、`Stop→onStop`）

**原生支持的接入点**：`spec-cli/src/harness.ts:1131` 的 `HARNESSES` 注册表 + `Harness` 接口（`harness.ts:242-289`）：

```ts
// 需要实现的成员（materialize 相关）：
shimFile(proj): string          // 自动发现的 hook shim 文件
shimScope: 'tree' | 'project'
shimOwnership: 'exclusive' | 'shared-json'
worktreeHookAnchor(proj): string | null
contractFiles(proj): string[]   // 契约文件（Snow: AGENTS.md）
skillDir(proj): string | null   // Snow: .snow/skills
agentDir(proj): string | null   // Snow: .snow/agents
shim(dispatch, spex): { content, hooks?, cmd }   // shim 载荷
writeTrust(proj, cmdFor): readonly string[]      // 信任写入（Snow 可能 no-op）
```

**结构性难点（执行时须解决）**：
- `Harness.shimFile` 是**单个文件**，但 Snow 需要**多个 hook 文件**（`beforeToolCall.json` + `afterToolCall.json`，最多 9 个）→ 需要设计扩展（如 `shimFiles()` 复数版，或 materialize 对 snow 特殊处理）
- `Harness` 接口**没有 commandDir**——当前 command 只走 plugin 路径或转换脚本 → 需要设计（扩展接口或复用 skillDir 模式）
- Snow hook 格式与 Claude 不同：`{"beforeToolCall": [{description, hooks: [{type, command, timeout, enabled}]}]}` vs `{"hooks": {"PreToolUse": [{matcher, hooks: [...]}]}}`

---

## 3. 执行阶段（勾选式进度——每轮更新本节的勾选状态！）

### 阶段 0：续跑检测（**每次启动 goal 必做**）

- [ ] 0.1 读本文件，检查各阶段勾选状态，判断从哪继续
- [ ] 0.2 确认分支与工作区：`git branch --show-current`（应 `feature/snow-integration`）+ `git status --short`
- [ ] 0.3 确认构建可用：`npm run build`（应干净）
- [ ] 0.4 记录基线到 `TEMP/SPEX-GOAL-BASELINE.md`（分支/HEAD/构建状态/测试现状）

### 阶段 1：测试基线（**分批跑，别全量**）

> 全量 `npm test` 在 Windows 上 15 分钟超时（实测）。**必须分批**。

- [ ] 1.1 跑 `spec-cli` 测试——**按字母分 4-6 批**，每批记录耗时与失败：
  ```powershell
  cd C:\Users\12971\skills\Spexcode\spec-cli
  # 例：a-f 批
  $files = Get-ChildItem src -Filter "*.test.ts" | Where-Object { $_.Name -match "^[a-f]" } | ForEach-Object { "src/$($_.Name)" }
  npx tsx --import ../scripts/test-home.mjs --test @files
  ```
- [ ] 1.2 跑 `packages/*` 测试（session-application / session-protocol / session-topology / session-runtime / session-events / transcript / archify）
- [ ] 1.3 找出**挂起/超时**的测试文件（记录哪些批超时、卡在哪个文件）
- [ ] 1.4 产出 `TEMP/SPEX-TEST-BASELINE.md`：失败清单 + 挂起清单 + 耗时统计

**验收**：基线报告存在，含「通过/失败/挂起/跳过」四类清单

### 阶段 2：修复测试失败

- [ ] 2.1 **修 `migration.test.ts` 的 2 个 POSIX-only 测试**：
  - `'residue migration is re-entrant'`：`chmodSync 0o500` 在 Windows 无效 → 平台感知（`process.platform === 'win32'` 时跳过该断言，或用 Windows 只读手段）
  - `'...refuses a retired envelope...'`：正则改平台无关（`[\\/]` 或 `path.sep` 感知）
  - **原则**：这是**测试自身**的适配，不是产品缺陷——不要改产品代码去迁就测试
- [ ] 2.2 **修真 bug #22（TOML 转义）**：
  - 读 `codex-runtime` spec（`spex spec owner spec-cli/src/codex-harness.ts`）
  - 按 §2.4 选方案实现（写入 + strip 同步）
  - 同步改 `materialize.test.ts` / `harness.test.ts` / `uninstall.test.ts` 的相关断言（若形式变化）
  - **spec 与代码同提交**（若改变了 codex-runtime 的意图）
- [ ] 2.3 **复跑验证**：`migration.test.ts` + `materialize.test.ts` 全绿
- [ ] 2.4 **处理挂起/超时**：对 1.3 找出的文件逐个跑，判断是「真挂起」还是「慢」；真挂起的修（或平台跳过 + 注释说明）
- [ ] 2.5 **复跑 spec-cli 全量（分批）**：失败数归零（或仅剩已记录的平台跳过）

**验收**：`TEMP/SPEX-TEST-BASELINE.md` 的失败清单全部消项；每个跳过都有 `skip` 理由

### 阶段 3：Windows 端到端验证

> 目的：证明 21 个修复**真的work**，不只是单测绿。

- [ ] 3.1 **核心 CLI 链路**（在临时目录或 investflow 上）：
  ```powershell
  spex init --pure / spex graph / spex spec lint / spex doctor / spex spec search / spex guide
  spex issue ls / spex diagram check / spex materialize
  ```
  每项记录：命令、退出码、关键输出、是否正常
- [ ] 3.2 **hook 链路**（Git Bash 桥接）：
  - 在 investflow 上验证 spec-first 门（读受治理文件 → block）
  - 验证 spec-of-file 注解（编辑未覆盖文件 → 注入提示）
  - 验证 CRLF 下的 manifest 生成（bug #11）
- [ ] 3.3 **dashboard 链路**：
  - `spex serve`（8787）启动无崩溃（bug #17/#18/#20）
  - `spex dashboard`（5173）打开
  - 静态页生成：`spex graph --public --html "TEMP/spex-atlas.html"`
- [ ] 3.4 **session 链路**（已知受限，记录现状）：
  - `spex session ls` 正常（bug #20 修复后不崩）
  - `spex session new` 的 tmux 限制（记录：Windows 无 tmux → headless only）
- [ ] 3.5 产出 `TEMP/SPEX-WINDOWS-VERIFY.md`：逐项 ✅/⚠️/❌ + 证据

**验收**：验证报告存在，核心链路（3.1/3.2/3.3）全绿或明确记录限制

### 阶段 4：Snow 原生 harness

> 目标：`spex init --harness snow` + `spex materialize` **直接产出** `.snow/` 全部产物，不再需要手动跑转换脚本。

- [ ] 4.1 **设计**（先读 spec 再动手）：
  - 读 `harness-adapter` spec（`spex spec owner spec-cli/src/harness.ts`）
  - 读 `harness-delivery` spec（`spex spec owner spec-cli/src/materialize.ts`）
  - 读 `harness-select` spec（`spex spec owner spec-cli/src/harness-select.ts`）
  - **解决 §2.5 的两个结构性难点**（多 hook 文件 / commandDir 缺失）——定稿设计写进 `TEMP/SPEX-SNOW-DESIGN.md`
- [ ] 4.2 **实现 `snowHarness` adapter**（`spec-cli/src/harness.ts` 或新文件 `snow-harness.ts`）：
  - `id: 'snow'`；`contractFiles` → `AGENTS.md`；`skillDir` → `.snow/skills`；`agentDir` → `.snow/agents`
  - `shimFile` → `.snow/hooks/beforeToolCall.json`（主文件，多文件方案按 4.1 定稿）
  - `shim()` → 生成 Snow 格式 hook 配置（含 `$ARGUMENTS`/退出码协议）
  - `writeTrust` → 按 Snow 机制（可能 no-op）
  - 注册进 `HARNESSES`（`harness.ts:1131`）
- [ ] 4.3 **单测**：新建 `spec-cli/src/snow-harness.test.ts`（或扩展 `harness.test.ts`），覆盖：
  - shim 生成正确（格式/事件映射/退出码）
  - materialize 写出 `.snow/hooks/*.json` / `.snow/skills/*` / `.snow/commands/*` / `AGENTS.md`
  - deselect 时 clean 干净（幂等）
- [ ] 4.4 **端到端验证**（在 investflow 上）：
  ```powershell
  cd C:\project\zy\investflow
  spex init --harness snow        # 或改 .spec/spexcode.json 的 harnesses
  spex materialize
  # 验证：.snow/hooks/*.json 生成、skills/commands 就位、AGENTS.md 契约块
  # 对比：与 snow-bridge.mjs + spexcode-to-snow.mjs 的产物是否等价
  ```
  - **回归**：确认 claude harness 仍正常（investflow 当前用 claude）
- [ ] 4.5 产出 `TEMP/SPEX-SNOW-NATIVE.md`：设计 + 实现 + 验证 + 与桥接方案的对比

**验收**：`spex materialize` 在选 snow 的仓库上产出全部 `.snow/` 产物；单测全绿；investflow 验证通过

### 阶段 5：spec 同步（**SpexCode 自己的规矩：spec 与代码同提交**）

- [ ] 5.1 **更新 `platform-support`**：21 个 Windows 修复改变了定位（"native Windows deferred" → "partially supported"）
  - 读现有正文（`.spec/spexcode/spec-cli/footprint/packaging/platform-support/spec.md`）
  - 更新为实测事实：read-only 半 + hooks 半在原生 Windows 可用；session runtime 仍受限（tmux）
  - **不要吹牛**：如实写「什么能用 / 什么不能用」
- [ ] 5.2 **新建 snow-harness spec 节点**（若 4.x 落地）：
  - 位置建议：`.spec/spexcode/spec-cli/` 下（参考 `codex-harness` 等同级节点的组织）
  - 内容：Snow 的发现约定、事件映射、退出码协议、多 hook 文件方案、与桥接的关系
- [ ] 5.3 **更新受影响的既有 spec**（按 `spex spec owner` 逐个查）：
  - `codex-runtime`（#22 修复若改变意图）
  - `harness-adapter`（若接口扩展）
  - `harness-delivery` / `harness-select`（若 materialize 逻辑变化）
- [ ] 5.4 **lint 硬门槛**：`spex spec lint` **0 error** + `npm run lint` 通过

**验收**：`spex spec lint` 0 error；每个改动文件的 spec 归属已确认；spec 与代码在同一提交

### 阶段 6：收尾

- [ ] 6.1 **全量测试复跑**（分批）：对比基线，失败归零
- [ ] 6.2 **构建验证**：`npm run build` + `npm run typecheck` 干净
- [ ] 6.3 **更新 notebook**：把本阶段新发现的坑写进笔记
- [ ] 6.4 写总结报告 `TEMP/SPEX-GOAL-REPORT.md`（含：修复清单 / 测试对比 / Snow 方案 / 提交建议）
- [ ] 6.5 **不要执行 git commit / push**（提交由用户确认；在报告中给出提交建议）

---

## 4. 强制约束（每轮都要遵守）

### 必须做

- ✅ **先读后写**：改任何 `spec-cli/src/` 文件前先跑 `spex spec owner <file>` + 读 spec 正文
- ✅ **spec 与代码同提交**（SpexCode 规矩）：改变了意图就更新对应 spec
- ✅ **每改必测**：改完跑相关单测 + `npm run build`
- ✅ **分批测试**：全量超时，按 §1.2 分批
- ✅ **平台跳过要写理由**：`{ skip: process.platform === 'win32' ? '理由' : false }`
- ✅ **提交由用户确认**（不擅自 commit）

### 禁止做

- ❌ **不推上游**（等网络好了 fork 后再推；当前只在本地分支）
- ❌ **不改产品代码去迁就 POSIX-only 测试**（测试适配测试，产品适配产品）
- ❌ **不删除测试**（只能平台跳过 + 理由）
- ❌ **不动 `.spec/spexcode/.plugins/`**（上游模板）
- ❌ **不写 `## vN` 历史**（spec 是活文档）
- ❌ **不在 spec 里吹牛**（如实写「什么能用/什么不能用」）

---

## 5. 陷阱清单（哈雷酱实测踩过的坑）

### 测试相关

- **全量 `npm test` 在 Windows 上 15 分钟超时**——必须分批（§1.2）
- **PowerShell 不展开 glob**：`npx tsx --test src/*.test.ts` 会报 "Could not find"——用 `Get-ChildItem` 展开成数组再 `@files`
- **`materialize.test.ts` 单个测试 48 秒**（慢，不是挂起）
- **`test-home.mjs` 会拒绝指向用户 home**（安全机制）——测试用临时 home
- **CI 是 ubuntu-only**：Windows 上的行为差异 CI 测不出来

### TOML / 路径

- **TOML basic string 里 `\` 必须转义**（`\U` 非法）——bug #22
- **写入与 strip 必须用同一形式**（`stripCodexTrustFor` 是字符串比较）
- **Windows 路径跨 bash 要转正斜杠**（`toPosix`）
- **`.gitignore` 必须用正斜杠**（bug #21）

### 工具

- **`rg` 全仓扫描会超时**（node_modules 太大）——用 `ace-search` 或限定目录
- **`spex doctor` 退出码 1 是正常**（有 findings）
- **`spex issue ls` 报 `forge unreachable` 是正常**（local only）
- **`spex spec lint` 的 untracked 检查**：`.spec/` 未 `git add` 会报 error

### Snow

- **hook 文件名必须是 `${hookType}.json`**（自定义名不加载）
- **项目级 hook 完全覆盖全局**（非合并）——写入时必须合并全局规则
- **Snow 读 `AGENTS.md`**（不读 CLAUDE.md）
- **Snow 的 `$ARGUMENTS`** 与 Claude Code slash 命令一致

---

## 6. 完成判定（goal 的 achieved 条件）

全部满足才算完成：

1. **测试**：`spec-cli` 分批全量跑完，失败数 = 0（或仅剩已记录的平台跳过）
2. **真 bug**：#22（TOML 转义）修复 + 有回归测试
3. **Windows 验证**：`TEMP/SPEX-WINDOWS-VERIFY.md` 存在，核心链路（CLI/hook/dashboard）全绿
4. **Snow 原生**：`spex init --harness snow` + `spex materialize` 直接产出 `.snow/` 产物（不需要手动转换脚本）
5. **Snow 单测**：`snow-harness.test.ts` 全绿
6. **spec 同步**：`platform-support` 已更新 + snow-harness spec 已建（若落地）+ `spex spec lint` 0 error
7. **构建**：`npm run build` + `npm run typecheck` 干净
8. **报告**：`TEMP/SPEX-GOAL-REPORT.md` 存在（含提交建议）
9. **未破坏**：`claude` harness 在 investflow 上仍正常（回归验证）

---

## 6.1 结算记录（2026-09-20，会话 #3）

| # | 判定 | 状态 | 依据 |
| --- | --- | --- | --- |
| 1 | 测试失败数 = 0（或仅剩已记录的平台跳过） | ❌ **未达成** | 逐文件串行实测：**19 例平台限制**已逐条记录理由（tmux 缺失 15 / POSIX 信号 1 / 无权限位 1 / 路径分隔符 1 / CRLF 源码正则 1）；**7 例已修复转绿**；**3 例平台语义差异**已定死（`sessions-hot` — process-host 走 start-token 见证，fixture 只写 agent.pid）；**余 4 例根因未定**（`session-transcript` 1 例 409≠200；`session-public-projection` 3 例 `resources.owners` 缺行），**单跑稳定复现**，本小姐**不归类**为平台限制 |
| 2 | bug #22 修复 + 回归测试 | ✅ | `codex-harness.ts` TOML 转义，测试在 `harness.test.ts` |
| 3 | `TEMP/SPEX-WINDOWS-VERIFY.md` 存在 + 核心链路全绿 | ✅ | 7222 字节；CLI / hook / dashboard 三链路已实测 |
| 4 | `spex init --harness snow` + `materialize` 直产 `.snow/` | ✅ | investflow 端到端通过 |
| 5 | `snow-harness.test.ts` 全绿 | ✅ | 12/12 |
| 6 | spec 同步 + `spex spec lint` 0 error | ✅ | `platform-support` / `snow-harness`（新建）/ `test-home-isolation` / `tsx-test-runner` 已同步 |
| 7 | `npm run build` + `npm run typecheck` 干净 | ✅ | 都 EXIT 0；`npm run lint` 亦 EXIT 0 |
| 8 | `TEMP/SPEX-GOAL-REPORT.md` 存在（含提交建议） | ✅ | 11495 字节，§1-§9 完整 |
| 9 | `claude` harness 在 investflow 仍正常 | ✅ | 回归验证通过 |

### 本轮新抓到并修复的真 bug（详见报告 §1）

| # | 位置 | 症状 |
| --- | --- | --- |
| **#52** | `spec-cli/src/snow-harness.ts` | hook timeout 单位写 30（Snow 是**毫秒**）→ 实际 30ms，spec-first 门在 Snow 下**完全失效** |
| **#53** | `distribution/gugu/spexcode-atlas/archify.mjs` | 改了 archify 源未重生成分发产物 → `npm run lint` 自 `691c2944a` 起一直红 |
| **#54** | `README.md` / `docs/README.zh-CN.md` / `guide.ts` | 注册表加 `snow` 漏同步 3 处文档（`docs-quickstart.test.ts` 逐字比对注册表） |
| **#55** | `commit-gate.test.ts` ×3 / `graphStream.api.test.ts` ×3 / `distribution.test.mjs` ×1 | 硬编码 `:` 拼 PATH（同文件别处早已用 `delimiter`） |
| **#56** | `scripts/test-home.mjs` | 测试隔离漏了 Snow 注入的 `SNOW_SESSION_ID`/`SNOW_CWD`/`SNOW_PLATFORM` → fixture 读到宿主会话身份 |
| **#57/#58** | `uninstall.test.ts` | Codex trust fixture 手写未转义路径、且不走 `mainCheckout` → strip 永不匹配 |
| **#60** | `spec-cli/src/tsx-bin.ts` | `node --import <loader>` 的 loader 在 Windows 上必须是 `file://` URL，裸盘符被解析成 scheme `c:` → **仪表板「添加项目」与 session materialize 在 Windows 上完全不可用** |
| **#61** | `spec-cli/src/session-liveness.ts`（测试侧） | `agentAlive()` 在 process-host（Windows）下走 **start-token 见证**而非 `process.kill(pid,0)`；`sessions-hot` fixture 只写 `agent.pid` 从未写启动令牌 → 视为 dead。**平台语义差异**，非产品缺陷 |
| **#62/#63** | `session-transcript.api.test.ts` / `session-public-projection.api.test.ts` | **根因未定**（4 例）。已排除：并发争用（单跑仍红）、store 路径编码（测试手写正则与产品 `encodeProject` 字面相同）、kill-0 语义（实测正确）。**如实留白，勿当结论** |

### 未解决（如实留白，勿当结论）

- **bug #59**：`commit-gate.test.ts` 单跑挂起 >50 分钟（CPU 仅 29s）。现场停在 `env .git/hooks/post-checkout`。两个候选假设（coreutils `env` 抢先命中；post-checkout 里的 `spex internal refresh-footprint` 走全局 link 落到本仓 396 节点）**都未证实** —— 本小姐的最小复现实验两个 `env.exe` 都正常。
- **§6 判定第 1 项未达成**：4 个测试（`session-transcript` 1 + `session-public-projection` 3）根因**未定**，单跑稳定复现。本小姐已排除并发、路径编码、kill-0 语义三条候选，但没能定死真正原因 —— 如实留白，不编结论。
- **bug #59**：`commit-gate.test.ts` 挂起（见上）。


## 7. 交付物

| # | 交付物 | 路径 |
| --- | --- | --- |
| 1 | 基线记录 | `TEMP/SPEX-GOAL-BASELINE.md` |
| 2 | 测试基线 | `TEMP/SPEX-TEST-BASELINE.md` |
| 3 | Windows 验证报告 | `TEMP/SPEX-WINDOWS-VERIFY.md` |
| 4 | Snow 设计 | `TEMP/SPEX-SNOW-DESIGN.md` |
| 5 | Snow 原生验证 | `TEMP/SPEX-SNOW-NATIVE.md` |
| 6 | 总结报告 | `TEMP/SPEX-GOAL-REPORT.md` |
| 7 | 修复后的代码 | `feature/snow-integration` 分支（逐项 commit） |
| 8 | 同步的 spec | `.spec/spexcode/...`（与代码同提交） |

---

## 8. 每轮收尾检查点

每轮结束前必须回答：

1. 本轮完成了哪些勾选项？（更新本文件勾选状态）
2. `npm run build` 是否干净？
3. 相关单测是否通过？
4. 改动的文件是否已确认 spec 归属？（`spex spec owner`）
5. 是否有新发现的坑要加入 §5？
6. 下一轮从哪继续？

---

## 9. 一句话收尾

**这个仓库是 spec-driven 的——改代码前先问 spec，改完代码同步 spec；测试是 Windows 适配的验收标准，Snow 原生是最终形态。别急，一步一步来。**
