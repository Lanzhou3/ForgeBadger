# OpenForge 前端重新设计需求说明

> 版本：v1.0  
> 日期：2026-05-25  
> 用途：交付给 UI/UX 设计师，作为 OpenForge Web Console 重新设计输入文档。  
> 当前产品阶段：v1.3 AI-Native Project Execution Traceability。

---

## 1. 背景与目标

OpenForge 是一个本地优先的 AI CLI 控制平台。它通过 Web 控制台统一管理 Claude Code、OpenCode、Codex 等 AI 编程 CLI 的项目配置、终端会话、模型提供商、Copilot 辅助、项目目标、工作项、证据引用和审计轨迹。

这次前端重设计的目标不是做一个漂亮的营销页，也不是把 OpenForge 做成通用项目管理工具。目标是重新设计一个可信、清晰、可操作的开发者控制台，让用户能稳定完成下面的核心闭环：

1. 配置模型提供商和本地 AI CLI 环境。
2. 创建或导入本地项目。
3. 启动并恢复 tmux 持久化的 AI CLI 会话。
4. 在浏览器终端里观察和控制 AI CLI。
5. 通过 Copilot 查询状态、提出操作、审批变更、追踪结果。
6. 将 AI 执行过程沉淀为项目目标、工作项、证据引用和 ledger 事件。

设计师需要输出新的信息架构、关键页面线框、主要交互流程、组件状态和视觉方向。工程实现会另行规划，本文件只定义产品和前端体验需求。

---

## 2. 产品定位

### 2.1 一句话定位

OpenForge 是一个 local-first AI CLI control plane：让开发者在浏览器里可靠控制、恢复和审计本地 AI 编程 CLI 会话。

### 2.2 当前产品方向

OpenForge 当前进入 v1.3：AI-Native Project Execution Traceability。

设计需要体现：

- Local-first：CLI、tmux、项目文件和密钥都围绕用户自己的机器或开发服务器运行。
- Control plane：核心是控制、恢复、观察和审批，不是泛化聊天工具。
- AI-native execution traceability：AI 执行不是黑盒，用户能看到 prompt、审批、终端进度、证据引用、工作项状态和 ledger 之间的关系。
- Project Manager 是 traceability layer，不是 Jira、Linear、ClickUp 替代品。
- Copilot、Feishu、模型输出只能提出建议或 pending action，不能绕过用户审批直接修改项目状态。

### 2.3 非目标

本次设计不要朝以下方向扩展：

- 通用项目管理套件。
- 云端协作、团队看板、计费、市场、托管执行。
- 纯聊天机器人界面。
- Codex app-server 的 Web prompt/turn 产品化。
- Feishu 自由文本远程控制终端。
- 存储原始终端 transcript、原始 provider payload、Feishu 消息正文或任何 secret。

---

## 3. 目标用户与使用场景

### 3.1 目标用户

- 独立开发者：本机或 VPS 上同时跑多个 AI CLI 会话，需要浏览器统一管理。
- AI coding power user：同时使用 Claude Code、OpenCode、Codex，关心模型、密钥、会话恢复和执行证据。
- 小团队技术负责人：希望给项目维护统一 AI 规范、模板、Agent、Skill，并能审计 AI 执行过程。
- 开源项目维护者：希望外部用户可以安全理解 OpenForge 的本地运行边界和支持范围。

### 3.2 用户最重要的任务

1. 我现在有哪些项目、会话、风险和阻塞项？
2. 某个项目能不能启动 Claude Code / OpenCode / Codex？缺什么？
3. 当前会话是否真的活着？tmux 里最新发生了什么？
4. Copilot 建议做什么操作？它会向哪个会话、项目、模型或工作项写入什么？
5. 我批准后，操作是否真的执行了？终端是否有后续输出？
6. 一个工作项为什么变成 done？有哪些证据引用和 ledger 记录？
7. 模型提供商为什么不可用？是密钥、endpoint、模型、网络还是超时？

---

## 4. 设计原则

### 4.1 整体气质

- 深色优先，专业开发者工具风格。
- 密集但有秩序，适合长时间使用和重复操作。
- 像 control room，不像 SaaS landing page。
- 终端和项目状态是核心，不要用装饰性大卡片稀释信息。
- 需要能承载错误、审批、等待、恢复、部分成功等复杂状态。

### 4.2 视觉约束

- 使用现有 shadcn/Radix 风格组件语言，图标优先使用 lucide-react。
- 卡片圆角保持克制，建议不超过 8px。
- 不要大量使用渐变、光斑、装饰性 blob、营销式 hero。
- 不要卡片嵌套卡片；页面区域应是清晰的 full-width band、split pane、table/list、sheet、dialog。
- 文字必须在桌面和移动端都不溢出，不遮挡按钮或状态。
- 颜色应服务于状态：running、idle、blocked、needs approval、failed、done、stale、unknown。

### 4.3 交互原则

- 操作必须可追踪：用户要知道请求从哪里来、要改什么、是否已批准、执行结果是什么。
- 错误必须可行动：不能只有 “failed”，要告诉用户下一步。
- 状态必须可信：会话状态不能用项目 active 代替；模型状态不能只看配置存在。
- 用户应随时能停止 Copilot 当前 run。
- 同一个 Copilot 会话必须保留上下文，追问不能变成全新问题。
- 对危险操作，默认用审批卡片而非直接执行。

---

## 5. 推荐信息架构

当前前端已有大量页面，重设计时建议收敛为以下主导航。Labs 或低频入口不应和核心闭环平级抢占注意力。

### 5.1 主导航建议

1. **Home / Command Center**
   - 全局状态、阻塞项、活跃会话、最近 Copilot/PM 活动、模型健康摘要。

2. **Projects**
   - 项目列表、创建、导入、项目详情。
   - 项目详情内承载 Sessions、Project Manager、Config、Agents、Skills、Templates。

3. **Sessions**
   - 所有会话列表、状态、恢复入口。
   - 会话详情是终端核心界面。

4. **Copilot**
   - 全局 Copilot 会话列表和聊天工作台。
   - 也可以作为全局 drawer 常驻入口。

5. **Project Manager**
   - 如果保留全局入口，应是跨项目执行追踪视图。
   - 项目内 PM 仍应优先出现在 Project detail。

6. **Models**
   - Provider setup、credentials、model profiles、health check。
   - 当前“凭据”和“模型目录”容易混淆，需要重新组织。

7. **Library**
   - Agents、Skills、Templates、Plugins 合并或分组，避免左侧导航过长。

8. **Activity**
   - Notifications、History、Usage、Audit/ledger 类只读活动视图。

9. **Settings**
   - 用户、成员、环境、诊断、偏好设置。

10. **Labs**
   - Codex app-server、Feishu callback、远程执行原型等未成为核心闭环的功能。

### 5.2 一级导航优先级

P0 必须设计：

- Home
- Projects list/detail
- Sessions list/detail terminal
- Copilot chat/drawer
- Project Manager within Project detail
- Models provider setup

P1 需要设计到可实现程度：

- Library：Agents / Skills / Templates / Plugins
- Activity：Notifications / History / Usage
- Settings / Members

P2 只需要轻量占位或 Labs 规则：

- Codex app-server
- Feishu live callback readiness
- Remote execution architecture preview

---

## 6. 核心用户旅程

### 6.1 首次启动与环境就绪

目标：用户 5 分钟内知道系统能否运行，并启动第一个 AI CLI 会话。

流程：

1. 登录或注册。
2. Home 显示 setup checklist。
3. 检查 Gateway、tmux、CLI adapters、模型提供商、凭据、项目路径权限。
4. 用户进入 Models 完成 provider/credential/model 配置。
5. 用户创建或导入项目。
6. 用户选择 Claude Code / OpenCode / Codex runtime。
7. 启动 session，进入终端。

设计要求：

- Checklist 必须区分 blocking、warning、optional。
- 每个阻塞项给出明确 CTA，例如 “Configure provider”、“Install Claude Code”、“Import project”。
- 不要把 credentials、model catalog、provider profile 混成一个不清楚的概念。

### 6.2 日常控制台使用

目标：用户打开 OpenForge 后立刻知道哪里需要处理。

流程：

1. Home 展示活跃 session、waiting approval、failed runs、stale sessions、provider health。
2. 用户点击会话进入终端。
3. 用户通过 Copilot 询问“当前会话是否活跃，最新操作是什么”。
4. Copilot 调用 session/detail/terminal snapshot 工具，返回带证据的回答。
5. 用户让 Copilot 向 CLI 发送指令。
6. UI 展示待审批操作，用户能清楚看到目标 session、输入内容、是否 submit。
7. 用户批准后，UI 持续追踪终端输出并显示结果。

设计要求：

- Terminal input approval 必须用人能读懂的卡片，而不是裸 `openforge.propose_session_input`。
- 批准后必须显示 “已发送”、“正在等待终端响应”、“捕获到最新输出” 或失败原因。
- 如果操作只是填入终端输入框但没有 submit，UI 必须明确显示。
- 已批准的 pending action 不应继续显示 “批准/拒绝” 按钮。

### 6.3 Copilot 会话追问

目标：Copilot 像同一个工作台里的助手，而不是每轮失忆。

流程：

1. 用户问：“看下当前 aether-glass 会话是否正常，最新操作是什么。”
2. Copilot 回答：前端审查完成，列出严重问题。
3. 用户追问：“有哪些严重问题？”
4. Copilot 基于上一轮回答继续列出严重问题，而不是转去查 OpenForge dashboard 健康。

设计要求：

- Copilot 会话列表需要明确当前选中 conversation。
- 当前 conversation 的历史消息、工具活动和 pending action 要稳定保留。
- 新建 conversation 时不要串流到旧 conversation。
- 流式输出完成后，最终消息内容不能被截断或替换成过短摘要。
- 消息删除应只影响展示，不应破坏 run activity 的可追踪性。

### 6.4 AI-native Project Manager

目标：AI 执行过程能转成可审计的项目状态。

流程：

1. 用户在项目详情打开 Project Manager。
2. 设置项目 goal、constraints、acceptance criteria。
3. 创建 work item。
4. Copilot 或用户附加 evidence reference，例如 session id、terminal snapshot marker、file path、Copilot run id。
5. work item 状态变更进入 ledger。
6. done 状态需要 evidence，若没有 evidence 必须记录 manual completion reason。

设计要求：

- Project Manager 应表现为项目执行追踪，不是泛项目管理。
- Work item 支持 table/list 密集审阅，也支持 board workflow。
- Ledger 需要清楚显示事件类型、来源、时间、状态变化、证据数量。
- Evidence 只收结构化引用，不鼓励粘贴原始终端输出、provider payload 或 secret。

### 6.5 模型提供商设置与故障排查

目标：用户知道 Copilot 或 CLI 为什么调用模型失败。

流程：

1. 用户进入 Models。
2. 看到 provider profile、credential、model profile 三层关系。
3. 使用 guided setup 添加 provider、credential、model。
4. health check 验证 credential/model readiness。
5. 错误状态显示具体类型：401/403、404、429、5xx、timeout、network、unsupported model。

设计要求：

- Qwen、MiniMax、OpenAI-compatible 等 provider 要呈现 endpoint、api format、supported adapters、model source。
- 静态模型和动态拉取模型要区分。
- “配置存在” 不等于 “可用于 Copilot”。
- Codex subscription-managed 路径必须和 API key/model provider 注入隔离。

---

## 7. 页面级详细需求

### 7.1 App Shell

必须具备：

- 左侧主导航，可折叠。
- 顶部或底部状态区展示 Gateway 连接、事件流连接、当前用户、通知数量。
- 全局命令面板入口。
- 全局 Copilot drawer 入口。
- 清晰区分核心导航和 Labs。

状态要求：

- WebSocket disconnected 时有全局但不遮挡的提示。
- 未登录跳转登录，登录失败需显示可读错误。
- 当前页面加载失败不能导致空白页面。

### 7.2 Home / Command Center

首页应回答：

- 系统现在是否可用？
- 有哪些 active session？
- 有哪些 waiting approval？
- 有哪些 blocking setup item？
- 最近 AI 执行发生了什么？

模块建议：

- Readiness strip：Gateway、DB、tmux、CLI adapters、provider health。
- Active sessions：名称、项目、runtime、live/stale、last active、quick open。
- Pending approvals：操作类型、目标、风险、时间、quick review。
- Project execution：最近 work items、blocked/done/in progress。
- Recent activity：Copilot、terminal、PM ledger、notifications。

避免：

- 重复入口，例如 “凭据” 和 “模型目录” 都跳到同一个 tab 但表现成两个不同模块。
- 统计卡片过多但没有行动价值。

### 7.3 Projects

列表页：

- 支持搜索、排序、状态筛选。
- 每个项目显示：名称、路径、tech stack、runtime availability、running sessions、PM blockers、config status。
- 提供 create/import 两个明确入口。

创建/导入：

- 创建项目和导入项目应是不同流程。
- 导入项目要展示扫描结果、已识别 AI tool、潜在配置冲突。
- 配置写入必须有 dry-run / preview / conflict resolution。

项目详情：

- Header：项目名称、路径、runtime 状态、config status、last activity。
- Tabs 或分区：Overview、Sessions、Project Manager、Config、Library、Activity。
- 不要把太多弱相关内容放进同一屏幕卡片。

### 7.4 Sessions

列表页：

- 支持按 project、runtime、status 过滤。
- 清楚区分数据库状态和实时 tmux/runtime 状态。
- stale running record 必须有解释和恢复/清理动作。

会话详情：

- Terminal 是主视图，占据最大视觉权重。
- 提供可折叠 sidecar：session info、model/provider、project files、evidence refs、Copilot context。
- 底部状态栏显示连接状态、cwd、runtime、last capture、read/write 状态。
- 终端断开不代表 CLI 死亡，需要显示 “browser disconnected” vs “tmux session not live”。

终端要求：

- 支持 reconnect、resize、focus mode。
- 不能让辅助 UI 遮挡终端输入行。
- 操作性错误要在终端外呈现，不混入终端输出。

### 7.5 Copilot

核心需求：

- 支持 conversation 列表、创建、切换、删除消息。
- 每条 assistant 消息可显示工具活动摘要，但默认不要用裸工具名压倒回答。
- Tool request、tool result、pending action、approval result 需要独立视觉层级。
- 流式输出期间发送按钮变成停止按钮。
- 用户可以随时 stop 当前 run。
- 同一个 conversation 内追问必须显式保留上下文。

Pending action 卡片：

- 标题必须是用户可读动作，例如 “向终端发送指令”、“创建工作项”、“同步模型列表”。
- 必须显示目标对象：项目、会话、模型 provider、work item。
- 必须显示风险等级或审批原因。
- 终端输入类 action 必须显示输入内容、submit 模式、目标 session、最近终端证据。
- 批准/拒绝后按钮消失，保留结果状态和时间。

执行结果：

- 批准后不要只显示 “operation approved”。
- 需要显示执行是否成功、后续终端是否变化、最终捕获的 terminal snapshot 摘要。
- 长时间无变化时显示 “已发送，但终端未产生新输出”。

错误状态：

- Provider auth failed、rate limited、timeout、network failed、stream parse failed 要有不同 UI。
- 消息加载失败不能显示空聊天，必须有错误和重试。

### 7.6 Project Manager

Project Manager 是项目详情内的一等工作区。

必须支持：

- Goal 编辑：summary、constraints、acceptance criteria、status。
- Work item list/table：title、status、priority、acceptance criteria、evidence count、ledger count。
- Work item detail sheet：描述、状态、证据引用、ledger events。
- Board workflow：按 bounded status 分列，但不能替代密集 table。
- Status transition：只显示允许的下一步，不用全状态下拉。
- Evidence attach：只能附结构化引用。
- Ledger timeline：按事件类型过滤、load more、失败重试。

状态语义：

- `todo`
- `in_progress`
- `blocked`
- `ready_for_review`
- `done`
- `cancelled`

Done guard：

- 无 evidence 时，必须要求 manual completion reason。
- UI 要解释这是记录完成依据，不是随意备注。

### 7.7 Models

Models 页面需要彻底降低认知负担。

建议结构：

- Providers：服务商 profile，例如 OpenAI、Anthropic、MiniMax、Qwen、OpenAI-compatible。
- Credentials：密钥，但只作为 provider 的从属对象，不单独成为首页主模块。
- Models：某 provider 下的模型 profile。
- Health：当前 Copilot default model、CLI adapter compatibility、最近健康检查。
- Guided setup：一步步添加 provider、credential、model，并验证可用性。

必须表达：

- provider profile != credential != model profile。
- 有 credential 不代表模型可用。
- Qwen Coding Plan 等 provider 需要正确 endpoint / model catalog / supported adapters。
- 404 应提示可能是 endpoint 或 model path 错，不是泛化“模型服务商失败”。

### 7.8 Library：Agents / Skills / Templates / Plugins

这些是配置资产，不应淹没核心会话控制。

设计建议：

- 用 Library 作为统一入口。
- 二级 tabs：Agents、Skills、Templates、Plugins。
- 每类资产都支持 list、detail、enable/disable、preview、install/create。
- 项目内覆盖关系要明确：global installed vs project enabled。

### 7.9 Activity：Notifications / History / Usage

Activity 应统一承载只读事件。

需要包含：

- Notifications：未读、全部标记已读、按类型过滤。
- History：session snapshots、activity events、Copilot runs。
- Usage：按 provider/model/project 的使用摘要。
- Audit/ledger links：跳转到相关 project/work item/session。

### 7.10 Settings / Members

设置需要清楚分组：

- Profile
- Security / auth
- Environment diagnostics
- Team members / roles
- Preferences
- Export diagnostics

成员和角色只展示当前已实现能力，避免暗示完整 SaaS 团队协作。

### 7.11 Labs

Labs 用于承载未完全产品化能力：

- Codex app-server
- Feishu live callback readiness
- Remote execution architecture preview

Labs 页面必须带边界说明：

- default-disabled 或 beta caveat。
- 当前能做什么、不能做什么。
- 需要哪些外部配置。
- 不应影响核心导航可信度。

---

## 8. 状态与反馈需求

每个页面必须覆盖以下状态：

- Loading
- Empty
- Partial data
- Permission denied
- Not found
- Validation error
- Mutation pending
- Mutation success
- Mutation failed
- Offline / event stream disconnected
- Stale data
- Recoverable failure

特别要求：

- 不要出现“请求失败后显示空白列表”。
- 不要只用 toast 承载关键错误；关键错误要留在页面上下文中。
- 长任务必须有持续进度或可停止状态。
- UI 状态更新要避免后返回请求覆盖新状态。

---

## 9. 安全与信任表达

OpenForge 的安全边界应通过 UI 可见，但不要写成长篇说明。

必须表达的概念：

- 密钥 encrypted at rest，不明文展示。
- host environment credential 和 stored encrypted key 是不同模式。
- project root 是文件访问边界。
- terminal scrollback 属于 tmux，不存 SQLite。
- evidence 是引用，不是原始内容存档。
- Copilot/Feishu/model output 只能 propose，用户审批后才执行。

设计要求：

- 危险操作使用确认 dialog 或 approval card。
- 破坏性操作需要明确对象名和影响范围。
- secret、token、API key 出现时 UI 应显示 redacted。
- 审批卡片不要隐藏风险对象。

---

## 10. 响应式与可访问性

桌面端：

- 以 1280px 以上为主要生产力布局。
- 支持 split pane、terminal + sidecar、table + detail sheet。

移动端：

- 主要用于查看状态、审批简单操作、查看通知。
- 不要求完整终端生产力，但不能破版。
- Terminal 页面可提示建议桌面使用。

可访问性：

- 所有表单字段有 label。
- 错误消息关联到字段。
- 图标按钮有 tooltip 或 aria label。
- 不只依赖颜色表达状态。
- Keyboard navigation 覆盖命令面板、dialog、sheet、approval。

国际化：

- 当前产品至少需要中英文文案结构。
- 设计稿不要把文案做成不可扩展的固定宽度。
- 中文长句、英文长单词、ID/path 都要有换行策略。

---

## 11. 设计交付物要求

请设计师交付：

1. 新信息架构图。
2. 主导航和 App Shell 设计。
3. 关键页面高保真稿：
   - Home / Command Center
   - Projects list
   - Project detail
   - Sessions list
   - Session detail terminal
   - Copilot workspace / drawer
   - Project Manager workspace
   - Models guided setup
4. 关键流程稿：
   - 首次 setup checklist
   - 启动会话
   - Copilot pending action approval
   - 终端输入批准后持续追踪
   - Work item evidence attach and done gate
   - Provider health failure remediation
5. 组件状态规范：
   - status badges
   - approval cards
   - tool activity rows
   - terminal status bar
   - work item row/card/board column
   - evidence ref chip
   - ledger event row
   - provider health card
6. Empty/error/loading/disabled/stale/offline 状态样例。
7. 响应式规则：desktop、tablet、mobile。
8. 基础 design tokens：颜色、字体、间距、边框、阴影、状态色。

---

## 12. 验收清单

设计完成后，用以下问题验收：

- 用户能在 Home 一眼看出当前最大阻塞项吗？
- 用户能区分项目 active 和 session running 吗？
- 用户能清楚知道模型失败是 credential、endpoint、model、rate limit、timeout 还是 provider outage 吗？
- 用户批准 Copilot 操作前，是否能知道它要对哪个对象做什么？
- 用户批准终端输入后，是否能看到发送结果和后续终端变化？
- 同一个 Copilot conversation 的追问是否在视觉上保持上下文连续？
- Project Manager 是否体现 AI 执行 traceability，而不是泛化 PM？
- Evidence attach 是否避免诱导用户粘贴原始 transcript 或 secret？
- Terminal 是否仍然是核心差异化界面，而不是被周边卡片压缩？
- Labs 是否被明确隔离，不会让未成熟功能损害核心可信度？
- 移动端是否至少能完成查看状态、审批、通知处理？
- 所有关键状态是否都有 loading、empty、error、stale、offline 表现？

---

## 13. 参考材料

- `CLAUDE.md`：项目概览、架构边界、当前实现状态。
- `docs/PRD-v1.1-MVP.md`：原始 MVP 范围。
- `docs/TECH-ARCHITECTURE.md`：Gateway/Web、tmux、terminal、安全边界。
- `docs/UI-DESIGN.md`：旧版 UI 方向，可作为历史参考，不必逐字继承。
- `.planning/ROADMAP.md`：当前 milestone 和后续 phases。
- `.planning/REQUIREMENTS.md`：v1.3 AI-Native Project Execution Traceability 当前需求。
- `.planning/milestones/v1.2-phases/OF-10-goal-and-work-item-operations/10-UI-SPEC.md`
- `.planning/milestones/v1.2-phases/OF-11-evidence-ledger-and-acceptance-gates/11-UI-SPEC.md`

