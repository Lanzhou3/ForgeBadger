<p align="center">
  <img src="../packages/web/public/brand/forgebadger-banner.png" alt="ForgeBadger" width="640">
</p>

<h1 align="center">ForgeBadger</h1>

<p align="center"><strong>把你的 AI 程式開發工具，放進一個本機工作台。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/forgebadger"><img src="https://img.shields.io/npm/v/forgebadger/beta?label=npm%20beta" alt="npm beta 版本"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20.12%20%E2%80%93%2024-43853d" alt="Node.js 20.12 至 24"></a>
  <a href="https://github.com/Lanzhou3/ForgeBadger/blob/dev/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 授權"></a>
</p>

[English](../README.md) · [简体中文](README.zh-CN.md)

**Claude Code · Codex · OpenCode · Kimi Code · Pi · MiniMax Code · Grok**

ForgeBadger 是一個本機優先的 AI 程式開發工作台：統一管理專案與終端機，透過 Copilot 協助開發，也支援 Agent 經 MCP 接入。部署在自己的電腦或可信任的私有主機上。

[快速開始](#快速開始) · [功能一覽](#功能一覽) · [MCP 接入](#透過-mcp-接入-agent) · [文件導覽](#文件導覽) · [參與貢獻](#參與貢獻)

## 快速開始

安裝目前的 beta，啟動隨套件提供的 Gateway 和 Web 控制台：

```bash
npm install -g forgebadger@beta
forgebadger start
```

在瀏覽器開啟終端機印出的 **Web Console 位址**。新安裝的 beta 預設使用 `http://127.0.0.1:18333`，Gateway 為 `http://127.0.0.1:18332`；既有設定會保留原來的連接埠。使用控制台期間，請保持啟動命令執行。

首次啟動會自動建立本機執行設定並產生所需密鑰。**透過 npm 安裝，無需複製倉庫、安裝 pnpm、手動建置或設定 `.env`。**

**準備條件：** Node.js **20.12 至 24**。你需要另外安裝並登入準備使用的 AI CLI，確保對應命令在 `PATH` 中。ForgeBadger 已包含 Web 控制台和終端機後端，不會替你安裝 AI CLI。可執行 `forgebadger doctor` 檢查環境，查看缺少工具的安裝提示。

| npm 渠道 | 安裝命令 | 適合用途 |
| --- | --- | --- |
| `beta` | `npm install -g forgebadger@beta` | 體驗本文介紹的目前功能，參與預發布測試 |
| `latest` | `npm install -g forgebadger` | 安裝上一正式版本，可能不包含目前的 beta 功能 |

beta 不會覆蓋 `latest`。已知回歸問題與平台限制見[發版計畫](RELEASE-PLAN.md)。實體 Windows/ConPTY 和 WSL 驗收仍待補充；原生依賴沒有適用的預編譯二進位檔時，安裝可能需要 C/C++ 建置工具。

### 啟動你的第一個工作階段

1. 開啟控制台，建立本機帳號。
2. 匯入既有專案，或使用範本建立專案。
3. 選擇已安裝的 AI CLI，啟動終端機工作階段。
4. 按需在 **Models** 中設定模型，重用 **Skills** 和 **Templates**，或開啟 **Copilot** 取得專案上下文協助。

## 功能一覽

| 功能 | 你可以做什麼 |
| --- | --- |
| **專案與設定** | 建立、匯入專案，預覽 CLI 設定；從既有專案或公開 Git 倉庫重用範本。 |
| **持久終端機** | 在瀏覽器中執行多個 AI CLI 工作階段；只要 Session Server 仍存活，瀏覽器斷線或 Gateway 重啟後都能重新連線。 |
| **模型中心** | 管理服務商、模型與加密憑證；明確套用至各 CLI 的原生全域設定，支援備份與回復。 |
| **Copilot** | 使用內建助手，結合專案上下文和平台工具協助開發。 |
| **專案管理與工作區** | 管理目標、任務、驗收條件與證據；透過獨立 worktree 完成驗證、審查與明確交付。 |
| **Skills、Agent 與範本** | 管理可重用的指令和專案設定，減少重複準備工作。 |
| **外部 Agent 的 MCP 接入** | 使用限定專案與能力的可撤銷權杖，讓相容的 Agent 讀取和操作所選專案。 |
| **狀態與診斷** | 查看工作階段狀態、通知、用量與歷史，匯出本機診斷；安裝可選 CodeGraph 工具後瀏覽唯讀程式碼圖譜。 |

### 支援的 AI CLI

| CLI | ForgeBadger 偵測的命令 |
| --- | --- |
| Claude Code | `claude` |
| Codex | `codex` |
| OpenCode | `opencode` |
| Kimi Code | `kimi` |
| Pi | `pi` |
| MiniMax Code | `mcode` |
| Grok | `grok` |

工作階段使用各 CLI 既有的主機設定與憑證。模型中心的修改需要明確執行：套用服務商會寫入所選 CLI 的使用者層級設定；啟動工作階段不會向其環境注入服務商密鑰。

### 透過 MCP 接入 Agent

在 **Settings（設定）** 中啟用 MCP，重啟 ForgeBadger，再建立權杖，選擇允許存取的專案與能力。使用控制台顯示的連線設定，接入支援 **MCP Streamable HTTP** 的 Agent。

MCP 工具涵蓋專案檢查、任務規劃、授權的 CLI 任務派發、審查與部分生命週期操作。Agent 的平台操作受權杖授權範圍限制，原生 CLI 的敏感確認仍需使用者處理。完整工具、設定與授權邊界見 [MCP API 文件](API.md#external-mcp-endpoint)。

## CLI 與本機資料

| 命令 | 用途 |
| --- | --- |
| `forgebadger start` | 啟動 Gateway 和 Web 控制台 |
| `forgebadger doctor` | 唯讀檢查依賴，不建立執行狀態 |
| `forgebadger --version` | 查看已安裝版本 |

執行狀態預設儲存在 `~/.forgebadger`。專案倉庫與各 AI CLI 的原生設定保留在各自的位置。

<details>
<summary><strong>自訂連接埠與獨立狀態目錄</strong></summary>

```bash
forgebadger start --gateway-port 18342 --web-port 18343
```

透過 `FORGEBADGER_STATE_DIR` 分開管理多個執行個體。例如在 POSIX shell 中：

```bash
FORGEBADGER_STATE_DIR=/private/path/forgebadger-state forgebadger start
```

每個執行個體使用獨立的狀態目錄與資料庫。Web 控制台會使用啟動時選定的 Gateway 位址。

</details>

<details>
<summary><strong>備份與還原</strong></summary>

```bash
forgebadger backup --output /private/path/new-backup
# 還原前先停止 Gateway 和 Web 程序。
forgebadger restore --from /private/path/new-backup --to /private/path/new-state
# POSIX shell；先清除舊的 FORGEBADGER_DB_PATH 覆寫值。
FORGEBADGER_STATE_DIR=/private/path/new-state forgebadger start
```

備份包含 SQLite 資料庫與實際執行設定，**也包含加密主密鑰與 JWT 密鑰**。請私密保存，它不是加密封存檔。還原會驗證備份，要求全新的目的地目錄，保留加密主密鑰並輪換瀏覽器認證，還原後需要重新登入。

專案倉庫和原生 CLI 設定需另行備份。執行中的終端機、終端機歷史與檔案系統中的 CLI 設定回復檔案不在備份範圍內；還原工作階段中繼資料不會重建程序。完整範圍見[工作流程與復原指南](PERSONAL-TEAM-WORKFLOWS.md)。

</details>

<details>
<summary><strong>解除安裝</strong></summary>

```bash
forgebadger uninstall --backup /private/path/new-backup
npm uninstall -g forgebadger
```

先停止 Gateway 和 Web。第一條命令會先備份，經確認後刪除本機 ForgeBadger 狀態；第二條命令刪除 npm 套件。本機狀態包含資料庫與加密主密鑰，請保留備份。僅執行 `npm uninstall -g forgebadger` 會保留執行狀態。

</details>

## 架構

```text
瀏覽器 / Web 控制台
  -> Gateway（HTTP + WebSocket）
  -> 獨立 Session Server（node-pty）
  -> AI CLI 程序
```

Gateway 負責專案存取、SQLite、憑證和 CLI 程序管理；Web 控制台是 Next.js SPA。Session Server 獨立管理終端機，使工作階段能跨瀏覽器斷線和 Gateway 重啟繼續執行。

終端機歷史儲存在 Session Server 的呈現畫面中，不寫入 SQLite。Daemon 退出或作業系統重啟會結束程序，系統不會靜默重建。實作細節見[技術架構](TECH-ARCHITECTURE.md)。

## 從原始碼開發

<details>
<summary><strong>本機開發與驗證</strong></summary>

使用支援的 Node.js 版本和根目錄 `packageManager` 指定的 pnpm（目前為 `pnpm@12.6.0`）。

```bash
git clone https://github.com/Lanzhou3/ForgeBadger.git
cd ForgeBadger
git switch dev
pnpm install --frozen-lockfile
```

在根目錄建立 `.env`，填入以下設定。使用 `openssl rand -hex 32` 為每個密鑰變數分別產生新值，替換預留位置；不要提交此檔案。

```dotenv
FORGEBADGER_MASTER_KEY=<64位hex字串>
FORGEBADGER_JWT_SECRET=<至少32字元>
FORGEBADGER_PORT=18332
FORGEBADGER_WEB_PORT=18333
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:18332
```

```bash
pnpm dev
```

開啟 `http://127.0.0.1:18333`。原始碼開發需要設定 `.env`；npm 安裝會自動初始化執行設定。

```bash
pnpm -r typecheck
pnpm -r test
node --test scripts/*.test.mjs
pnpm -r build
```

npm 套件驗證命令：`pnpm build:npm`、`pnpm verify:npm`、`pnpm smoke:npm`。完整門檻見[發版流程](RELEASE-PLAN.md)。

```text
packages/cli/       npm CLI 與隨套件執行環境
packages/gateway/   API、WebSocket、Session Server、SQLite、CLI 適配器
packages/web/       Next.js、React、Tailwind CSS、xterm.js
scripts/            打包、驗證與測試腳本
docs/               產品、架構、API 與維運文件
```

</details>

## 文件導覽

| 安裝與使用 | 開發與貢獻 |
| --- | --- |
| [試用執行手冊](TRIAL-RUNBOOK.md) | [技術架構](TECH-ARCHITECTURE.md) |
| [首次執行檢查表](TRIAL-CHECKLIST.md) | [API 文件](API.md) |
| [疑難排解](TROUBLESHOOTING.md) | [測試計畫](TEST-PLAN.md) |
| [工作流程與復原](PERSONAL-TEAM-WORKFLOWS.md) | [開發計畫](DEVELOPMENT-PLAN.md) |
| [回饋範本](TRIAL-FEEDBACK.md) | [發版計畫](RELEASE-PLAN.md) |
| [診斷指南](SUPPORT-DIAGNOSTICS.md) | [外部驗收門檻](EXTERNAL-EVIDENCE-GATES.md) |

## 參與貢獻

歡迎試用 beta、回報可重現的問題、改進文件或貢獻程式碼。可填寫[試用回饋表單](../.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml)，或[建立 Issue](https://github.com/Lanzhou3/ForgeBadger/issues)。提交 PR 前，請閱讀[貢獻指南](../CONTRIBUTING.md)。

ForgeBadger 面向可信任的本機或私有主機，MCP 專案授權不會把不可信任的程式碼放進沙箱。請私密保存備份與憑證，分享日誌、終端機截圖與 Issue 時移除密鑰。安全漏洞請按[安全政策](../SECURITY.md)回報。

## 開源授權

[MIT](../LICENSE)。Happy coding!
