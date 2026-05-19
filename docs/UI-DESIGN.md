# OpenForge UI 设计文档

> 版本：v1.0 | 2026-04-25
> 作者：火珂 🎨（UI/UX 设计师）
> 状态：初稿待评审
> 基于文档：PRD-v1.1-MVP.md + TECH-ARCHITECTURE.md + DEVELOPMENT-PLAN.md

---

## 一、设计原则

### 1.1 核心设计理念

| 原则 | 说明 |
|------|------|
| **专业开发者风格** | 深色主题优先，终端风格，对标 VS Code / Linear / Vercel Dashboard |
| **技术感强但不花哨** | 克制的设计语言，功能优先于装饰，避免过度动画和渐变 |
| **高功能密度** | 开发者需要一眼看到更多信息，减少留白，紧凑布局 |
| **终端为核心** | 终端页面是产品差异化所在，其他页面围绕终端服务 |
| **移动端辅助管理** | 移动端只用于查看状态、简单操作，不提供完整终端功能 |

### 1.2 设计对标

| 参考产品 | 借鉴点 |
|----------|--------|
| **VS Code** | 侧边栏导航、终端面板、命令面板交互模式 |
| **Linear** | 极简列表、键盘快捷键、深色主题配色体系 |
| **Vercel Dashboard** | 卡片式仪表盘、状态标签、项目列表布局 |
| **GitHub Codespaces** | Web 终端集成、会话管理界面 |

---

## 二、信息架构

### 2.1 导航结构

```
OpenForge
├── 登录/注册                          → /login, /register
│
├── 仪表盘 (Dashboard)                 → /
│   ├── 全局统计卡片                    → 项目数/会话数/Agent数/Skill数
│   ├── 活跃会话列表                    → 最近活跃的 5 个会话
│   ├── 健康检查报告                    → 配置缺失警告
│   └── 通知中心                        → 会话完成/报错通知
│
├── 项目管理 (Projects)                → /projects
│   ├── 项目列表                        → 卡片/列表双视图
│   ├── 创建项目向导                    → /projects/new (多步骤表单)
│   ├── 导入项目向导                    → /projects/import (扫描+冲突处理)
│   └── 项目详情                        → /projects/:id
│       ├── 基本信息
│       ├── 会话列表
│       ├── Agent 列表
│       └── Skill 列表
│
├── 会话管理 (Sessions)                → /sessions
│   ├── 会话仪表盘                      → 按项目分组的会话列表
│   └── 会话详情 + 终端                 → /sessions/:id
│       ├── xterm.js 终端区域           → 核心功能区，占屏 70%+
│       ├── 侧边栏（可选）              → Agent 切换/模型切换/会话信息
│       └── 底部状态栏                  → 连接状态/当前模型/工作目录
│
├── Agent 管理 (Agents)                → /agents
│   ├── Agent 列表                      → 表格视图
│   ├── 创建/编辑 Agent                 → /agents/new, /agents/:id/edit
│   └── Agent 详情                      → /agents/:id
│
├── Skill 管理 (Skills)                → /skills
│   ├── Skill 列表                      → 卡片视图
│   ├── Skill 详情/编辑                 → /skills/:id
│   └── 安装新 Skill                    → /skills/install
│
├── 模板管理 (Templates)               → /templates
│   ├── 模板列表                        → 卡片视图（内置/自定义分组）
│   ├── 模板详情                        → /templates/:id
│   └── 模板编辑                        → /templates/:id/edit
│
├── 模型管理 (Models)                   → /models
│   ├── 模型列表                        → 表格视图
│   ├── 添加/编辑模型                   → /models/new, /models/:id/edit
│   └── API Key 管理                    → /models/api-keys
│
└── 设置 (Settings)                     → /settings
    ├── 个人资料
    ├── 主题切换
    └── 关于
```

### 2.2 页面层级关系

```
Level 1 (主导航): 仪表盘 | 项目 | 会话 | Agent | Skill | 模板 | 模型 | 设置
    │
    ├── Level 2 (列表页): 各模块的列表视图
    │       │
    │       └── Level 3 (详情页): 单个资源的详情/编辑
    │               │
    │               └── Level 4 (子功能): 如会话详情中的终端、项目详情中的子列表
    │
    └── 特殊流程: 创建向导（多步骤）、导入向导（扫描+确认）
```

### 2.3 全局导航设计

**桌面端（PC）：** 左侧固定侧边栏导航（宽度 220px），类似 VS Code Activity Bar + Sidebar 组合。

```
┌──────────┬──────────────────────────────────────────┐
│ Logo     │                                          │
│          │            主内容区                       │
│ [仪表盘] │                                          │
│ [项目]   │                                          │
│ [会话]   │                                          │
│ [Agent]  │                                          │
│ [Skill]  │                                          │
│ [模板]   │                                          │
│ [模型]   │                                          │
│ [设置]   │                                          │
│          │                                          │
│ ──────── │                                          │
│ [用户头像]│                                         │
└──────────┴──────────────────────────────────────────┘
```

**移动端：** 顶部汉堡菜单 + 底部 Tab 导航（仅保留核心入口：仪表盘/项目/会话）。

---

## 三、页面线框图

### 3.1 登录/注册页面

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                    OpenForge                        │
│                 AI IDE Control Platform             │
│                                                     │
│         ┌───────────────────────────────┐          │
│         │                               │          │
│         │  Email:  [________________]   │          │
│         │                               │          │
│         │  Password: [______________]   │          │
│         │                               │          │
│         │  [ ] Remember me              │          │
│         │                               │          │
│         │      [  Sign In  ]            │          │
│         │                               │          │
│         │  Don't have an account?       │          │
│         │  [Sign up]                    │          │
│         │                               │          │
│         └───────────────────────────────┘          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**设计要点：**
- 居中卡片布局，最大宽度 400px
- 深色背景（`#0d1117`），卡片背景（`#161b22`）
- 输入框使用 shadcn/ui Input 组件，带焦点环
- 登录按钮使用 Primary Button（蓝色 `#2f81f7`）
- 注册链接使用 Text Link 样式
- 表单验证错误显示在输入框下方，红色文字

---

### 3.2 Dashboard（全局仪表盘）

```
┌──────────────────────────────────────────────────────────────────┐
│  OpenForge                                    [🔔 3] [👤 User ▼]│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐ │
│  │  Projects    │ │  Sessions    │ │  Agents      │ │ Skills │ │
│  │    12        │ │     5        │ │     8        │ │   15   │ │
│  │  ↑ 2 this wk │ │  ● 3 active  │ │  ○ 2 idle    │ │        │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘ │
│                                                                  │
│  Active Sessions                              [+ New Session]   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Name          Project        Status     Model       Action│  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ session-alpha my-app         ● Running  Sonnet 4    [→]  │  │
│  │ session-beta  api-service    ○ Idle     GPT-4      [→]  │  │
│  │ session-gamma docs-site      ⚠ Error    -          [→]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Health Check                                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ⚠ my-app: Missing .claude/CLAUDE.md          [Fix Now]  │  │
│  │ ⚠ api-service: Outdated agent config         [Fix Now]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Notifications                                   [Mark All Read]│
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🔔 session-alpha completed task "Refactor auth"   2m ago │  │
│  │ ⚠ session-gamma encountered error                 15m ago│  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 统计卡片：4 列网格，每个卡片显示总数 + 状态摘要
- 活跃会话列表：表格形式，状态用彩色圆点标识（● 运行中绿色、○ 空闲灰色、⚠ 错误红色）
- 健康检查：警告列表，每条带快速修复按钮
- 通知中心：时间倒序，未读加粗
- 所有列表支持「查看全部」跳转到对应模块

---

### 3.3 项目管理 - 项目列表

```
┌──────────────────────────────────────────────────────────────────┐
│  Projects                                     [+ New Project]    │
├──────────────────────────────────────────────────────────────────┤
│  [Search projects...]                           [View: □ ■ ▼]   │
│                                                                  │
│  Card View:                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ my-app       │ │ api-service  │ │ docs-site    │            │
│  │ TypeScript   │ │ Python       │ │ Next.js      │            │
│  │ Claude Code  │ │ OpenCode     │ │ Claude Code  │            │
│  │              │ │              │ │              │            │
│  │ Sessions: 3  │ │ Sessions: 1  │ │ Sessions: 0  │            │
│  │ Agents: 2    │ │ Agents: 1    │ │ Agents: 0    │            │
│  │              │ │              │ │              │            │
│  │ [Open] [⋮]   │ │ [Open] [⋮]   │ │ [Open] [⋮]   │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
│  List View:                                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Name         Tech Stack    AI Tool   Sessions  Actions   │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ my-app       TS, React     Claude    3         [→] [⋮]  │  │
│  │ api-service  Python        OpenCode  1         [→] [⋮]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 默认卡片视图，右上角可切换列表视图
- 卡片显示：项目名称、技术栈标签、AI 工具图标、会话/Agent 计数
- 搜索框支持按名称过滤
- 「更多」菜单（⋮）包含：编辑、删除、导出配置

---

### 3.4 项目管理 - 创建项目向导（多步骤表单）

```
Step 1: Basic Info                    Step 2: AI Tool         Step 3: Template        Step 4: Confirm
[●━━━━━○━━━━━○━━━━━○]

┌──────────────────────────────────────────────────────────────────┐
│  Create New Project                                              │
│                                                                  │
│  Project Name:  [my-new-project________________________]        │
│                                                                  │
│  Project Path:  [/home/user/projects/my-new-project_____]       │
│               [Browse...]                                        │
│                                                                  │
│  Description:   [________________________________________]      │
│                 [Optional]                                       │
│                                                                  │
│  Tech Stack:    [TypeScript] [React] [Node.js] [+]             │
│                                                                  │
│                                                                  │
│                                  [Cancel]  [Next →]             │
└──────────────────────────────────────────────────────────────────┘
```

**步骤拆解：**

| 步骤 | 内容 | 校验 |
|------|------|------|
| Step 1 | 项目名称、路径、描述、技术栈 | 名称必填、路径必填且有效 |
| Step 2 | 选择 AI 工具（Claude Code / OpenCode / Codex） | 必选 |
| Step 3 | 选择规范模板（内置模板列表 + 预览） | 必选 |
| Step 4 | 确认摘要 + 生成配置 | 展示即将创建的文件列表 |

**设计要点：**
- 顶部步骤指示器，当前步骤高亮
- 每步独立表单，上一步数据保留
- Step 3 模板选择：卡片网格，悬停预览模板内容
- Step 4 确认页：展示项目摘要 + 将要生成的文件树
- 最后一步按钮变为「Create & Generate Config」

---

### 3.5 项目管理 - 导入项目向导

```
┌──────────────────────────────────────────────────────────────────┐
│  Import Existing Project                                         │
│                                                                  │
│  Project Path:  [/home/user/existing-project____________]       │
│               [Browse...]  [Scan]                                │
│                                                                  │
│  Scan Results:                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Detected AI Tool: Claude Code                            │  │
│  │                                                          │  │
│  │ Existing Config:                                         │  │
│  │   ✅ .claude/CLAUDE.md                                   │  │
│  │   ✅ .claude/settings.json                               │  │
│  │   ❌ .claude/agents/ (missing)                           │  │
│  │   ❌ .claude/rules/ (missing)                            │  │
│  │                                                          │  │
│  │ Conflict:                                                │  │
│  │   ⚠ .claude/CLAUDE.md differs from template              │  │
│  │     [Keep Existing] [Overwrite] [Merge]                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Inject Missing Config:                                          │
│  [x] Add missing agents                                          │
│  [x] Add missing rules                                           │
│  [ ] Overwrite existing CLAUDE.md                                │
│                                                                  │
│                                  [Cancel]  [Import & Inject]    │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 路径输入 + 扫描按钮，扫描后显示检测结果
- 检测结果分三类：✅ 已存在且匹配、❌ 缺失、⚠ 冲突
- 冲突项提供三种处理方式：保留现有/覆盖/合并（合并在 MVP 简化为让用户手动选择）
- 复选框控制要注入的内容
- 导入按钮二次确认对话框

---

### 3.6 会话管理 - 会话列表

```
┌──────────────────────────────────────────────────────────────────┐
│  Sessions                                      [+ New Session]   │
├──────────────────────────────────────────────────────────────────┤
│  Filter: [All Projects ▼]  [All Status ▼]  [Search...]          │
│                                                                  │
│  Grouped by Project:                                             │
│                                                                  │
│  📁 my-app                                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Name            Status     Model        Last Active      │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ feat-auth       ● Running  Sonnet 4     2 min ago  [→]  │  │
│  │ fix-bug-123     ○ Idle     Sonnet 4     1 hr ago   [→]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  📁 api-service                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ refactor-api    ● Running  GPT-4       Just now   [→]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 按项目分组显示，每组可折叠
- 状态列：彩色圆点 + 文字
- 「Last Active」相对时间显示
- 每行末尾「→」按钮进入终端页面
- 支持按项目/状态过滤 + 关键词搜索

---

### 3.7 会话管理 - 终端页面（核心！）

这是 OpenForge 的核心差异化功能，重点设计。下面给出两种布局方案。

#### 方案 A：经典 IDE 布局（推荐 MVP 采用）

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back  session-alpha (my-app)              [⚙] [⏹ Stop] [×]  │
├──────────┬───────────────────────────────────────────┬──────────┤
│          │                                           │          │
│ Sidebar  │           Terminal Area                   │ Info     │
│ (220px)  │           (flexible, resizable)           │ Panel    │
│          │                                           │ (280px)  │
│ Agents:  │  chaos-team@dev:~/my-app$ claude          │          │
│ ○ planner│  Welcome to Claude Code!                  │ Session: │
│ ● coder  │                                           │ session- │
│ ○ reviewer                                            │ alpha    │
│          │  > What would you like to build?          │          │
│ Skills:  │                                           │ Project: │
│ [x] plan-workflow                                     │ my-app   │
│ [ ] review                                            │          │
│          │                                           │ Model:   │
│ Files:   │                                           │ Sonnet 4 │
│ src/     │                                           │ [Change] │
│ tests/   │                                           │          │
│          │                                           │ Status:  │
│          │                                           │ ● Active │
│          │                                           │          │
│          │                                           │ Uptime:  │
│          │                                           │ 15m 32s  │
│          │                                           │          │
│          │                                           │ [Logs]   │
│          │                                           │          │
├──────────┴───────────────────────────────────────────┴──────────┤
│  Connected  │  my-app/src  │  Sonnet 4  │  UTF-8  │  Ln 1, Col 1│
└──────────────────────────────────────────────────────────────────┘
```

**布局说明：**
- **顶部工具栏**：返回按钮、会话名称、设置、停止会话、关闭
- **左侧边栏（220px，可折叠）**：Agent 切换、Skill 开关、文件树（可选）
- **中央终端区（弹性宽度）**：xterm.js 渲染区域，占据主要空间
- **右侧信息面板（280px，可折叠）**：会话信息、模型切换、状态、快捷操作
- **底部状态栏**：连接状态、工作目录、当前模型、编码、光标位置

**推荐理由：**
1. **熟悉感**：对标 VS Code 布局，开发者零学习成本
2. **信息分层清晰**：左侧操作、中间执行、右侧监控
3. **可扩展**：侧边栏可折叠，终端区自适应
4. **MVP 可实现**：shadcn/ui 有现成的 Resizable 组件

---

#### 方案 B：沉浸式终端布局（P2 备选）

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back  session-alpha                    [⚙] [⏹] [≡ Menu] [×] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                                                                  │
│                                                                  │
│              Full-Screen Terminal Area                           │
│                                                                  │
│  chaos-team@dev:~/my-app$ claude                                 │
│  Welcome to Claude Code!                                         │
│                                                                  │
│  > What would you like to build?                                 │
│                                                                  │
│                                                                  │
│                                                                  │
│                                                                  │
│                                                                  │
│                                                                  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  ● Connected  │  my-app/src  │  Sonnet 4  │  15m 32s            │
└──────────────────────────────────────────────────────────────────┘

  [Menu] 展开抽屉式侧边栏：
  ┌──────────────┐
  │ Agents       │
  │ ○ planner    │
  │ ● coder      │
  │ Skills       │
  │ [x] plan     │
  │ Model        │
  │ Sonnet 4 [▼] │
  └──────────────┘
```

**布局说明：**
- 终端占据几乎全部屏幕
- 侧边栏改为抽屉式（从左侧滑出），默认隐藏
- 右侧信息面板移除，关键信息整合到底部状态栏
- 通过顶部「Menu」按钮或快捷键唤起侧边栏

**适用场景：**
- 重度终端用户，需要最大化终端可视区域
- 作为「专注模式」可选切换

**不推荐 MVP 采用的原因：**
- 抽屉式交互增加认知负担
- 信息密度降低，需要额外点击才能看到 Agent/模型信息
- 开发成本高（动画、手势处理）

---

#### 方案对比总结

| 维度 | 方案 A（经典 IDE） | 方案 B（沉浸式） |
|------|-------------------|-----------------|
| 终端可视面积 | ~60% | ~90% |
| 信息可见性 | 高（常驻侧边栏） | 低（需展开抽屉） |
| 学习成本 | 低（VS Code 同款） | 中（新交互模式） |
| 开发复杂度 | 中（Resizable 组件） | 高（抽屉动画+手势） |
| MVP 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐ |

**最终推荐：方案 A 作为 MVP 默认布局，方案 B 作为 P2「专注模式」可选。**

---

### 3.8 Agent 管理 - Agent 列表

```
┌──────────────────────────────────────────────────────────────────┐
│  Agents                                         [+ New Agent]    │
├──────────────────────────────────────────────────────────────────┤
│  Filter: [All Projects ▼]  [Search...]                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Name        Project     Model       Tools      Status    │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ planner     my-app      Sonnet 4    read,bash  ● Active  │  │
│  │ coder       my-app      Sonnet 4    read,write ● Active  │  │
│  │ reviewer    global      Opus        read       ○ Idle    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [1-3 of 8]  [< Prev] [1] [2] [3] [Next >]                    │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 表格视图，支持排序（点击表头）
- Tools 列显示为标签（`read` `write` `bash`）
- Status 列彩色圆点
- 分页控制在底部
- 每行悬停显示操作按钮：编辑、删除

---

### 3.9 Agent 管理 - 创建/编辑 Agent

```
┌──────────────────────────────────────────────────────────────────┐
│  Create Agent                                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Name:        [coder_______________________________]            │
│                                                                  │
│  Description: [AI coding assistant with write access__]        │
│               [Optional]                                         │
│                                                                  │
│  Project:     [my-app ____________________________▼]            │
│               [global] means available to all projects           │
│                                                                  │
│  Model:       [Claude Sonnet 4 ___________________▼]            │
│                                                                  │
│  Allowed Tools:                                                  │
│  [x] Read files                                                  │
│  [x] Write files                                                 │
│  [ ] Execute commands                                            │
│  [ ] Use bash                                                    │
│  [ ] Web search                                                  │
│                                                                  │
│  Allowed Directories:                                            │
│  [/src_______________________] [Add]                            │
│  [/tests_____________________] [Add]                            │
│  [Leave empty for full project access]                          │
│                                                                  │
│  Custom System Prompt:                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ You are a coding assistant specialized in...             │  │
│  │                                                          │  │
│  │                                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│                                  [Cancel]  [Save Agent]         │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 表单垂直排列，字段间留白适中
- Tools 用 Checkbox Group
- Directories 用 Tag Input（添加后显示为可删除标签）
- System Prompt 用 TextArea，支持 Markdown 预览
- 保存前二次确认（如果修改了权限范围）

---

### 3.10 Skill 管理 - Skill 列表

```
┌──────────────────────────────────────────────────────────────────┐
│  Skills                                      [+ New] [Install]   │
├──────────────────────────────────────────────────────────────────┤
│  Filter: [All Projects ▼]  [Source: All ▼]  [Search...]         │
│                                                                  │
│  Card Grid:                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ plan-workflow│ │ review-code  │ │ test-gen     │            │
│  │ Local        │ │ ClawHub      │ │ GitHub       │            │
│  │              │ │              │ │              │            │
│  │ Generates    │ │ Reviews PRs  │ │ Auto-generates│           │
│  │ structured   │ │ and suggests │ │ unit tests   │            │
│  │ plans        │ │ improvements │ │              │            │
│  │              │ │              │ │              │            │
│  │ [Enabled ✓]  │ │ [Disabled]   │ │ [Enabled ✓]  │            │
│  │ [Edit] [⋮]   │ │ [Enable] [⋮] │ │ [Edit] [⋮]   │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 卡片网格布局（3 列）
- 每张卡片显示：Skill 名称、来源标签（Local/ClawHub/GitHub）、描述、启用状态
- 启用/禁用用 Toggle Switch
- 「更多」菜单：编辑、删除、查看详情

---

### 3.11 Skill 管理 - Skill 编辑

```
┌──────────────────────────────────────────────────────────────────┐
│  Edit Skill: plan-workflow                         [Save] [×]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Name:        [plan-workflow_______________________]            │
│                                                                  │
│  Description: [Generate structured development plans_]          │
│                                                                  │
│  Content (SKILL.md):                                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ---                                                        │  │
│  │ name: plan-workflow                                        │  │
│  │ description: Generate structured plans                     │  │
│  │ ---                                                        │  │
│  │                                                            │  │
│  │ When the user asks for a plan, follow these steps:         │  │
│  │ 1. Analyze the requirements                                │  │
│  │ 2. Break down into tasks                                   │  │
│  │ ...                                                        │  │
│  │                                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Markdown Preview: [Toggle]                                    │
│                                                                  │
│  Applied to Projects:                                            │
│  [x] my-app    [x] api-service    [ ] docs-site                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 名称和描述用普通输入框
- Content 用代码编辑器（Monaco Editor 或 CodeMirror），支持语法高亮
- 可切换 Markdown 预览模式
- 项目应用用 Checkbox Group

---

### 3.12 模板管理 - 模板列表

```
┌──────────────────────────────────────────────────────────────────┐
│  Templates                                    [+ New Template]   │
├──────────────────────────────────────────────────────────────────┤
│  Tabs: [Built-in (3)] [Custom (2)]                              │
│                                                                  │
│  Built-in Templates:                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ Harness Eng. │ │ Minimal      │ │ Full Stack   │            │
│  │ v2.1         │ │ v1.0         │ │ v1.5         │            │
│  │              │ │              │ │              │            │
│  │ Complete     │ │ Lightweight  │ │ For full-    │            │
│  │ harness with │ │ config for   │ │ stack projects│            │
│  │ agents+rules │ │ quick start  │ │ with DB/API  │            │
│  │              │ │              │ │              │            │
│  │ Used 128x    │ │ Used 45x     │ │ Used 67x     │            │
│  │ [Preview]    │ │ [Preview]    │ │ [Preview]    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- Tab 切换内置/自定义模板
- 卡片显示：模板名称、版本、描述、使用次数
- 「Preview」按钮弹出模态框展示模板文件树和内容摘要

---

### 3.13 模板管理 - 模板编辑

```
┌──────────────────────────────────────────────────────────────────┐
│  Edit Template: Harness Engineering v2.1          [Save] [×]    │
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                      │
│ Files:   │  File Editor                                         │
│          │                                                      │
│ 📄 .claude/                                                     │
│   CLAUDE.md  [●]                                               │
│   settings.json [ ]                                            │
│ 📄 .claude/agents/                                             │
│   planner.md   [ ]                                             │
│   coder.md     [ ]                                             │
│ 📄 .claude/rules/                                              │
│   frontend.md  [ ]                                             │
│   backend.md   [ ]                                             │
│          │  ┌────────────────────────────────────────────────┐ │
│          │  │ # CLAUDE.md                                    │ │
│          │  │                                                │ │
│          │  │ ## Current State                               │ │
│          │  │ This is a TypeScript + React project...        │ │
│          │  │                                                │ │
│          │  │ ## Workflow                                    │ │
│          │  │ 1. Always create a plan first                  │ │
│          │  │ ...                                            │ │
│          │  └────────────────────────────────────────────────┘ │
│          │  [Markdown Preview]                                 │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

**设计要点：**
- 左侧文件树，当前编辑文件高亮（● 标记）
- 右侧代码编辑器，支持语法高亮
- 可切换 Markdown 预览
- 保存时提示影响的文件数量

---

### 3.14 模型管理 - 模型列表

```
┌──────────────────────────────────────────────────────────────────┐
│  Models                                         [+ Add Model]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Name              Provider    Endpoint          Default  │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ Claude Sonnet 4   Anthropic   (default)         [★]     │  │
│  │ Claude Opus       Anthropic   (default)         [ ]     │  │
│  │ GPT-4             OpenAI      (default)         [ ]     │  │
│  │ Gemini Pro        Google      custom endpoint   [ ]     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  API Keys Management                              [Manage Keys] │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Provider       Label         Status        Last Used     │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ Anthropic      Primary Key   ● Active      2 min ago     │  │
│  │ OpenAI         Dev Key       ● Active      1 hr ago      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- 模型列表：表格视图，Default 列用星号标识
- API Key 管理：独立区块，显示 Provider/Label/Status/Last Used
- 「Manage Keys」跳转到独立的 API Key 管理页面

---

### 3.15 模型管理 - 添加模型

```
┌──────────────────────────────────────────────────────────────────┐
│  Add Model                                                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Name:        [My Custom Model____________________]             │
│                                                                  │
│  Provider:    [Anthropic __________________________▼]           │
│               Options: Anthropic / OpenAI / Google / Custom     │
│                                                                  │
│  Model ID:    [claude-sonnet-4-20250514___________]             │
│                                                                  │
│  Endpoint:    [(default) _________________________]             │
│               [Leave blank for default endpoint]                │
│                                                                  │
│  API Key:     [Select existing key _______________▼]            │
│               Or [Add new key...]                               │
│                                                                  │
│  Set as Default: [ ]                                             │
│                                                                  │
│  [Test Connection]                                               │
│  Result: ● Connected (latency: 245ms)                           │
│                                                                  │
│                                  [Cancel]  [Save Model]         │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点：**
- Provider 下拉选择，选择后动态显示对应字段
- API Key 可选择已有 Key 或添加新 Key
- 「Test Connection」按钮实时测试端点连通性
- 测试结果用彩色状态标识

---

## 四、响应式策略

### 4.1 断点定义

| 断点 | 宽度范围 | 设备类型 |
|------|----------|----------|
| `sm` | < 640px | 手机竖屏 |
| `md` | 640px - 1024px | 平板 / 手机横屏 |
| `lg` | > 1024px | 桌面 PC |

### 4.2 各断点布局差异

#### 桌面端（lg, > 1024px）

- **导航**：左侧固定侧边栏（220px）
- **列表页**：多列网格或完整表格
- **终端页面**：三栏布局（侧边栏 + 终端 + 信息面板）
- **表单**：单列表单，最大宽度 600px 居中

#### 平板端（md, 640px - 1024px）

- **导航**：左侧侧边栏缩小为图标栏（60px），文字标签隐藏
- **列表页**：2 列网格，表格横向滚动
- **终端页面**：两栏布局（终端 + 可折叠信息面板），侧边栏改为抽屉式
- **表单**：单列表单，全宽

#### 手机端（sm, < 640px）

- **导航**：顶部汉堡菜单 + 底部 Tab 栏（仅 3 个核心入口：仪表盘/项目/会话）
- **列表页**：单列卡片堆叠，无表格
- **终端页面**：**降级为只读模式** — 显示会话状态、最后输出摘要，提供「在外部终端打开」链接
- **表单**：单列表单，全宽，输入框增大触控区域

### 4.3 移动端功能降级清单

| 功能 | 桌面端 | 平板端 | 手机端 |
|------|--------|--------|--------|
| 终端交互 | ✅ 完整 xterm.js | ✅ 完整 xterm.js | ❌ 只读状态 + 外部打开 |
| 侧边栏 | ✅ 固定显示 | ⚠️ 抽屉式 | ❌ 隐藏 |
| 信息面板 | ✅ 固定显示 | ⚠️ 可折叠 | ❌ 隐藏 |
| 多列网格 | ✅ 3-4 列 | ✅ 2 列 | ✅ 1 列 |
| 表格视图 | ✅ 完整表格 | ⚠️ 横向滚动 | ❌ 卡片替代 |
| 创建向导 | ✅ 多步骤表单 | ✅ 多步骤表单 | ✅ 简化表单 |
| 代码编辑器 | ✅ Monaco Editor | ✅ Monaco Editor | ⚠️ 纯 TextArea |
| Markdown 预览 | ✅ 并排预览 | ⚠️ Tab 切换 | ⚠️ Tab 切换 |

### 4.4 移动端终端降级方案

**为什么终端在移动端降级？**
- xterm.js 在触摸屏上体验差（无物理键盘、虚拟键盘遮挡）
- 开发者在手机上不会进行重度编码
- 保持 MVP 范围可控

**降级后的手机端会话详情页：**

```
┌─────────────────────────────┐
│  ← Back                     │
│                             │
│  session-alpha              │
│  Project: my-app            │
│  Status: ● Running          │
│  Model: Sonnet 4            │
│  Uptime: 15m 32s            │
│                             │
│  ─────────────────────────  │
│  Last Output (50 lines):    │
│  ┌─────────────────────────┐│
│  │ chaos-team@dev:~$      ││
│  │ claude                  ││
│  │ Welcome to Claude Code! ││
│  │ > What would you like   ││
│  │   to build?             ││
│  │                         ││
│  └─────────────────────────┘│
│                             │
│  [Open in External Terminal]│
│  Command:                   │
│  tmux attach -t of-xxx      │
│  [Copy]                     │
│                             │
└─────────────────────────────┘
```

---

## 五、组件规范

### 5.1 shadcn/ui 组件选型表

| 页面/模块 | 使用的 shadcn/ui 组件 |
|-----------|----------------------|
| **全局布局** | `Sidebar`, `ResizablePanelGroup`, `Separator` |
| **登录/注册** | `Card`, `Input`, `Button`, `Label`, `Checkbox` |
| **Dashboard** | `Card`, `Badge`, `Table`, `Button`, `Avatar`, `DropdownMenu` |
| **项目列表** | `Card`, `Button`, `Input` (search), `DropdownMenu`, `Tabs` |
| **创建向导** | `Stepper` (custom), `Input`, `Select`, `Button`, `Dialog` |
| **导入向导** | `Input`, `Button`, `Alert`, `Checkbox`, `Dialog` |
| **会话列表** | `Table`, `Badge`, `Button`, `Select`, `Input` |
| **终端页面** | `ResizablePanelGroup`, `ScrollArea`, `Button`, `DropdownMenu`, `Tooltip` |
| **Agent 列表** | `Table`, `Badge`, `Button`, `Dialog` (edit) |
| **Agent 表单** | `Input`, `Select`, `Checkbox`, `Textarea`, `Button`, `TagInput` (custom) |
| **Skill 列表** | `Card`, `Switch`, `Button`, `DropdownMenu` |
| **Skill 编辑** | `Input`, `Textarea`, `CodeEditor` (Monaco wrapper), `Checkbox` |
| **模板列表** | `Card`, `Tabs`, `Button`, `Dialog` (preview) |
| **模板编辑** | `Tree` (custom), `CodeEditor`, `Button` |
| **模型列表** | `Table`, `Button`, `Badge` |
| **添加模型** | `Input`, `Select`, `Button`, `Alert` (test result) |
| **通知** | `Toast`, `Badge`, `DropdownMenu` |
| **通用** | `Dialog`, `Toast`, `Tooltip`, `Popover`, `Skeleton`, `Alert` |

### 5.2 颜色系统

**深色主题（默认）：**

| Token | 值 | 用途 |
|-------|-----|------|
| `--background` | `#0d1117` | 页面背景 |
| `--foreground` | `#c9d1d9` | 主要文字 |
| `--card` | `#161b22` | 卡片背景 |
| `--card-foreground` | `#c9d1d9` | 卡片文字 |
| `--primary` | `#2f81f7` | 主按钮、链接 |
| `--primary-foreground` | `#ffffff` | 主按钮文字 |
| `--secondary` | `#21262d` | 次要按钮背景 |
| `--secondary-foreground` | `#c9d1d9` | 次要按钮文字 |
| `--muted` | `#21262d` | 禁用/次要背景 |
| `--muted-foreground` | `#8b949e` | 次要文字 |
| `--accent` | `#1f6feb` | 悬停/聚焦 |
| `--destructive` | `#f85149` | 危险操作 |
| `--border` | `#30363d` | 边框 |
| `--input` | `#21262d` | 输入框背景 |
| `--ring` | `#2f81f7` | 焦点环 |

**状态颜色：**

| 状态 | 颜色 | 用途 |
|------|------|------|
| Success | `#3fb950` | 运行中、成功 |
| Warning | `#d29922` | 警告、空闲 |
| Error | `#f85149` | 错误、失败 |
| Info | `#58a6ff` | 信息提示 |

**终端配色（xterm.js 默认 ANSI）：**
- 使用 xterm.js 默认深色主题，与页面背景协调
- 前景色 `#c9d1d9`，背景色 `#0d1117`

### 5.3 字体系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-sans` | `Inter, system-ui, sans-serif` | UI 文字 |
| `--font-mono` | `JetBrains Mono, Fira Code, monospace` | 代码、终端 |

**字号阶梯：**

| Token | 大小 | 行高 | 用途 |
|-------|------|------|------|
| `text-xs` | 12px | 16px | 标签、元数据 |
| `text-sm` | 14px | 20px | 正文、表格内容 |
| `text-base` | 16px | 24px | 主要正文 |
| `text-lg` | 18px | 28px | 小标题 |
| `text-xl` | 20px | 28px | 页面标题 |
| `text-2xl` | 24px | 32px | 大标题 |

**终端字体：**
- 固定使用 JetBrains Mono 14px，行高 1.4
- 支持 ligatures（连字）

### 5.4 间距系统

基于 Tailwind CSS 默认 spacing scale：

| Token | 值 | 用途 |
|-------|-----|------|
| `space-1` | 4px | 紧密元素间距 |
| `space-2` | 8px | 小组件内边距 |
| `space-3` | 12px | 常规内边距 |
| `space-4` | 16px | 卡片内边距、元素间距 |
| `space-6` | 24px | 区块间距 |
| `space-8` | 32px | 大区块间距 |

**页面内边距：**
- 桌面端：`p-6`（24px）
- 平板端：`p-4`（16px）
- 手机端：`p-3`（12px）

### 5.5 圆角系统

| Token | 值 | 用途 |
|-------|-----|------|
| `rounded-sm` | 2px | 按钮、输入框 |
| `rounded-md` | 6px | 卡片、弹窗 |
| `rounded-lg` | 8px | 大卡片 |
| `rounded-full` | 9999px | 头像、徽章 |

---

## 六、交互说明

### 6.1 创建项目向导（多步骤表单）

**交互流程：**

```
Step 1: Basic Info
  1. 用户输入项目名称 → 实时校验（不能为空、不能有特殊字符）
  2. 用户输入/选择路径 → 点击 Browse 打开文件选择器（Web 限制为手动输入）
  3. 用户添加技术栈标签 → 点击「+」弹出预设标签选择
  4. 点击「Next」→ 校验通过则进入 Step 2，否则显示错误

Step 2: AI Tool
  1. 显示三个选项卡片（Claude Code / OpenCode / Codex）
  2. 点击选择 → 卡片高亮
  3. 点击「Next」→ 进入 Step 3

Step 3: Template
  1. 显示内置模板卡片网格
  2. 悬停卡片 → 显示简要预览
  3. 点击「Preview」→ 弹出模态框展示完整文件树
  4. 点击选择 → 卡片勾选
  5. 点击「Next」→ 进入 Step 4

Step 4: Confirm
  1. 展示项目摘要（名称、路径、AI 工具、模板）
  2. 展示将要生成的文件列表（树形结构）
  3. 点击「Create & Generate Config」→ 显示加载状态
  4. 成功后跳转到项目详情页
  5. 失败则显示错误详情 + 重试按钮
```

**键盘导航：**
- `Enter` 在当前步骤提交
- `Esc` 取消向导
- `Tab` 在表单字段间切换

**加载状态：**
- 配置生成时显示进度条 + 正在生成的文件列表
- 预计耗时 2-5 秒

---

### 6.2 导入项目的冲突对话框

**触发时机：** 用户扫描目录后，检测到已有配置文件与模板冲突。

**对话框内容：**

```
┌─────────────────────────────────────────────────────┐
│  Configuration Conflict                              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  The following files already exist and differ       │
│  from the template:                                 │
│                                                     │
│  📄 .claude/CLAUDE.md                               │
│  ┌─────────────────────────────────────────────┐   │
│  │ Your version: 125 lines                     │   │
│  │ Template:      98 lines                     │   │
│  │ Differences: 23 additions, 5 deletions      │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Choose action for each file:                       │
│                                                     │
│  .claude/CLAUDE.md:                                 │
│  ○ Keep existing    ○ Overwrite    ○ Review diff   │
│                                                     │
│  [Show detailed diff]                               │
│                                                     │
│  ────────────────────────────────────────────────   │
│                                                     │
│              [Cancel]  [Apply Changes]              │
└─────────────────────────────────────────────────────┘
```

**交互细节：**
- 每个冲突文件独立选择处理方式
- 「Review diff」点击后展开行内 diff 视图（类似 GitHub PR diff）
- 「Show detailed diff」弹出全屏 diff 对比模态框
- 应用变更后显示成功提示 + 受影响文件列表

---

### 6.3 终端断线重连的 UI 反馈

**断线检测：**
- WebSocket 断开 → 立即在状态栏显示「⚠ Disconnected」
- 终端区域叠加半透明遮罩，显示「Reconnecting...」
- 启动指数退避重连（1s → 2s → 4s → 8s → 最大 30s）

**重连中 UI：**

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                  Reconnecting...                    │
│                  Attempt 2/∞                        │
│                                                     │
│              [ Cancel Reconnect ]                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**重连成功：**
- 遮罩消失
- 状态栏恢复「● Connected」
- 通过 `tmux capture-pane` 获取最近 500 行历史
- xterm.js 恢复显示，用户看到断线前的终端内容

**重连失败（超过最大重试次数）：**
- 显示错误提示：「Connection failed. The session may have ended.」
- 提供两个按钮：「Retry」和「Close Session」
- 终端区域显示最后已知状态（灰显）

**手动恢复入口：**
- 任何时候用户可点击状态栏的「Disconnected」手动触发重连
- 或在会话列表中点击「Resume」按钮

---

### 6.4 Agent 拖拽排序

**使用场景：** 在会话侧边栏的 Agent 列表中，用户希望调整 Agent 的优先级顺序。

**交互流程：**

```
1. 用户长按 Agent 项（或点击「⋮⋮」拖拽手柄）
2. Agent 项进入「拖拽状态」：
   - 背景变深
   - 出现阴影
   - 原位置留下占位符
3. 用户拖动到其他位置
4. 目标位置插入占位符，其他项自动让位
5. 用户释放鼠标
6. 发送 API 请求更新顺序
7. 成功 → 显示短暂 Toast「Order saved」
8. 失败 → 回滚到原顺序 + 显示错误 Toast
```

**视觉反馈：**
- 拖拽项：`opacity: 0.8` + `box-shadow` + 跟随鼠标
- 占位符：虚线边框 + 半透明背景
- 其他项：平滑过渡到新位置（CSS transition 200ms）

**键盘替代：**
- 选中 Agent 项后，用 `Alt + ↑/↓` 调整顺序
- 适合无障碍访问

---

### 6.5 模板预览

**触发方式：** 在模板列表点击「Preview」按钮。

**预览模态框内容：**

```
┌─────────────────────────────────────────────────────────┐
│  Preview: Harness Engineering v2.1               [×]    │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ Files:   │  File Content                                │
│          │                                              │
│ 📄 .claude/                                             │
│   CLAUDE.md                                             │
│   settings.json                                         │
│ 📄 .claude/agents/                                      │
│   planner.md                                            │
│   coder.md                                              │
│ 📄 .claude/rules/                                       │
│   frontend.md                                           │
│   backend.md                                            │
│          │  ┌────────────────────────────────────────┐ │
│          │  │ # CLAUDE.md                            │ │
│          │  │                                        │ │
│          │  │ ## Current State                       │ │
│          │  │ This is a TypeScript + React project.. │ │
│          │  │                                        │ │
│          │  │ ## Workflow                            │ │
│          │  │ 1. Always create a plan first          │ │
│          │  │ ...                                    │ │
│          │  └────────────────────────────────────────┘ │
│          │  [Copy Content]                             │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

**交互细节：**
- 左侧文件树，点击切换右侧内容
- 右侧只读代码查看器（非编辑模式）
- 「Copy Content」复制当前文件内容到剪贴板
- 模态框最大宽度 800px，高度 80vh
- 支持 ESC 关闭

---

## 七、附录

### 7.1 图标系统

使用 `lucide-react` 图标库：

| 用途 | 图标 |
|------|------|
| 项目 | `FolderOpen` |
| 会话 | `Terminal` |
| Agent | `Bot` |
| Skill | `Zap` |
| 模板 | `FileCode` |
| 模型 | `Cpu` |
| 设置 | `Settings` |
| 通知 | `Bell` |
| 搜索 | `Search` |
| 添加 | `Plus` |
| 删除 | `Trash2` |
| 编辑 | `Pencil` |
| 更多 | `MoreHorizontal` |
| 运行中 | `Circle` (绿色填充) |
| 空闲 | `Circle` (灰色描边) |
| 错误 | `AlertCircle` |

### 7.2 键盘快捷键

| 快捷键 | 功能 | 作用域 |
|--------|------|--------|
| `Ctrl/Cmd + K` | 命令面板（远期） | 全局 |
| `Ctrl/Cmd + B` | 切换侧边栏 | 终端页面 |
| `Ctrl/Cmd + \` | 切换信息面板 | 终端页面 |
| `Esc` | 关闭模态框/取消操作 | 全局 |
| `Ctrl/Cmd + Enter` | 提交表单 | 表单页面 |
| `Alt + ↑/↓` | 调整列表项顺序 | Agent/Skill 列表 |

### 7.3 无障碍考虑

- 所有交互元素有明确的 `aria-label`
- 颜色对比度符合 WCAG AA 标准（前景/背景对比度 ≥ 4.5:1）
- 键盘可完成所有操作（无需鼠标）
- 屏幕阅读器友好的语义化 HTML
- 焦点管理：模态框打开时锁定焦点，关闭时恢复

---

_火珂 🎨 | 设计为用户，不为炫技 | 2026-04-25_
