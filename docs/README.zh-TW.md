<p align="center">
  <img src="assets/openforge-wordmark.png" alt="OpenForge" width="720">
</p>

# OpenForge

[English](../README.md) | [简体中文](README.zh-CN.md)

OpenForge 是一個本地優先的 AI 程式設計 CLI 控制平面。它為開發者提供統一的 Web
控制台，用來管理 Claude Code、OpenCode 和 Codex 的專案、持久終端機工作階段、AI
工具設定、模型、API Key、Agent、Skill、範本、外掛、用量視覺化和工作階段歷史。

OpenForge 面向自架開發機器和私有工作區。Gateway 負責檔案系統存取、SQLite
持久化、tmux 工作階段、WebSocket 終端機流量、加密和 CLI 程序生命週期；Web 控制台是
純 Next.js SPA，透過 HTTP 和 WebSocket 與 Gateway 通訊。

## 專案狀態

OpenForge 處於 MVP / 本地優先發布候選開發階段。核心 Gateway、Web 控制台、tmux
終端機鏈路、認證、加密 API Key 儲存、專案設定、適配器偵測和管理介面已經具備本地
使用者測試條件，並已支援模型服務商 Profile 和線上模型同步。

Codex app-server 控制面原型已於 2026-08-14 下線；Codex 會話僅以 tmux 後端
終端機會話方式執行。託管協作、計費、雲部署和自主遠端執行不屬於目前本地優先 MVP
範圍。

## 首次使用者試用

- [試用執行手冊](TRIAL-RUNBOOK.md)
- [首次執行檢查表](TRIAL-CHECKLIST.md)
- [疑難排解](TROUBLESHOOTING.md)
- [回饋範本](TRIAL-FEEDBACK.md)
- [GitHub 回饋 Issue 表單](../.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml)

## 為什麼使用 OpenForge

- 在瀏覽器裡查看和恢復長時間執行的 AI CLI 工作。
- 統一管理 Claude Code、OpenCode 和 Codex 工作階段，減少手動混改本地設定檔。
- 使用 tmux 保存終端機工作階段，而不是依賴瀏覽器分頁或資料庫日誌。
- 在一個開發者控制台裡集中管理專案範本、Agent、Skill、API Key、模型和本地診斷。
- 保持本地優先：密鑰、專案路徑、終端機程序和 SQLite 狀態都留在執行 Gateway 的主機上。

## 功能

- 專案建立和匯入流程，支援 AI 工具設定生成與合規檢查。
- 基於 tmux 的終端機工作階段，瀏覽器斷線或 Gateway 重啟後仍可恢復。
- 支援 Claude Code、OpenCode、Codex 的適配器偵測和受控工作階段啟動。
- 模型服務商 Profile、加密 API Key 儲存，以及 OpenAI-compatible 服務商端點的
  線上模型同步。
- Web 控制台提供 Agent、Skill、範本、外掛、用量、歷史、通知和設定介面。
- 工作階段快照、終端機專注模式、命令面板原型和本地診斷匯出。
- 透過 WebSocket 事件流提供工作階段狀態、通知和快取刷新。

## 架構

```text
瀏覽器 xterm.js
  -> WebSocket
  -> Gateway
  -> node-pty
  -> tmux attach
  -> AI CLI 程序
```

倉庫結構：

```text
packages/
  cli/       npm 分發的 OpenForge CLI 包裝器
  gateway/   Express、WebSocket、tmux/node-pty、SQLite、適配器、服務層
  web/       Next.js App Router、React、Tailwind CSS、xterm.js
docs/        架構、發布、冒煙測試、試用和多語言文件
templates/   內建 AI CLI 設定範本
```

關鍵規則：

- Gateway 和 Web 是兩個獨立服務。Gateway API 行為不放進 Next.js API routes。
- REST API 位於 `/api/v1`；終端機流量使用 `/ws/terminal/:sessionId`。
- tmux 是終端機工作階段的持久化層。
- 終端機歷史透過 tmux capture-pane 恢復，不寫入 SQLite。
- API Key 只在 Gateway 記憶體中解密，並透過 tmux 環境變數注入 CLI 工作階段。

## 環境需求

- Node.js 20 或更高版本
- 原始碼開發需要 pnpm 9 或更高版本
- tmux 3.2 或更高版本
- 支援 SQLite 的本地檔案系統
- 如需真實 AI CLI 工作階段，需要在 `PATH` 中安裝 Claude Code、OpenCode 和/或 Codex

Windows 使用者如需使用內建瀏覽器終端機，請在 WSL 中執行 OpenForge。原生
Windows 安裝仍可使用管理介面，但可還原的終端機工作階段依賴 tmux。

## 從 npm 安裝

```bash
npm install -g openforge
openforge doctor
openforge start
```

在 `openforge start` 印出的 URL 開啟 Web 控制台。

npm 包只安裝 OpenForge CLI 包裝器，不會安裝 tmux、Claude Code、OpenCode 或
Codex。請另外安裝計劃使用的 AI CLI 工具，並確保它們在 `PATH` 中可用。

## 從原始碼開發

安裝依賴：

```bash
pnpm install
```

建立本地 `.env` 檔案。不要提交此檔案。

```bash
OPENFORGE_PORT=48731
OPENFORGE_WEB_PORT=48732
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
OPENFORGE_MASTER_KEY=<使用-openssl-rand-hex-32-生成的64位hex字串>
OPENFORGE_JWT_SECRET=<32位以上隨機密鑰>
```

分別在兩個 shell 中啟動 Gateway 和 Web 控制台：

```bash
pnpm --filter @openforge/gateway dev
pnpm --filter @openforge/web dev -- --hostname 127.0.0.1 --port 48732
```

開啟 Web 控制台：

```text
http://127.0.0.1:48732
```

執行聚焦檢查：

```bash
pnpm --filter @openforge/web typecheck
pnpm --filter @openforge/web test
pnpm --filter @openforge/gateway typecheck
pnpm --filter @openforge/gateway test
git diff --check
```

準備發布級改動時執行全部包檢查：

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm build:npm
pnpm verify:npm
pnpm smoke:npm
```

## 文件

- [架構文件](TECH-ARCHITECTURE.md)
- [產品需求](PRD-v1.1-MVP.md)
- [開發計畫](DEVELOPMENT-PLAN.md)
- [API 參考](API.md)
- [安全說明](../SECURITY.md)
- [冒煙測試指南](SMOKE-TEST.md)
- [發布計畫](RELEASE-PLAN.md)
- [疑難排解](TROUBLESHOOTING.md)

## 安全

- 不要提交 `.env`、SQLite 資料庫、API Key、JWT secret、加密密鑰、生成憑據或個人 AI CLI 設定。
- 使用者級 Claude Code、Codex、OpenCode 設定應保留在倉庫外。
- Gateway 會校驗專案路徑，並拒絕目錄穿越、符號連結逃逸和敏感系統路徑。
- WebSocket 終端機存取同時需要 JWT 認證和工作階段級 attach 憑據。
- OpenForge 是本地優先產品，但本地優先並不意味著可以降低終端機存取和 API Key 的敏感級別。

## 授權

OpenForge 使用 [MIT License](../LICENSE) 開源。
