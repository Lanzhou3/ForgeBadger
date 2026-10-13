<p align="center">
  <img src="../packages/web/public/brand/forgebadger-banner.png" alt="ForgeBadger" width="640">
</p>

<h1 align="center">ForgeBadger</h1>

<p align="center"><strong>把你的 AI 编程工具，放进一个本地工作台。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/forgebadger"><img src="https://img.shields.io/npm/v/forgebadger/beta?label=npm%20beta" alt="npm beta 版本"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20.12%20%E2%80%93%2024-43853d" alt="Node.js 20.12 至 24"></a>
  <a href="https://github.com/Lanzhou3/ForgeBadger/blob/dev/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 协议"></a>
</p>

[English](../README.md) · [繁體中文](README.zh-TW.md)

**Claude Code · Codex · OpenCode · Kimi Code · Pi · MiniMax Code · Grok**

ForgeBadger 是一个本地优先的 AI 编程工作台：统一管理项目与终端，通过 Copilot 协助开发，也支持 Agent 经 MCP 接入。部署在自己的电脑或可信私有主机上。

[快速开始](#快速开始) · [功能一览](#功能一览) · [MCP 接入](#通过-mcp-接入-agent) · [文档导航](#文档导航) · [参与贡献](#参与贡献)

## 快速开始

安装当前 beta，启动随包提供的 Gateway 和 Web 控制台：

```bash
npm install -g forgebadger@beta
forgebadger start
```

在浏览器打开终端打印的 **Web Console 地址**。新安装的 beta 默认使用 `http://127.0.0.1:18333`，Gateway 为 `http://127.0.0.1:18332`；已有配置会保留原来的端口。使用控制台期间，请保持启动命令运行。

首次启动会自动创建本地运行配置并生成所需密钥。**通过 npm 安装，无需克隆仓库、安装 pnpm、手动构建或配置 `.env`。**

**准备条件：** Node.js **20.12 至 24**。你需要单独安装并登录准备使用的 AI CLI，确保对应命令在 `PATH` 中。ForgeBadger 已包含 Web 控制台和终端后端，不会替你安装 AI CLI。可运行 `forgebadger doctor` 检查环境，查看缺失工具的安装提示。

| npm 渠道 | 安装命令 | 适合用途 |
| --- | --- | --- |
| `beta` | `npm install -g forgebadger@beta` | 体验本文介绍的当前功能，参与预发布测试 |
| `latest` | `npm install -g forgebadger` | 安装上一正式版本，可能不包含当前 beta 功能 |

beta 不会覆盖 `latest`。已知回归问题与平台限制见[发版计划](RELEASE-PLAN.md)。物理 Windows/ConPTY 和 WSL 验收仍有待补充；原生依赖没有适配的预编译二进制时，安装可能需要 C/C++ 构建工具。

### 启动你的第一个会话

1. 打开控制台，创建本地账号。
2. 导入已有项目，或使用模板创建项目。
3. 选择已安装的 AI CLI，启动终端会话。
4. 按需在 **Models** 中配置模型，复用 **Skills** 和 **Templates**，或打开 **Copilot** 获取项目上下文协助。

## 功能一览

| 功能 | 你可以做什么 |
| --- | --- |
| **项目与配置** | 创建、导入项目，预览 CLI 配置；从已有项目或公开 Git 仓库复用模板。 |
| **持久终端** | 在浏览器中运行多个 AI CLI 会话；只要 Session Server 仍存活，浏览器断开或 Gateway 重启后都能重新连接。 |
| **模型中心** | 管理服务商、模型和加密凭据；明确应用到各 CLI 的原生全局配置，支持备份与回滚。 |
| **Copilot** | 使用内置助手，结合项目上下文和平台工具协助开发。 |
| **项目管理与工作区** | 管理目标、任务、验收条件和证据；通过独立 worktree 完成验证、审查与明确交付。 |
| **Skills、Agent 与模板** | 管理可复用的指令与项目配置，减少重复准备工作。 |
| **外部 Agent 的 MCP 接入** | 使用限定项目与能力的可撤销令牌，让兼容的 Agent 读取和操作所选项目。 |
| **状态与诊断** | 查看会话状态、通知、用量和历史，导出本地诊断；安装可选 CodeGraph 工具后浏览只读代码图谱。 |

### 支持的 AI CLI

| CLI | ForgeBadger 检测的命令 |
| --- | --- |
| Claude Code | `claude` |
| Codex | `codex` |
| OpenCode | `opencode` |
| Kimi Code | `kimi` |
| Pi | `pi` |
| MiniMax Code | `mcode` |
| Grok | `grok` |

会话使用各 CLI 已有的宿主机配置与凭据。模型中心的修改需要明确执行：应用服务商会写入所选 CLI 的用户级配置；启动会话不会向其环境注入服务商密钥。

### 通过 MCP 接入 Agent

在 **Settings（设置）** 中启用 MCP，重启 ForgeBadger，再创建令牌，选择允许访问的项目和能力。使用控制台展示的连接配置，接入支持 **MCP Streamable HTTP** 的 Agent。

MCP 工具涵盖项目检查、任务规划、授权的 CLI 任务派发、审查与部分生命周期操作。Agent 的平台操作受令牌授权范围限制，原生 CLI 的敏感确认仍需用户处理。完整工具、配置与授权边界见 [MCP API 文档](API.md#external-mcp-endpoint)。

## CLI 与本地数据

| 命令 | 用途 |
| --- | --- |
| `forgebadger start` | 启动 Gateway 和 Web 控制台 |
| `forgebadger doctor` | 只读检查依赖，不创建运行状态 |
| `forgebadger --version` | 查看已安装版本 |

运行状态默认保存在 `~/.forgebadger`。项目仓库与各 AI CLI 的原生配置保留在各自的位置。

<details>
<summary><strong>自定义端口与独立状态目录</strong></summary>

```bash
forgebadger start --gateway-port 18342 --web-port 18343
```

通过 `FORGEBADGER_STATE_DIR` 分开管理多个实例。例如在 POSIX shell 中：

```bash
FORGEBADGER_STATE_DIR=/private/path/forgebadger-state forgebadger start
```

每个实例使用独立的状态目录和数据库。Web 控制台会使用启动时选定的 Gateway 地址。

</details>

<details>
<summary><strong>备份与恢复</strong></summary>

```bash
forgebadger backup --output /private/path/new-backup
# 恢复前先停止 Gateway 和 Web 进程。
forgebadger restore --from /private/path/new-backup --to /private/path/new-state
# POSIX shell；先清除旧的 FORGEBADGER_DB_PATH 覆盖值。
FORGEBADGER_STATE_DIR=/private/path/new-state forgebadger start
```

备份包含 SQLite 数据库和实际运行配置，**也包含加密主密钥与 JWT 密钥**。请私密保存，它不是加密归档。恢复会校验备份，要求全新的目标目录，保留加密主密钥并轮换浏览器认证，恢复后需要重新登录。

项目仓库和原生 CLI 配置需另行备份。运行中的终端、终端历史和文件系统中的 CLI 配置回滚文件不在备份范围内；恢复会话元数据不会重建进程。完整范围见[工作流与恢复指南](PERSONAL-TEAM-WORKFLOWS.md)。

</details>

<details>
<summary><strong>卸载</strong></summary>

```bash
forgebadger uninstall --backup /private/path/new-backup
npm uninstall -g forgebadger
```

先停止 Gateway 和 Web。第一条命令会先备份，经确认后删除本地 ForgeBadger 状态；第二条命令删除 npm 包。本地状态包含数据库和加密主密钥，请保留备份。仅执行 `npm uninstall -g forgebadger` 会保留运行状态。

</details>

## 架构

```text
浏览器 / Web 控制台
  -> Gateway（HTTP + WebSocket）
  -> 独立 Session Server（node-pty）
  -> AI CLI 进程
```

Gateway 负责项目访问、SQLite、凭据和 CLI 进程管理；Web 控制台是 Next.js SPA。Session Server 独立管理终端，使会话能跨浏览器断开和 Gateway 重启继续运行。

终端历史保存在 Session Server 的渲染画面中，不写入 SQLite。Daemon 退出或操作系统重启会结束进程，系统不会静默重建。实现细节见[技术架构](TECH-ARCHITECTURE.md)。

## 从源码开发

<details>
<summary><strong>本地开发与验证</strong></summary>

使用支持的 Node.js 版本和根目录 `packageManager` 指定的 pnpm（当前为 `pnpm@12.6.0`）。

```bash
git clone https://github.com/Lanzhou3/ForgeBadger.git
cd ForgeBadger
git switch dev
pnpm install --frozen-lockfile
```

在根目录创建 `.env`，填入以下配置。使用 `openssl rand -hex 32` 为每个密钥变量分别生成新值，替换占位符；不要提交该文件。

```dotenv
FORGEBADGER_MASTER_KEY=<64位hex字符串>
FORGEBADGER_JWT_SECRET=<至少32字符>
FORGEBADGER_PORT=18332
FORGEBADGER_WEB_PORT=18333
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:18332
```

```bash
pnpm dev
```

打开 `http://127.0.0.1:18333`。源码开发需要配置 `.env`；npm 安装会自动初始化运行配置。

```bash
pnpm -r typecheck
pnpm -r test
node --test scripts/*.test.mjs
pnpm -r build
```

npm 包验证命令：`pnpm build:npm`、`pnpm verify:npm`、`pnpm smoke:npm`。完整门禁见[发版流程](RELEASE-PLAN.md)。

```text
packages/cli/       npm CLI 与随包运行时
packages/gateway/   API、WebSocket、Session Server、SQLite、CLI 适配器
packages/web/       Next.js、React、Tailwind CSS、xterm.js
scripts/            打包、校验与测试脚本
docs/               产品、架构、API 与运维文档
```

</details>

## 文档导航

| 安装与使用 | 开发与贡献 |
| --- | --- |
| [试用运行手册](TRIAL-RUNBOOK.md) | [技术架构](TECH-ARCHITECTURE.md) |
| [首次运行检查表](TRIAL-CHECKLIST.md) | [API 文档](API.md) |
| [故障排查](TROUBLESHOOTING.md) | [测试计划](TEST-PLAN.md) |
| [工作流与恢复](PERSONAL-TEAM-WORKFLOWS.md) | [开发计划](DEVELOPMENT-PLAN.md) |
| [反馈模板](TRIAL-FEEDBACK.md) | [发版计划](RELEASE-PLAN.md) |
| [诊断指南](SUPPORT-DIAGNOSTICS.md) | [外部验收门禁](EXTERNAL-EVIDENCE-GATES.md) |

## 参与贡献

欢迎试用 beta、反馈可复现的问题、改进文档或贡献代码。可填写[试用反馈表单](../.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml)，或[创建 Issue](https://github.com/Lanzhou3/ForgeBadger/issues)。提交 PR 前，请阅读[贡献指南](../CONTRIBUTING.md)。

ForgeBadger 面向可信的本地或私有主机，MCP 项目授权不会把不可信代码放进沙箱。请私密保存备份与凭据，分享日志、终端截图和 Issue 时移除密钥。安全漏洞请按[安全政策](../SECURITY.md)报告。

## 开源协议

[MIT](../LICENSE)。Happy coding!
