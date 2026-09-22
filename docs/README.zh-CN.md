<p align="center">
  <img src="../packages/web/public/brand/forgebadger-banner.png" alt="ForgeBadger" width="720">
</p>

# ForgeBadger

[English](../README.md) | [繁體中文](README.zh-TW.md)

ForgeBadger 是一个本地优先的 AI 编程 CLI 控制平面。它为开发者提供统一的 Web
控制台，用来管理 Claude Code、OpenCode、Codex 和 Kimi Code 的项目、持久终端会话、AI
工具配置、模型、API Key、Agent、Skill、模板、插件、用量可视化和会话历史。

ForgeBadger 面向自托管开发机器和私有工作区。Gateway 负责文件系统访问、SQLite
持久化、Session Server 终端会话、WebSocket 终端流量、加密和 CLI 进程生命周期；Web 控制台是
纯 Next.js SPA，通过 HTTP 和 WebSocket 与 Gateway 通信。

## 项目状态

ForgeBadger 处于 MVP / 本地优先发布候选开发阶段。核心 Gateway、Web 控制台、持久终端
终端链路、认证、加密 API Key 存储、项目设置、适配器发现和管理界面已经具备本地
用户测试条件，并已支持模型服务商 Profile 和在线模型同步。

模型/厂商配置是 per-CLI、user-global 的：Model Center（/models）保存服务商
Profile、模型与加密凭据，显式 apply-provider 会把所选内容按各 CLI 原生格式写入
全局配置文件（Codex 写入 `~/.codex/config.toml` 与 `~/.codex/auth.json`）。会话
与模型解耦，一律以宿主机环境凭据启动，ForgeBadger 不在启动时注入任何
provider/model/credential 环境变量，也不读取系统钥匙串。托管协作、计费、云部署
和自主远程执行不属于当前本地优先 MVP 范围。

产品、包作用域、CLI、运行时标识、本地状态契约与公开 GitHub 仓库现已统一使用
ForgeBadger 品牌。以 `OF-` 开头的历史阶段 ID 继续作为稳定的证据标识保留。

## 首次用户试用

- [试用运行手册](TRIAL-RUNBOOK.md)
- [首次运行检查表](TRIAL-CHECKLIST.md)
- [故障排查](TROUBLESHOOTING.md)
- [反馈模板](TRIAL-FEEDBACK.md)
- [GitHub 反馈 Issue 表单](../.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml)

## 为什么使用 ForgeBadger

- 在浏览器里查看和恢复长时间运行的 AI CLI 工作。
- 统一管理 Claude Code、OpenCode、Codex 和 Kimi Code 会话，通过可预览、可回滚的绑定投影减少手工混改本地配置文件。
- 通过内嵌 Session Server 保存会话：浏览器断开或 Gateway 重启后仍可恢复，不依赖浏览器标签页或数据库日志。
- 在一个开发者控制台里集中管理项目模板、Agent、Skill、API Key、模型和本地诊断。
- 保持本地优先：密钥、项目路径、终端进程和 SQLite 状态都留在运行 Gateway 的主机上。

## 功能

- 项目创建和导入流程，支持 AI 工具配置生成与合规检查。
- 将项目的 AI CLI 配置沉淀为可复用模板，创建或导入项目时选择模板，并从公开 Git 仓库导入模板。
- 基于 Session Server 的终端会话，浏览器断开或 Gateway 重启后仍可恢复：
  macOS/Linux/WSL 经 Unix socket，原生 Windows 经命名管道 + ConPTY。
- 支持 Claude Code、OpenCode、Codex 的适配器发现和受控会话启动。
- 模型服务商 Profile、加密 API Key 存储，以及 OpenAI-compatible 服务商端点的
  在线模型同步。
- Web 控制台提供 Agent、Skill、模板、插件、用量、历史、通知和设置界面。
- 会话快照、终端专注模式、命令面板原型和本地诊断导出。
- 通过 WebSocket 事件流提供会话状态、通知和缓存刷新。

## 架构

```text
浏览器 xterm.js
  -> WebSocket
  -> Gateway（经 Session Server IPC）
  -> Session Server daemon（node-pty）
  -> AI CLI 进程
```

仓库结构：

```text
packages/
  cli/       npm 分发的 ForgeBadger CLI 包装器
  gateway/   Express、WebSocket、Session Server/node-pty、SQLite、适配器、服务层
  web/       Next.js App Router、React、Tailwind CSS、xterm.js
docs/        架构、发布、冒烟测试、试用和多语言文档
templates/   内置 AI CLI 配置模板
```

关键规则：

- Gateway 和 Web 是两个独立服务。Gateway API 行为不放进 Next.js API routes。
- REST API 位于 `/api/v1`；终端流量使用 `/ws/terminal/:sessionId`。
- 内嵌 Session Server 是终端会话持久化层（唯一终端后端）。
- 终端历史通过 Session Server 渲染快照恢复，不写入 SQLite。
- CLI 会话以宿主机环境凭据启动，不注入服务商密钥。在模型中心执行“应用到 CLI”会明确写入所选 CLI 的全局配置；平台存储使用 AES-256-GCM 加密，日志、事件和数据库不包含明文密钥。

## 环境要求

- Node.js 20.12 至 24
- 源码开发需要 pnpm 10 或更高版本
- 支持 SQLite 的本地文件系统
- 如需真实 AI CLI 会话，需要在 `PATH` 中安装 Claude Code、OpenCode、Codex 和/或 Kimi Code

终端会话由内嵌 Session Server daemon 提供，无需安装任何终端复用器或其他前置二进制。

## 从 npm 安装

```bash
npm install -g forgebadger
forgebadger doctor
forgebadger start
```

在 `forgebadger start` 打印的 URL 打开 Web 控制台。

`forgebadger start` / `init` 启动时会绘制零依赖的 ForgeBadger 文字 Logo 环境预检横幅。
只有支持颜色的 TTY 使用品牌色；重定向输出、`NO_COLOR` 或 `TERM=dumb` 环境自动降级为纯文本。

npm 包的 postinstall 不安装系统软件；`forgebadger start` / `init` 也不会安装或升级任何系统级依赖。
`forgebadger doctor` 只读检查依赖：检查空状态目录不会创建配置、密钥、数据库或目录。
Claude Code、OpenCode、Codex 或 Kimi Code 需单独安装并放入 `PATH`。

### 版本与卸载

```bash
forgebadger --version
forgebadger uninstall            # 交互式确认；脚本场景用 --yes
forgebadger uninstall --backup /private/path/new-backup   # 先备份再删除
```

`forgebadger uninstall` 会删除本地状态目录（默认 `~/.forgebadger`）：数据库、保存的运行时 `config.json`（含**主加密密钥**）、备份与运行时状态。目录不像 ForgeBadger 状态目录时会拒绝删除；Gateway/Web 端口仍在服务时会拒绝执行（先停止进程，或用 `--force` 跳过）；未传 `--yes` 时需要交互确认。该命令无法从进程内部删除全局安装的 npm 包——之后请再执行 `npm uninstall -g forgebadger` 完成卸载。删除状态目录不可逆：没有主密钥，已加密的 Provider 凭据和集成密钥将无法恢复，建议先使用 `--backup`。

## 从源码开发

安装依赖：

```bash
pnpm install
```

创建本地 `.env` 文件。不要提交该文件。

```bash
FORGEBADGER_PORT=48731
FORGEBADGER_WEB_PORT=48732
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
FORGEBADGER_MASTER_KEY=<使用-openssl-rand-hex-32-生成的64位hex字符串>
FORGEBADGER_JWT_SECRET=<32位以上随机密钥>
```

分别在两个 shell 中启动 Gateway 和 Web 控制台：

```bash
pnpm --filter @forgebadger/gateway dev
FORGEBADGER_WEB_HOST=127.0.0.1 FORGEBADGER_WEB_PORT=48732 pnpm --filter @forgebadger/web dev
```

打开 Web 控制台：

```text
http://127.0.0.1:48732
```

运行聚焦检查：

```bash
pnpm --filter @forgebadger/web typecheck
pnpm --filter @forgebadger/web test
pnpm --filter @forgebadger/gateway typecheck
pnpm --filter @forgebadger/gateway test
git diff --check
```

准备发布级改动时运行全部包检查：

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm build:npm
pnpm verify:npm
pnpm smoke:npm
```



## 文档

- [架构文档](TECH-ARCHITECTURE.md)
- [产品需求](PRD-v1.1-MVP.md)
- [开发计划](DEVELOPMENT-PLAN.md)
- [API 参考](API.md)
- [安全说明](../SECURITY.md)
- [冒烟测试指南](SMOKE-TEST.md)
- [发布计划](RELEASE-PLAN.md)
- [故障排查](TROUBLESHOOTING.md)

## 安全

- 不要提交 `.env`、SQLite 数据库、API Key、JWT secret、加密密钥、生成凭据或个人 AI CLI 配置。
- 用户级 Claude Code、Codex、OpenCode 配置应保留在仓库外。
- Gateway 会校验项目路径，并拒绝目录穿越、符号链接逃逸和敏感系统路径。
- WebSocket 终端访问同时需要 JWT 认证和会话级 attach 凭据。
- ForgeBadger 是本地优先产品，但本地优先并不意味着可以降低终端访问和 API Key 的敏感级别。

## 许可证

ForgeBadger 使用 [MIT License](../LICENSE) 开源。
