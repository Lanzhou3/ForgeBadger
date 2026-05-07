# OpenForge 繁體中文

[English](../README.md) | [简体中文](README.zh-CN.md)

OpenForge 是一個本地優先的 AI 程式設計 IDE 控制平台。它提供 Web 控制台，用於管理
Claude Code、OpenCode 和 Codex 等 AI CLI 工作流，包括專案建立與匯入、設定生成、
終端機工作階段、模型與 API Key 管理、Agent、Skill、範本、外掛、用量視覺化和工作階段歷史。

OpenForge 面向自架開發環境。Gateway 負責所有檔案系統、資料庫、tmux、
WebSocket、加密和 CLI 程序管理；Web 控制台是純 Next.js SPA，透過 HTTP 和
WebSocket 與 Gateway 通訊。

## 首次使用者試用

- 試用執行手冊：[`TRIAL-RUNBOOK.md`](TRIAL-RUNBOOK.md)
- 首次執行檢查表：[`TRIAL-CHECKLIST.md`](TRIAL-CHECKLIST.md)
- 疑難排解：[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
- 回饋範本：[`TRIAL-FEEDBACK.md`](TRIAL-FEEDBACK.md)

## 功能

- 管理專案、工作階段、終端機、Agent、Skill、範本、模型、API Key、外掛、用量、歷史和設定。
- 基於 tmux 的終端機工作階段，瀏覽器斷線或 Gateway 重啟後仍可恢復。
- 支援 Claude Code、OpenCode、Codex 的適配器偵測和受控工作階段啟動。
- 建立或匯入專案後，會自動嘗試生成對應 AI 工具設定。
- 內建 Claude Code、OpenCode、Codex 最佳實務範本。
- 專案級 AI 設定編輯器，支援原始檔案編輯和表單欄位編輯。
- 全域 AI CLI 設定唯讀預覽，並自動遮蔽敏感值。
- SQLite 持久化、使用者級資料隔離和 JWT 認證。
- API Key 使用 AES-256-GCM 加密儲存。
- 透過 WebSocket 事件流提供通知和快取刷新。

## 架構

```text
瀏覽器 Web 控制台
  -> HTTP / WebSocket
  -> Gateway 服務
  -> SQLite / tmux / node-pty
  -> AI CLI 程序（claude / opencode / codex）
```

倉庫是 pnpm monorepo：

```text
packages/
  gateway/   Express、WebSocket、tmux/node-pty、SQLite、適配器、服務層
  web/       Next.js App Router、React、Tailwind CSS、xterm.js
docs/        README 多語言翻譯
```

## 環境需求

- Node.js 20 或更高版本
- tmux 3.2 或更高版本
- 如需真實 CLI 工作階段，需要在 `PATH` 中安裝 Claude Code、OpenCode 和/或 Codex
- 支援 SQLite 的本地檔案系統
- 原始碼開發需要 pnpm 9 或更高版本

## 從 npm 安裝

```bash
npm install -g openforge
openforge doctor
openforge start
```

在 `openforge start` 印出的 URL 開啟 Web 控制台。

`npm install -g openforge` 只安裝 OpenForge CLI，不會安裝 `tmux`、Claude
Code、OpenCode 或 Codex。請另外安裝計劃使用的 AI CLI 工具，並確保它們在
`PATH` 中可用。

## 從原始碼開發

安裝依賴：

```bash
pnpm install
```

建立本地 `.env` 檔案。不要提交此檔案。以下是本地開發所需的最小設定，請使用自己生成的密鑰。

```bash
OPENFORGE_PORT=48731
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
OPENFORGE_MASTER_KEY=<使用-openssl-rand-hex-32-生成的64位hex字串>
OPENFORGE_JWT_SECRET=<32位以上隨機密鑰>
```

開發模式啟動：

```bash
pnpm --filter @openforge/gateway dev
pnpm --filter @openforge/web dev -- --hostname 127.0.0.1 --port 48732
```

開啟 Web 控制台：

```text
http://localhost:48732
```

建置全部套件：

```bash
pnpm -r build
```

執行檢查：

```bash
pnpm -r typecheck
pnpm -r test
git diff --check
```

## 安全說明

- 不要提交 `.env`、SQLite 資料庫、API Key、JWT secret、加密密鑰、生成的憑據或個人 AI CLI 設定。
- 使用者級 Claude Code、Codex、OpenCode 設定檔不屬於本倉庫內容。
- 透過 OpenForge 儲存的 API Key 會使用 AES-256-GCM 加密。
- Gateway 會校驗專案路徑，並拒絕目錄穿越、符號連結逃逸和敏感系統路徑。
- WebSocket 終端機存取同時需要 JWT 認證和工作階段級 attach 憑據。

## 文件

- [`../README.md`](../README.md) - English README
- [`README.zh-CN.md`](README.zh-CN.md) - 简体中文 README

## 授權

OpenForge 使用 [MIT License](LICENSE) 開源。
