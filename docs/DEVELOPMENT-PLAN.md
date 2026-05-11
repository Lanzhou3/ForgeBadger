# OpenForge MVP 开发计划

> 版本：v1.1 | 2026-04-24
> 修订人：朱雀 🛠️（基于三方评审结论 + 盘古拍板）
> 制定人：毕方 🏗️
> 状态：local-first MVP 已进入 beta feedback ready；Phase A/Phase B 验收证据已闭合，真实 Windows/WSL 验收仍保留平台 caveat
> 基于文档：PRD-v1.1-MVP.md + PRD-REVIEW-v1.1.md + TECH-ARCHITECTURE.md
> 2026-04-26 补充：执行时以 `docs/superpowers/specs/2026-04-26-mvp-scope-risk-gates-design.md` 的 MVP-0/MVP-1 分层和风险 Gate 为准。
> 2026-04-29 补充：MVP-0 Gate D 已通过，验收证据见 `docs/reports/gate-d-mvp0-acceptance-2026-04-29.md`；MVP-1 任务列表见 `docs/MVP-1-TASKS.md`。
> 2026-04-30 补充：MVP-2 任务列表见 `docs/MVP-2-TASKS.md`，通知中心、模板导入导出/版本历史、模型预设/分组、外部端点健康检查、Skill 来源管理、Claude Code 插件管理、OpenCode/Codex adapter 发现原型已完成。
> 2026-05-02 补充：MVP-3 任务列表见 `docs/MVP-3-TASKS.md`；服务端通知持久化、跨设备同步、浏览器通知、Agent/Session 活动流和受门控的 Claude/OpenCode/Codex 多适配器启动已完成，下一步进入远程 Skill/插件市场、会话历史快照和使用统计。
> 2026-05-02 补充：MVP-4 任务列表见 `docs/MVP-4-TASKS.md`；Claude Code 本地 Skill/插件命令发现与显式重扫、默认模板、权限通知 HTTP hook、插件物化、模板同步、角色可见性和审计可见性已完成。MVP-5 任务列表见 `docs/MVP-5-TASKS.md`；管理员成员/角色管理、Agent 快速创建模板、Skill 快速创建模板、项目配置合规报告、模板市场安装、CLI init 原型和 Agent 编排原型已完成。MVP-6 任务列表见 `docs/MVP-6-TASKS.md`；会话历史/快照 UI、使用统计 UI、远程 Skill/插件安装、共享治理 UI、终端效率、发布计划、CI/CD 计划、smoke checklist 和完成度审计已完成。MVP-6 审计发现的补齐项已进入并关闭于 `docs/MVP-7-TASKS.md`。发布相关文档见 `docs/RELEASE-PLAN.md`、`docs/CI-CD-PLAN.md`、`docs/SMOKE-TEST.md`。
> 2026-05-02 补充：MVP-7 任务列表见 `docs/MVP-7-TASKS.md`；项目脚手架补齐、从项目创建模板、直接 Skill 来源安装加固、快照恢复与 Agent 活动过滤、local-first 角色模型 ADR、checked-in CI workflow、API/route smoke 与完成度审计重跑已完成。历史审计曾要求补真实浏览器终端与真实 Claude Code 权限提示 smoke；该缺口已在 2026-05-07 Phase A 验收中闭合。托管协作、云部署、计费、托管市场、自主远程执行、更完整插件 executable/MCP/LSP 执行能力均需另行架构评审。
> 2026-05-05 补充：后续三周迭代已拆分为 `docs/MVP-8-TASKS.md`、`docs/MVP-9-TASKS.md`、`docs/MVP-10-TASKS.md`。MVP-8 聚焦浏览器终端与真实 Claude 权限提示验收证据、smoke harness 和回归门；MVP-9 在完成 MVP-8 release smoke 后推进 Codex app-server guarded control-plane prototype；MVP-10 聚焦 local-first release candidate、beta 反馈和最终验收。当前回归记录见 `docs/reports/regression-2026-05-05.md`。
> 2026-05-06 补充：MVP-8 至 MVP-10 的代码与文档迭代已完成到 user-test ready 状态。新增 repeatable local smoke harness、Codex app-server Gateway 原型、local diagnostics export、npm package build/verify/smoke 记录和 release risk register。最新回归见 `docs/reports/regression-2026-05-06.md`，release-candidate 决策见 `docs/reports/release-candidate-2026-05-06.md`；真实浏览器终端与真实 Claude 权限提示 smoke 进入用户测试清单。
> 2026-05-07 补充：Phase A release evidence 已由真实浏览器终端 smoke 和真实 Claude Code 权限提示 smoke 闭合；Phase B Codex app-server 进入 Gateway 协议集成推进，已补 `initialize`/`thread`/`turn` 路由、managed client、malformed frame 处理、notification activity normalization、Web guarded control-plane surface 和 turn rate limit。当前项目进度记忆见根目录 `MEMORY.md`。
> 2026-05-10 补充：Phase B Codex Background Tasks 已作为 observable control-plane prototype 接受 beta feedback，Web 仍不开放 prompt/turn 输入，`/turn` 默认 403 且仅作为 feature-flag prototype。Provider SSOT 与 Codex subscription boundary 已完成回归，Windows/tmux/WSL 指引已落地；真实 Windows/WSL 主机 smoke 仍为平台 caveat。下一阶段 Phase C 聚焦首次试用、依赖失败态、诊断反馈、CI/release gate 自动化和平台验收闭环，不扩大 Codex turn 输入范围。
> 2026-05-11 补充：SSH/remote execution 独立架构规格已确认，见 `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md`；该方向仍不属于当前 beta release gate 实现范围，当前状态为待拆解实施计划，后续应在单独 feature slice 中开发。
> 2026-05-11 补充：Platform AI Copilot 第一版独立架构规格已确认，见 `docs/superpowers/specs/2026-05-11-platform-ai-copilot-design.md`；实施计划见 `docs/superpowers/plans/2026-05-11-platform-ai-copilot.md`。第一版定位为 provider-backed、read-heavy、approval-gated 的平台操作助手，不开放自主开发、自动 tmux 输入、任意 shell 或 Codex app-server prompt/turn 输入；OpenClaw 参考点已吸收到 provider seam、memory recall、session visibility 和 approval canonical payload 约束中，记忆模块拆为后续独立 PR。当前已完成 provider-backed text runs、Web Copilot 页面、read-only tool registry、approval-gated pending actions 和 diagnostics capability 元数据；后续记忆模块仍按独立 PR 推进。

---

## 零、MVP-0 / MVP-1 执行 Overlay（2026-04-26）

原 26 天计划保留为总体排期参考，但实际执行必须先完成 MVP-0：**Claude Code 本地控制闭环**。

### MVP-0 硬闭环

MVP-0 必须支持用户完成以下链路：

1. 注册/登录。
2. 创建或导入一个本地项目。
3. 选择内置 Claude Code 模板。
4. 生成或注入 `.claude/CLAUDE.md` 和必要配置。
5. 创建项目会话。
6. Gateway 创建 tmux 会话并启动 Claude Code。
7. 浏览器通过 xterm.js + WebSocket 操作该会话。
8. 浏览器刷新或 Gateway 重启后，会话仍可恢复。

### 分层执行

| 层级 | 范围 | 完成标准 |
|------|------|----------|
| MVP-0 | Claude Code 单工具本地控制闭环 | Gate A/B/C/D 全部通过 |
| MVP-1 | Agent/Skill/Template/Model/Dashboard 管理面扩展 | MVP-0 通过后再展开 |
| P2 | 团队协作、市场、费用统计、历史快照 | 不进入首轮实现 |

### 硬性风险 Gate

| Gate | 名称 | 触发时机 | 阻塞规则 |
|------|------|----------|----------|
| Gate A | Terminal Feasibility | 管理面大规模开发前 | 未通过则启用外部终端 Plan B，不继续做终端 UI 深功能 |
| Gate B | Config Generation Contract | 项目创建/导入 UI 完整实现前 | 未通过则不做多入口配置写入 |
| Gate C | Security Baseline | 任何携带凭据的会话启动前 | 未通过则禁止启动带凭据的会话 |
| Gate D | MVP-0 Acceptance | MVP-1 开始前 | A/B/C 未通过或闭环未跑通时禁止进入 MVP-1 |

### 当前计划调整

- Phase 0 聚焦认证、数据库、加密、路径安全、终端 POC、前端壳。
- Phase 1 聚焦 Claude adapter、配置生成契约、项目创建/导入、session 创建、终端页。
- Phase 2 才展开 Model、Agent、Skill、Template、Dashboard 管理深度。
- Phase 3 聚焦联调、WebSocket 硬化、文档同步、发布检查。

Agent/Skill/Template/Model 页面可以在 MVP-0 中作为占位或只读视图出现，但不得阻塞控制闭环。

## 一、总体排期

| 阶段 | 时间范围 | 天数 | 范围 | 状态 |
|------|----------|------|------|------|
| **Phase 0** | Day 1-4 | 4 天 | 基础设施层（认证→数据模型→POC→前端框架，**串行**） | 🔴 完全串行 |
| **Phase 1** | Day 5-12 | 8 天 | 核心业务层（项目 + 模型 + 模板） | 🟡 部分可并行 |
| **Phase 2** | Day 13-20 | 8 天 | 扩展功能层（会话 + Agent + Skill + 仪表盘） | 🟡 部分可并行 |
| **Phase 3** | Day 21-26 | 6 天 | 联调测试 + 缓冲 | 🔴 收尾 |
| **总计** | **Day 1-26** | **26 天** | MVP 交付 | ⏱️ 22-28 天约束内 |

### 甘特图式排期表

```
Day  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26
     │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │
P0   ├───────────────────────────────┤
     │ 认证(1-2) → 数据模型(1-2)     │
     │ → POC(2.5-3.5) → 前端框架(4) │
     └───────────────────────────────┘
                                     │
P1                                   ├─────────────────────────────────────┤
                                     │ A 项目管理 │ H 模型管理 │ E 模板     │
                                     │ (含前端)   │ (含前端)   │ (含前端)   │
                                     └─────────────────────────────────────┘
                                                                       │
P2                                                                     ├───────────────────────────────────────┤
                                                                       │ B 会话  │ C Agent │ D Skill │ G 仪表盘 │
                                                                       │ + 终端  │ + 前端  │ + 前端  │ + 联调  │
                                                                       └───────────────────────────────────────┘
                                                                                                              │
P3                                                                                                            ├──────────┤
                                                                                                              │ 联调+缓冲│
                                                                                                              └──────────┘

关键路径（不可并行）: Day 1-4 (P0 串行基础设施) → Day 5-8 (A 项目管理) → Day 13-17 (B 会话+终端) → Day 21-26 (联调+缓冲)
```

---

## 二、里程碑

| 里程碑 | 时间 | 交付物 | 验收标准 | 检查方式 |
|--------|------|--------|----------|----------|
| **M1: 基础设施就绪** | Day 4 | 认证可登录、数据库迁移完成、终端 POC 通过、前端框架就绪 | ① 注册+登录全流程可跑 ② `drizzle-kit generate` + `migrate` 通过 ③ POC 5 项验收全部 ✅ ④ 前端基础框架搭建完成 | 朱雀演示 |
| **M2: 项目管理可用** | Day 9 | 项目创建/导入/配置注入全流程可跑 | ① 创建项目 → 选择模板 → 生成配置 ② 导入已有项目 → 冲突检测 → 注入 ③ 前端页面可操作 | 朱雀演示 |
| **M3: 核心功能可用** | Day 12 | 模型管理 + 模板编辑 + 模板前端就绪 | ① 添加/切换/删除模型 ② 查看/编辑内置模板 ③ 前端路由/布局完整，PC/手机自适应 | 朱雀演示 + 火珂走查 UI |
| **M4: 终端打通** | Day 17 | 会话创建 + 内置终端可操作 | ① 创建会话 → 启动 Claude Code → 终端交互 ② 断线重连 → 终端状态恢复 ③ 会话状态实时监控 | 朱雀演示 |
| **M5: MVP 交付** | Day 26 | 全部 P0 + 高优 P1 功能就绪 | ① 5 分钟完成全流程（登录→创建/导入→会话→编码） ② 核心路径零阻塞 Bug ③ 所有 API 接口通过测试 | 祝融验收 |

---

## 三、POC 任务（Day 2-3.5，最高优先级）

> **方案确认：方案 A** — node-pty spawn 后执行 `tmux attach -t <session>`，非创建新 session 模式。
> POC Day 1 完成方案确认，Day 2-3 完成验证。

### POC 目标

验证终端全链路：**xterm.js + WebSocket + node-pty（方案 A: tmux attach）+ tmux**，确认技术方案可行。

### POC 验收标准（5 项，全部通过才算过）

| # | 验收项 | 验证方法 | 通过标准 |
|---|--------|----------|----------|
| 1 | **node-pty 编译** | `npm install node-pty` + `tsc` 编译 | 零编译错误，`spawn('bash')` 可正常读写 |
| 2 | **tmux 会话管理（方案 A）** | node-pty spawn → `tmux attach -t <session>` | 通过 node-pty 成功 attach 到已有 tmux session，I/O 双向正常 |
| 3 | **终端数据流** | 浏览器 xterm.js → WebSocket → node-pty → tmux → bash | 在浏览器输入 `echo hello`，终端输出 `hello` |
| 4 | **断线重连** | 断开 WebSocket → 重连 → 恢复终端显示 | 重连后通过 `tmux capture-pane` 获取历史，终端内容恢复 |
| 5 | **真实 Claude 交互** | tmux 中启动 Claude Code，发送简单 prompt（如 "Say hello"） | Claude Code 正常响应，输出在浏览器终端可见，确认交互式 CLI 可正常工作 |

### POC 开发计划（串行，接在认证之后）

```
Day 2 上午（0.5 天）
  ├── 搭建 POC 独立项目（最小 Express + ws + node-pty）
  ├── 验证 node-pty 编译和基础 I/O（方案 A：tmux attach）
  └── 验证 tmux session 创建 + node-pty attach

Day 2 下午（0.5 天）
  ├── 搭建最小前端（xterm.js + WebSocket 客户端）
  └── 终端数据流打通（浏览器 ↔ Gateway ↔ pty ↔ tmux ↔ bash）

Day 3 上午（0.5 天）
  ├── 断线重连实现：WebSocket 重连 + tmux capture-pane 恢复
  ├── 窗口大小调整同步
  └── tmux 中启动 Claude Code 并验证真实交互（验收标准 #5）

Day 3 下午（0.5 天）
  ├── 收尾 + 边界情况处理（pty 关闭、tmux 异常退出）
  ├── 编写 POC 验证报告
  └── ✅ POC 验收演示（Day 3 下班前）
```

### POC 失败备用方案

如果 POC 验证不通过（如 node-pty 编译失败或 tmux 断线重连不稳定）：

```
Plan B: 降级方案
  └── "纯 API 模式" — Gateway 保留所有管理功能，终端功能降级为：
      - 前端显示"请使用外部终端操作"
      - 提供 tmux attach 命令给用户复制
      - 保留会话状态管理和监控
      - 标记为 v1.0.1 修复项
```

> **决策规则：** Day 3 下班前必须出 POC 结论。如不通过，Day 4 上午切换到 Plan B，不影响 Day 5 的其他模块开发。

---

## 四、模块详细拆解

### 模块 F：用户认证与多租户（P0）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 0 |
| **时间** | Day 1-2（API 部分），Day 4（前端，接前端框架之后） |
| **负责人** | 朱雀 |
| **前置依赖** | 无（Day 1-2 API 部分）；前端框架就绪（Day 4，前端部分） |
| **功能清单** | F0（登录/注册/多租户隔离） |
| **工时** | 2 天（含前端） |

#### 技术要点

1. **JWT 鉴权** — 登录签发 JWT，后续所有 API 请求携带 Bearer Token
2. **密码加密** — bcrypt（salt rounds = 10），不存明文
3. **多租户隔离** — 所有业务表 `user_id` 外键，API 中间件统一注入 `req.userId`
4. **前端路由守卫** — 未登录重定向到 `/login`，已登录重定向到 `/`
5. **串行说明** — Phase 0 三条线串行：认证（Day 1-2 API）→ 数据模型（Day 1-2）→ POC（Day 2.5-3.5）→ 前端框架（Day 4）

#### 技术方案

| 维度 | 方案 |
|------|------|
| 库 | `jsonwebtoken` (JWT) + `bcrypt` (密码加密) + `zod` (请求校验) |
| 数据表 | `users`、`user_settings` |
| API | `POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`POST /api/v1/auth/logout`、`GET /api/v1/auth/me` |
| 中间件 | `authMiddleware`（解析 JWT → `req.userId`）+ `tenantMiddleware`（注入 user_id 到所有查询） |
| 前端 | `/(auth)/login/page.tsx`、`/(auth)/register/page.tsx` |

#### 子任务拆解

| 子任务 | 工时 | 说明 |
|--------|------|------|
| F0.1 数据库 schema（users 表） | 0.25 天 | Drizzle schema 定义 + 迁移文件 |
| F0.2 注册/登录 API | 0.5 天 | bcrypt 加密 + JWT 签发 + zod 校验 |
| F0.3 认证中间件 | 0.25 天 | JWT 解析 + req.userId 注入 + 未授权拦截 |
| F0.4 前端登录/注册页面 | 0.75 天 | shadcn/ui 表单 + zod 校验 + API 调用 |
| F0.5 路由守卫 + 状态管理 | 0.25 天 | Next.js middleware + React Query 缓存 |

---

### 模块 DB：数据模型与 ORM 搭建（P0）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 0 |
| **时间** | Day 1-2（与认证 **串行**，接在认证 API 之后） |
| **负责人** | 朱雀 |
| **前置依赖** | 认证 API schema 定义完成（F0.1） |
| **功能清单** | 全部 10 张表的 schema 定义 |
| **工时** | 1.5 天 |

#### 技术要点

1. **Drizzle ORM schema** — TypeScript 类型推导，所有字段强类型
2. **迁移管理** — `drizzle-kit` 生成迁移，`migrate` 执行
3. **Repository 模式** — 封装 CRUD，自动注入 `user_id` 过滤
4. **索引优化** — sessions、audit_logs 的查询索引

#### 技术方案

| 维度 | 方案 |
|------|------|
| 库 | `better-sqlite3` + `drizzle-orm` + `drizzle-kit` |
| 数据库 | SQLite WAL 模式，路径 `~/.openforge/openforge.db` |
| 迁移 | `drizzle-kit generate` → `drizzle-kit migrate` |
| 表结构 | 按 TECH-ARCHITECTURE.md 第二章完整表定义 |

#### 子任务拆解

| 子任务 | 工时 | 说明 |
|--------|------|------|
| DB.1 Drizzle schema 定义 | 0.75 天 | 10 张表：users, user_settings, models, api_keys, projects, sessions, agents, skills, project_skills, templates, template_files, audit_logs（~~terminal_logs~~ 不写 SQLite，用 tmux scrollback 替代） |
| DB.2 迁移文件生成和测试 | 0.25 天 | `drizzle-kit generate` → 验证迁移可执行 |
| DB.3 Repository 封装 | 0.5 天 | 通用 BaseRepo（自动 user_id 过滤）+ 各表具体 Repo |

---

### 模块 A：项目初始化 + 导入（P0 + P1）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 1（P0）+ Phase 2（P1） |
| **时间** | P0: Day 5-8, P1: Day 18-19 |
| **负责人** | 朱雀 + 火珂（前端 UI） |
| **前置依赖** | Phase 0 完成（认证 + 数据模型） |
| **功能清单** | P0: A1、A3（Claude）、A4、I1-I4; P1: A2、A5-A9 |
| **工时** | P0: 4 天, P1: 1.5 天 |

#### 技术要点

1. **配置生成引擎** — 模板渲染（Handlebars/字符串替换）→ 多格式输出（.claude/CLAUDE.md 等）
2. **MVP 先打透 Claude Code** — 只实现 `claude.ts` 适配器，`opencode.ts` / `codex.ts` 留 P1
3. **A3↔E3 接口先行** — 模块 A（项目生成）与模块 E（模板管理）的共享接口在 Day 5 先行定义（接口契约），实现阶段可并行推进
4. **项目扫描** — 检测目标目录已有文件，识别 AI 工具类型（.claude/ → Claude, .codex/ → Codex）
5. **冲突检测** — 目标文件已存在时生成冲突报告，用户选择跳过/覆盖/合并
6. **安全回滚** — 注入前自动备份目标目录，失败时自动回滚

#### 技术方案

| 维度 | 方案 |
|------|------|
| 适配器 | `adapters/claude.ts` 实现 `CliAdapter` 接口（TECH-ARCHITECTURE §4.4） |
| 配置生成 | `services/config-generator.ts`：模板文件 → 变量替换 → 写文件 |
| 项目扫描 | `services/project-scanner.ts`：目录扫描 → 文件匹配 → 工具类型识别 |
| 冲突处理 | `services/config-generator.ts`：backup → write → rollback on error |
| 数据表 | `projects` |
| API | `POST /api/v1/projects`、`POST /api/v1/projects/scan`、`POST /api/v1/projects/import`、`POST /api/v1/projects/:id/generate-config` |
| 前端 | `/projects`（列表）、`/projects/new`（创建向导）、`/projects/:id`（详情） |

#### 子任务拆解

| 子任务 | 优先级 | 工时 | 说明 |
|--------|--------|------|------|
| A1.1 Claude Code 适配器 | P0 | 1 天 | `generateConfig`、`scanProject`、`getLaunchCommand` |
| A1.2 配置生成引擎 | P0 | 0.75 天 | 模板渲染 + 冲突检测 + 备份/回滚 |
| A1.3 项目扫描引擎 | P0 | 0.5 天 | 目录扫描 + AI 工具识别 + 缺失文件检测 |
| A1.4 项目创建 API + 前端 | P0 | 1 天 | 向导表单 → API 调用 → 配置生成 |
| A1.5 项目导入 API + 前端 | P0 | 0.75 天 | 扫描 → 冲突报告 → 确认 → 注入 |
| A1.6 内置模板数据 | P0 | 0.5 天 | 内置模板 seed 数据（至少 1 套完整 Harness 模板） |
| A1.7 跨工具配置扩展 | P1 | 1 天 | OpenCode / Codex 适配器（接口适配） |
| A1.8 Rules/Hooks/Skills 注入 | P1 | 0.5 天 | A6-A9 功能 |

---

### 模块 H：模型管理（P0 + P1）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 1（P0）+ Phase 2（P1） |
| **时间** | P0: Day 7-9, P1: Day 17-18 |
| **负责人** | 朱雀 + 火珂（前端 UI） |
| **前置依赖** | Phase 0 完成（认证 + 数据模型） |
| **功能清单** | P0: H1、H2、H3、H5; P1: H4、H6、H8 |
| **工时** | P0: 2.5 天, P1: 1.5 天 |

#### 技术要点

1. **API Key 加密存储** — AES-256-GCM 加密，密钥从 `OPENFORGE_MASTER_KEY` 环境变量读取
2. **环境变量注入** — 启动 CLI 进程时将解密的 API Key 作为环境变量注入（如 `ANTHROPIC_API_KEY`）
3. **模型切换** — 运行时切换模型，无需重启会话
4. **安全红线** — 不在日志、数据库、配置文件中存储明文 Key

#### 技术方案

| 维度 | 方案 |
|------|------|
| 加密 | `crypto` 模块 AES-256-GCM，密钥 = `OPENFORGE_MASTER_KEY`（推荐 64 字符 hex），随机 IV + Auth Tag |
| 数据表 | `models`、`api_keys` |
| API | `GET/POST /api/v1/models`、`PUT/DELETE /api/v1/models/:id`、`POST /api/v1/api-keys`、`POST /api/v1/models/:id/set-default` |
| 前端 | `/models`（列表）、`/models/new`（添加） |

#### 子任务拆解

| 子任务 | 优先级 | 工时 | 说明 |
|--------|--------|------|------|
| H1.1 加密工具模块 | P0 | 0.5 天 | `services/crypto.ts`：encrypt/decrypt AES-256-GCM（IV + Auth Tag 管理） |
| H1.2 模型 CRUD API | P0 | 0.75 天 | 增删改查 + 设为默认 |
| H1.3 API Key 管理 API | P0 | 0.5 天 | 加密存储 + 环境变量注入 |
| H1.4 模型管理前端 | P0 | 0.75 天 | 列表 + 添加/编辑表单 |
| H1.5 模型切换功能 | P0 | 0.25 天 | 会话中切换模型 |
| H1.6 模型分组 + 预设 | P1 | 0.75 天 | 按提供商分组 + 预设组合 |
| H1.7 模型健康检查 | P1 | 0.75 天 | 端点可达性检测 + 延迟测量 |

---

### 模块 E：模板管理（P0 + P1）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 1（P0）+ Phase 2（P1） |
| **时间** | P0: Day 9-12, P1: Day 18-19 |
| **负责人** | 朱雀 + 火珂（前端 UI） |
| **前置依赖** | Phase 0 完成（认证 + 数据模型）；**A3↔E3 接口先行定义**（Day 5 完成接口契约，实现阶段并行推进） |
| **功能清单** | P0: E1、E3; P1: E2、E4、E6、E7 |
| **工时** | P0: 2.5 天, P1: 1.5 天 |

#### 技术要点

1. **模板文件管理** — 一个模板包含多个文件（CLAUDE.md、Agents、Rules、Skills）
2. **在线编辑** — Markdown 编辑器（支持预览），编辑后保存到 `template_files` 表
3. **版本管理** — 模板内容变更时记录版本，支持回滚
4. **内置模板** — MVP 内置至少 1 套完整 Harness 模板（覆盖 CLAUDE.md + Agent 定义 + Rules）

#### 技术方案

| 维度 | 方案 |
|------|------|
| 编辑器 | `react-markdown`（预览）+ `@monaco-editor/react` 或纯 textarea（编辑） |
| 数据表 | `templates`、`template_files` |
| API | `GET /api/v1/templates`、`GET /api/v1/templates/:id`、`PUT /api/v1/templates/:id/files/:filePath`、`GET /api/v1/templates/builtins` |
| 前端 | `/templates`（列表）、`/templates/:id`（详情+编辑） |

#### 子任务拆解

| 子任务 | 优先级 | 工时 | 说明 |
|--------|--------|------|------|
| E1.1 模板列表 API + 前端 | P0 | 0.75 天 | 列表展示 + 搜索/过滤 |
| E1.2 模板详情 API + 前端 | P0 | 0.75 天 | 文件列表 + 内容预览 |
| E1.3 模板文件在线编辑 | P0 | 1 天 | 编辑器 + 保存 + 冲突检测 |
| E1.4 模板创建（从项目） | P1 | 0.5 天 | 从现有项目提取配置生成模板 |
| E1.5 版本管理 | P1 | 0.5 天 | 版本记录 + 回滚 |
| E1.6 模板同步推送 | P1 | 0.5 天 | 批量更新已使用项目 |

---

### 模块 B：会话管理（P0 + P1）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 2（P0 核心）+ Phase 2（P1 扩展） |
| **时间** | P0: Day 13-18, P1: Day 19-20 |
| **负责人** | 朱雀 + 火珂（终端 UI 优化） |
| **前置依赖** | Phase 0（POC 通过）、Phase 1（项目 + 模型） |
| **功能清单** | P0: B1、B2、B3、B5; P1: B4、B6-B9 |
| **工时** | P0: 5 天, P1: 1.5 天 |

#### 技术要点

1. **终端全链路** — 浏览器 xterm.js → WebSocket → Gateway node-pty → tmux → AI CLI
2. **断线重连** — WebSocket 断开 → 指数退避重连 → tmux 保活 → `capture-pane` 恢复显示
3. **tmux 会话生命周期** — 命名规范 `of-{user_short}-{session_short}`，Gateway 重启不影响
4. **会话状态监控** — 定时轮询 tmux 进程状态 → 数据库更新 → WebSocket 推送前端
5. **流量控制** — 输出帧限速（60fps）、WebSocket 缓冲区背压处理（> 1MB 暂停读取）

#### 技术方案

| 维度 | 方案 |
|------|------|
| 终端渲染 | `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` |
| WebSocket | `ws` 库（服务端）+ 原生 WebSocket API（客户端） |
| pty | `node-pty`（VS Code 同款） |
| 会话管理 | `services/session-manager.ts`：tmux create/attach/kill/monitor |
| 终端代理 | `services/terminal-proxy.ts`：I/O 转发 + 窗口调整 + 断线恢复 |
| 数据表 | `sessions`（~~terminal_logs~~ 不写 SQLite，终端历史通过 tmux scrollback 获取） |
| API | `GET/POST /api/v1/sessions`、`POST /api/v1/sessions/:id/start`、`POST /api/v1/sessions/:id/stop`、`POST /api/v1/sessions/:id/switch-model` |
| WS 通道 | `/ws/terminal/:sessionId`（终端 I/O）+ `/ws/events`（状态推送） |
| 前端 | `/sessions`（仪表盘）、`/sessions/:id`（终端页面） |

#### 子任务拆解

| 子任务 | 优先级 | 工时 | 说明 |
|--------|--------|------|------|
| B1.1 会话管理 Service | P0 | 1 天 | tmux 封装：create/kill/monitor/status |
| B1.2 终端 WebSocket 处理 | P0 | 1 天 | I/O 转发 + 窗口调整 + 心跳 |
| B1.3 前端终端组件 | P0 | 1.5 天 | xterm.js 封装 + WebSocket 客户端 + 重连逻辑 |
| B1.4 会话 CRUD API + 前端 | P0 | 1 天 | 列表 + 创建/停止 + 状态监控 |
| B1.5 断线重连优化 | P0 | 0.5 天 | capture-pane 恢复 + 滚动缓冲重建 |
| B1.6 会话切换/搜索/分组 | P1 | 1 天 | 按项目/标签分组 + 搜索过滤 |
| B1.7 会话通知 | P1 | 0.5 天 | Agent 需要确认时推送通知（WebSocket events） |

---

### 模块 C：Agent 管理（P0 + P1）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 2 |
| **时间** | Day 18-19（与 B/D 并行） |
| **负责人** | 朱雀 + 火珂（前端 UI） |
| **前置依赖** | Phase 0（数据模型）、Phase 1（项目） |
| **功能清单** | P0: C1、C2; P1: C3-C5、C8 |
| **工时** | P0: 1.5 天, P1: 1.5 天 |

#### 技术要点

1. **Agent 配置格式** — 将表单数据转换为 AI CLI 的 Agent 定义格式（由适配器负责）
2. **权限边界** — 工具选择（read/write/execute/bash）+ 目录限制
3. **MVP 只做基础 CRUD** — Agent 编排（C6）和模板（C7）延后 P2

#### 技术方案

| 维度 | 方案 |
|------|------|
| 数据表 | `agents` |
| API | `GET/POST /api/v1/agents`、`GET/DELETE /api/v1/agents/:id` |
| 前端 | `/agents`（列表）、`/agents/new`（创建表单） |

#### 子任务拆解

| 子任务 | 优先级 | 工时 | 说明 |
|--------|--------|------|------|
| C1.1 Agent CRUD API | P0 | 0.5 天 | 增删改查 + 适配器格式转换 |
| C1.2 Agent 列表 + 创建前端 | P0 | 1 天 | 列表 + 表单（名称/描述/模型/工具/目录） |
| C1.3 Agent 编辑/状态/日志 | P1 | 1 天 | 编辑表单 + 实时状态 + 日志查看 |
| C1.4 权限预览 | P1 | 0.5 天 | 可视化展示权限边界 |

---

### 模块 D：Skill 管理（P0 + P1）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 2 |
| **时间** | Day 19-20（与 C 并行） |
| **负责人** | 朱雀 + 火珂（前端 UI） |
| **前置依赖** | Phase 0（数据模型）、Phase 1（项目） |
| **功能清单** | P0: D1、D2; P1: D3-D6 |
| **工时** | P0: 1 天, P1: 1 天 |

#### 技术要点

1. **Skill 内容管理** — SKILL.md 文件内容存储在 `skills.content` 字段
2. **项目级启用/禁用** — `project_skills` 关联表，每个项目可独立启用/禁用
3. **D6 插件管理** — 作为独立功能，不在 Skill 模块内混淆（按 PRD 评审建议）

#### 技术方案

| 维度 | 方案 |
|------|------|
| 数据表 | `skills`、`project_skills` |
| API | `GET/POST /api/v1/skills`、`POST /api/v1/skills/:id/toggle`、`GET /api/v1/skills/:id` |
| 前端 | `/skills`（列表）、`/skills/:id`（编辑） |

#### 子任务拆解

| 子任务 | 优先级 | 工时 | 说明 |
|--------|--------|------|------|
| D1.1 Skill CRUD API | P0 | 0.5 天 | 增删改查 + 项目关联 |
| D1.2 Skill 列表 + 启用/禁用前端 | P0 | 0.5 天 | 列表 + Toggle 开关 |
| D1.3 Skill 安装/编辑/预览 | P1 | 0.75 天 | 从 ClawhHub 安装 + 在线编辑 + 预览 |
| D1.4 插件管理（D6） | P1 | 0.25 天 | Claude Code 插件启用/禁用 |

---

### 模块 G：仪表盘与分析（P1）

| 属性 | 详情 |
|------|------|
| **阶段** | Phase 2 |
| **时间** | Day 20（与 C/D P1 并行） |
| **负责人** | 朱雀 + 火珂（前端 UI） |
| **前置依赖** | Phase 1（所有基础模块完成） |
| **功能清单** | P1: G1、G3、G4 |
| **工时** | 1.5 天 |

#### 技术要点

1. **全局统计** — 项目数/会话数/Agent 数/Skill 数（SQL COUNT 查询）
2. **健康检查** — 扫描各项目配置完整性（缺失文件/过期配置）
3. **通知中心** — 集中展示会话完成/Agent 报错/权限确认等通知

#### 技术方案

| 维度 | 方案 |
|------|------|
| API | `GET /api/v1/dashboard/stats`、`GET /api/v1/dashboard/health`、`GET /api/v1/notifications` |
| 前端 | `/`（仪表盘首页）、通知 Badge |

#### 子任务拆解

| 子任务 | 优先级 | 工时 | 说明 |
|--------|--------|------|------|
| G1.1 统计 API + 仪表盘前端 | P1 | 0.75 天 | COUNT 查询 + 卡片展示 |
| G1.2 健康检查 | P1 | 0.5 天 | 配置完整性扫描 + 报告 |
| G1.3 通知中心 | P1 | 0.25 天 | 通知列表 + WebSocket 推送 |

---

## 五、详细排期表（按天）

| Day | 任务 | 模块 | 负责人 | 工时 | 并行 | 检查点 |
|-----|------|------|--------|------|------|--------|
| **1** | 项目初始化 + 认证 API（users schema + 注册/登录） + **终端方案确认：方案 A** | P0: F0.1/F0.2 | 朱雀 | 1 天 | — | monorepo 搭建完成 |
| **2** | 数据模型 Drizzle schema（全部表）+ 迁移 + Repository 封装 | P0: DB.1/DB.2/DB.3 | 朱雀 | 1 天 | — | 数据模型就绪 |
| **2** | 终端 POC：node-pty 编译 + tmux attach 验证（方案 A） | POC.1/POC.2 | 朱雀 | 0.5 天 | — | node-pty 编译通过 |
| **3** | 终端 POC：数据流打通（xterm → WS → pty → tmux） + 断线重连 + **真实 Claude 交互** | POC.3/POC.4/POC.5 | 朱雀 | 1.5 天 | — | — |
| **4** | POC 验收演示 + 报告 → 前端基础框架（Next.js + shadcn/ui） + **认证前端（登录/注册/路由守卫）** | POC 收尾 + Web.1 + F0.4/F0.5 | 朱雀 | 1.5 天 | — | ⭐ **M1 里程碑** |
| **5** | **A3↔E3 接口定义**（接口契约）+ Claude Code 适配器 | A3↔E3 先行 + A1.1 | 朱雀 | 1 天 | — | 接口契约完成 |
| **6** | 配置生成引擎 + 项目扫描引擎 | A1.2/A1.3 | 朱雀 | 1 天 | — | — |
| **7** | 项目创建 API + 前端 | A1.4 | 朱雀 + 火珂 | 1 天 | 🟡 与 H1.2 并行 | — |
| **8** | 项目导入 + 内置模板 | A1.5/A1.6 | 朱雀 | 1 天 | 🟡 与 H1.3 并行 | ⭐ **M2 里程碑** |
| **9** | 模型 CRUD + 前端 | H1.2/H1.4 | 朱雀 + 火珂 | 1 天 | — | — |
| **10** | API Key 加密（AES-256-GCM）+ 管理前端 | H1.3/H1.4 | 朱雀 | 0.75 天 | — | — |
| **11** | 模板列表 + 详情 + 在线编辑前端 | E1.1/E1.2/E1.3 | 朱雀 + 火珂 | 1 天 | — | — |
| **12** | 模型切换 + 模板收尾 | H1.5/E 收尾 | 朱雀 | 0.5 天 | — | ⭐ **M3 里程碑** |
| **13** | 会话管理 Service（tmux 封装） | B1.1 | 朱雀 | 1 天 | — | — |
| **14** | 终端 WebSocket 处理（I/O 转发 + 窗口调整 + 心跳） | B1.2 | 朱雀 | 1 天 | — | — |
| **15** | 前端终端组件（xterm.js + WS 客户端 + 重连逻辑） | B1.3 | 朱雀 + 火珂 | 1.5 天 | — | — |
| **16** | 会话 CRUD API + 前端 + 状态监控 | B1.4 | 朱雀 | 1 天 | 🟡 与 B1.5 并行 | — |
| **17** | 断线重连优化 + Agent CRUD API | B1.5/C1.1 | 朱雀 | 1 天 | — | ⭐ **M4 里程碑** |
| **18** | Agent 前端 + Skill CRUD API | C1.2/D1.1 | 朱雀 + 火珂 | 1 天 | — | — |
| **19** | Skill 前端 + 会话扩展（搜索/分组） | D1.2/B1.6 | 朱雀 + 火珂 | 1 天 | — | — |
| **20** | 仪表盘 + 模型扩展（分组/预设） + 健康检查 + 通知中心 | G1.1/G1.2/G1.3 + H1.6/H1.7 | 朱雀 + 火珂 | 1 天 | — | — |
| **21** | 端到端测试（5 分钟全流程） | 联调.1 | 朱雀 | 1 天 | — | 5 分钟流程可跑 |
| **22** | Bug 修复 + 边界情况处理 | 联调.2 | 朱雀 | 1 天 | — | 零阻塞 Bug |
| **23** | 性能优化 + 安全加固 | 联调.3 | 朱雀 | 1 天 | — | — |
| **24** | 文档 + 部署脚本 | 联调.4 | 朱雀 | 0.5 天 | — | — |
| **25** | 缓冲（机动时间） | 缓冲 | 朱雀 | 1 天 | — | — |
| **26** | 最终验收准备 + 祝融验收 | 缓冲 | 朱雀 | 0.5 天 | — | ⭐ **M5 里程碑** |

> **并行说明：** Phase 0 **完全串行**（一人无法并行三条线）。Phase 1-2 标注 🟡 的任务可与同天其他任务由同一人切换完成。火珂协助前端 UI 时可实现真正的多人并行。

---

## 六、负责人与协作

### 核心分工

| 角色 | 人员 | 职责 | 投入 |
|------|------|------|------|
| **全栈开发** | 朱雀 | 全部后端 API + 核心前端 | 100% |
| **前端 UI** | 火珂 | 页面样式优化、组件美化、响应式适配 | 30%-50%（Day 6 起介入） |

### 火珂介入时间点

| Day | 介入内容 |
|-----|----------|
| **Day 4** | 前端基础框架搭建协助（布局/导航/主题适配） |
| **Day 7** | 项目创建/导入页面 UI 走查与优化 |
| **Day 9** | 模型管理页面 UI 优化 |
| **Day 11** | 模板编辑页面 UI 优化（编辑器布局、按钮交互） |
| **Day 15** | 终端页面 UI（布局、工具栏、状态栏） |
| **Day 18** | Agent/Skill 页面 UI |
| **Day 20** | 仪表盘页面 UI（卡片、图表） |

---

## 七、风险缓冲

### 缓冲时间分配

| 位置 | 时间 | 用途 |
|------|------|------|
| Day 4 下午 | 0.5 天 | POC 失败 → 切换 Plan B |
| Day 17 下午 | 0.5 天 | B 模块延迟时的追赶窗口 |
| Day 21-24 | 4 天 | 联调测试 + Bug 修复 |
| Day 25-26 | 1.5 天 | 全局缓冲（机动）+ 最终验收 |

### 风险应对矩阵

| 风险 | 触发条件 | 应对策略 | 影响天数 |
|------|----------|----------|----------|
| POC 不通过 | Day 3 下班前 | 切换 Plan B（纯 API 模式），Day 4 上午迁移代码 | 0（已预留） |
| node-pty 编译失败 | Day 1 | 使用 prebuild → 降级纯命令行 | 0 |
| A3 跨工具配置复杂 | Day 6 | 只做 Claude，OpenCode/Codex 延后 | 0（已纳入计划） |
| 前端 UI 返工 | Day 15 | 先保证功能可用，Day 19-20 统一优化 | +1 天 |
| 后端接口变更 | 任意天 | 用 zod 校验，接口变更自动暴露 | 0 |
| 联调发现阻塞 Bug | Day 21 | 优先修 P0 Bug，P1 Bug 记入 backlog | +1~2 天 |

### 进度检查点

| 检查点 | 时间 | 检查内容 | 延迟阈值 | 行动 |
|--------|------|----------|----------|------|
| **CP1** | Day 4 下班 | M1 里程碑 | POC 未通过 | 切换到 Plan B |
| **CP2** | Day 9 下班 | M2 里程碑 | 落后 > 0.5 天 | 砍 A1.6（内置模板种子数据简化） |
| **CP3** | Day 12 下班 | M3 里程碑 | 落后 > 1 天 | 砍 E1.3（模板编辑先做只读） |
| **CP4** | Day 18 下班 | M4 里程碑 | 落后 > 1 天 | 砍 B1.5（断线重连简化为手动恢复） |
| **CP5** | Day 21 下班 | 5 分钟全流程 | 不可跑 | 砍 P1 功能保 P0 |

---

## 八、每日站会检查点

### 站会规则

- **时间**：每天早上 10:00（或朱雀开工时）
- **形式**：3 个问题 — 昨天做了什么？今天做什么？有没有阻塞？
- **时长**：≤ 10 分钟

### 关键检查日

| Day | 检查内容 | 必须确认 |
|-----|----------|----------|
| **Day 1** | 项目搭建 | monorepo 结构正确、依赖安装完成、**终端方案确认：方案 A** |
| **Day 4** | **⭐ M1 里程碑** | 认证可登录、POC 5 项全通过、前端框架就绪 |
| **Day 9** | **⭐ M2 里程碑** | 项目创建/导入全流程可跑 |
| **Day 12** | **⭐ M3 里程碑** | 模型 + 模板管理可用 |
| **Day 18** | **⭐ M4 里程碑** | 会话 + 终端可操作 |
| **Day 21** | 端到端测试 | 5 分钟全流程可跑 |
| **Day 26** | **⭐ M5 交付** | 祝融验收 |

---

## 九、功能优先级裁剪预案

> 如进度落后，按以下顺序裁剪功能（保核心路径，砍锦上添花）：

### 裁剪优先级（从最可砍到最不可砍）

| 优先级 | 功能 | 影响 | 节省工时 |
|--------|------|------|----------|
| 🟢 最先砍 | G1 仪表盘 | 仅影响数据可视化，不影响核心功能 | -1.5 天 |
| 🟢 先砍 | H6 模型预设 + H8 健康检查 | 模型管理和项目配置不受影响 | -1.5 天 |
| 🟡 次砍 | E3 模板在线编辑（降为只读查看） | 可用内置模板，不能自定义 | -1 天 |
| 🟡 次砍 | D2 Skill 启用/禁用（降为全部启用） | 不影响 Skill 功能，只是不能按项目开关 | -0.5 天 |
| 🟡 次砍 | C2 Agent 表单（降为最小必填项） | 保留创建能力，减少字段 | -0.5 天 |
| 🔴 不可砍 | F0 认证 | 基石功能，砍了全线返工 | — |
| 🔴 不可砍 | A 项目管理 | 核心价值，砍了产品不存在 | — |
| 🔴 不可砍 | B 会话 + 终端 | 核心价值，砍了产品不存在 | — |
| 🔴 不可砍 | H5 API Key 安全存储 | 安全红线，不可妥协 | — |

---

## 十、验收标准

### MVP 交付验收（5 分钟全流程）

用户在 **5 分钟** 内完成以下操作，无阻塞、无报错：

| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 打开浏览器 → `http://localhost:3000` | 显示登录页面 |
| 2 | 注册账号 → 登录 | 跳转到仪表盘 |
| 3 | 点击「创建项目」→ 填写项目名/路径 → 选择 AI 工具（Claude）→ 选择模板 | 项目创建成功 |
| 4 | 点击「生成配置」 | `.claude/CLAUDE.md` 等文件生成 |
| 5 | 或点击「导入项目」→ 选择已有项目目录 → 扫描 → 注入配置 | 配置注入成功 |
| 6 | 点击「创建会话」→ 选择项目 → 启动 | 终端页面打开 |
| 7 | 在终端输入 → 看到 AI CLI 响应 | 终端交互正常 |
| 8 | **总计** | **≤ 5 分钟** |

### 非功能性验收标准

| 维度 | 标准 |
|------|------|
| **终端断线重连** | 断开网络 → 30 秒内重连 → 终端内容恢复，CLI 未中断 |
| **API 响应时间** | P0 API 响应 < 500ms（不含 AI CLI 调用） |
| **前端加载** | 首屏加载 < 3 秒（localhost） |
| **数据库** | WAL 模式，零手动维护 |
| **安全** | API Key 加密存储，密码 bcrypt，JWT 鉴权 |
| **部署** | `openforge start` 一键启动 |

---

## 十一、附录

### 11.1 开发环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 20 LTS | 运行环境 |
| tmux | ≥ 3.2 | 会话持久化 |
| pnpm | ≥ 8.0 | monorepo 包管理 |
| gcc/g++/make | 系统默认 | 首次编译 node-pty（prebuild 可跳过） |

### 11.2 环境变量清单

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `OPENFORGE_PORT` | ❌ | 3000 | Gateway 端口 |
| `OPENFORGE_DB_PATH` | ❌ | `~/.openforge/openforge.db` | SQLite 路径 |
| `OPENFORGE_MASTER_KEY` | ✅ | — | AES 加密密钥（推荐 64 字符 hex） |
| `OPENFORGE_JWT_SECRET` | ✅ | — | JWT 签名密钥 |
| `OPENFORGE_LOG_LEVEL` | ❌ | info | 日志级别 |
| `OPENFORGE_TMUX_PREFIX` | ❌ | of- | tmux 前缀 |

### 11.3 P0 功能完整清单

| 模块 | 功能 ID | 功能名称 | 状态 |
|------|---------|----------|------|
| F | F0 | 用户认证 + 多租户 | ✅ 纳入计划 |
| DB | — | 数据模型 + ORM | ✅ 纳入计划 |
| A | A1 | 项目创建向导 | ✅ 纳入计划 |
| A | A3 | 跨工具配置生成（仅 Claude） | ✅ 纳入计划 |
| A | A4 | CLAUDE.md 模板 | ✅ 纳入计划 |
| A | A6 | Rules 注入 | ✅ 纳入计划 |
| I | I1 | 项目扫描 | ✅ 纳入计划 |
| I | I2 | 一键注入配置 | ✅ 纳入计划 |
| I | I3 | 配置冲突检测 | ✅ 纳入计划 |
| I | I4 | 导入确认 | ✅ 纳入计划 |
| B | B1 | 会话仪表盘 | ✅ 纳入计划 |
| B | B2 | 会话创建 | ✅ 纳入计划 |
| B | B3 | 内置终端 | ✅ 纳入计划 |
| B | B5 | 会话状态监控 | ✅ 纳入计划 |
| C | C1 | Agent 列表 | ✅ 纳入计划 |
| C | C2 | Agent 创建（表单） | ✅ 纳入计划 |
| D | D1 | Skill 列表 | ✅ 纳入计划 |
| D | D2 | Skill 启用/禁用 | ✅ 纳入计划 |
| E | E1 | 模板列表 | ✅ 纳入计划 |
| E | E3 | 模板编辑 | ✅ 纳入计划 |
| H | H1 | 模型列表 | ✅ 纳入计划 |
| H | H2 | 模型切换 | ✅ 纳入计划 |
| H | H3 | 添加模型 | ✅ 纳入计划 |
| H | H5 | API Key 管理 | ✅ 纳入计划 |

### 11.4 与 PRD 评审意见的对齐

| 评审意见 | 处理方式 |
|----------|----------|
| 工时估算压缩 | 已调整为 26 天，纳入 POC、前端、联调时间 |
| Gateway 技术栈待定 | 已确认 Node.js + TypeScript（TECH-ARCHITECTURE） |
| API 接口定义缺失 | 已补充完整 REST + WebSocket API 设计（TECH-ARCHITECTURE §3） |
| 数据模型缺失 | 已补充 10 张表完整 schema（TECH-ARCHITECTURE §2） |
| B3 POC 未计入工时 | POC 单独占 Day 2-3.5，5 项验收标准明确（含真实 Claude 交互） |
| A3 先打透 Claude | 已纳入计划：MVP 只做 Claude 适配器，OpenCode/Codex → P1 |
| G2/G3/G4 定义缺失 | 仪表盘功能已重定义并纳入 P1（Day 20） |
| **Phase 0 串行化** | **v1.1 修订**：认证→数据模型→POC→前端框架，完全串行，一人无法并行 |
| **终端方案** | **v1.1 修订**：确认方案 A（node-pty spawn + tmux attach） |
| **AES-256-GCM** | **v1.1 修订**：替代 CBC，含 IV + Auth Tag 管理 |
| **A3↔E3 接口先行** | **v1.1 修订**：Day 5 先定义接口契约，实现阶段并行推进 |
| **terminal_logs** | **v1.1 修订**：不写 SQLite，用 tmux scrollback 替代 |

---

_毕方 🏗️ | 观全局而建 | 2026-04-24_
_朱雀 🛠️ | v1.1 修订 | 2026-04-24（基于三方评审 + 盘古拍板）_
