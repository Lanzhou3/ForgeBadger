# ForgeBadger — 技术架构设计

> 版本：v1.1 | 2026-04-24
> 作者：毕方 🏗️
> 状态：已确认（盘古拍板）
> 评审前置：基于 PRD-v1.1-MVP.md + PRD-REVIEW-v1.1.md
> 2026-04-26 补充：MVP-0 执行以 Claude Code 本地控制闭环和风险 Gate 为优先，分层与风险 Gate 规则见下文「零点五、MVP-0 架构契约」与 `docs/PRD-v1.1-MVP.md` 的「零、MVP-0 硬范围」。

---

## 零点五、MVP-0 架构契约（2026-04-26）

本节为 MVP-0 实现前必须遵守的架构契约。

### 0.5.1 Session Launch Contract

```text
Browser xterm.js → Gateway WebSocket → authenticated JSON-line IPC
  → independent Session Server daemon → node-pty → AI CLI
```

- Session Server is the only terminal backend. It uses a POSIX Unix socket or a
  Windows named pipe; native Windows PTYs use ConPTY. No tmux/psmux install,
  executable probe, or backend fallback is required.
- Gateway shutdown disconnects IPC without stopping the daemon or its CLI
  processes. Browser/Gateway reconnect restores the live headless terminal
  snapshot and then continues output. Terminal history is not stored in SQLite.
- Daemon death or OS restart loses the original processes. Startup reconciliation
  marks missing database sessions `lost`; it must not silently recreate tasks.
- Session names use `FORGEBADGER_SESSION_PREFIX` (default `fb-`). Storage uses `runtime_session_name`; APIs use `runtimeSessionName` and
  snapshot restore mode `attach_runtime`. Migration 0076 preserves existing values.
- IPC authentication, protocol version checks, bounded message parsing, endpoint
  ownership and startup locking protect the shared terminal host. Database and
  HTTP/WebSocket tenant checks remain mandatory; session naming alone is not authorization.
- `/ws/terminal/:sessionId` requires the `forgebadger-terminal` subprotocol,
  JWT, and session attach token. A new connection replaces the old one (4000).
- Output carries `sequence`; the browser acknowledges it with `terminal_ack`
  only from the xterm `write` callback. Slow-client output is bounded. Temporary
  failures (1011/4001) allow reconnect; 1000/4000/4403/4404 do not auto-reconnect.
- Sessions launch using structured adapter plans and host-environment credentials.
  No provider secrets are injected at session launch. Programmatic submission
  uses adapter-aware bracketed paste, readiness checks and one Enter through IPC.
- Stop/delete is explicit. Upgrade does not terminate legacy tmux/psmux processes
  or uninstall system software. Operators must finish and retire old sessions
  themselves; those processes cannot be adopted by Session Server.
- Physical Windows/ConPTY and WSL browser + real CLI lifecycle evidence remains
  a release caveat until separately recorded; unit tests do not clear it.


### 0.5.2 Structured Launch Plan

Adapter 禁止返回 shell string，必须返回结构化启动计划：

```typescript
interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  secretEnvNames: string[];
  credentialMode: "stored_encrypted_key" | "host_environment";
}
```

规则：

- Gateway 以 argv 方式使用 `command` + `args`，禁止拼接 shell 命令。
- 用户输入不得插入 shell syntax。
- `cwd` 必须位于 approved project root 内。
- session launch 使用 host-environment credentials，不注入 provider secret。
- 日志允许记录 env name，禁止记录 env value。

### 0.5.3 Credential Policy

MVP-0 支持两种明确模式：

| 模式 | 说明 | 要求 |
|------|------|------|
| `stored_encrypted_key` | API key 加密存储在 SQLite | Gateway 内存解密，只通过选定复用器的 `new-session -e` 注入 |
| `host_environment` | 使用机器已有环境变量 | UI 必须明确标记为 host-managed credentials |

禁止 silent fallback。session 记录必须持久化本次启动使用的 credential mode。

### 0.5.4 Filesystem Trust Boundary

MVP-0 采用显式 approved project root，不允许无边界访问本地文件系统。

允许根：

- 用户在创建/导入时显式选择并批准的 project root。
- 未来 Gateway 配置的 workspace root。

禁止根：

- `/`
- `/etc`
- `/proc`
- `/sys`
- `/dev`
- `/run`
- `/boot`
- `/root`
- ForgeBadger 数据库目录
- ForgeBadger 备份目录（备份服务自身写入除外）

路径规则：

- 保存 project root 前必须 `fs.realpathSync()`。
- 所有目标路径必须通过 `safeResolve(projectRoot, userPath)`。
- 已存在路径必须校验 realpath；未存在路径校验最近存在父目录 realpath。
- 禁止绝对输出路径、`..`、编码 traversal、Unicode traversal。
- 项目内 symlink 只有在解析后仍位于 approved project root 内才允许。

### 0.5.5 Config Generation Contract

配置生成必须先支持 dry-run、冲突检测、备份、写入、回滚。

```typescript
interface RenderPlan {
  projectId: string;
  targetRoot: string;
  templateId: string;
  variables: Record<string, string>;
  files: GeneratedFile[];
  credentialMode: "stored_encrypted_key" | "host_environment";
  dryRun: boolean;
}

interface GeneratedFile {
  relativePath: string;
  content: string;
  mode?: string;
  sha256: string;
  sourceTemplateFileId: string;
}

interface ConflictReport {
  relativePath: string;
  existingSha256?: string;
  incomingSha256: string;
  conflictType: "exists" | "modified" | "unsafe_path";
  allowedActions: Array<"skip" | "overwrite">;
}

interface WriteResult {
  writtenFiles: string[];
  skippedFiles: string[];
  backupPath: string;
  conflicts: ConflictReport[];
  rollbackAvailable: boolean;
}

interface RollbackResult {
  restoredFiles: string[];
  removedFiles: string[];
  failedFiles: string[];
  success: boolean;
}
```

语义：

- dry-run 不写文件，只返回 render plan 和 conflict report。
- `exists` 表示目标文件与生成文件内容完全一致。写入时可自动按 skip 处理，不要求用户再次确认。
- `modified` 表示目标文件内容不同，必须由用户显式选择 skip 或 overwrite。
- `unsafe_path` 必须阻塞，不能通过 overwrite 绕过。
- backup path 必须位于 ForgeBadger 控制的备份目录。
- 部分写入失败必须自动 rollback。
- rollback 失败必须返回需人工检查的文件列表。
- 导入已有项目时，项目记录创建和配置生成是两个阶段。配置生成可以作为 Web 侧 best-effort 后续步骤执行；若配置冲突，项目记录仍然有效，UI 必须提示用户进入预览/冲突处理流程。

### 0.5.6 MVP-0 Risk Gates

| Gate | 通过条件摘要 |
|------|--------------|
| Gate A Terminal Feasibility | Gateway 通过 Session Server 创建 Claude Code 会话，浏览器终端可交互，浏览器/Gateway 重启后可恢复，daemon 内孤立会话可安全清理 |
| Gate B Config Contract | RenderPlan/ConflictReport/WriteResult/RollbackResult 可用且测试覆盖 dry-run/冲突/回滚/路径安全 |
| Gate C Security Baseline | API key 加密、日志脱敏、路径边界、WebSocket auth/ownership/限流、API envelope 冲突已修复 |
| Gate D MVP-0 Acceptance | A/B/C 已通过，5 分钟闭环可演示，核心验证命令已运行或记录跳过原因 |

### 0.5.7 Project Manager 与 Copilot 执行契约（2026-08-31）

ForgeBadger 保留两个清晰边界：Copilot 负责对话、记忆、只读查询与审批后的平台工具调用；Project Manager 负责目标、工作项、Task Packet 和看板状态。两者都通过 Gateway 服务访问项目与会话，不引入独立的 Portfolio 控制平面。

架构约束：

- `/copilot` 与 `/api/v1/copilot/*` 是唯一助手入口，使用 Gateway 自有 provider、conversation、memory、approval、tool 与 event 服务。
- Project Manager 的工作项与 Task Packet 继续使用现有 `/api/v1/projects/:projectId/project-manager/*` 路径和 tenant-scoped repository。
- 新工作项始终以 `todo` 落库；创建 API 只接受省略 `status` 或显式 `todo`，其他状态必须在创建后通过独立 status mutation 按状态机、证据、Ledger 与审计约束变更。
- Web 创建弹窗不采集或发送初始 evidence/Feishu refs；证据从工作项详情与验收流程追加。Gateway 底层创建契约仍保留 bounded `evidenceRefs` / `feishuRefs` 作为历史数据和受控集成的兼容元数据，不删除对应 DB/DTO 字段，也不使飞书成为 Project Manager 状态权威。
- Session Manager 和 Session Server 作为 CLI 生命周期与终端输入的唯一执行边界；浏览器与程序化输入都必须经过会话所有权和 runtime authorization 校验。
- Portfolio Operations 的页面、API、仓储、worker、scheduler、event、Feishu handler 和 session fence 已退役，不得重新作为兼容层引入。
- 已应用的 Portfolio migrations 与 schema declarations 仅为迁移连续性和数据安全保留；live runtime 不读取或写入这些表。
- DeepSeek Harness 与 bridge 继续保持移除状态；DeepSeek 仅可作为普通可选模型 provider。

### 0.5.8 Copilot P0 持久运行（2026-09-05）

Gateway 的 `startCopilotRuntime` 负责恢复扫描及关停，租户 stack 仍按执行构建。`CopilotRunLedger` 通过 SQLite IMMEDIATE 事务准入、领取 lease/fence、提交完整工具批次和回执。HTTP 使用 enqueue 立即返回；定时任务继续等待 runTurn，并按自己的 runId 获取最终结果。模型请求预算跨审批和恢复持久计数。

迁移 0068 增加 run 输入/版本/lease/revision、`copilot_run_steps`、消息和审批步骤关联、会话级记忆归属。旧版活跃 run 明确失败、旧 pending action 过期，保留原数据且不重放。新版同会话仅允许一个活跃 run。终态模型响应和 completed 原子提交；恢复只重试安全读取，已经开始却无回执的写操作进入 indeterminate，执行异常也按可能存在部分副作用保守处理。

取消先更新数据库终态和 fence，再 abort 本机请求；在途写步骤标记结果未知，迟到回执只能补充证据。关停停止续租，最多等待一秒 drain 后由 lease 到期触发保守恢复。运行记录和回执随会话隐藏继续保留。回滚应暂停新版执行器并保留账本，不能在新版未决运行存在时启动旧版写执行器。

OpenAI 和 Anthropic 的工具往返均由持久 transcript 投影；压缩以完整用户回合为边界。摘要写入校验历史和执行权；记忆按 tenant/global/project/conversation 精确匹配。P1 项目授权和混合项目总览见下节；飞书、Telegram 和自治项目经理闭环仍属于后续阶段。

### 0.5.9 Copilot P1 平台命令与范围授权（2026-09-05）

`services/platform-commands/` 是首批项目、工作项、任务准备、会话生命周期、管理元数据和记忆写入的统一边界。Web route 与 Copilot tool 复用命令目录、严格输入、实际资源解析和 `PlatformActions`。显式 Web 操作使用单次 `owner_action`；Copilot 没有匹配 Grant 时等待精确审批。Grant 失效或越界不得退回 owner 权限。工作项一般元数据授权不包含验收条件、证据写入和完成状态。

迁移 `0069_copilot_platform_actions.sql` 与前向补充 `0070_copilot_platform_action_recovery.sql` 增加 `copilot_grants`、`platform_action_intents`、`platform_action_receipts`、`copilot_conversation_grants`、`project_manager_management` 和 `session_writer_leases`，关联采用租户复合外键。0069 保留已实际应用的原始 SQL/hash；0070 补 conversation 租户复合约束、writer 表与外部执行 lease，并把无租约的旧 executing intent 标为 indeterminate。升级使旧活跃 run 失败、旧 pending action 过期，保留历史而不以旧审批执行新命令。仅新空会话可绑定 Grant；绑定不可切换，撤销后也不解除。模型工具、查询资源、记忆召回均按实际关联过滤，未授权全局上下文不能进入模型输入。

Grant 明确项目、能力、规范化根目录、到期时间、动作次数和并发数；目前 actor 是当前 owner，没有跨用户或渠道身份委派。Intent 固化参数摘要、资源 revision、Grant revision、策略版本、actor、有效期和租户内唯一幂等键。执行前复核当前身份、工具开关、策略、资源与预算；数据库动作、回执和预算在 IMMEDIATE 事务内提交，外部动作先持久 claim 再执行，claim 使用 30 秒租约、每 10 秒续租；过期孤立 claim 保守恢复为未知，不重放。外部回执与 intent 终态同事务提交；迟到确认可补充事实。P0 run 恢复读取已持久化的平台回执，避免把已确认数据库作用错误投影为未知。外部结果未知时保留占用和证据、不重试副作用。P0 步骤仅引用这些结果，不形成第二条独立写入路径。自动 post-turn memory curation 已退出 orchestrator；持久记忆通过统一 `memory.write` 命令授权，包括旧的 memory entries HTTP 创建入口。

`SessionWriterLeases` 在正式 Gateway 组合中持久化到 SQLite，以规范化 workspace 为排他范围，租户/会话校验和单调 fence 防止别名目录、过期或旧进程继续写入。程序化提交在 staging 前、等待后和 Enter 前复核；WebSocket 键盘及缓冲 flush 同样检查。显式 takeover 先失效旧 token 再交回人工，已 staging 的不确定效果不重放。四种生产 adapter 均为 `manual_only`；自动任务执行和 dispatch 在启动前拒绝，项目的 `cli` 分类不表示 CLI 沙箱权限已验证。

混合项目总览复用现有目标和工作项事实，独立管理元数据记录 manual/cli、负责人、下一动作、证据时效阈值与 revision。旧项目默认 manual；证据时效仅基于声明时间，缺失或未来时间按未知处理，不代表证据内容已验收。Web 在 `/copilot` 提供 Grant、精确预览/回执、总览与管理编辑，在终端提供 writer 状态和接管。P2 飞书/Telegram、P3 调度、真实 CLI 自治权限验收尚未启用；本地 fixture LLM 浏览器验证不能代替这些外部证据。

## 零、架构总览

### 架构模式

浏览器 Next.js SPA 通过 HTTP/WebSocket 连接 Gateway；Gateway 独立持有认证、数据库和业务 API。终端 I/O 经 IPC 连接独立 Session Server，daemon 负责 node-pty、CLI 进程、headless 屏幕状态及输出流控。

### 部署拓扑

同一主机运行 Web、Gateway 和独立 Session Server。Gateway 退出只断开 IPC；daemon 与 CLI 继续运行。不同实例使用独立 state directory 和数据库，不共享同一 daemon 管理域。

## 一、技术选型确认

### 1.1 Gateway 技术栈：**Node.js (TypeScript)**

| 候选方案 | 优势 | 劣势 | 适用度 |
|----------|------|------|--------|
| **Node.js (TypeScript)** | ✅ `node-pty`（VS Code 同款，千万级用户验证）<br>✅ 原生 WebSocket 支持<br>✅ 与目标 AI CLI 同源生态（都是 npm）<br>✅ 前后端统一语言，降低协作成本 | ⚠️ CPU 密集任务不如 Go | ⭐⭐⭐⭐⭐ **推荐** |
| Python (FastAPI) | ✅ 异步生态成熟 | ❌ pty 支持弱（`pty` 模块原始，无成熟封装）<br>❌ WebSocket + pty 桥接方案不成熟 | ⭐⭐ |
| Go | ✅ 性能最优 | ❌ 团队需额外语言栈 | ⭐⭐⭐ |

**选择理由：**
1. **核心依赖 `node-pty`** — 这是 VS Code 终端的底层库，经过全球数百万开发者验证。Python 和 Go 没有同等成熟度的 pty 封装。
2. **目标 CLI 同源** — Claude Code、OpenCode 都是 npm 包，Node.js 调用子进程、解析配置、处理输出格式天然适配。
3. **统一技术栈** — 前端 Next.js + 后端 Node.js = 全栈 TypeScript，朱雀一个人就能 cover。
4. **WebSocket 一等公民** — Node.js 的 `ws` 库简单高效，无需额外依赖。

**具体选型：**
- 运行时：Node.js ≥ 20 LTS
- 语言：TypeScript 5.x
- HTTP 框架：**Express**（轻量、成熟、中间件生态完善，MVP 不需要 Next.js 的服务端渲染能力）
- WebSocket：**ws**（最轻量，性能最好）
- pty：**node-pty**（VS Code 同款）
- SQLite 驱动：**better-sqlite3**（同步 API，零异步复杂度，单线程 Gateway 完美匹配）

> **为什么不用 Next.js 做全栈？**
> Next.js 的 API Routes 适合轻量 CRUD，但 Gateway 需要长连接 WebSocket、pty 进程管理、Session Server 生命周期协调——这些是常驻后台服务的职责。Express 作为独立 Gateway 更清晰，部署也更简单（`node dist/server.js` 一行启动）。前端 Next.js 纯做 SPA，通过 API 调用 Gateway。

### 1.2 Web 前端：**Next.js 15 (App Router) + shadcn/ui + Tailwind CSS**

| 候选方案 | 优势 | 劣势 | 适用度 |
|----------|------|------|--------|
| **shadcn/ui** | ✅ 非依赖型组件库（代码复制到你项目），完全可控 | ⚠️ 需要自己组合 | ⭐⭐⭐⭐⭐ **推荐** |
| Ant Design | ✅ 组件丰富 | ❌ 体积大（~300KB gzipped）<br>❌ 移动端适配弱 | ⭐⭐ |
| Radix UI + 手写 | ✅ 完全自主 | ❌ 开发成本高 | ⭐⭐⭐ |
| Element Plus | ✅ 中文文档 | ❌ Vue 生态，与 Next.js 不匹配 | ⭐ |

**选择理由：**
1. **shadcn/ui 不是传统组件库** — 它把组件代码复制到你的项目，你拥有完全控制权。这对 MVP 快速迭代至关重要。
2. **基于 Radix UI** — 无障碍访问性有保障。
3. **Tailwind CSS** — PC/手机自适应的核心工具，utility-first 写响应式布局极快。
4. **xterm.js 集成** — 官方 React wrapper (`@xterm/xterm`) 成熟稳定。

**额外依赖：**
- `@xterm/xterm` — 终端渲染
- `@xterm/addon-fit` — 自适应终端尺寸
- `@xterm/addon-webgl` — GPU 加速渲染（可选，提升流畅度）
- `react-query` (TanStack Query) — 数据获取和缓存
- `zod` — 表单验证和 API 数据类型校验
- `lucide-react` — 图标库

### 1.3 终端方案：Session Server + node-pty + xterm

```text
Browser xterm.js → Gateway WebSocket → authenticated JSON-line IPC
  → independent Session Server daemon → node-pty → AI CLI
```

- Session Server is the only terminal backend. It uses a POSIX Unix socket or a
  Windows named pipe; native Windows PTYs use ConPTY. No tmux/psmux install,
  executable probe, or backend fallback is required.
- Gateway shutdown disconnects IPC without stopping the daemon or its CLI
  processes. Browser/Gateway reconnect restores the live headless terminal
  snapshot and then continues output. Terminal history is not stored in SQLite.
- Daemon death or OS restart loses the original processes. Startup reconciliation
  marks missing database sessions `lost`; it must not silently recreate tasks.
- Session names use `FORGEBADGER_SESSION_PREFIX` (default `fb-`). Storage uses `runtime_session_name`; APIs use `runtimeSessionName` and
  snapshot restore mode `attach_runtime`. Migration 0076 preserves existing values.
- IPC authentication, protocol version checks, bounded message parsing, endpoint
  ownership and startup locking protect the shared terminal host. Database and
  HTTP/WebSocket tenant checks remain mandatory; session naming alone is not authorization.
- `/ws/terminal/:sessionId` requires the `forgebadger-terminal` subprotocol,
  JWT, and session attach token. A new connection replaces the old one (4000).
- Output carries `sequence`; the browser acknowledges it with `terminal_ack`
  only from the xterm `write` callback. Slow-client output is bounded. Temporary
  failures (1011/4001) allow reconnect; 1000/4000/4403/4404 do not auto-reconnect.
- Sessions launch using structured adapter plans and host-environment credentials.
  No provider secrets are injected at session launch. Programmatic submission
  uses adapter-aware bracketed paste, readiness checks and one Enter through IPC.
- Stop/delete is explicit. Upgrade does not terminate legacy tmux/psmux processes
  or uninstall system software. Operators must finish and retire old sessions
  themselves; those processes cannot be adopted by Session Server.
- Physical Windows/ConPTY and WSL browser + real CLI lifecycle evidence remains
  a release caveat until separately recorded; unit tests do not clear it.


### 1.4 存储：**SQLite**

**SQLite 是否够用？** — 对 ForgeBadger 的本地单 Gateway、npm 安装形态完全够用，
也是当前正式存储架构，不是等待替换的过渡方案。

| 维度 | 评估 |
|------|------|
| 并发 | Gateway 单进程，better-sqlite3 同步读写，无并发冲突 |
| 数据量 | MVP 预期：用户 < 100，项目 < 500/用户，会话 < 50/用户 → 总计 < 50MB |
| 可靠性 | WAL 模式 + journal，崩溃安全 |
| 备份 | 运行中使用 SQLite backup API；离线复制前必须停止 Gateway 并完成 checkpoint |
| 扩展性 | 通过查询聚合、精确索引和有界保留策略扩展；保持单 Gateway + SQLite |

**选择理由：**
- **零运维** — 不需要安装、配置、监控额外服务
- **一键部署** — 符合 "npm install + 一键启动" 的目标
- **性能足够** — better-sqlite3 比 node-sqlite3 快 5-10x
- **迁移可审计** — forward-only SQL、严格递增 journal 与 SHA manifest 共同保护已发布历史
- **读取有界** — Dashboard 使用数据库计数而不物化业务行，Token Usage 在 SQLite 内聚合后再跨进程边界
- **历史可保留** — nullable session/project 历史引用继续使用 `ON DELETE SET NULL`；迁移前脏数据守卫和所有权触发器阻止跨租户写入
- **时间单位显式** — Drizzle `mode: "timestamp"` 列统一存 Unix 秒，绕过 ORM 的 raw SQL 必须使用 `sqliteTimestampSeconds()`；原生毫秒域继续保持毫秒，不按列名做全库猜测转换

`0064_normalize_mixed_timestamp_units.sql` 只修复已证实被 raw SQL 写成毫秒的
`sessions.updated_at` 与 `notifications.updated_at`。它通过数量级阈值保留正常秒值，
不转换 Provider、Project Manager、Feishu 或历史 Copilot 的原生毫秒字段；session
recovery 读取边界在迁移窗口内同时接受秒和旧毫秒值。

`0065_project_manager_goals_tenant_fk.sql` 为 Project Manager Goals 补齐
`(user_id, project_id) -> projects(user_id, id)` 复合外键，与 Work Items 的
租户所有权约束保持一致；迁移先以 guard 拒绝跨租户或缺失项目的历史行，再保留
合法 Goal 数据重建表。

**具体选型：Drizzle ORM**
- TypeScript 原生，类型推导
- 当前项目只使用 SQLite dialect，避免为了未计划的数据库后端增加抽象
- 迁移工具内置；`pnpm validate:db-migrations` 阻止历史 SQL 漂移和 journal 错位
- 比 Prisma 轻量（启动快 3 倍）

### 1.5 部署方式

发布 CLI 提供 `forgebadger doctor`、`forgebadger init` 和 `forgebadger start`。Node.js 支持范围为 >=20.12 <25。需要可加载的 node-pty 与 better-sqlite3 原生模块，以及目标 AI CLI；无需系统终端复用器。

`doctor` 只读，未初始化的 state directory 保持不存在。终端能力返回 `persistence: "session-server"`，`mode: "ready" | "unavailable"`。npm postinstall 不安装系统软件。安装、打包、启动与实机证据要求见 RELEASE-PLAN.md 和 TRIAL-RUNBOOK.md。

## 二、数据模型设计

### 2.1 ER 关系图

```
user ────< project >──── template
  │           │
  │           ├───< session >──── model
  │           │         │
  │           │         └───< terminal_log
  │           │
  │           ├───< agent
  │           │
  │           └───< project_skill ──── skill
  │
  └───< user_model (API keys)
  └───< user_template (自定义模板)
```

### 2.2 完整表结构

```sql
-- ============================================================
-- 用户与认证
-- ============================================================

CREATE TABLE users (
    id            TEXT PRIMARY KEY,                    -- UUID v4
    username      TEXT NOT NULL UNIQUE,                -- 用户名
    email         TEXT NOT NULL UNIQUE,                -- 邮箱
    password_hash TEXT NOT NULL,                       -- bcrypt 加密
    display_name  TEXT,                                -- 显示名称
    role          TEXT NOT NULL DEFAULT 'user',        -- user | admin
    status        TEXT NOT NULL DEFAULT 'active',      -- active | disabled
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Role model decision: local-first MVP supports only user | admin.
-- PRD editor | readonly roles are deferred until shared project membership
-- or hosted workspace tenancy exists. See ADR-005.

CREATE TABLE user_settings (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme         TEXT NOT NULL DEFAULT 'light',       -- light | dark
    language      TEXT NOT NULL DEFAULT 'zh-CN',       -- zh-CN | en-US
    default_model TEXT REFERENCES models(id),          -- 默认模型
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 模型配置（API Key 管理）
-- ============================================================

CREATE TABLE models (
    id            TEXT PRIMARY KEY,                    -- UUID v4
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,                       -- 显示名称: "Claude Sonnet 4"
    provider      TEXT NOT NULL,                       -- anthropic | openai | google | local
    model_id      TEXT NOT NULL,                       -- API 模型 ID: claude-sonnet-4-20250514
    endpoint      TEXT,                                -- 自定义端点（空则使用默认）
    status        TEXT NOT NULL DEFAULT 'active',      -- active | disabled
    is_default    INTEGER NOT NULL DEFAULT 0,          -- 0 | 1
    sort_order    INTEGER NOT NULL DEFAULT 0,          -- 排序
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

-- API Key 独立存储，与模型配置分离，支持轮换
CREATE TABLE api_keys (
    id            TEXT PRIMARY KEY,                    -- UUID v4
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,                       -- anthropic | openai | google
    key_encrypted TEXT NOT NULL,                       -- AES-256-GCM 加密存储
    label         TEXT,                                -- 用户标注: "主 Key" | "备用 Key"
    status        TEXT NOT NULL DEFAULT 'active',      -- active | expired | disabled
    last_used_at  TEXT,                                -- 最后使用时间
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 项目管理
-- ============================================================

CREATE TABLE projects (
    id            TEXT PRIMARY KEY,                    -- UUID v4
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,                       -- 项目名称
    path          TEXT NOT NULL,                       -- 本地绝对路径
    description   TEXT,                                -- 项目描述
    tech_stack    TEXT,                                -- JSON: ["typescript", "react", "node"]
    ai_tool       TEXT NOT NULL,                       -- claude | opencode | codex
    status        TEXT NOT NULL DEFAULT 'active',      -- active | archived
    is_imported   INTEGER NOT NULL DEFAULT 0,          -- 0=新建, 1=导入已有项目
    template_id   TEXT REFERENCES templates(id),       -- 使用的模板
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, path)
);

-- ============================================================
-- 会话管理
-- ============================================================

CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,                    -- UUID v4
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,                       -- 会话名称
    ai_tool       TEXT NOT NULL,                       -- claude | opencode | codex
    model_id      TEXT REFERENCES models(id),          -- 当前使用的模型
    agent_id      TEXT REFERENCES agents(id),          -- 当前使用的 Agent
    status        TEXT NOT NULL DEFAULT 'idle',        -- idle | running | waiting | error | completed | stopped
    runtime_session_name TEXT,                         -- Session Server 会话名
    working_dir   TEXT NOT NULL,                       -- 工作目录（通常 = project.path）
    last_active   TEXT,                                -- 最后活跃时间
    error_message TEXT,                                -- 错误信息
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user_project ON sessions(user_id, project_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- terminal_logs 表已废弃（2026-04-24 架构评审确认删除）
-- 理由：终端输出不持久化到数据库，断线恢复通过Session Server headless snapshot 获取。
-- 原 schema 保留在下方注释中供参考，实际不创建此表。
--
-- CREATE TABLE terminal_logs (
--     id            INTEGER PRIMARY KEY AUTOINCREMENT,
--     session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
--     data          TEXT NOT NULL,                       -- 终端输出数据（不持久化）
--     sequence      INTEGER NOT NULL,                    -- 顺序号
--     created_at    TEXT NOT NULL DEFAULT (datetime('now'))
-- );
--
-- CREATE INDEX idx_terminal_logs_session ON terminal_logs(session_id);

-- ============================================================
-- Agent 管理
-- ============================================================

CREATE TABLE agents (
    id            TEXT PRIMARY KEY,                    -- UUID v4
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = 全局 Agent
    name          TEXT NOT NULL,                       -- Agent 名称
    description   TEXT,                                -- Agent 描述
    model_id      TEXT REFERENCES models(id),          -- 绑定的模型
    tools         TEXT,                                -- JSON: 允许的工具列表
    allowed_dirs  TEXT,                                -- JSON: 允许的目录列表
    custom_prompt TEXT,                                -- 自定义系统提示词
    status        TEXT NOT NULL DEFAULT 'active',      -- active | disabled
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Skill 管理
-- ============================================================

CREATE TABLE skills (
    id            TEXT PRIMARY KEY,                    -- UUID v4
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,                       -- Skill 名称（文件名）
    description   TEXT,                                -- Skill 描述
    source        TEXT NOT NULL DEFAULT 'local',       -- local | clawhub | github
    content       TEXT NOT NULL,                       -- SKILL.md 内容
    version       TEXT NOT NULL DEFAULT '1.0.0',
    is_enabled    INTEGER NOT NULL DEFAULT 1,          -- 0 | 1
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

-- 项目-Skill 关联
CREATE TABLE project_skills (
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    skill_id      TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    is_enabled    INTEGER NOT NULL DEFAULT 1,          -- 0 | 1
    PRIMARY KEY (project_id, skill_id)
);

-- ============================================================
-- 模板管理
-- ============================================================

CREATE TABLE templates (
    id            TEXT PRIMARY KEY,                    -- UUID v4
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,                       -- 模板名称
    description   TEXT,                                -- 模板描述
    version       TEXT NOT NULL DEFAULT '1.0.0',
    is_builtin    INTEGER NOT NULL DEFAULT 0,          -- 0=用户模板, 1=内置模板
    usage_count   INTEGER NOT NULL DEFAULT 0,          -- 使用次数
    status        TEXT NOT NULL DEFAULT 'active',      -- active | archived
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE template_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id   TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    file_path     TEXT NOT NULL,                       -- 相对路径: .claude/CLAUDE.md
    content       TEXT NOT NULL,                       -- 文件内容
    file_type     TEXT NOT NULL,                       -- markdown | json | yaml | shell
    UNIQUE(template_id, file_path)
);

CREATE INDEX idx_template_files_template ON template_files(template_id);

-- ============================================================
-- 审计日志
-- ============================================================

CREATE TABLE audit_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action        TEXT NOT NULL,                       -- create | update | delete | import
    resource_type TEXT NOT NULL,                       -- project | session | agent | skill | template | model
    resource_id   TEXT,                                -- 资源 ID
    details       TEXT,                                -- JSON: 变更详情
    ip_address    TEXT,                                -- 请求 IP
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
```

### 2.3 多租户隔离方案

**方案：行级隔离（Row-Level Isolation）**

```
核心原则：每个表都包含 user_id 字段，所有查询强制 WHERE user_id = ?
```

| 层级 | 隔离方式 | 说明 |
|------|----------|------|
| 数据层 | `user_id` 外键 | 所有业务表强制 user_id 关联，删除用户时级联清理 |
| 文件层 | 项目路径隔离 | 每个项目独立文件系统路径，不共享 |
| 会话层 | daemon 会话身份与 Gateway 租户校验 | Session Server session 命名格式：`fb-{user_id}-{session_id}` |
| API 层 | 中间件鉴权 | 所有 API 请求通过中间件注入 `req.userId`，业务层无需手动过滤 |

**API 中间件伪代码：**
```typescript
// 所有路由经过此中间件后，req.userId 已设置
// 业务代码直接使用 req.userId，无需检查
app.use('/api/*', authMiddleware);

// 所有数据库查询使用封装的 Repository，自动注入 user_id
const projects = await projectRepo.findByUserId(req.userId);
// 内部执行: SELECT * FROM projects WHERE user_id = ?
```

**安全边界：**
- Project Manager 等强父子关系使用复合租户外键；Activity、Snapshot、Token Usage
  等需要在父对象删除后保留历史的 nullable 引用使用数据库 ownership trigger，
  同时保留 `ON DELETE SET NULL`。迁移在安装触发器前必须拒绝已有跨租户或缺失父记录。
- Gateway 以普通用户身份运行，不碰 `root` 权限
- 文件系统访问限制在项目路径内（通过 `path.resolve` + 路径前缀校验）
- API Key 加密存储（AES-256-GCM），密钥从环境变量 `FORGEBADGER_MASTER_KEY` 读取

---

## 三、API 接口设计

### 3.1 REST API（MVP P0）

**基础约定：**
- 所有 API 前缀：`/api/v1`
- 鉴权：JWT Bearer Token（通过 `Authorization: Bearer <token>` 传递）
- 响应格式：`{ code: 0, data: ..., message: "" }`
- 错误格式：`{ code: <非零>, message: "错误描述", details?: {} }`

#### 用户与认证

| Method | Path | 描述 | 请求体 |
|--------|------|------|--------|
| POST | `/api/v1/auth/register` | 本机所有者验证后注册 | `{ email, password, recoveryKey, inviteCode? }` |
| POST | `/api/v1/auth/login` | 登录 | `{ email, password }` → 返回 JWT |
| POST | `/api/v1/auth/reset-password` | 本机恢复密码 | `{ email, recoveryKey, newPassword }` |
| POST | `/api/v1/auth/logout` | 登出 | — |
| GET | `/api/v1/auth/me` | 当前用户信息 | — |

本机密码恢复以运行 ForgeBadger 的操作系统账户作为恢复权威：Gateway 首次
启动时在 `<FORGEBADGER_STATE_DIR>/account-recovery.key` 生成 256-bit 随机密钥，
POSIX 文件权限收紧为 `0600`，后续启动复用。恢复接口只接受没有代理转发头的
直接 loopback 连接；校验成功后先轮换密钥，再在同一个 SQLite 事务中更新
bcrypt 密码哈希并删除该用户的全部认证会话。接口不会返回或记录密钥，也不会
自动登录。该边界刻意不支持经反向代理或容器转发的远程恢复。

注册接口复用同一个本机所有者边界：生产 Gateway 提供恢复服务时，注册请求
也必须来自无代理转发头的直接 loopback 连接并携带有效 `recoveryKey`。注册只
执行常量时间校验，不消费或轮换密钥；`off` / `invite` 策略在此门禁之后继续
生效，invite 模式的后续用户需要同时提供恢复密钥和有效邀请码。

#### 项目管理

| Method | Path | 描述 | 请求体 |
|--------|------|------|--------|
| POST | `/api/v1/projects` | 创建项目 | `{ name, path, tech_stack, ai_tool, template_id }` |
| GET | `/api/v1/projects` | 项目列表 | `?page=1&limit=20&status=active` |
| GET | `/api/v1/projects/:id` | 项目详情 | — |
| POST | `/api/v1/projects/scan` | 扫描目录（导入） | `{ path }` |
| POST | `/api/v1/projects/import` | 导入已有项目 | `{ path, ai_tool, conflict_strategy }` |
| DELETE | `/api/v1/projects/:id` | 删除项目 | — |
| POST | `/api/v1/projects/:id/generate-config` | 生成/注入配置 | `{ template_id, force?: boolean }` |

#### 会话管理

| Method | Path | 描述 | 请求体 |
|--------|------|------|--------|
| GET | `/api/v1/sessions` | 会话列表 | `?project_id=&status=` |
| POST | `/api/v1/sessions` | 创建会话 | `{ project_id, ai_tool?, name? }`（一律 host_environment 启动） |
| GET | `/api/v1/sessions/:id` | 会话详情 | — |
| POST | `/api/v1/sessions/:id/start` | 启动会话 | — |
| POST | `/api/v1/sessions/:id/stop` | 停止会话 | — |

模型/厂商配置不走会话：见下方「模型管理」的 Model Provider 与
`/api/v1/cli-config/:adapter/apply-provider` 流程。

#### Agent 管理

| Method | Path | 描述 | 请求体 |
|--------|------|------|--------|
| GET | `/api/v1/agents` | Agent 列表 | `?project_id=` |
| POST | `/api/v1/agents` | 创建 Agent | `{ projectId, name, description, modelId, tools, allowedDirs, customPrompt }` |
| GET | `/api/v1/agents/:id` | Agent 详情 | — |
| PUT | `/api/v1/agents/:id` | 更新 Agent | `{ name, status, ... }` |
| DELETE | `/api/v1/agents/:id` | 删除 Agent | — |

项目配置生成会把启用状态不是 `disabled` 的项目 Agent 写入
`.claude/agents/<slug>.md`。`projectId` 和 `modelId` 必须属于当前用户。

#### Skill 管理

| Method | Path | 描述 | 请求体 |
|--------|------|------|--------|
| GET | `/api/v1/skills` | Skill 列表 | — |
| POST | `/api/v1/skills` | 创建 Skill | `{ name, description, source, content, version }` |
| PUT | `/api/v1/skills/:id` | 更新 Skill | `{ name, description, content, ... }` |
| DELETE | `/api/v1/skills/:id` | 删除 Skill | — |
| POST | `/api/v1/skills/:id/toggle` | 启用/禁用 | `{ enabled: boolean }` |
| GET | `/api/v1/skills/:id` | Skill 详情 | — |
| GET | `/api/v1/projects/:id/skills` | 项目 Skill 列表 | — |
| POST | `/api/v1/projects/:id/skills/:skillId` | 项目级启用/禁用 | `{ enabled: boolean }` |

项目配置生成会把项目级启用的 Skill 写入 `.claude/skills/<slug>.md`。
Skill 内容按纯文本处理，不作为 HTML 执行。

#### 模板管理

| Method | Path | 描述 | 请求体 |
|--------|------|------|--------|
| GET | `/api/v1/templates` | 模板列表 | `?builtin=true&page=1` |
| GET | `/api/v1/templates/:id` | 模板详情（含文件列表） | — |
| POST | `/api/v1/templates` | 创建自定义模板 | `{ name, description, files }` |
| POST | `/api/v1/templates/:id/clone` | 克隆模板 | `{ name }` |
| PUT | `/api/v1/templates/:id` | 更新自定义模板 | `{ name, description, version, status }` |
| PUT | `/api/v1/templates/:id/files/:filePath` | 编辑模板文件 | `{ content }` |
| DELETE | `/api/v1/templates/:id` | 删除自定义模板 | — |
| GET | `/api/v1/templates/builtins` | 内置模板列表 | — |

内置模板只读。自定义模板文件与项目配置写入共用 Gate B 路径安全、
冲突检测、备份和回滚机制。

#### 模型管理

旧的扁平 `models` 表与 `/api/v1/models` 接口已在两套模型系统统一时移除。
`model_profiles`（隶属于某个 provider profile）成为模型的唯一事实来源，
所有引用模型的表（`sessions.model_id`、`user_settings.model_id`、
`model_cost_rates.model_id`）统一指向 `model_profiles.id`。模型管理统一走
Model Providers 接口：

| Method | Path | 描述 |
|--------|------|------|
| GET | `/api/v1/model-providers` | Provider / Model / Credential 全量清单 |
| POST | `/api/v1/model-providers` | 创建 Provider（手动填写配置，无预设目录） |
| POST | `/api/v1/model-providers/:id/models` | 添加模型 |
| PATCH | `/api/v1/model-providers/:id/models/:modelId` | 更新模型 |
| POST | `/api/v1/model-providers/:id/models/:modelId/set-default` | 设为默认 |
| DELETE | `/api/v1/model-providers/:id/models/:modelId` | 删除模型 |
| GET | `/api/v1/api-keys` | API Key 列表 |
| POST | `/api/v1/api-keys` | 添加 API Key |
| POST | `/api/v1/api-keys/:id/rotate` | 轮换 API Key |
| DELETE | `/api/v1/api-keys/:id` | 删除 API Key |

模型服务商与 Code CLI 目标不再通过
`model_provider_bindings` 关联：该表与 sessions 的 `launch_*` 列仅因迁移连续性
和历史溯源保留（见 `docs/adr/0001-decouple-model-config-from-projects-and-sessions.md`），
live 代码不再读写。Provider 只保存服务商元数据、模型与加密凭据；厂商/模型/凭据
的应用是 per-CLI、user-global 的显式操作：`POST /api/v1/cli-config/:adapter/apply-provider`
（及 `/apply-provider/preview`、`/apply-provider/rollback`）把选中的
`providerProfileId`、`modelProfileId?`、`credentialId?` 按各 CLI 原生格式写入全局
配置文件（claude `~/.claude/settings.json`、codex `~/.codex/config.toml`、
opencode `opencode.json`、kimi `~/.kimi-code/config.toml`）。

凭据按 cc-switch 方式明文写入 CLI 配置文件：写前对现有配置做 AES-256-GCM 加密
备份，使用原子 `0600` 写入，失败可 rollback；preview 掩码密钥且不落盘。
模型选择按 CLI 分别适配（cc-switch 对齐）：claude 支持角色映射
（`modelMapping: {opus, sonnet, haiku, fable?, subagent?}`，未设置的角色回退主模型；
写入官方别名固定 `ANTHROPIC_DEFAULT_<ROLE>_MODEL` + 显示名 `*_MODEL_NAME`，
并删除官方已废弃的 `ANTHROPIC_SMALL_FAST_MODEL`）；codex 支持
`reasoningEffort`（写入 `model_reasoning_effort`，未传则清理）；opencode 为
additive 语义，apply 把供应商全部 active 模型写入 models map 且不触碰用户自有的
顶层 `model`；kimi 仍为单一 `default_model`。
具体到各 CLI 的写入语义：claude 写入 `ANTHROPIC_AUTH_TOKEN` 时同步删除残留的
`ANTHROPIC_API_KEY`，并对目录外模型 id 注入上下文窗口覆盖
（`CLAUDE_CODE_MAX_CONTEXT_TOKENS` / `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 两个键
必须同时写，且仅对非 `claude-` 前缀模型 id 生效）：优先取模型 profile 的
`contextWindow`，未设置时 Kimi For Coding 端点回落 256k、MiniMax
`/anthropic` 端点回落 512k 保底；不覆盖用户显式值，切走时依据
`cli_config_applied_providers` 指针仅剥离上一次 apply 注入的值（Kimi 的
256k 默认值对指针建立前的历史 apply 也始终视为托管值）；codex 采用 0.149+ 布局，把 key 写入
`model_providers.<id>.experimental_bearer_token`，并从 `~/.codex/auth.json`
移除遗留 `OPENAI_API_KEY`（保留 ChatGPT 登录 tokens 等其它字段，若因此清空则
直接删除该文件——Codex 对空 auth.json 报错、缺文件才显示登录页）；opencode
按 additive 语义 upsert provider 条目（含 `name`/`models`，重复 apply 累加模型）。
`/api/v1/cli-config/*` 不再 claim-gated，instance-admin 即可读写，语义写
（providers/models/default-model）已开放。Session 创建只收
`projectId` + `aiTool`，一律 `host_environment` 启动，不注入任何
provider/model/credential 环境变量；`switch-model` 端点已删除，历史 session
restart 退化为普通 host-environment 会话。

OpenAI 作为普通 Provider 接入 Codex，apply-provider 会把所选凭据按 Codex 原生
格式写入 `~/.codex/config.toml` 的 `model_providers.<id>` 表；ForgeBadger 不读取系统
keyring。官方边界见
[Codex authentication](https://learn.chatgpt.com/docs/auth) 与
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)。

### 3.2 WebSocket 接口

**连接鉴权：**
```
ws://localhost:3000/ws?token=<jwt_token>
```

**消息格式：**
```typescript
// 所有消息统一格式
interface WSMessage {
  type: string;
  payload: Record<string, any>;
  id?: string;  // 请求-响应匹配
}
```

#### 终端 I/O 通道

```
路径：/ws/terminal/:sessionId
```

**客户端 → 服务端（终端输入）：**
```typescript
{ type: "terminal_input", payload: { data: "cd src\n" } }
```

**服务端 → 客户端（终端输出）：**
```typescript
{ type: "terminal_output", payload: { data: "chaos-team@srv:~$ " } }
{ type: "terminal_resize", payload: { cols: 120, rows: 40 } }  // 窗口大小调整
{ type: "terminal_closed", payload: { reason: "session_stopped" } }  // 终端关闭
```

#### 实时状态推送通道

```
路径：/ws/events
```

**服务端 → 客户端（事件推送）：**
```typescript
// 会话状态变更
{ type: "session_status_changed", payload: { session_id, old_status, new_status } }

// 会话创建/删除
{ type: "session_created", payload: { session_id, project_id, name } }
{ type: "session_deleted", payload: { session_id } }

// Agent 状态变更
{ type: "agent_status_changed", payload: { agent_id, status } }

// 模型切换完成
{ type: "model_switched", payload: { session_id, model_id, model_name } }

// 错误通知
{ type: "error", payload: { session_id, message, recoverable: boolean } }
```

#### WebSocket 心跳机制

```typescript
// 客户端 → 服务端
{ type: "ping", payload: { timestamp: 1714000000000 } }

// 服务端 → 客户端
{ type: "pong", payload: { timestamp: 1714000000000 } }

// 超时策略：30s 无心跳视为断连
```

---

## 四、Gateway 与 AI CLI 的通信机制

### 4.1 整体通信架构

```
┌───────────────────────────────────────────────────┐
│                 Gateway (Node.js)                  │
│                                                    │
│  ┌──────────────┐    ┌──────────────────────────┐  │
│  │ Session      │───▶│  Session Server daemon  │  │
│  │ Manager      │    │  ┌────────────────────┐  │  │
│  │              │    │  │  AI CLI process    │  │  │
│  │  创建/销毁    │    │  │  (claude/opencode/  │  │  │
│  │  状态监控    │    │  │   codex)            │  │  │
│  │              │    │  │  stdin/stdout/     │  │  │
│  └──────────────┘    │  │  stderr             │  │  │
│                      │  └────────────────────┘  │  │
│                      └────────────┬─────────────┘  │
│                                   │                │
│                      ┌────────────▼─────────────┐  │
│                      │  node-pty (伪终端)        │  │
│                      │  负责 stdin/stdout 转发   │  │
│                      └────────────┬─────────────┘  │
│                                   │                │
│                      ┌────────────▼─────────────┐  │
│                      │  WebSocket → xterm.js    │  │
│                      │  (浏览器端)               │  │
│                      └──────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

### 4.2 终端宿主与恢复契约

```text
Browser xterm.js → Gateway WebSocket → authenticated JSON-line IPC
  → independent Session Server daemon → node-pty → AI CLI
```

- Session Server is the only terminal backend. It uses a POSIX Unix socket or a
  Windows named pipe; native Windows PTYs use ConPTY. No tmux/psmux install,
  executable probe, or backend fallback is required.
- Gateway shutdown disconnects IPC without stopping the daemon or its CLI
  processes. Browser/Gateway reconnect restores the live headless terminal
  snapshot and then continues output. Terminal history is not stored in SQLite.
- Daemon death or OS restart loses the original processes. Startup reconciliation
  marks missing database sessions `lost`; it must not silently recreate tasks.
- Session names use `FORGEBADGER_SESSION_PREFIX` (default `fb-`). Storage uses `runtime_session_name`; APIs use `runtimeSessionName` and
  snapshot restore mode `attach_runtime`. Migration 0076 preserves existing values.
- IPC authentication, protocol version checks, bounded message parsing, endpoint
  ownership and startup locking protect the shared terminal host. Database and
  HTTP/WebSocket tenant checks remain mandatory; session naming alone is not authorization.
- `/ws/terminal/:sessionId` requires the `forgebadger-terminal` subprotocol,
  JWT, and session attach token. A new connection replaces the old one (4000).
- Output carries `sequence`; the browser acknowledges it with `terminal_ack`
  only from the xterm `write` callback. Slow-client output is bounded. Temporary
  failures (1011/4001) allow reconnect; 1000/4000/4403/4404 do not auto-reconnect.
- Sessions launch using structured adapter plans and host-environment credentials.
  No provider secrets are injected at session launch. Programmatic submission
  uses adapter-aware bracketed paste, readiness checks and one Enter through IPC.
- Stop/delete is explicit. Upgrade does not terminate legacy tmux/psmux processes
  or uninstall system software. Operators must finish and retire old sessions
  themselves; those processes cannot be adopted by Session Server.
- Physical Windows/ConPTY and WSL browser + real CLI lifecycle evidence remains
  a release caveat until separately recorded; unit tests do not clear it.

### 4.6 安全边界


#### 4.6.2 文件路径安全校验（防目录穿越）

**风险场景：** 用户传入 `../../etc/passwd` 等恶意路径，绕过项目目录限制。

**防护层：**
```typescript
// 路径校验 — 必须在文件系统操作前执行
function safeResolve(baseDir: string, userPath: string): string {
  // 1. 解析为绝对路径（消除 .. 和 .）
  const resolved = path.resolve(baseDir, userPath);

  // 2. 校验路径前缀，确保不逃逸出 baseDir
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep)) {
    throw new Error(`路径穿越检测："${userPath}" 超出项目目录边界`);
  }

  // 3. 校验路径长度（防 DoS）
  if (resolved.length > 4096) {
    throw new Error('路径过长');
  }

  return resolved;
}
```

**应用范围：**
| 场景 | 校验点 |
|------|--------|
| 项目导入 `POST /api/v1/projects/scan` | 校验 `path` 参数，确保是本地绝对路径且不包含符号链接指向系统目录 |
| 项目创建 `POST /api/v1/projects` | 校验 `path` 在项目目录前缀内 |
| 模板文件写入 `PUT /api/v1/templates/:id/files/:filePath` | 校验 `filePath` 不能包含 `..` 或绝对路径 |
| Agent `allowed_dirs` | 每个目录都需执行 `safeResolve` 校验 |

**额外防护：**
- 符号链接解析：`fs.realpathSync()` 确认最终目标路径仍在白名单内（防 symlink 逃逸）
- 拒绝访问敏感路径：`/etc`, `/proc`, `/sys`, `/root` 等系统目录直接拒绝，即使是合法路径前缀的一部分也拒绝（深度白名单）

#### 4.6.3 WebSocket 连接管理（生产级）

**连接生命周期：**
```typescript
// WebSocket 连接管理器 — 核心设计要点
class WebSocketManager {
  // 1. 连接限制：单用户最多 10 个并发 WebSocket 连接（防 DoS）
  private readonly MAX_CONNECTIONS_PER_USER = 10;

  // 2. 连接限制：全局最多 100 个并发连接（MVP 保守值）
  private readonly MAX_GLOBAL_CONNECTIONS = 100;

  // 3. 连接追踪：userId → Set<WebSocket>
  private connections = new Map<string, Set<WebSocket>>();

  // 4. 心跳检测：30s ping/pong，90s 无响应踢出（已在 §3.2 定义）

  // 5. 优雅关闭：SIGTERM → 关闭所有连接 → 等待客户端断开 → 清理

  handleConnection(ws: WebSocket, userId: string): void {
    // 连接数检查（单用户 + 全局）
    if (this.isConnectionLimitReached(userId)) {
      ws.close(1013, '连接数已达上限');
      return;
    }

    // 连接注册 + 心跳启动 + 错误处理绑定...
  }
}
```

**关键设计决策：**

| 决策点 | 方案 | 理由 |
|--------|------|------|
| 单用户连接数限制 | 10 个 | 典型用户最多同时开 2-3 个终端 + 1 个事件通道，10 个留有余量 |
| 全局连接数限制 | 100 个 | MVP 阶段单机部署，避免内存耗尽 |
| 超时踢出 | 90s 无心跳 | 30s 心跳间隔 × 3 次容忍，兼顾弱网和异常检测 |
| 消息大小限制 | 1MB（单帧） | WebSocket 默认限制，防止恶意大消息 |
| 频率限制 | 终端输入 50 次/秒 | 防止恶意快速输入拖垮 pty |
| 优雅关闭 | SIGTERM 后 5s 等待 | 给客户端时间完成 `close` 握手 |
| 连接标识 | 终端连接绑 `sessionId` | 一个终端 session 只允许一个活跃 WebSocket（多开互踢） |
| 互踢机制 | 新连接建立时踢出旧连接 | 避免同一终端出现多个写入源导致显示混乱 |

### 4.7 AI CLI 适配器

**适配器接口定义：**

```typescript
interface CliAdapter {
  // CLI 名称
  name: string;  // 'claude' | 'opencode' | 'codex'

  // 启动命令
  getLaunchCommand(projectPath: string, options?: LaunchOptions): string;

  // 配置文件生成
  generateConfig(project: Project, template: Template): ConfigFile[];

  // 配置扫描（导入已有项目时识别）
  scanProject(projectPath: string): ScanResult;

  // Agent 配置格式
  formatAgentConfig(agent: Agent): string;

  // Skill 注入格式
  formatSkillInjection(skill: Skill): string;
}
```

**MVP 阶段只实现 Claude Code 适配器，OpenCode 和 Codex 作为 P1 扩展。**

---

## 五、开发依赖关系图

### 5.1 模块依赖图

```
                        ┌─────────────┐
                        │  Day 1-3    │
                        │  基础设施层  │
                        └──────┬──────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
    ┌─────▼─────┐       ┌─────▼─────┐       ┌──────▼──────┐
    │ F0 认证   │       │ B3 终端   │       │ 数据模型    │
    │ + 多租户  │       │ POC 验证  │       │ + ORM 搭建  │
    └─────┬─────┘       └─────┬─────┘       └──────┬──────┘
          │                    │                    │
          │              ┌─────▼─────┐              │
          │              │ POC 通过？ │              │
          │              └─────┬─────┘              │
          │              ┌─────┴─────┐              │
          │          ✅ 通过      ❌ 失败            │
          │          (继续)      (换方案)            │
          │                                         │
    ┌─────▼─────────────────────────▼──────────────┐
    │              Day 4-8                        │
    │              核心业务层（可并行）             │
    └─────┬─────────────────────────┬──────────────┘
          │                         │
    ┌─────▼─────────────┐    ┌─────▼─────────────┐
    │ A 项目初始化       │    │ H 模型管理         │
    │ + I 项目导入       │    │ (API Key 管理)    │
    │ (先打透 Claude)   │    │                    │
    └─────┬─────────────┘    └─────┬─────────────┘
          │                         │
          └─────────────┬───────────┘
                        │
                  ┌─────▼─────┐
                  │ Day 9-15  │
                  │ 扩展层    │
                  └─────┬─────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
    ┌─────▼─────┐ ┌────▼──────┐ ┌────▼──────┐
    │ B 会话管理 │ │ C Agent   │ │ D Skill   │
    │ (列表+状态)│ │ 管理      │ │ 管理      │
    └───────────┘ └───────────┘ └───────────┘
          │
    ┌─────▼─────┐
    │ E 模板管理 │
    └───────────┘
```

### 5.2 开发阶段排期

#### Phase 0：基础设施（Day 1-3，不可并行）

| 任务 | 负责人 | 耗时 | 说明 |
|------|--------|------|------|
| 项目初始化 | 朱雀 | 0.5 天 | monorepo 搭建（pnpm workspace） |
| F0 认证 + 多租户 | 朱雀 | 2 天 | JWT + bcrypt + 中间件 |
| 数据模型 + ORM | 朱雀 | 1.5 天 | Drizzle schema + 迁移 |
| B3 终端 POC | 朱雀 | 3 天 | Session Server + node-pty + xterm.js 全链路验证 |

> **POC 验收标准：** 能通过浏览器 xterm.js 操作 Session Server 中的 `claude` 命令，断线重连后终端状态可恢复。

#### Phase 1：核心业务（Day 4-12，可并行）

| 任务 | 负责人 | 耗时 | 依赖 |
|------|--------|------|------|
| A 项目初始化 + I 项目导入 | 朱雀 | 4 天 | Phase 0 |
| H 模型管理（API Key） | 朱雀 | 3 天 | Phase 0 |
| E 模板管理 | 朱雀 | 3 天 | Phase 0 |
| 前端基础框架 + 路由 | 朱雀 | 2 天 | Phase 0 |

> A 和 H 可以并行，E 依赖模板数据模型（Phase 0 已完成）。

#### Phase 2：扩展功能（Day 13-22）

| 任务 | 负责人 | 耗时 | 依赖 |
|------|--------|------|------|
| B 会话管理（列表+状态+终端） | 朱雀 | 5 天 | Phase 1 + POC |
| C Agent 管理 | 朱雀 | 3 天 | Phase 1 |
| D Skill 管理 | 朱雀 | 2 天 | Phase 1 |
| 前后端联调 + 端到端测试 | 朱雀 | 2 天 | 所有模块 |

### 5.3 POC 任务清单

**POC 1：终端全链路验证（最高优先级，Day 1-3）**
- [ ] `node-pty` 在目标平台编译通过
- [ ] Session Server 会话创建/attach/stop 正常
- [ ] xterm.js + WebSocket + node-pty 数据流打通
- [ ] 断线重连后终端状态恢复（通过 headless snapshot）
- [ ] 真实 Claude 交互验证：启动 Claude Code 会话后，能输入 `/help` 并看到完整响应输出，确认 stdin/stdout 双向通信正常（非简单 echo 测试）
- [ ] 窗口大小调整同步

**POC 2：配置生成验证（Day 4）**
- [ ] 读取模板文件 → 生成 `.claude/CLAUDE.md`
- [ ] 目标目录已有配置时的冲突检测
- [ ] 配置注入前备份 + 失败回滚

**POC 3：项目扫描验证（Day 4-5）**
- [ ] 识别目录中已有的 AI 工具类型
- [ ] 检测缺失的配置文件

---

## 六、风险与对策

### 技术风险 Top 5

| # | 风险 | 影响 | 概率 | 严重度 | 应对方案 |
|---|------|------|------|--------|----------|
| 1 | **node-pty 编译失败** | Gateway 无法启动，终端功能完全不可用 | 中 | 🔴 致命 | ① 使用 prebuild 包跳过编译 ② 准备 fallback：如果 node-pty 不可用，降级为纯命令行模式（不嵌入终端，外部打开终端窗口） |
| 2 | **daemon 生命周期错误** | 并发启动或错误清理中断会话 | 高 | 🟡 严重 | 启动互斥、endpoint 身份检查、数据库/live session 对账 |
| 3 | **WebSocket 连接不稳定** | 终端卡顿、断连，用户体验差 | 高 | 🟡 严重 | ① 客户端自动重连（指数退避：1s → 2s → 4s → 8s → 最大 30s） ② daemon 保活：WebSocket 断连不影响 CLI 运行 ③ 重连后通过 headless snapshot 恢复显示 |
| 4 | **API Key 安全存储** | 密钥泄露 → 资损 | 低 | 🔴 致命 | ① AES-256-GCM 加密，密钥来自环境变量 `FORGEBADGER_MASTER_KEY` ② 不在日志中打印密钥 ③ 内存中解密后通过环境变量注入 CLI 进程 ④ 支持 API Key 轮换 |
| 5 | **MVP 工时压缩** | 项目跳票 | 高 | 🟡 严重 | ① MVP 只打透 Claude Code，OpenCode/Codex 适配器延后 ② 前端页面使用 shadcn/ui 快速搭建，不追求完美 UI ③ 严格 P0 范围，P1 功能不提前做 ④ 每周检查进度，必要时砍功能不砍质量 |

### 风险详细应对

#### 风险 1：node-pty 编译失败

```
触发条件：目标环境缺少编译工具链（gcc, make, python3）

检测：安装时运行 node-pty 编译测试
降级方案：
  1. 使用 prebuild（node-pty 提供预编译二进制）
  2. 如果 prebuild 也不可用 → 提供"纯 API 模式"
     - Gateway 仍提供所有管理功能
     - 终端功能提示用户使用外部终端
     - 记录 node-pty 加载失败并修复本机原生模块环境
```

#### 风险 2：Session Server 会话与宿主生命周期

Gateway 正常退出不能停止 daemon。显式停止会话才终止对应 PTY。恢复时对账数据库与 live session；daemon 或系统重启后缺失会话标记 lost。启动互斥、endpoint 所有权检查及进程身份验证防止并发 Gateway 误替换活跃宿主。

#### 风险 3：WebSocket 断连和慢消费者

输出 sequence 在浏览器 xterm write 回调后 ACK；对未确认输出和发送缓冲设置界限。重连恢复 headless snapshot，不能重复提交 CLI 输入。按关闭码决定是否重连，不能用 wasClean 代替业务原因。

#### 风险 4：API Key 安全存储

```
加密方案：
  - 算法：AES-256-GCM（替代 CBC，增加认证标签防篡改）
  - 密钥：FORGEBADGER_MASTER_KEY 环境变量（推荐 64 字符 hex）
  - 首次启动时如未设置则生成并提示用户保存

注入方案：
  - 启动 CLI 进程时，通过环境变量注入（如 ANTHROPIC_API_KEY）
  - 不在配置文件、日志、数据库中存储明文

审计：
  - 记录 API Key 的创建、使用、轮换时间
  - 不记录密钥内容
```

#### 风险 5：MVP 工时压缩

```
范围控制：
  - MVP 只做 Claude Code 适配器（OpenCode / Codex → P1）
  - Agent 管理先做基础 CRUD（编排 → P2）
  - Skill 管理先做本地 Skill（从 ClawhHub 安装 → P1）
  - 模板管理先做内置模板（自定义创建 → P1）

质量底线：
  - 不砍终端 POC 时间
  - 不砍认证模块时间
  - 不砍 API Key 安全存储
  - 不砍错误处理

进度管理：
  - 每日站会检查进度
  - Day 7 做一次里程碑检查，如果落后 > 2 天则砍 P0 范围
  - 砍功能优先级：E3 模板编辑 → D2 Skill 启用 → C2 Agent 表单
```

---

## 七、项目结构

### 7.1 Monorepo 结构

```
forgebadger/
├── packages/
│   ├── gateway/                    # Gateway 服务
│   │   ├── src/
│   │   │   ├── index.ts            # 入口
│   │   │   ├── server.ts           # Express 服务器
│   │   │   ├── config/             # 配置
│   │   │   │   ├── database.ts     # Drizzle + SQLite
│   │   │   │   └── env.ts          # 环境变量
│   │   │   ├── routes/             # REST API 路由
│   │   │   │   ├── auth.ts
│   │   │   │   ├── projects.ts
│   │   │   │   ├── sessions.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── skills.ts
│   │   │   │   ├── templates.ts
│   │   │   │   └── models.ts
│   │   │   ├── websocket/          # WebSocket Hub
│   │   │   │   ├── hub.ts          # WebSocket 连接管理
│   │   │   │   ├── terminal.ts     # 终端 WebSocket 处理
│   │   │   │   └── events.ts       # 事件推送
│   │   │   ├── services/           # 业务逻辑
│   │   │   │   ├── session-manager.ts   # 会话管理（Session Server）
│   │   │   │   ├── terminal-proxy.ts    # 终端 I/O 转发
│   │   │   │   ├── config-generator.ts  # 配置生成引擎
│   │   │   │   ├── project-scanner.ts   # 项目扫描引擎
│   │   │   │   └── crypto.ts            # 加密/解密
│   │   │   ├── adapters/           # AI CLI 适配器
│   │   │   │   ├── index.ts
│   │   │   │   ├── claude.ts       # Claude Code 适配器
│   │   │   │   ├── opencode.ts     # OpenCode 适配器 (P1)
│   │   │   │   └── codex.ts        # Codex 适配器 (P1)
│   │   │   ├── db/                 # 数据库
│   │   │   │   ├── schema.ts       # Drizzle schema
│   │   │   │   ├── migrations/     # 迁移文件
│   │   │   │   └── repositories/   # 数据访问层
│   │   │   └── middleware/         # 中间件
│   │   │       ├── auth.ts         # JWT 鉴权
│   │   │       ├── error.ts        # 错误处理
│   │   │       └── tenant.ts       # 多租户隔离
│   │   └── package.json
│   │
│   └── web/                        # Web 控制台
│       ├── src/
│       │   ├── app/                # Next.js App Router
│       │   │   ├── (auth)/         # 认证页面（登录/注册）
│       │   │   ├── (dashboard)/    # 主控制台页面
│       │   │   │   ├── projects/
│       │   │   │   ├── sessions/
│       │   │   │   ├── agents/
│       │   │   │   ├── skills/
│       │   │   │   ├── templates/
│       │   │   │   └── models/
│       │   │   └── layout.tsx
│       │   ├── components/         # React 组件
│       │   │   ├── ui/             # shadcn/ui 组件
│       │   │   ├── terminal/       # xterm.js 封装
│       │   │   └── layout/         # 布局组件
│       │   ├── lib/                # 工具库
│       │   │   ├── api.ts          # API 客户端
│       │   │   └── ws.ts           # WebSocket 客户端
│       │   └── hooks/              # React Hooks
│       └── package.json
│
├── pnpm-workspace.yaml
├── package.json                    # 根 package
└── README.md
```

### 7.2 技术依赖清单

**Gateway (`packages/gateway`):**
```json
{
  "dependencies": {
    "express": "^4.21",
    "ws": "^8.18",
    "node-pty": "^1.0",
    "better-sqlite3": "^11.0",
    "drizzle-orm": "^0.38",
    "jsonwebtoken": "^9.0",
    "bcrypt": "^5.1",
    "zod": "^3.23"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "drizzle-kit": "^0.30",
    "@types/express": "^5.0",
    "@types/ws": "^8.5",
    "@types/better-sqlite3": "^7.6"
  }
}
```

**Web (`packages/web`):**
```json
{
  "dependencies": {
    "next": "^15.0",
    "react": "^19.0",
    "@xterm/xterm": "^5.5",
    "@xterm/addon-fit": "^0.10",
    "@tanstack/react-query": "^5.0",
    "zod": "^3.23",
    "lucide-react": "^0.460"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "tailwindcss": "^4.0",
    "shadcn/ui": "latest"
  }
}
```

---

## 八、架构决策记录（ADR）

### ADR-001: Gateway 技术栈选择 Node.js

- **状态：** 提议
- **决策者：** 毕方
- **日期：** 2026-04-24

**背景：** Gateway 需要管理 AI CLI 实例、终端 I/O 转发、会话持久化。需要从 Node.js / Python / Go 中选择。

**候选方案：**
1. Node.js (TypeScript) — 使用 node-pty + Express + ws
2. Python (FastAPI) — 使用 pty + asyncio
3. Go — 使用 creack/pty + gorilla/websocket

**选择方案：Node.js (TypeScript)**

**选择理由：**
1. `node-pty` 是 VS Code 的终端底层库，经过全球验证，是唯一生产级别的 Node.js pty 方案
2. 目标 AI CLI（Claude Code, OpenCode, Codex）都是 Node.js 生态，适配成本低
3. 前后端统一 TypeScript，降低开发者的上下文切换成本
4. WebSocket 在 Node.js 中是一等公民

**被否决方案：**
- **Python：** pty 支持不成熟，异步编程模型复杂，与 AI CLI 生态隔离
- **Go：** 性能优势对 MVP 不重要，团队需要额外语言栈

**后果：**
- ✅ 开发效率高，朱雀一人可 cover 全栈
- ⚠️ 如果未来需要极高并发（> 100 用户同时操作终端），可能需要迁移到 Go
- ⚠️ `node-pty` 需要编译依赖，部署时需注意 prebuild

---

### ADR-002: 前端组件库选择 shadcn/ui

- **状态：** 提议
- **决策者：** 毕方
- **日期：** 2026-04-24

**背景：** 需要选择一个 React 组件库，支持 PC/手机自适应，开发效率高。

**候选方案：**
1. shadcn/ui — 代码复制模式，基于 Radix UI
2. Ant Design — 完整组件库
3. Material UI — 完整组件库

**选择方案：shadcn/ui**

**选择理由：**
1. 非依赖型：组件代码复制到项目中，完全可控，不会被组件库版本升级绑架
2. 轻量：只引入需要的组件，无多余代码
3. Radix UI 底层：无障碍访问有保障
4. Tailwind CSS：响应式设计开发效率高

**被否决方案：**
- **Ant Design：** 体积大（~300KB gzipped），移动端适配弱，风格偏企业级
- **Material UI：** 风格过于 Google 化，自定义成本高

---

### ADR-003: 存储方案选择 SQLite + Drizzle ORM

- **状态：** 提议
- **决策者：** 毕方
- **日期：** 2026-04-24

**背景：** 需要选择一个轻量、零运维的数据库方案，支持后续扩展。

**候选方案：**
1. SQLite + better-sqlite3 + Drizzle ORM
2. PostgreSQL + Prisma
3. SQLite + Prisma

**选择方案：SQLite + better-sqlite3 + Drizzle ORM**

**选择理由：**
1. 零运维：无需安装额外服务，符合一键部署目标
2. better-sqlite3 同步 API：单线程 Gateway 无需处理异步并发
3. Drizzle ORM：TypeScript 原生，提供 SQLite schema 类型和 migration runner
4. 性能：MVP 阶段（< 500 项目，< 5000 会话）完全够用

**被否决方案：**
- **PostgreSQL：** 需要额外部署和运维，不符合 MVP 的一键启动目标
- **Prisma：** 启动慢（冷启动 2-3 秒），对 CLI 工具不友好

**后果：**
- ✅ 部署简单，`npm install` 即
- ✅ 本地 npm 服务保持单文件、零外部数据库依赖
- ✅ WAL + 有限 busy timeout 适配单 Gateway 的短事务写入
- ⚠️ migration 必须 forward-only；已发布 SQL 不允许原地改写
- ⚠️ 若未来产品目标改为多主机共享状态，需要重新做完整存储架构评审，而不是替换连接字符串

---

### ADR-004: 会话管理使用 tmux 而非直接子进程（历史决策记录）

> 已被 2026-09 Session Server 契约取代。以下理由和平台补充仅供历史追溯，不是当前运行或安装要求。

- **状态：** 历史；核心决策已在 2026-08-31 泛化为平台终端复用器
- **决策者：** 毕方
- **日期：** 2026-04-24

**背景：** 需要管理 AI CLI 进程的生命周期，支持断线重连。

**候选方案：**
1. tmux 托管子进程
2. Gateway 直接 spawn 子进程
3. systemd user service

**选择方案：tmux 托管子进程**

**选择理由：**
1. 断线重连：tmux 天然支持 detach/attach，Web 断连不影响 CLI 运行
2. 进程隔离：每个会话一个 tmux session，互不影响
3. 滚动历史：tmux 保留 scrollback 历史，重连后可恢复
4. 成熟稳定：tmux 是业界标准的终端复用器

**被否决方案：**
- **直接子进程：** Gateway 重启 = 所有 CLI 进程丢失，断线即断会话
- **systemd：** 复杂度高，不适合 MVP 一键部署

**后果：**
- ✅ 用户体验好：断线重连无感知
- ⚠️ 依赖 tmux，需要在安装文档中说明
- ⚠️ tmux 会话泄漏需要防护（已制定清理策略）

**2026-08-31 修订：** ADR 的核心选择是“由操作系统终端复用器托管会话，
而不是由 Gateway 直接托管 CLI 子进程”。该历史方案已由 2026-09 Session Server 契约取代；不再加载 tmux/psmux。复用器选择由
`services/terminal-multiplexer-runtime.ts` 统一解析，创建、恢复、历史捕获、
resize、停止、WebSocket attach 和 programmatic submit 复用同一运行时。
当前 macOS 上的代码/单元测试通过不等于真实 Windows 验收；物理 Windows +
ConPTY + psmux + 浏览器 + AI CLI 完整生命周期仍由 `WINDOWS-WSL` 外部证据门禁
保持 `Caveat`。

---

## 九、附录

### 9.1 配置生成引擎设计

```
模板文件（template_files 表）
    │
    ▼
┌─────────────────────────┐
│   Template Renderer     │
│                         │
│   输入：                │
│   - 模板内容            │
│   - 项目变量            │
│     (name, path,        │
│      tech_stack, etc.)  │
│                         │
│   输出：                │
│   - 渲染后的文件内容    │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Conflict Detector     │
│                         │
│   检查目标路径是否已有  │
│   文件，如有则生成      │
│   冲突报告              │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Config Writer         │
│                         │
│   1. 备份目标目录       │
│   2. 写入新文件         │
│   3. 失败则回滚         │
└─────────────────────────┘
```

### 9.2 环境变量清单

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `FORGEBADGER_PORT` | ❌ | 3000 | Gateway HTTP/WS 端口 |
| `FORGEBADGER_DB_PATH` | ❌ | `~/.forgebadger/forgebadger.db` | SQLite 数据库路径 |
| `FORGEBADGER_MASTER_KEY` | ✅ | — | AES 加密密钥（推荐 64 字符 hex） |
| `FORGEBADGER_JWT_SECRET` | ✅ | — | JWT 签名密钥 |
| `FORGEBADGER_LOG_LEVEL` | ❌ | info | 日志级别 |
| `FORGEBADGER_SESSION_PREFIX` | ❌ | fb- | Session Server 会话名前缀 |

### 9.3 前端页面路由

```
/                     → 登录/注册（未登录）/ 仪表盘（已登录）
/projects             → 项目列表
/projects/new         → 创建项目
/projects/:id         → 项目详情
/projects/:id/import  → 导入项目
/sessions             → 会话仪表盘
/sessions/:id         → 会话详情 + 终端
/agents               → Agent 列表
/agents/new           → 创建 Agent
/skills               → Skill 列表
/skills/:id           → Skill 编辑
/templates            → 模板列表
/templates/:id        → 模板详情 + 编辑
/models               → 模型列表
/models/new           → 添加模型
/settings             → 用户设置
```

---

## 十、核心结论

> 以下为开发前必须对齐的核心结论：

1. **Gateway 用 Node.js + TypeScript** — 不是因为流行，而是因为 `node-pty`（VS Code 同款）是唯一生产级方案，且与 AI CLI 生态同源。
2. **前端用 Next.js + shadcn/ui** — 不是要追求最新，而是要一人全栈高效开发。shadcn/ui 代码复制模式避免了组件库升级的绑架风险。
3. **存储用 SQLite + Drizzle ORM** — 这是本地 npm 服务的正式零运维架构；通过精确索引、SQLite 聚合和 forward-only migration 持续扩展。
4. **终端方案可行但需要 POC** — xterm.js + WebSocket + IPC + Session Server + node-pty 为当前唯一链路。必须验证 Gateway 重启恢复、daemon 丢失对账和浏览器背压；历史 POC 不代表新链路已验收。
5. **MVP 先打透 Claude Code** — 不三端同时做。Claude Code 适配器跑通后，OpenCode 和 Codex 只是接口适配问题。
6. **认证 + 数据模型是 Day 1 前置任务** — 不确认这两个，所有业务模块的开发都会返工。
7. **工时实际 22-28 天** — PRD 的 17-20 天偏乐观，主要遗漏了 POC 时间、前端页面时间和联调时间。

---

_毕方 🏗️ | 观全局而建 | 2026-04-24_


### Session Server v2 cutover (2026-09-10)

The terminal runtime uses IPC protocol v2 and v2 socket, named-pipe and token names. No v1 discovery, adoption or fallback is supported. Retire old daemon sessions explicitly before cutover; a stopped CLI is never silently recreated. Database/API historical field names do not select a runtime.
