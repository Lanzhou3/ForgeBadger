<p align="center">
  <img src="../packages/web/public/brand/forgebadger-banner.png" alt="ForgeBadger" width="720">
</p>

# ForgeBadger

[English](../README.md) | [简体中文](README.zh-CN.md)

ForgeBadger 是一個本地優先的 AI 程式設計 CLI 控制平面。它為開發者提供統一的 Web
控制台，用來管理 Claude Code、OpenCode、Codex 和 Kimi Code 的專案、持久終端機工作階段、AI
工具設定、模型、API Key、Agent、Skill、範本、外掛、用量視覺化和工作階段歷史。

ForgeBadger 面向自架開發機器和私有工作區。Gateway 負責檔案系統存取、SQLite
持久化、終端機多工器工作階段、WebSocket 終端機流量、加密和 CLI 程序生命週期；Web 控制台是
純 Next.js SPA，透過 HTTP 和 WebSocket 與 Gateway 通訊。

## 專案狀態

ForgeBadger 處於 MVP / 本地優先發布候選開發階段。核心 Gateway、Web 控制台、持久終端機
終端機鏈路、認證、加密 API Key 儲存、專案設定、適配器偵測和管理介面已經具備本地
使用者測試條件，並已支援模型服務商 Profile 和線上模型同步。

模型/廠商配置是 per-CLI、user-global 的：Model Center（/models）保存服務商
Profile、模型與加密憑據，顯式 apply-provider 會把所選內容按各 CLI 原生格式寫入
全域設定檔（Codex 寫入 `~/.codex/config.toml` 與 `~/.codex/auth.json`）。工作階段
與模型解耦，一律以宿主機環境憑據啟動，ForgeBadger 不在啟動時注入任何
provider/model/credential 環境變數，也不讀取系統鑰匙圈。託管協作、計費、雲部署
和自主遠端執行不屬於目前本地優先 MVP 範圍。

產品、套件作用域、CLI、執行階段識別、本機狀態契約與公開 GitHub 倉庫現已統一使用
ForgeBadger 品牌。以 `OF-` 開頭的歷史階段 ID 繼續作為穩定的證據識別保留。

## 首次使用者試用

- [試用執行手冊](TRIAL-RUNBOOK.md)
- [首次執行檢查表](TRIAL-CHECKLIST.md)
- [疑難排解](TROUBLESHOOTING.md)
- [回饋範本](TRIAL-FEEDBACK.md)
- [GitHub 回饋 Issue 表單](../.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml)

## 為什麼使用 ForgeBadger

- 在瀏覽器裡查看和恢復長時間執行的 AI CLI 工作。
- 統一管理 Claude Code、OpenCode、Codex 和 Kimi Code 工作階段，透過可預覽、可回滾的綁定投影減少手動混改本地設定檔。
- 透過內嵌 Session Server 保存工作階段：瀏覽器斷線或 Gateway 重啟後仍可恢復，不依賴瀏覽器分頁或資料庫日誌。
- 在一個開發者控制台裡集中管理專案範本、Agent、Skill、API Key、模型和本地診斷。
- 保持本地優先：密鑰、專案路徑、終端機程序和 SQLite 狀態都留在執行 Gateway 的主機上。

## 功能

- 專案建立和匯入流程，支援 AI 工具設定生成與合規檢查。
- 將專案的 AI CLI 設定沉澱為可複用範本，建立或匯入專案時選擇範本，並從公開 Git 倉庫匯入範本。
- 基於 Session Server 的終端機工作階段，瀏覽器斷線或 Gateway 重啟後仍可恢復：
  macOS/Linux/WSL 經 Unix socket，原生 Windows 經命名管道 + ConPTY。
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
  -> Gateway（經 Session Server IPC）
  -> Session Server daemon（node-pty）
  -> AI CLI 程序
```

倉庫結構：

```text
packages/
  cli/       npm 分發的 ForgeBadger CLI 包裝器
  gateway/   Express、WebSocket、Session Server/node-pty、SQLite、適配器、服務層
  web/       Next.js App Router、React、Tailwind CSS、xterm.js
docs/        架構、發布、冒煙測試、試用和多語言文件
templates/   內建 AI CLI 設定範本
```

關鍵規則：

- Gateway 和 Web 是兩個獨立服務。Gateway API 行為不放進 Next.js API routes。
- REST API 位於 `/api/v1`；終端機流量使用 `/ws/terminal/:sessionId`。
- 內嵌 Session Server 是終端機工作階段持久化層（唯一終端後端）。
- 終端機歷史透過 Session Server 渲染快照恢復，不寫入 SQLite。
- CLI 工作階段以宿主機環境憑據啟動，不注入服務商密鑰。在模型中心執行「套用至 CLI」會明確寫入所選 CLI 的全域設定；平台儲存使用 AES-256-GCM 加密，日誌、事件和資料庫不包含明文密鑰。

## 環境需求

- Node.js 20.12 至 24
- 原始碼開發需要 pnpm 10 或更新版本
- 支援 SQLite 的本地檔案系統
- 如需真實 AI CLI 工作階段，需要在 `PATH` 中安裝 Claude Code、OpenCode、Codex 和/或 Kimi Code

終端機工作階段由內嵌 Session Server daemon 提供，無需安裝任何終端機多工器或其他前置二進位。

## 從 npm 安裝

```bash
npm install -g forgebadger
forgebadger doctor
forgebadger start
```

在 `forgebadger start` 印出的 URL 開啟 Web 控制台。

`forgebadger start` / `init` 啟動時會繪製零依賴的 ForgeBadger 文字 Logo 環境預檢橫幅。
只有支援色彩的 TTY 使用品牌色；重新導向輸出、`NO_COLOR` 或 `TERM=dumb` 環境會自動降級為純文字。

npm 包的 postinstall 不安裝系統軟體；`forgebadger start` / `init` 也不會安裝或升級任何系統級依賴。
`forgebadger doctor` 只讀檢查依賴：檢查空狀態目錄不會建立設定、密鑰、資料庫或目錄。
Claude Code、OpenCode、Codex 或 Kimi Code 需另外安裝並放入 `PATH`。

## 從原始碼開發

安裝依賴：

```bash
pnpm install
```

建立本地 `.env` 檔案。不要提交此檔案。

```bash
FORGEBADGER_PORT=48731
FORGEBADGER_WEB_PORT=48732
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
FORGEBADGER_MASTER_KEY=<使用-openssl-rand-hex-32-生成的64位hex字串>
FORGEBADGER_JWT_SECRET=<32位以上隨機密鑰>
```

分別在兩個 shell 中啟動 Gateway 和 Web 控制台：

```bash
pnpm --filter @forgebadger/gateway dev
FORGEBADGER_WEB_HOST=127.0.0.1 FORGEBADGER_WEB_PORT=48732 pnpm --filter @forgebadger/web dev
```

開啟 Web 控制台：

```text
http://127.0.0.1:48732
```

執行聚焦檢查：

```bash
pnpm --filter @forgebadger/web typecheck
pnpm --filter @forgebadger/web test
pnpm --filter @forgebadger/gateway typecheck
pnpm --filter @forgebadger/gateway test
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
- ForgeBadger 是本地優先產品，但本地優先並不意味著可以降低終端機存取和 API Key 的敏感級別。

## 授權

ForgeBadger 使用 [MIT License](../LICENSE) 開源。
