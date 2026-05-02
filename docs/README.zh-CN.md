# OpenForge 简体中文

[English](../README.md) | [繁體中文](README.zh-TW.md)

OpenForge 是一个本地优先的 AI 编程 IDE 控制平台。它提供 Web 控制台，用于管理
Claude Code、OpenCode 和 Codex 等 AI CLI 工作流，包括项目创建和导入、配置生成、
终端会话、模型和 API Key 管理、Agent、Skill、模板、插件、用量可视化和会话历史。

OpenForge 面向自托管开发环境。Gateway 负责所有文件系统、数据库、tmux、
WebSocket、加密和 CLI 进程管理；Web 控制台是纯 Next.js SPA，通过 HTTP 和
WebSocket 与 Gateway 通信。

## 功能

- 管理项目、会话、终端、Agent、Skill、模板、模型、API Key、插件、用量、历史和设置。
- 基于 tmux 的终端会话，浏览器断开或 Gateway 重启后仍可恢复。
- 支持 Claude Code、OpenCode、Codex 的适配器发现和受控会话启动。
- 创建或导入项目后，自动尝试生成对应 AI 工具配置。
- 内置 Claude Code、OpenCode、Codex 最佳实践模板。
- 项目级 AI 配置编辑器，支持原始文件编辑和表单字段编辑。
- 全局 AI CLI 配置只读预览，并自动脱敏敏感值。
- SQLite 持久化、用户级数据隔离和 JWT 认证。
- API Key 使用 AES-256-GCM 加密存储。
- 通过 WebSocket 事件流提供通知和缓存刷新。

## 架构

```text
浏览器 Web 控制台
  -> HTTP / WebSocket
  -> Gateway 服务
  -> SQLite / tmux / node-pty
  -> AI CLI 进程（claude / opencode / codex）
```

仓库是 pnpm monorepo：

```text
packages/
  gateway/   Express、WebSocket、tmux/node-pty、SQLite、适配器、服务层
  web/       Next.js App Router、React、Tailwind CSS、xterm.js
docs/        README 多语言翻译
```

## 环境要求

- Node.js 20 或更高版本
- tmux 3.2 或更高版本
- 如需真实 CLI 会话，需要在 `PATH` 中安装 Claude Code、OpenCode 和/或 Codex
- 支持 SQLite 的本地文件系统
- 源码开发需要 pnpm 9 或更高版本

## 从 npm 安装

```bash
npm install -g openforge
openforge doctor
openforge start
```

在 `openforge start` 打印的 URL 打开 Web 控制台。

`npm install -g openforge` 只安装 OpenForge CLI，不会安装 `tmux`、Claude
Code、OpenCode 或 Codex。请单独安装计划使用的 AI CLI 工具，并确保它们在
`PATH` 中可用。

## 从源码开发

安装依赖：

```bash
pnpm install
```

创建本地 `.env` 文件。不要提交该文件。以下是本地开发所需的最小配置，请使用自己生成的密钥。

```bash
OPENFORGE_PORT=48731
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
OPENFORGE_MASTER_KEY=<使用-openssl-rand-hex-32-生成的64位hex字符串>
OPENFORGE_JWT_SECRET=<32位以上随机密钥>
```

开发模式启动：

```bash
pnpm --filter @openforge/gateway dev
pnpm --filter @openforge/web dev -- --hostname 127.0.0.1 --port 48732
```

打开 Web 控制台：

```text
http://localhost:48732
```

构建全部包：

```bash
pnpm -r build
```

运行检查：

```bash
pnpm -r typecheck
pnpm -r test
git diff --check
```

## 安全说明

- 不要提交 `.env`、SQLite 数据库、API Key、JWT secret、加密密钥、生成的凭据或个人 AI CLI 配置。
- 用户级 Claude Code、Codex、OpenCode 配置文件不属于本仓库内容。
- 通过 OpenForge 存储的 API Key 会使用 AES-256-GCM 加密。
- Gateway 会校验项目路径，并拒绝目录穿越、符号链接逃逸和敏感系统路径。
- WebSocket 终端访问同时需要 JWT 认证和会话级 attach 凭据。

## 文档

- [`../README.md`](../README.md) - English README
- [`README.zh-TW.md`](README.zh-TW.md) - 繁體中文 README

## 许可证

OpenForge 使用 [MIT License](LICENSE) 开源。
