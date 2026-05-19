# CLAUDE.md — 项目指南

> 每次对话自动加载。这是约束 AI 行为的核心输入，必须在项目开始之前就到位。

---

## 🔄 当前状态（最重要，每次新对话第一步读取）

> 这里是跨会话续接的核心。每次新对话，第一步读取此段落确认当前阶段和续接点。
> 当上下文即将耗尽时，主 Agent 必须调度 doc-sync 做一次紧急快照更新此段落。

```
当前阶段：[开发中/已完成] - 阶段 X / 共 N 阶段
最后更新：YYYY-MM-DD HH:mm
下次继续：[具体第一个任务名称]
已完成：
  - [x] Phase X.1 - 任务A（交付报告见 CHANGELOG.md）
  - [x] Phase X.2 - 任务B
进行中：
  - [ ] Phase X.3 - 任务C（backend-dev 已完成，等待 frontend-dev）
待办：
  - [ ] Phase X.4 - 任务D
```

---

## 📋 项目基本信息

- **项目名称**：[项目名称]
- **项目描述**：[一句话描述项目做什么]
- **团队**：[团队名称]
- **最后更新**：[YYYY-MM-DD]

---

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | [Vue 3 / React 18 / Svelte] |
| 后端语言 | [Python / Go / Node.js / Rust] |
| 数据库 | [PostgreSQL / MongoDB / SQLite] |
| ORM/框架 | [Prisma / Django / FastAPI / Gin / Actix] |
| 包管理器 | [npm / pnpm / yarn / uv / cargo / go mod] |
| 测试框架 | [Vitest / pytest / go test] |
| 容器化 | [Docker / Docker Compose] |

---

## 📁 项目结构

```
# 前端（React/Vue）
src/
├── components/     # UI 组件
├── pages/          # 页面/路由
├── hooks/          # 自定义 Hooks
├── stores/         # 状态管理
├── api/            # API 调用
├── types/          # 类型定义
├── utils/          # 工具函数
└── styles/         # 全局样式

# Python
src/
├── api/            # API 路由
├── models/         # 数据模型
├── schemas/        # Pydantic 模型
├── services/       # 业务逻辑
├── repositories/   # 数据访问
└── core/           # 核心配置

# Go
cmd/
├── api/            # 主程序
└── migrate/        # 迁移工具
internal/
├── api/            # HTTP 处理
├── service/        # 业务逻辑
├── repository/     # 数据访问
└── model/          # 数据模型
pkg/
├── utils/          # 工具
└── errors/         # 错误定义
```

---

## 🚀 工作流（Harness Engineering）

### 子 Agent 职责隔离

本项目使用 6 个职责隔离的子 Agent，通过 `--agent <name>` 调用：

| Agent | 职责 | 工具权限 | 目录限制 |
|-------|------|---------|---------|
| `business-analyst` | 只读分析：代码现状、模块关系 | Read/Grep/Glob/Bash(只读) | 全部（只读） |
| `backend-dev` | 后端实现：API、业务逻辑、数据库 | 全工具 | 后端目录 |
| `frontend-dev` | 前端实现：页面、组件、状态管理 | 全工具 | 前端目录 |
| `test-writer` | 测试：编写用例、执行测试、出报告 | 全工具 | 测试目录 |
| `code-reviewer` | 审查：GATE 1/2/3 输出书面报告 | Read/Grep/Glob/Bash | 全部（只读） |
| `doc-sync` | 文档同步：更新 CLAUDE.md、PLAN.md 等 | Edit/Write | 文档目录 |

**主 Agent 只调度，不执行。** 所有具体实现动作必须下发子 Agent。

### 核心主流程（三级 Gate）

```
需求 → GATE 1 计划审查 → STEP 2 分层执行 → GATE 2 实现审查
    → STEP 3 测试 → GATE 3 零信任验收 → STEP 4/5 文档+提交
```

#### GATE 1 — 计划审查
- 计划写完不直接进入开发，先交给 code-reviewer 审
- 检查：完成标准是否覆盖、影响文件是否列清、分层分工是否合规
- **不通过，不允许进入开发**

#### STEP 2 — 分层执行
- backend-dev 和 frontend-dev 按依赖顺序调度
- 后端 API 就绪前，前端不能抢跑
- 后端强制 TDD，先写失败测试，再写实现

#### GATE 2 — 实现审查
- code-reviewer 确认：实现是否对齐原计划、是否违反架构约束
- **不通过，代码打回开发 Agent 修复，修完再审**

#### STEP 3 — 测试
- test-writer 执行测试，输出结构化报告
- **硬规则：测试失败修复后，不能直接重跑，必须重新走 GATE 2**

#### GATE 3 — 零信任验收
- code-reviewer 在全新上下文下，从全局视角重新审视
- 回答：是否引入架构漂移、是否破坏已有模块
- **测试通过只能证明被执行到的行为没出错，不能证明整个交付安全**

#### STEP 4/5 — 文档同步 + Git 提交
- doc-sync 同步所有项目文档
- Git 按规范提交（一个提交只做一件事）

### 流程裁剪规则

| 场景 | 流程 |
|------|------|
| 复杂任务（跨模块） | 完整流程（GATE 1→2→3） |
| 简单修复（单文件） | STEP 2 → GATE 2 → STEP 3 |
| 紧急 Hotfix | 快速定位 → 最小修复 → 验证 → 部署 → 事后补审查+文档 |
| 纯文档变更 | doc-sync 直接执行 |

**复杂度被低估时必须立即升级为完整流程，不允许继续走简化路径。**

### Skills 作为流程约束

| Skill | 触发时机 | 作用 |
|-------|---------|------|
| `plan-workflow` | 开发前 | 强制输出完整计划 |
| `review-workflow` | GATE 触发 | 每条发现必须有代码证据 |
| `verify-workflow` | 完成前 | 禁止虚标完成，必须有验证证据 |
| `commit-workflow` | 提交前 | 确保一个提交只做一件事 |

---

## ⚡ 执行原则

```
一次一事：
- 每次只完成一个功能模块
- 每个任务独立验证后再做下一个
- 禁止同时修改多个不相关的模块

闭环验证：
- 每完成一个功能，立即测试验证
- 不留半成品，不堆砌未联调代码

贪功禁忌：
- 不为省事合并多个改动到一个 commit
- 不同时修多个 bug（除非确认无关联）
- 不在未验证的情况下继续下一步
```

---

## 🚫 铁律速查

```
禁止：
- 硬编码密钥/凭据
- 字符串拼接 SQL（必须参数化查询）
- 用户输入直接拼入 HTML（必须转义）
- 使用 any（必须具体类型）
- 直接修改 production/main 分支
- 没有测试就合并代码
- 跳过 Gate 审查直接进入下一步
- 主 Agent 越权执行（必须下发子 Agent）

必须：
- 函数不超过 50 行
- 嵌套不超过 4 层，使用 early return
- 所有 API 有错误处理
- 用户输入必须校验
- 异步操作必须 try/catch
- 测试失败修复后必须重新走 GATE 2
- 每次会话结束前更新"当前状态"段落
```

---

## 📝 提交规范

```
格式：<type>: <描述>

type：feat / fix / refactor / perf / docs / test / chore / ci

规则：
- 标题不超过 50 字
- 描述为什么改，不描述改了什么
- 一个提交只做一件事
```

---

## 📁 文档体系

| 文件 | 作用 | 更新时机 |
|------|------|---------|
| `CLAUDE.md` | 项目指南，每次对话自动加载 | 每次会话结束 |
| `docs/WORKFLOW.md` | 完整工作流手册 | 流程变更时 |
| `docs/PLAN.md` | 开发计划 | 每阶段开始/结束 |
| `docs/CHANGELOG.md` | 变更日志 | 每次任务完成 |
| `docs/CONTRIBUTING.md` | 开发规范手册 | 规范变更时 |
| `.claude/settings.local.json` | 权限配置 | 项目初始化时 |

---

## 🔧 运行环境

- **开发环境**：[Node.js X / Python X / Go X]
- **测试环境**：[数据库地址 / API Mock]
- **构建命令**：`npm run build` / `uv run build` / `go build`
- **测试命令**：`npm test` / `uv run pytest` / `go test ./...`
- **启动命令**：`npm run dev` / `uv run dev` / `go run cmd/api/main.go`
