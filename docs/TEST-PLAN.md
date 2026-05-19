# OpenForge TDD 测试计划

> 版本：v2.1 | 日期：2026-04-25 | 状态：**已通过复审，可进入执行阶段**
> 变更说明：v2.0 根据煊璃复审报告（docs/XUANLI-REVIEW-V2.md）修补 3 项遗留问题 + 2 项可选建议
> 本文档与 `docs/PRD-v1.1-MVP.md`、`docs/TECH-ARCHITECTURE.md`、`docs/DEVELOPMENT-PLAN.md` 配套使用。
> 2026-04-26 补充：测试执行按 MVP-0/MVP-1 分层，MVP-0 必须先覆盖 Claude Code 本地控制闭环和风险 Gate。
> 2026-04-29 补充：MVP-1 smoke 已加入 `packages/web/e2e/mvp1-smoke.spec.ts`，覆盖注册、模型/API Key、模板克隆、Agent、Skill 项目启用、配置写入和 Dashboard 健康入口。
> 2026-04-29 补充：MVP-1 稳定化新增 `dashboard-summary.test.ts`、`model-health.test.ts`、`agent-preview.test.ts`，覆盖 Dashboard 汇总、模型本地健康检查和 Agent 权限预览。

---

## 0. MVP-0 / MVP-1 测试分层（2026-04-26）

完整测试计划仍作为长期质量目标，但首轮必须优先覆盖 MVP-0 风险。

### 0.1 MVP-0 必跑测试

| 类别 | 必测内容 |
|------|----------|
| Auth | 注册、登录、JWT 校验、过期/伪造 token 拒绝、`alg:none` 拒绝 |
| Tenant | repository 自动 `user_id` 过滤，userA 不能访问 userB 项目/session/key |
| SQL | API/repository 参数化查询，SQL 注入 payload 不生效 |
| Crypto | AES-256-GCM 加解密、IV 随机、auth tag 篡改失败、密钥长度校验 |
| Path | approved project root、denied root、`..`、编码 traversal、Unicode traversal、symlink escape |
| Config | dry-run、变量渲染、冲突检测、identical auto-skip、modified skip/overwrite、backup、partial write rollback、rollback failure report |
| Session | Gateway 创建 tmux session、Claude adapter launch plan、`tmux new-session -e` 注入、node-pty attach |
| Restart | 浏览器刷新恢复、Gateway 重启恢复、`of-*` orphan tmux 清理 |
| WebSocket | JWT auth、session ownership、单连接替换、malformed message、message size、heartbeat timeout、基础输入限流 |
| Frontend | 登录、项目创建/导入、配置注入确认、session 列表、terminal 页面 smoke test |

### 0.2 MVP-1 / Hardening 测试

| 类别 | 延后内容 |
|------|----------|
| WebSocket | 洪水攻击、高并发压力、慢客户端背压深测 |
| Agent | CRUD、Claude 格式生成、项目注入、权限预览已纳入 MVP-1 |
| Skill | 启用/禁用、项目注入、内容 XSS 文本渲染、内容预览已纳入 MVP-1；安装源管理延后 |
| Template | 克隆、编辑、删除、项目应用已纳入 MVP-1；版本同步和导入/导出延后 |
| Model | CRUD、默认模型、Key 轮换、本地配置健康检查已纳入 MVP-1；外部连通性健康检查延后 |
| Dashboard | 汇总 API、健康卡、事件订阅、快捷入口已纳入 MVP-1；通知中心延后 |
| E2E | MVP-1 smoke 覆盖单项目核心闭环；多项目、多 session 压测延后 |

### 0.3 Gate 对应测试要求

| Gate | 最低测试证据 |
|------|--------------|
| Gate A Terminal Feasibility | 真实 tmux + node-pty + WebSocket + xterm.js + Claude Code 交互；浏览器/Gateway 重启恢复 |
| Gate B Config Contract | config generation 单元/集成测试覆盖 dry-run、冲突、回滚和路径安全 |
| Gate C Security Baseline | auth、tenant、crypto、path、WebSocket ownership/limits 测试通过 |
| Gate D MVP-0 Acceptance | MVP-0 必跑测试通过，或记录无法运行的命令和原因 |

## 1. 测试策略

### 1.1 测试金字塔

```
        ┌─────────┐
        │  E2E    │  Playwright — 12 个核心场景（含 4 个异常路径）
        ├─────────┤
        │Integration│ node:test — 80+ API + DB + tmux 用例
        ├─────────────┤
        │   Unit    │  node:test + Vitest — 140+ 用例（含 20 个 WebSocket）
        └─────────────┘
```

### 1.2 框架配置

| 层 | 框架 | 命令 | 配置文件 |
|------|------|------|---------|
| 后端单元测试 | `node:test` | `cd packages/gateway && pnpm test` | `package.json` scripts |
| 后端集成测试 | `node:test` + `supertest` | `pnpm test:integration` | 同上 |
| 前端单元测试 | `Vitest` | `cd packages/web && pnpm vitest run` | `packages/web/vitest.config.ts` |
| E2E 测试 | `Playwright` | `pnpm e2e` | `packages/web/playwright.config.ts` |

### 1.3 TDD 适用度分级

| 模块类型 | TDD 适用度 | 策略 |
|---------|-----------|------|
| 认证/授权 | ✅ 高 | 严格执行 RED→GREEN→REFACTOR |
| 数据仓储 | ✅ 高 | 内存 SQLite 可快速验证 |
| 加密服务 | ✅ 高 | 确定性输入输出，易断言 |
| 配置生成 | ✅ 中高 | 模板渲染可预测，文件 I/O 需 Mock |
| 会话管理（tmux） | ⚠️ 中 | 先 POC 验证，后补测试。集成测试必须用真实 tmux |
| 终端代理（node-pty） | ⚠️ 中低 | pty 行为依赖操作系统，集成测试必须用真实 pty |
| WebSocket Hub | ⚠️ 中 | 并发连接模拟复杂，用真实 WS 客户端测试 |

### 1.4 Mock 策略

| Mock 对象 | 单元测试 | 集成测试 |
|----------|---------|---------|
| tmux | 可用抽象接口 Mock | **必须用真实 tmux** |
| node-pty | 可用抽象接口 Mock | **必须用真实 pty** |
| 数据库 | 接口抽象 Mock | 内存 SQLite |
| WebSocket | 客户端 Mock（前端） | 真实 WS 库（服务端） |

---

## 2. 后端单元测试清单

### 2.1 F 认证授权模块（15 单测）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 1 | `auth.test.ts` | 密码哈希（bcrypt） | 正常哈希、盐轮数验证、弱密码拒绝 |
| 2 | `auth.test.ts` | 用户注册 | 正常注册、重复邮箱拒绝、弱密码拒绝、空字段拒绝 |
| 3 | `auth.test.ts` | 用户登录 | 正确凭据、错误密码、错误邮箱、已禁用账户 |
| 4 | `auth.test.ts` | JWT 签发 | 正常签发、载荷验证、过期时间验证 |
| 5 | `auth.test.ts` | JWT 验证 | 有效 token、过期 token、伪造签名拒绝、**alg:none 攻击拒绝** |
| 6 | `authMiddleware.test.ts` | 中间件拦截 | 无 token 拒绝、无效 token 拒绝、有效 token 放行 |
| 7 | `authMiddleware.test.ts` | userId 注入 | req.userId 正确注入、多租户隔离验证 |
| 8 | `authMiddleware.test.ts` | 权限校验 | 管理员/普通用户路由隔离 |
| 9 | `tenantMiddleware.test.ts` | 多租户隔离 | userA 无法访问 userB 数据 |

**覆盖率目标：** lines 80%, functions 75%, branches 90%

### 2.2 DB 数据仓储模块（25 单测）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 10 | `repositories/user.test.ts` | CRUD | create/read/update/delete/findByEmail |
| 11 | `repositories/user.test.ts` | 边界条件 | 重复邮箱、超长字段、SQL 注入尝试 |
| 12 | `repositories/project.test.ts` | CRUD | create/read/update/delete/list |
| 13 | `repositories/project.test.ts` | 用户隔离 | 只能查询/修改自己的项目 |
| 14 | `repositories/session.test.ts` | CRUD | create/read/update/delete/findByProject |
| 15 | `repositories/session.test.ts` | 状态转换 | idle→running→stopped 合法转换、非法转换拒绝 |
| 16 | `repositories/api-key.test.ts` | CRUD | create/read/update/delete/list |
| 17 | `repositories/api-key.test.ts` | 用户隔离 | 只能查询/修改自己的 Key |
| 18 | `repositories/model.test.ts` | CRUD | create/read/update/delete/list |
| 19 | `repositories/skill.test.ts` | CRUD | create/read/update/delete/list |
| 20 | `repositories/skill.test.ts` | 用户隔离 | 只能查询/修改自己的 Skill |
| 21 | `repositories/template.test.ts` | CRUD | create/read/update/delete/list |
| 22 | `db/schema.test.ts` | Schema 约束 | NOT NULL、UNIQUE、FOREIGN KEY CASCADE、CHECK |
| 23 | `db/schema.test.ts` | 迁移幂等性 | 多次运行 migrate 不报错 |

**覆盖率目标：** lines 80%, functions 75%, branches 90%

### 2.3 H 加密服务模块（12 单测）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 24 | `crypto.test.ts` | AES-256-GCM 加密/解密 | 正常加解密、确定性输出 |
| 25 | `crypto.test.ts` | IV 随机性 | 两次加密 IV 不同 |
| 26 | `crypto.test.ts` | Auth Tag 验证 | 篡改密文抛出 AUTH_TAG 错误 |
| 27 | `crypto.test.ts` | 密钥长度校验 | 非 32 字节密钥抛出错误 |
| 28 | `crypto.test.ts` | 空输入处理 | 空字符串加解密、null/undefined 抛出错误 |
| 29 | `crypto.test.ts` | 特殊字符 | Unicode、Emoji、二进制数据加解密 |

**覆盖率目标：** lines 90%, functions 85%, branches 95%

### 2.4 B 会话管理模块（20 单测 + 6 集成测试）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 30 | `session-manager.test.ts` | createSession | 正常创建、名称格式验证（of-{user}-{session}） |
| 31 | `session-manager.test.ts` | stopSession | 正常停止、已停止会话再次停止 |
| 32 | `session-manager.test.ts` | deleteSession | 正常删除、级联清理 |
| 33 | `session-manager.test.ts` | getSessionStatus | 正确返回状态 |
| 34 | `session-manager.test.ts` | listSessions | 按用户过滤、按项目过滤 |
| 35 | `session-manager.test.ts` | **tmux 孤儿清理** | Gateway 重启后扫描 of-* 会话，对比数据库，清理孤儿 |
| 36 | `session-manager.test.ts` | **tmux 命名冲突** | 命名冲突时自动追加后缀 |
| 37 | `session-manager.test.ts` | **tmux attach 失败降级** | session 不存在时返回明确错误 |
| 38 | `session-manager.test.ts` | **tmux history-limit 验证** | capture-pane 验证 history-limit 设置为 10000 |
| 39 | `session-manager.test.ts` | **环境变量注入** | tmux -e 正确注入 API Key |
| 40 | `session-manager.test.ts` | **路径安全** | session 名包含路径穿越时拒绝 |

**覆盖率目标：** lines 80%, functions 75%, branches 90%

### 2.5 A/I 项目配置模块（15 单测 + 10 集成测试）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 41 | `project-scanner.test.ts` | 扫描 AI 工具 | 检测 Claude Code / OpenCode / Codex |
| 42 | `project-scanner.test.ts` | 扫描空目录 | 空项目返回空结果 |
| 43 | `project-scanner.test.ts` | 路径穿越防护 | `../../etc/passwd` 拒绝、**Unicode `%2e%2e%2f` 绕过拒绝** |
| 44 | `project-scanner.test.ts` | 符号链接解析 | 符号链接指向外部目录时拒绝 |
| 45 | `config-generator.test.ts` | 模板渲染 | 变量替换正确性 |
| 46 | `config-generator.test.ts` | 冲突检测 | 已存在文件返回冲突报告 |
| 47 | `config-generator.test.ts` | 回滚机制 | 写入失败时恢复备份 |

**覆盖率目标：** lines 80%, functions 75%, branches 90%

### 2.6 C/D/E Agent/Skill/模板模块（33 单测 + 24 集成测试）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 48 | `agent.test.ts` | CRUD | 创建/读取/更新/删除/列表 |
| 49 | `agent.test.ts` | 配置格式转换 | agent 表单→Claude Code 格式 |
| 50 | `skill.test.ts` | CRUD | 创建/读取/更新/删除/列表 |
| 51 | `skill.test.ts` | **Skill 内容 XSS 过滤** | Skill 内容包含 HTML 标签时正确转义 |
| 52 | `template.test.ts` | CRUD | 创建/读取/更新/删除/列表 |
| 53 | `template.test.ts` | 模板渲染 | 变量替换、缺失变量处理 |

**覆盖率目标：** lines 80%, functions 75%, branches 90%

### 2.7 🔴 WebSocket 终端模块（20 单测）— 新增

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 54 | `websocket/hub.test.ts` | 连接管理 | 正常连接、连接计数 |
| 55 | `websocket/hub.test.ts` | **单终端互踢** | 新连接建立时踢出旧连接 |
| 56 | `websocket/hub.test.ts` | **全局连接数限制** | 超过 100 并发连接时拒绝新连接 |
| 57 | `websocket/hub.test.ts` | **单用户连接数限制** | 单用户超过 10 个连接时拒绝 |
| 58 | `websocket/hub.test.ts` | **心跳超时踢出** | 90s 无心跳自动断开 |
| 59 | `websocket/hub.test.ts` | **连接洪水攻击** | 短时间内大量 WS 连接，验证限流生效 |
| 60 | `websocket/hub.test.ts` | 断开连接 | 正常断开、异常断开清理 |
| 61 | `websocket/hub.test.ts` | 消息路由 | 消息正确路由到对应 session |
| 62 | `websocket/terminal.test.ts` | **终端 I/O 转发** | 输入→pty 转发、pty 输出→客户端广播 |
| 63 | `websocket/terminal.test.ts` | **终端 resize** | 窗口大小调整正确传递到 pty |
| 64 | `websocket/terminal.test.ts` | **背压处理** | 客户端消费慢时缓冲不溢出 |
| 65 | `websocket/terminal.test.ts` | **输入频率限制** | 输入 > 50 次/秒时限流 |
| 66 | `websocket/terminal.test.ts` | **消息大小限制** | 单帧 > 1MB 时拒绝 |
| 67 | `websocket/terminal.test.ts` | 断线重连 | 断线后重连恢复终端状态 |
| 68 | `websocket/terminal.test.ts` | 错误处理 | pty 进程退出时通知客户端 |
| 69 | `websocket/terminal.test.ts` | 会话隔离 | userA 无法发送数据到 userB 的终端 |
| 70 | `websocket/terminal.test.ts` | **消息顺序性** | 快速连续输出时终端按序渲染，无乱序错行 |
| 71 | `websocket/events.test.ts` | 事件广播 | 状态变更事件广播到订阅者 |
| 72 | `websocket/events.test.ts` | 事件过滤 | 用户只收到自己的事件 |
| 73 | `websocket/events.test.ts` | 连接恢复 | 断线重连后事件不丢失 |
| 74 | `websocket/auth.test.ts` | WS 认证 | JWT 验证通过/拒绝 |
| 75 | `websocket/cors.test.ts` | **CORS 配置验证** | 跨域请求仅允许配置白名单域名 |

**覆盖率目标：** lines 90%, functions 85%, branches 95%（提升至最高级别）

---

## 3. 后端集成测试清单

### 3.1 认证 API（8 集成测试）

| # | 文件 | 端点 | 测试内容 |
|---|------|------|---------|
| 74 | `integration/auth.test.ts` | POST /api/v1/auth/register | 正常注册、重复邮箱、弱密码、空字段 |
| 75 | `integration/auth.test.ts` | POST /api/v1/auth/login | 正确凭据、错误密码、错误邮箱、已禁用账户 |
| 76 | `integration/auth.test.ts` | POST /api/v1/auth/refresh | 有效 refresh token、过期 refresh token |
| 77 | `integration/auth.test.ts` | 速率限制 | 快速连续登录触发限流 |

### 3.2 项目 API（10 集成测试）

| # | 文件 | 端点 | 测试内容 |
|---|------|------|---------|
| 78 | `integration/projects.test.ts` | GET/POST/PUT/DELETE /api/v1/projects | CRUD 全流程 |
| 79 | `integration/projects.test.ts` | POST /api/v1/projects/import | 导入项目、扫描、冲突处理 |
| 80 | `integration/projects.test.ts` | 多租户隔离 | userA 无法访问 userB 的项目 |

### 3.3 会话 API（10 集成测试）

| # | 文件 | 端点 | 测试内容 |
|---|------|------|---------|
| 81 | `integration/sessions.test.ts` | POST /api/v1/sessions | 创建会话 + 启动 tmux |
| 82 | `integration/sessions.test.ts` | PATCH /api/v1/sessions/:id/stop | 停止会话 |
| 83 | `integration/sessions.test.ts` | DELETE /api/v1/sessions/:id | 删除会话 |
| 84 | `integration/sessions.test.ts` | GET /api/v1/sessions | 列表查询 |
| 85 | `integration/sessions.test.ts` | **真实 tmux 交互** | 集成测试环境运行真实 tmux，验证 create→attach→capture-pane 全流程 |

### 3.4 Agent API（6 集成测试）

| # | 文件 | 端点 | 测试内容 |
|---|------|------|---------|
| 86 | `integration/agents.test.ts` | CRUD | 创建/读取/更新/删除/列表 |
| 87 | `integration/agents.test.ts` | 配置应用 | 保存后验证配置文件写入 |

### 3.5 Skill API（8 集成测试）

| # | 文件 | 端点 | 测试内容 |
|---|------|------|---------|
| 88 | `integration/skills.test.ts` | CRUD | 创建/读取/更新/删除/列表 |
| 89 | `integration/skills.test.ts` | 技能应用 | 保存后验证技能注入配置文件 |

### 3.6 API Key 管理（8 集成测试）

| # | 文件 | 端点 | 测试内容 |
|---|------|------|---------|
| 90 | `integration/api-keys.test.ts` | CRUD | 创建/读取/更新/删除/列表 |
| 91 | `integration/api-keys.test.ts` | 加密存储 | 数据库中存储的是加密值 |
| 92 | `integration/api-keys.test.ts` | **API Key 轮换** | 更新 Key 后，运行中的会话是否注入新 Key |
| 93 | `integration/api-keys.test.ts` | 创建速率限制 | 快速连续创建触发限流 |

### 3.7 模型配置 API（6 集成测试）

| # | 文件 | 端点 | 测试内容 |
|---|------|------|---------|
| 94 | `integration/models.test.ts` | CRUD | 创建/读取/更新/删除/列表 |
| 95 | `model-health.test.ts` | 模型健康 helper | 本地配置健康检查，不调用外部 API |
| 95b | `integration/models.test.ts` | 模型外部测试端点 | 调用外部 API 验证连通性（延后） |

### 3.8 🔴 POC 验收测试（5 集成测试）— 新增

| # | 文件 | 测试内容 | 对应 POC 验收项 |
|---|------|---------|----------------|
| 96 | `poc/terminal-full-stack.test.ts` | node-pty 编译通过 | POC #1 |
| 97 | `poc/terminal-full-stack.test.ts` | tmux attach I/O 双向正常 | POC #2 |
| 98 | `poc/terminal-full-stack.test.ts` | 浏览器 echo 测试（WS ↔ pty ↔ tmux） | POC #3 |
| 99 | `poc/terminal-full-stack.test.ts` | 断线重连恢复 | POC #4 |
| 100 | `poc/terminal-full-stack.test.ts` | 真实 Claude 交互（模拟输入输出） | POC #5 |

---

## 4. 前端单元测试清单

### 4.1 认证 Hook（8 单测）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 101 | `hooks/useAuth.test.tsx` | 登录状态 | 初始未登录、登录后状态更新 |
| 102 | `hooks/useAuth.test.tsx` | 登录/登出 | 登录成功、登录失败、登出 |
| 103 | `hooks/useAuth.test.tsx` | Token 管理 | Token 存储/读取/清除 |
| 104 | `hooks/useAuth.test.tsx` | **Token 过期处理** | Token 过期自动跳转登录 |
| 105 | `components/ProtectedRoute.test.tsx` | 路由守卫 | 未登录重定向、已登录放行 |

### 4.2 终端组件（10 单测）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 106 | `components/Terminal.test.tsx` | xterm.js 初始化 | 终端正确渲染 |
| 107 | `components/Terminal.test.tsx` | WebSocket 连接 | 连接建立/断开状态 |
| 108 | `components/Terminal.test.tsx` | 输入输出 | 键盘输入发送到 WS、终端输出渲染 |
| 109 | `components/Terminal.test.tsx` | Resize | 窗口大小调整 |
| 110 | `components/Terminal.test.tsx` | **断线重连** | 断线自动尝试重连 |
| 111 | `hooks/useTerminal.test.tsx` | 连接管理 | Hook 正确管理 WS 生命周期 |

### 4.3 项目组件（8 单测）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 112 | `components/ProjectList.test.tsx` | 列表渲染 | 项目列表正确显示 |
| 113 | `components/ProjectList.test.tsx` | 空状态 | 无项目时显示空状态 |
| 114 | `components/ProjectForm.test.tsx` | 表单验证 | 必填字段验证 |
| 115 | `components/ProjectForm.test.tsx` | 提交 | 表单提交成功 |

### 4.4 Agent/Skill/模板组件（14 单测）

| # | 文件 | 测试内容 | 预期用例 |
|---|------|---------|---------|
| 116 | `components/AgentForm.test.tsx` | 表单 | 创建/编辑 Agent |
| 117 | `components/SkillList.test.tsx` | 列表 | CRUD 交互 |
| 118 | `components/TemplateSelector.test.tsx` | 选择器 | 模板选择交互 |
| 119 | `agent-preview.test.ts` | 权限预览 helper | 工具列表、目录列表、scope/model 展示值 |

---

## 5. E2E 测试清单

### 5.1 核心场景（8 个 Happy Path）

| # | 场景 | 路径 | 验证点 |
|---|------|------|--------|
| E2E-001 | 新用户首次登录 | 注册 → 登录 → Dashboard | 登录成功，跳转 Dashboard |
| E2E-002 | 创建新项目 | Dashboard → 创建 → 保存 | 项目出现在列表 |
| E2E-003 | 创建会话并启动终端 | 项目 → 会话 → 终端 | 终端渲染成功，可输入输出 |
| E2E-004 | 配置 Agent | 会话 → Agent 管理 → 保存 → 启动 | Agent 配置生效 |
| E2E-005 | 创建并应用 Skill | Skill 管理 → 应用 → 保存 | Skill 生效 |
| E2E-006 | 导入现有项目 | 导入 → 扫描 → 确认 → 完成 | 项目导入成功 |
| E2E-007 | API Key 管理 | 设置 → 添加 → 查看 → 删除 | Key 管理全流程 |
| E2E-008 | 模型配置与测试 | 模型管理 → 添加 → 测试 → 保存 | 模型连通性验证 |
| E2E-010 | MVP-1 管理闭环 | 注册 → 模型/Key → 模板克隆 → Agent/Skill → 项目配置写入 | `.claude/agents` 与 `.claude/skills` 文件生成 |

### 5.2 🔴 异常路径场景（4 个）— 新增

| # | 场景 | 路径 | 验证点 | 优先级 |
|---|------|------|--------|--------|
| E2E-009 | **断线重连** | 终端操作 → 断开网络 10s → 重连 → 验证 scrollback 保留最近 500 行、终端状态恢复 | 终端状态恢复，历史记录可见 | **P0** |
| E2E-010 | 配置冲突处理 | 导入已有项目时遇到相同配置自动 skip；遇到 modified 冲突时提示用户预览并选择跳过/覆盖 → 验证结果 | 相同文件不误报失败，modified 冲突处理正确 | P1 |
| E2E-011 | 会话状态监控 | 创建会话 → 启动 → 观察状态变化（idle→running）→ 停止 | 状态变化实时反映 | P1 |
| E2E-012 | 多会话并行 | 创建 2 个会话 → 切换 → 验证互不干扰 | 会话隔离 | P2 |

---

## 6. 安全测试清单

### 6.1 OWASP Top 10 覆盖

| # | 类别 | 测试项 | 文件 | 状态 |
|---|------|--------|------|------|
| S01 | SQL 注入 | 参数化查询验证，所有 Repository 方法 | `integration/sql-injection.test.ts` | ✅ |
| S02 | XSS 防护 | 终端输出转义、用户输入渲染、**Skill 内容 HTML 标签** | `integration/xss.test.ts` | ✅ |
| S03 | 路径穿越 | 文件操作/项目扫描，`../../etc/passwd`、**Unicode `%2e%2e%2f`、双重编码** | `integration/path-traversal.test.ts` | ✅ |
| S04 | JWT 伪造 | 认证中间件，伪造签名、**alg:none 攻击**、**弱密钥爆破** | `integration/jwt-security.test.ts` | ✅ |
| S05 | 密钥泄露 | API Key 存储加密、日志过滤 | `integration/api-keys.test.ts` | ✅ |
| S06 | CSRF 防护 | 表单提交 Token 校验 | `integration/csrf.test.ts` | ✅ |
| S07 | 速率限制 | 登录端点、**API Key 创建端点** | `integration/rate-limit.test.ts` | ✅ |
| S08 | 加密强度 | AES-256-GCM 加密/解密、Auth Tag 验证 | `crypto.test.ts` | ✅ |

### 6.2 补充安全测试

| # | 测试项 | 描述 | 文件 | 优先级 |
|---|--------|------|------|--------|
| S09 | **API Key 轮换** | 更新 API Key 后，运行中的会话是否注入新 Key | `integration/api-key-rotation.test.ts` | P1 |
| S10 | **JWT 过期边界** | token 在过期前 1 秒/过期后 1 秒的行为 | `integration/jwt-edge.test.ts` | P1 |
| S11 | **多租户隔离渗透** | userA 尝试通过篡改 ID 访问 userB 的数据 | `integration/tenant-isolation.test.ts` | P0 |
| S12 | **tmux 会话枚举** | 猜测其他用户的 tmux session 名称并尝试 attach | `integration/tmux-enumeration.test.ts` | P1 |
| S13 | **WebSocket 洪水攻击** | 短时间内建立大量 WS 连接，验证限流生效 | `integration/ws-flood.test.ts` | P1 |
| S14 | **敏感日志泄露** | 验证日志中不出现密码、Token、API Key | `integration/log-safety.test.ts` | P0 |
| S15 | **输入超长攻击** | 超长输入导致 DoS 或缓冲区溢出 | `integration/input-fuzz.test.ts` | P1 |
| S16 | **CSP 配置验证** | 验证 Content Security Policy 正确配置 | `integration/csp.test.ts` | P1 |
| S17 | **HTTPOnly Cookie** | 验证认证 Cookie 设置 HTTPOnly / Secure 标志 | `integration/cookie-security.test.ts` | P1 |
| S18 | **CORS 配置** | 跨域请求仅允许配置白名单域名，拒绝未授权 Origin | `integration/cors.test.ts` | P1 |

---

## 7. 分阶段测试交付计划

### 7.1 Phase 0（Day 1-5）：基础设施

> **测试顺序调整：auth → DB → POC → crypto → 前端**（按评审建议调整）

| 天 | 测试模块 | 用例数 | 阻塞关系 |
|----|---------|--------|---------|
| Day 0.5 | **Mock 基础设施搭建**（`mocks/tmux.ts`、`mocks/pty.ts` 抽象接口） | — | 阻塞模块单测 |
| Day 1 | auth API 单测（15）+ 注册/登录集成测试（8） | 23 | 阻塞所有后续开发 |
| Day 2 | DB schema 迁移测试 + Repository 单测（25） | 25 | 阻塞所有业务模块 |
| Day 2.5 | **POC 终端全链路验证测试（5）** | 5 | 阻塞 B 模块开发 |
| Day 3 | crypto 单测（12） | 12 | 阻塞 API Key 功能 |
| Day 4 | 前端认证 Hook 测试 + 路由守卫测试（8） | 8 | 阻塞前端路由 |
| Day 5 | 缓冲 / 修复 | — | — |

**Phase 0 合计：** 73 用例 + Mock 基础设施

### 7.2 Phase 1（Day 6-12）：核心功能

| 天 | 测试模块 | 用例数 |
|----|---------|--------|
| Day 6-7 | 项目 API 单测（15）+ 集成测试（10） | 25 |
| Day 7-8 | 会话管理单测（20）+ 集成测试（10+6 tmux） | 36 |
| Day 9 | Agent 单测（11）+ 集成测试（6） | 17 |
| Day 9-10 | Skill 单测（10+1 XSS）+ 集成测试（8） | 19 |
| Day 10 | 模板单测（11）+ 集成测试 | 11 |
| Day 11 | API Key 单测 + 集成测试（8+1 轮换） | 9 |
| Day 12 | 缓冲 / 修复 | — |

**Phase 1 合计：** 117 用例

### 7.3 Phase 2（Day 13-20）：终端链路 + 前端组件

| 天 | 测试模块 | 用例数 |
|----|---------|--------|
| Day 13-14 | **WebSocket 单元测试（20）** | 20 |
| Day 14-15 | **终端代理集成测试**（`integration/terminal-proxy.test.ts`，10 用例，真实 tmux + pty） | 10 |
| Day 15-17 | 前端组件测试（32） | 32 |
| Day 18-19 | 前端终端组件测试（10） | 10 |
| Day 20 | 缓冲 / 修复 | — |

**Phase 2 合计：** 74 用例（+2 天缓冲）

### 7.4 Phase 3（Day 21-30）：E2E + 安全测试 + 验收

| 天 | 测试模块 | 用例数 |
|----|---------|--------|
| Day 21-23 | E2E 核心场景（8 个 Happy Path） | 8 |
| Day 24 | E2E 异常场景（4 个） | 4 |
| Day 25-27 | 安全测试（17 项） | 17 |
| Day 28 | POC 验收测试（5 项） | 5 |
| Day 29 | 覆盖率报告 + 回归测试 | — |
| Day 30 | 缓冲 / 修复 | — |

**Phase 3 合计：** 35 用例（+8 天）

### 7.5 总计

| 指标 | v1.0 计划 | v2.0 计划 | 变化 |
|------|----------|----------|------|
| 单元测试 | 120+ | **140+** | +20（WebSocket） |
| 集成测试 | 60+ | **80+** | +20（tmux/POC/安全） |
| 前端单测 | 40+ | **40+** | 持平 |
| E2E 场景 | 8 | **12** | +4（异常路径） |
| 安全测试 | 8 | **18** | +10 |
| **总计** | **230+** | **275+** | **+45** |
| 预估工期 | 26 天 | **28-32 天** | +2-6 天 |

---

## 8. 覆盖率目标总表

| 模块 | lines | functions | branches |
|------|-------|-----------|----------|
| `crypto/*` | 90% | 85% | 95% |
| `auth/*` | 80% | 75% | 90% |
| `db/repositories/*` | 80% | 75% | 90% |
| `services/session-manager.ts` | 80% | 75% | 90% |
| `services/terminal-proxy.ts` | 80% | 75% | 90% |
| `services/config-generator.ts` | 80% | 75% | 90% |
| `services/project-scanner.ts` | 80% | 75% | 90% |
| `routes/*` | 80% | 75% | 90% |
| `middleware/*` | 80% | 75% | 90% |
| `adapters/*` | 80% | 75% | 90% |
| **`websocket/*`** | **90%** | **85%** | **95%** |
| `poc/*` | 80% | 75% | 90% |
| `frontend/components/*` | 80% | 75% | 90% |
| `frontend/hooks/*` | 80% | 75% | 90% |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| POC 测试未通过 | 终端方案需要调整，后续 B 模块测试废弃 | Day 2.5 前完成 POC 验证，不通过则暂停 |
| tmux Mock 与真实行为差异 | 集成测试通过但生产环境失败 | 集成测试必须用真实 tmux |
| node-pty 跨平台兼容性 | 不同 OS 行为差异 | CI 增加多平台测试 |
| 前端组件测试工时超标 | Phase 2 延期 | 前端组件测试降为冒烟测试 |
| E2E 调试耗时超预期 | Phase 3 延期 | 优先覆盖 happy path，异常路径用集成测试替代 |
| 28-32 天排期超出 26 天目标 | MVP 延期 | 如工期不可延长，裁剪 P2 前端组件测试，保核心路径 |
