# OpenForge — 技术架构设计

> 版本：v1.1 | 2026-04-24
> 作者：毕方 🏗️
> 状态：已确认（盘古拍板）
> 评审前置：基于 PRD-v1.1-MVP.md + PRD-REVIEW-v1.1.md
> 2026-04-26 补充：MVP-0 执行以 Claude Code 本地控制闭环和风险 Gate 为优先，分层与风险 Gate 规则见下文「零点五、MVP-0 架构契约」与 `docs/PRD-v1.1-MVP.md` 的「零、MVP-0 硬范围」。

---

## 零点五、MVP-0 架构契约（2026-04-26）

本节为 MVP-0 实现前必须遵守的架构契约。

### 0.5.1 Session Launch Contract

Gateway 必须创建真实会话，不允许只验证手工创建的 tmux attach 路径。

启动链路：

1. Web 发起创建 session 请求。
2. Gateway 校验 JWT、项目归属、凭据模式、项目路径。
3. Gateway 使用 `safeResolve` 和 realpath 校验工作目录。
4. Claude adapter 返回结构化 launch plan。
5. Gateway 创建 `of-{user_id_short}-{session_id_short}` tmux session。
6. Gateway 使用 `tmux new-session -e KEY=value` 注入环境变量。
7. Claude Code 在 tmux session 内启动。
8. 浏览器连接 `/ws/terminal/:sessionId`。
9. Gateway 校验 WebSocket 认证和 session 归属，用 node-pty attach 到 tmux。
10. xterm.js ↔ WebSocket ↔ node-pty ↔ tmux ↔ Claude Code 传输终端 I/O。

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
- secret 值只允许在 tmux 创建时通过 `-e` 注入。
- 日志允许记录 env name，禁止记录 env value。

### 0.5.3 Credential Policy

MVP-0 支持两种明确模式：

| 模式 | 说明 | 要求 |
|------|------|------|
| `stored_encrypted_key` | API key 加密存储在 SQLite | Gateway 内存解密，只通过 tmux `-e` 注入 |
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
- OpenForge 数据库目录
- OpenForge 备份目录（备份服务自身写入除外）

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
- backup path 必须位于 OpenForge 控制的备份目录。
- 部分写入失败必须自动 rollback。
- rollback 失败必须返回需人工检查的文件列表。
- 导入已有项目时，项目记录创建和配置生成是两个阶段。配置生成可以作为 Web 侧 best-effort 后续步骤执行；若配置冲突，项目记录仍然有效，UI 必须提示用户进入预览/冲突处理流程。

### 0.5.6 MVP-0 Risk Gates

| Gate | 通过条件摘要 |
|------|--------------|
| Gate A Terminal Feasibility | Gateway 创建 tmux + Claude Code，浏览器终端可交互，浏览器/Gateway 重启后可恢复，orphan tmux 可清理 |
| Gate B Config Contract | RenderPlan/ConflictReport/WriteResult/RollbackResult 可用且测试覆盖 dry-run/冲突/回滚/路径安全 |
| Gate C Security Baseline | API key 加密、日志脱敏、路径边界、WebSocket auth/ownership/限流、API envelope 冲突已修复 |
| Gate D MVP-0 Acceptance | A/B/C 已通过，5 分钟闭环可演示，核心验证命令已运行或记录跳过原因 |

### 0.5.7 Project Manager Agent Execution Contract（2026-08-12）

Project Manager Agent 采用持久化控制循环，而不是用一次 Copilot 对话或长驻模型调用充当执行状态机。

```text
Project goal / work item
  -> task attempt (desired state + observed state)
  -> session assignment (lease + adapter capability snapshot)
  -> semantic command
  -> SessionWorkerAdapter
  -> CLI session managed by tmux
  -> normalized lifecycle event
  -> evaluator + acceptance result
```

架构约束：

- task attempt、session assignment、command、wakeup 和 acceptance result 是执行事实源；Copilot conversation、Web 本地状态和 ledger event 只提供交互或审计投影。
- Controller 必须通过幂等 reconcile 推进状态。外部副作用采用 command-first、稳定 idempotency key 和 assignment lease，重复或乱序事件不得重复创建 session 或提交任务。
- Controller 只调用 `SessionWorkerAdapter` 的准备、启动、分派、跟进、打断、权限响应和观测接口，不直接拼接 tmux 字符输入。
- adapter 必须显式报告结构化 turn、权限事件、完成事件、interrupt、resume、terminal fallback 和证据提取能力；降级能力不得伪装成完整支持。
- Task Packet 的 prepare 不启动 CLI、不发送输入；dispatch 只有在 capability、policy、lease、payload digest 和 session readiness 校验通过后才能执行。
- 所有副作用必须经过服务器端 Action Policy。默认策略为 `observe`；有期限的项目 `operate` 只允许明确列出的低风险可逆动作；删除、密钥、权限扩大、外部发布、跨项目操作和 raw shell 始终审批或拒绝。
- CLI 的完成声明只产生 completion candidate。工作项进入 `done` 前必须有 accepted 或 verified acceptance result。
- tmux 继续作为进程持久层和 terminal fallback。SQLite 只保存结构化状态、摘要、哈希、证据引用和审计，不保存完整终端日志。
- `OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED` 默认 `false`，只有显式设置为字符串 `true` 才允许未来的自动 dispatch runner；无效布尔值必须使 Gateway 启动校验失败。

## 零、架构总览

### 架构模式

```
┌──────────────────────────────────────────────┐
│                  Browser                     │
│  ┌────────────────────────────────────────┐  │
│  │  Next.js SPA (App Router)              │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │  │
│  │  │项目  │ │会话  │ │Agent │ │模板  │  │  │
│  │  │管理  │ │管理  │ │管理  │ │管理  │  │  │
│  │  └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘  │  │
│  └─────┼────────┼────────┼────────┼───────┘  │
│        │ HTTP   │  WS    │  WS    │ HTTP     │
└────────┼────────┼────────┼────────┼──────────┘
         │        │        │        │
┌────────▼────────▼────────▼────────▼──────────┐
│          OpenForge Gateway (Node.js)         │
│                                              │
│  ┌──────────┐  ┌──────────────────────────┐  │
│  │ REST API │  │ WebSocket Hub            │  │
│  │ (Express)│  │ (ws)                     │  │
│  └────┬─────┘  └────────┬─────────────────┘  │
│       │                 │                     │
│  ┌────▼─────────────────▼──────────────────┐  │
│  │         Core Engine Layer               │  │
│  │  ┌──────────┐ ┌──────────────────────┐  │  │
│  │  │ Config   │ │ Session Manager      │  │  │
│  │  │ Generator│ │ (tmux + node-pty)    │  │  │
│  │  └──────────┘ └──────────────────────┘  │  │
│  │  ┌──────────┐ ┌──────────────────────┐  │  │
│  │  │ Project  │ │ Terminal Proxy       │  │  │
│  │  │ Scanner  │ │ (xterm stream)       │  │  │
│  │  └──────────┘ └──────────────────────┘  │  │
│  └─────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────┐  │
│  │  Data Layer (better-sqlite3)            │  │
│  │  SQLite: users, projects, sessions,     │  │
│  │  agents, skills, templates, models      │  │
│  └─────────────────────────────────────────┘  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  AI CLI Adapters                         │  │
│  │  ┌──────────┐ ┌─────────┐ ┌──────────┐  │  │
│  │  │claude    │ │openCode │ │codex     │  │  │
│  │  │adapter   │ │adapter  │ │adapter   │  │  │
│  │  └──────────┘ └─────────┘ └──────────┘  │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
         │                    │
    ┌────▼────┐          ┌────▼────┐
    │ tmux    │          │ AI CLI  │
    │ sessions│          │ process │
    └─────────┘          └─────────┘
```

### 部署拓扑

```
单机部署（MVP）：
┌─────────────────────────────────────┐
│  用户机器 / 开发服务器               │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  openforge gateway (后台)    │   │
│  │  ├── HTTP (端口 3000)       │   │
│  │  ├── WebSocket (端口 3000)   │   │
│  │  └── SQLite (本地文件)      │   │
│  └─────────────┬───────────────┘   │
│                │                    │
│  ┌─────────────▼───────────────┐   │
│  │  tmux sessions (用户级)      │   │
│  │  ├── claude-session-1       │   │
│  │  ├── claude-session-2       │   │
│  │  └── codex-session-1        │   │
│  └─────────────────────────────┘   │
│                                     │
│  浏览器 ←── http://localhost:3000   │
└─────────────────────────────────────┘
```

---

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
> Next.js 的 API Routes 适合轻量 CRUD，但 Gateway 需要长连接 WebSocket、pty 进程管理、tmux 生命周期控制——这些是常驻后台服务的职责。Express 作为独立 Gateway 更清晰，部署也更简单（`node dist/server.js` 一行启动）。前端 Next.js 纯做 SPA，通过 API 调用 Gateway。

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

### 1.3 终端方案：**xterm.js + WebSocket + node-pty + tmux**

**架构链路：**
```
浏览器 xterm.js ←── WebSocket ──→ Gateway node-pty ←── pty ──→ tmux ←── AI CLI
```

**可行性评估：**

| 关注点 | 方案 | 可行性 |
|--------|------|--------|
| 终端渲染 | xterm.js | ✅ 成熟，VS Code / GitHub Codespaces 同款 |
| 数据传输 | WebSocket (ws) | ✅ 双向实时，适合终端 I/O |
| pty 分配 | node-pty | ✅ VS Code 底层，百万级验证 |
| 会话持久化 | tmux | ✅ 断线重连天然支持 |
| 断线重连 | tmux attach + xterm 状态恢复 | ✅ tmux 保活，xterm 重建时恢复滚动 |
| 多路复用 | 每个终端一个 WebSocket 连接 | ✅ 简单可靠 |

**核心风险点：断线重连**
- Web 端断开 → WebSocket 关闭 → xterm.js 停止渲染
- tmux 会话继续运行（不受影响）
- 重新连接 → 新 WebSocket → 新 xterm.js 实例 → `tmux attach -t <session>` → 恢复终端状态
- **关键：** xterm.js 断线前的滚动缓冲区会丢失，但 tmux 的 scrollback 历史可保留（通过 `tmux capture-pane` 获取）

**结论：可行，但需要 POC 验证。**

### 1.4 存储：**SQLite**

**SQLite 是否够用？** — MVP 阶段完全够用。

| 维度 | 评估 |
|------|------|
| 并发 | Gateway 单进程，better-sqlite3 同步读写，无并发冲突 |
| 数据量 | MVP 预期：用户 < 100，项目 < 500/用户，会话 < 50/用户 → 总计 < 50MB |
| 可靠性 | WAL 模式 + journal，崩溃安全 |
| 备份 | 直接复制 .db 文件 |
| 扩展性 | 用户量 > 1000 时可迁移到 PostgreSQL（ORM 兼容） |

**选择理由：**
- **零运维** — 不需要安装、配置、监控额外服务
- **一键部署** — 符合 "npm install + 一键启动" 的目标
- **性能足够** — better-sqlite3 比 node-sqlite3 快 5-10x
- **迁移成本低** — 使用 `drizzle-orm` 或 `kysely`，后续迁移到 PostgreSQL 只需改连接字符串

**具体选型：Drizzle ORM**
- TypeScript 原生，类型推导
- 支持 SQLite + PostgreSQL（平滑迁移）
- 迁移工具内置
- 比 Prisma 轻量（启动快 3 倍）

### 1.5 部署方式：**npm install + 一键启动**

```bash
# 安装
npm install -g @openforge/gateway

# 一键启动（自动完成以下动作）
openforge start

# openforge start 内部流程：
# 1. 检查 node-pty 编译依赖（已 prebuild，无需编译）
# 2. 检查 tmux 是否安装，未安装则提示
# 3. 初始化 SQLite 数据库（首次运行自动迁移）
# 4. 启动 Gateway 服务（后台进程）
# 5. 自动打开浏览器 → http://localhost:3000

# 停止
openforge stop

# 查看状态
openforge status
```

**外部依赖清单：**

| 依赖 | 必要性 | 说明 |
|------|--------|------|
| Node.js ≥ 20 | ✅ 必须 | 运行环境 |
| tmux ≥ 3.2 | ✅ 必须 | 会话持久化 |
| npm/pnpm/yarn | ✅ 必须 | 包管理 |
| gcc/g++/make | ⚠️ 首次安装 | 仅用于编译 node-pty（prebuild 可跳过） |
| Python | ❌ 不需要 | 仅 node-gyp 编译时用，非运行时依赖 |

**打包策略：**
- Gateway 作为 npm 全局包发布（`@openforge/gateway`）
- `bin` 字段注册 `openforge` 命令
- 使用 `pkg` 或 `nexe` 可选打包为单二进制文件（降低 Node.js 版本要求）
- SQLite 数据库文件存储在 `~/.openforge/openforge.db`

---

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
    tmux_session  TEXT,                                -- tmux 会话名
    working_dir   TEXT NOT NULL,                       -- 工作目录（通常 = project.path）
    last_active   TEXT,                                -- 最后活跃时间
    error_message TEXT,                                -- 错误信息
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user_project ON sessions(user_id, project_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- terminal_logs 表已废弃（2026-04-24 架构评审确认删除）
-- 理由：终端输出不持久化到数据库，断线恢复通过 tmux capture-pane 实时获取。
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
| 会话层 | tmux 会话命名隔离 | tmux session 命名格式：`of-{user_id}-{session_id}` |
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
- Gateway 以普通用户身份运行，不碰 `root` 权限
- 文件系统访问限制在项目路径内（通过 `path.resolve` + 路径前缀校验）
- API Key 加密存储（AES-256-GCM），密钥从环境变量 `OPENFORGE_MASTER_KEY` 读取

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
| POST | `/api/v1/auth/register` | 注册 | `{ username, email, password }` |
| POST | `/api/v1/auth/login` | 登录 | `{ email, password }` → 返回 JWT |
| POST | `/api/v1/auth/logout` | 登出 | — |
| GET | `/api/v1/auth/me` | 当前用户信息 | — |

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
| POST | `/api/v1/sessions` | 创建会话 | `{ project_id, ai_tool, model_id, name }` |
| GET | `/api/v1/sessions/:id` | 会话详情 | — |
| POST | `/api/v1/sessions/:id/start` | 启动会话 | — |
| POST | `/api/v1/sessions/:id/stop` | 停止会话 | — |
| POST | `/api/v1/sessions/:id/switch-model` | 切换模型 | `{ model_id }` |

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

| Method | Path | 描述 | 请求体 |
|--------|------|------|--------|
| GET | `/api/v1/models` | 模型列表 | — |
| POST | `/api/v1/models` | 添加模型 | `{ name, provider, model_id, endpoint, api_key }` |
| PUT | `/api/v1/models/:id` | 更新模型 | `{ name, endpoint, ... }` |
| DELETE | `/api/v1/models/:id` | 删除模型 | — |
| POST | `/api/v1/models/:id/set-default` | 设为默认 | — |
| GET | `/api/v1/api-keys` | API Key 列表 | — |
| POST | `/api/v1/api-keys` | 添加 API Key | `{ provider, name, plaintextKey }` |
| POST | `/api/v1/api-keys/:id/rotate` | 轮换 API Key | `{ plaintextKey }` |
| DELETE | `/api/v1/api-keys/:id` | 删除 API Key | — |

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
│  │ Session      │───▶│  tmux session            │  │
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

### 4.2 子进程管理方案 — 方案 A（已选定）

**选定方案：tmux 托管子进程，node-pty spawn `tmux attach -t <session>`**

#### 方案对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| Gateway 直接 spawn 子进程 | 简单 | ❌ Gateway 重启 = 所有 CLI 进程丢失 | ⭐ |
| **tmux 托管子进程（方案 A）** | ✅ Gateway 重启不影响 CLI<br>✅ 天然支持断线重连 | ⚠️ 需要 tmux 依赖 | ⭐⭐⭐⭐⭐ **已选定** |
| systemd 管理 | 最稳定 | ❌ 复杂度高，不适合 MVP | ⭐⭐ |

**推荐：tmux 托管子进程（非直接子进程）**

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| Gateway 直接 spawn 子进程 | 简单 | ❌ Gateway 重启 = 所有 CLI 进程丢失 | ⭐ |
| **tmux 托管子进程** | ✅ Gateway 重启不影响 CLI<br>✅ 天然支持断线重连 | ⚠️ 需要 tmux 依赖 | ⭐⭐⭐⭐⭐ |
| systemd 管理 | 最稳定 | ❌ 复杂度高，不适合 MVP | ⭐⭐ |

**tmux 会话命名规范：**
```
of-{user_id_short}-{session_id_short}
例: of-a1b2c3d4-e5f6a7b8
```

**会话生命周期：**

```
1. 创建会话
   → Gateway: tmux new-session -d -s of-{user}-{session} -c {working_dir}
   → 注入环境变量（API Key 等）
   → 启动 AI CLI: tmux send-keys -t {session} "claude" Enter

2. 监控状态
   → 定时检查: tmux list-sessions | grep of-{user}-{session}
   → 检查进程: tmux list-panes -t {session} -F '#{pane_pid}'
   → 状态推断: 进程存在=running, 不存在=stopped

3. 停止会话
   → tmux kill-session -t of-{user}-{session}
   → 清理数据库状态

4. 断线恢复
   → 用户重连 → Gateway 检查 tmux session 是否存在
   → 存在 → 新 WebSocket attach 到现有 pty
   → 不存在 → 提示用户重新创建
```

### 4.3 终端连接方案 — 方案 A（已选定）

**核心方案：node-pty spawn `tmux attach -t <session>`**

```typescript
// SessionManager.createSession()
const pty = nodePty.spawn('tmux', ['attach', '-t', sessionName], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: workingDir,
  env: { ...process.env, ...sessionEnv }  // 注入 API Key 等环境变量（变体方案 D）
});
```

**方案对比：**

| 关注点 | 方案 A（node-pty + tmux attach） | 方案 B（node-pty + 直接 CLI） |
|--------|---------------------------------|------------------------------|
| 断线重连 | ✅ tmux 保活，重连即 attach | ❌ pty 关闭 = 进程终止 |
| Gateway 重启 | ✅ tmux 会话独立存活 | ❌ 所有 CLI 进程丢失 |
| 滚动历史 | ✅ tmux 自带 scrollback | ❌ 无历史 |
| 嵌套 pty | ✅ node-pty master → tmux → CLI pty，成熟稳定 | — |
| 运维复杂度 | ⚠️ 需 tmux 依赖 | ✅ 零额外依赖 |

**嵌套 pty 可行性分析：**
```
嵌套层级：
  node-pty master（由 node-pty 创建）
    └── tmux client（tmux attach -t xxx）
        └── tmux server（后台守护进程）
            └── tmux pane pty（tmux 内部创建的 pty）
                └── AI CLI（claude/opencode/codex）

关键问题：pty 嵌套是否会引入额外的转义/编码问题？

结论：不会。tmux attach 本身设计用于远程终端场景，它通过 tmux
client-server 协议通信，不是 pty 桥接。node-pty 只感知到
tmux attach 这一个子进程，tmux 内部的多层 pty 管理对 node-pty
完全透明。
```

数据流：
```
浏览器输入 → WebSocket → node-pty master write()
  → tmux client stdin → tmux server → tmux pane pty → AI CLI

AI CLI stdout → tmux pane pty → tmux server → tmux client stdout
  → node-pty on('data') → WebSocket → xterm.js 渲染
```

**已知风险点：**
1. **tmux 嵌套检测**：tmux attach 默认会检测是否嵌套运行，需清除 `TMUX` 环境变量（`TMUX=`）避免 "sessions should be nested with care" 错误。
2. **窗口大小调整延迟**：node-pty resize() → SIGWINCH → tmux client → tmux server → pane resize，链路存在 ~10-50ms 延迟，实际使用中无感知。
3. **字符编码**：tmux 渲染后的纯文本输出可能丢失 ANSI 颜色码，需要确认 `capture-pane -e` 选项保留 escape 序列。

### 4.4 变体方案 D — tmux 环境变量注入（无需中间 bash）

**方案说明：** 利用 `tmux new-session -d -s xxx -e` 直接注入环境变量，无需通过中间 bash 脚本包装。
```bash
# 推荐方案：直接注入环境变量
tmux new-session -d -s of-{user}-{session} \
  -c {working_dir} \
  -e ANTHROPIC_API_KEY="xxx" \
  -e OPENAI_API_KEY="yyy" \
  claude

# 会话运行期间动态注入（适用于 API Key 轮换）
tmux set-environment -t of-{user}-{session} MY_KEY "value"
```

**废弃的中间 bash 方案：**
```bash
# 废弃：需要中间 bash，增加一层进程管理复杂度
tmux new-session -d -s xxx "bash -c 'export KEY=xxx && claude'"
```

**方案 D 优势：**
| 优势 | 说明 |
|------|------|
| 无中间进程 | 不产生多余 bash 子进程，tmux pane 直接运行 AI CLI |
| 信号传递正确 | SIGINT/SIGTERM 直接到达 AI CLI，不需要 bash 转发 |
| 退出状态准确 | AI CLI 退出码直接反映，不经过 bash 包装层扭曲 |
| 简洁安全 | 环境变量通过 tmux 内部机制传递，不经过 shell 解析，无注入风险 |
| 动态更新 | `tmux set-environment` 支持运行时调整（适用于 Key 轮换） |

**注意事项：**
- tmux `-e` 在 3.2+ 版本完全支持，需确保 tmux ≥ 3.2
- 建议使用 `-E` 清除默认环境 + 逐条 `-e` 注入，确保最小权限：
  `tmux new-session -d -s xxx -E -c {dir} -e PATH="/usr/local/bin:/usr/bin" -e KEY="xxx" claude`

### 4.5 终端 I/O 转发方案（方案 A 落地）
**数据流：**
```
浏览器 xterm.js
    │
    │ WebSocket (UTF-8 文本帧)
    ▼
Gateway WebSocket Server
    │
    │ node-pty.write(data)  ← 键盘输入  [方案 A: tmux attach]
    │ node-pty.on('data')   → 终端输出   [tmux client stdout]
    ▼
node-pty (伪终端 — 连接到 tmux attach)
    │
    │ pty ↔ tmux client ↔ tmux server ↔ tmux pane pty
    ▼
AI CLI 进程 (claude/opencode/codex)
```
**关键技术点：**

1. **输入转发（浏览器 → CLI）：**
   ```typescript
   ws.on('message', (msg) => {
     const { type, payload } = JSON.parse(msg);
     if (type === 'terminal_input') {
       ptyProcess.write(payload.data);  // 发送到 pty master
     }
   });
   ```

2. **输出转发（CLI → 浏览器）：**
   ```typescript
   ptyProcess.on('data', (data) => {
     ws.send(JSON.stringify({
       type: 'terminal_output',
       payload: { data }  // 终端原始输出（tmux 渲染后的纯文本）
     }));
   });
   ```

3. **窗口大小调整：**
   ```typescript
   ws.on('message', (msg) => {
     if (type === 'terminal_resize') {
       ptyProcess.resize(payload.cols, payload.rows);
       // node-pty → SIGWINCH → tmux client → tmux server → pane resize
     }
   });
   ```

4. **断线重连恢复（capture-pane）：**
   ```typescript
   // 客户端重连时，获取 tmux 历史缓冲区重建显示
   async function restoreTerminal(sessionId: string): Promise<string> {
     const { stdout } = await execAsync(
       `tmux capture-pane -t of-${sessionId} -p -S -5000`
     );
     return stdout;  // 返回给 xterm.js 恢复显示
   }
   ```

5. **流量控制：**
   - 输出数据按帧发送，每帧最大 64KB（WebSocket 帧大小限制）
   - 输出频率限制：最多 60 帧/秒（匹配典型终端刷新率）
   - 背压处理：如果 WebSocket 缓冲区积压 > 1MB，暂停 pty 读取
   - **终端输入频率限制**：50 次/秒（防恶意快速输入拖垮 pty）
   - **互踢机制**：单终端 session 只允许一个活跃 WebSocket 连接，新连接建立时踢出旧连接（§4.6.3 详细设计）

### 4.6 架构建议与补充设计（2026-04-24 评审补充）

#### 4.6.1 `tmux capture-pane` 限制与应对

| 限制 | 影响 | 应对方案 |
|------|------|----------|
| **默认 2000 行上限** | 历史输出超过 2000 行时，最早的部分会被丢弃 | 启动时配置 `set-option -t <session> history-limit 10000`，将缓冲区扩展到 10000 行 |
| **ANSI 转义丢失** | 纯文本模式下颜色码、超链接等富文本信息丢失 | 使用 `capture-pane -e` 保留 escape 序列；浏览器端用 `xterm.js` 的 `write()` 还原 |
| **截断宽字符** | CJK 双宽字符可能截断错位 | 设置 `TERM=xterm-256color` + 确保 pty cols ≥ 120；前端 `xterm.js` 使用 `allowProposedApi: true` 处理 Unicode |
| **性能瓶颈** | 大量并发重连时 `execAsync` 调用 `capture-pane` 产生进程开销 | ① 限制单次恢复行数（默认 500 行） ② 使用 `debounce` 合并短时间内的多次重连 ③ 缓存最后一次 capture 结果，10s 内重复重连直接返回缓存 |

**最佳实践：**
```typescript
// 断线重连恢复 — 控制边界版
async function restoreTerminal(sessionId: string, options?: { maxLines?: number }): Promise<string> {
  const maxLines = options?.maxLines ?? 500;
  const { stdout } = await execAsync(
    `tmux capture-pane -t of-${sessionId} -p -e -S -${maxLines}`
  );
  // 截断过长输出（安全兜底）
  if (stdout.length > 64 * 1024) {
    return stdout.slice(-64 * 1024);
  }
  return stdout;
}
```

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
| B3 终端 POC | 朱雀 | 3 天 | node-pty + tmux + xterm.js 全链路验证 |

> **POC 验收标准：** 能通过浏览器 xterm.js 操作 tmux 中的 `claude` 命令，断线重连后终端状态可恢复。

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
- [ ] tmux session 创建/attach/kill 正常
- [ ] xterm.js + WebSocket + node-pty 数据流打通
- [ ] 断线重连后终端状态恢复（通过 `tmux capture-pane`）
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
| 2 | **tmux 会话泄漏** | 停止会话后 tmux 进程残留，占用资源 | 高 | 🟡 严重 | ① 所有 tmux 操作封装在 SessionManager 中，确保 create/destroy 配对 ② 定时巡检：每 5 分钟扫描孤立 tmux session 并清理 ③ Gateway 启动时清理上一次残留的 `of-*` 会话 |
| 3 | **WebSocket 连接不稳定** | 终端卡顿、断连，用户体验差 | 高 | 🟡 严重 | ① 客户端自动重连（指数退避：1s → 2s → 4s → 8s → 最大 30s） ② tmux 保活：WebSocket 断连不影响 CLI 运行 ③ 重连后通过 `tmux capture-pane` 恢复终端显示 |
| 4 | **API Key 安全存储** | 密钥泄露 → 资损 | 低 | 🔴 致命 | ① AES-256-GCM 加密，密钥来自环境变量 `OPENFORGE_MASTER_KEY` ② 不在日志中打印密钥 ③ 内存中解密后通过环境变量注入 CLI 进程 ④ 支持 API Key 轮换 |
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
     - 用户通过 tmux attach 手动连接
```

#### 风险 2：tmux 会话泄漏

```
根因：Gateway 异常退出时未清理 tmux session

防护层：
  1. 进程级：使用 SIGTERM 处理函数，优雅关闭所有 tmux session
  2. 定时巡检：setInterval(() => cleanupOrphanSessions(), 5 * 60 * 1000)
  3. 启动时清理：启动时扫描所有 of-{user_id}-* 会话，对比数据库中的活跃会话，清理孤儿
  4. 命名规范：所有 OpenForge 管理的 tmux session 以 of- 开头，便于识别和清理
```

#### 风险 3：WebSocket 连接不稳定

```
客户端重连策略：
  - 第 1 次：1 秒后重连
  - 第 2 次：2 秒后重连
  - 第 3 次：4 秒后重连
  - ...
  - 最大间隔：30 秒
  - 最大重试次数：无限（直到用户手动关闭页面）

服务端保活：
  - ping/pong 心跳间隔：30 秒
  - 超时判定：90 秒无心跳视为断连
  - 断连后不关闭 pty（tmux 保活）

重连恢复：
  - 获取 tmux 最近 N 行输出
  - 通过 xterm.write() 恢复显示
  - 用户看到的终端状态基本无感知
```

#### 风险 4：API Key 安全存储

```
加密方案：
  - 算法：AES-256-GCM（替代 CBC，增加认证标签防篡改）
  - 密钥：OPENFORGE_MASTER_KEY 环境变量（推荐 64 字符 hex）
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
openforge/
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
│   │   │   │   ├── session-manager.ts   # 会话管理（tmux）
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
3. Drizzle ORM：TypeScript 原生，支持 SQLite 和 PostgreSQL（平滑迁移路径）
4. 性能：MVP 阶段（< 500 项目，< 5000 会话）完全够用

**被否决方案：**
- **PostgreSQL：** 需要额外部署和运维，不符合 MVP 的一键启动目标
- **Prisma：** 启动慢（冷启动 2-3 秒），对 CLI 工具不友好

**后果：**
- ✅ 部署简单，`npm install` 即
- ✅ 迁移到 PostgreSQL 时只需改连接字符串（Drizzle 支持）
- ⚠️ SQLite 不支持并发写入，但 Gateway 单进程无此问题
- ⚠️ 如果未来需要多实例部署（水平扩展），需要迁移到 PostgreSQL

---

### ADR-004: 会话管理使用 tmux 而非直接子进程

- **状态：** 提议
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
| `OPENFORGE_PORT` | ❌ | 3000 | Gateway HTTP/WS 端口 |
| `OPENFORGE_DB_PATH` | ❌ | `~/.openforge/openforge.db` | SQLite 数据库路径 |
| `OPENFORGE_MASTER_KEY` | ✅ | — | AES 加密密钥（推荐 64 字符 hex） |
| `OPENFORGE_JWT_SECRET` | ✅ | — | JWT 签名密钥 |
| `OPENFORGE_LOG_LEVEL` | ❌ | info | 日志级别 |
| `OPENFORGE_TMUX_PREFIX` | ❌ | of- | tmux 会话名前缀 |

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
3. **存储用 SQLite + Drizzle ORM** — MVP 零运维，后续可平滑迁移到 PostgreSQL。
4. **终端方案可行但需要 POC** — xterm.js + WebSocket + node-pty + tmux 链路清晰，断线重连通过 tmux 天然支持。**Day 1-3 必须完成 POC，POC 不通过则整体方案需要调整。**
5. **MVP 先打透 Claude Code** — 不三端同时做。Claude Code 适配器跑通后，OpenCode 和 Codex 只是接口适配问题。
6. **认证 + 数据模型是 Day 1 前置任务** — 不确认这两个，所有业务模块的开发都会返工。
7. **工时实际 22-28 天** — PRD 的 17-20 天偏乐观，主要遗漏了 POC 时间、前端页面时间和联调时间。

---

_毕方 🏗️ | 观全局而建 | 2026-04-24_
