# @openforge/dsh-bridge

OpenForge copilot 的 dsh（DeepSeek Harness）内核桥接包：平台能力 Cordis 插件 +
resume 感知 JSON-RPC server + per-user runtime launcher。对应
`.planning/dsh-integration/PLAN.md` 的 M1。

## 组成

- `src/plugin.ts`（`@openforge/dsh-bridge/plugin`）— openforge-bridge 插件，把平台能力
  注册为模型工具（14 个，与老 copilot harness 工具面对齐）：projects
  （`list_projects` / `get_project` / `create_project`）、sessions
  （`list_sessions` / `dispatch_task_to_session`）、portfolio
  （`list_work_items` / `get_work_item` / `advance_work_item` / `portfolio_overview` /
  `list_portfolio_requests` / `get_project_dossier`）、memory
  （`search_memory` / `list_memory` / `write_memory`）。全部经 HTTP 回调
  Gateway 内部 API，插件进程内无 DB、无租户数据；operate 四件
  （create_project / write_memory / advance_work_item / dispatch_task_to_session）
  走 M3 审批桥。
- `src/server.ts`（`@openforge/dsh-bridge/server`）— resume 感知 SDK JSON-RPC server。
  官方 `dsh-sdk-jsonrpc-server` 对已持久化的 sessionId 会报 id collision；本实现对
  命中持久化日志的 id 走 `ctx.agents.resume()`，使"杀进程 + resume"成为
  mid-turn cancel 的替代路径（spike ② 已验证）。
- `src/launcher.ts`（bin `openforge-dsh-bridge`）— per-user runtime 启动器，供 M2
  Gateway 进程管理 spawn，也可手动 E2E。
- `templates/cordis.yml` — per-user 组合模板（MiniMax 经 `dsh-llm-pi-ai` anthropic
  协议接入；key 由 `MINIMAX_API_KEY` 环境变量在请求时解析）。M4 起 Gateway 按用户
  配置渲染裁剪副本（`# @openforge-feature` 标记块，如 compaction/subagents），写到
  `stateDir/dsh-config/<userId>/cordis.yml` 并经 `DSH_BRIDGE_CONFIG` 注入；包内模板
  本身保持默认全开组合。

## 环境变量契约

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENFORGE_GATEWAY_URL` | 否（默认 `http://127.0.0.1:48731`） | Gateway base URL |
| `OPENFORGE_COPILOT_BRIDGE_TOKEN` | 是 | 内部 API bearer token |
| `OPENFORGE_USER_ID` | 是 | 租户 id（`X-OpenForge-User-Id`） |
| `OPENFORGE_BRIDGE_TIMEOUT_MS` | 否（默认 15000） | 单次内部 API 超时 |
| `MINIMAX_API_KEY` | 是 | LLM 凭据，仅驻留子进程环境 |
| `MINIMAX_BASE_URL` | 否 | LLM 端点覆盖 |
| `DSH_BRIDGE_CONFIG` | 否 | cordis.yml 覆盖路径（默认包内模板） |
| `DSH_CWD` / `DSH_SESSION_ROOT` | 否 | 工作目录 / 会话日志根 |

缺必填变量时 launcher 在 boot 前失败并列出全部缺失项。

## Gateway 内部 API 契约（对接方，勿偏离）

Base `{OPENFORGE_GATEWAY_URL}/api/internal/v1/copilot-bridge`，
`Authorization: Bearer $OPENFORGE_COPILOT_BRIDGE_TOKEN` + `X-OpenForge-User-Id`，
envelope `{code:0,data,message}` / `{code:1,message,details}`（`code!==0` 时 message
作为工具错误透传给模型）。

用到的端点：`GET /work-items?projectId=&status=`、`GET /work-items/:id`、
`POST /work-items/:id/advance {note?}`、`GET /sessions?projectId=&limit=`、
`POST /sessions/:id/dispatch {message}`、`GET /projects?limit=`、`GET /projects/:id`、
`POST /projects {name,path,description?}`、`GET /portfolio/overview`、
`GET /portfolio/requests?projectId=&limit=`、`GET /portfolio/projects/:id/dossier`、
`GET /memory/entries?scope=&projectId=&limit=`、`GET /memory/search?q=&scope=&projectId=&limit=`、
`POST /memory/entries {kind,scope,text,projectId?,metadata?}`。
dispatch 成功响应含
`delivery:"confirmed"`（Gateway 已回读目标 tmux pane 确认送达）；注入未被目标终端回显
（如模态对话框吞掉输入）时返回 502 `BRIDGE_DELIVERY_UNCONFIRMED`，message 透传给模型。

## 用法

```bash
pnpm --dir packages/dsh-bridge build
OPENFORGE_COPILOT_BRIDGE_TOKEN=... OPENFORGE_USER_ID=... MINIMAX_API_KEY=... \
  node packages/dsh-bridge/dist/launcher.js
# stdio 上是 dsh SDK JSON-RPC 协议（initialize / session/prompt / shutdown），
# 用 @deepseek-ai/dsh-sdk-client 驱动；sessionId 复用即可跨进程 resume。
```

## ⚠️ dsh 依赖是临时方案

`@deepseek-ai/*` 依赖全部用 pnpm `link:` 指向本地检出
`../../../github_project/deepseek-harness`（npm 上只有 stale 0.0.1-rc.1）。
要求该检出已完成 `pnpm install && npm run build:lib`。**dsh 正式发包后必须切换为
版本化依赖并删掉这些 link。** link 模式下 dsh 包自身的依赖从其原仓库的
node_modules 解析，不要对 dsh-bridge 做 `pnpm publish` 或打包分发。

## 测试

```bash
pnpm --dir packages/dsh-bridge test     # node:test + tsx，stub HTTP server
node packages/dsh-bridge/scripts/launcher-smoke.mjs   # 组合 boot + initialize + shutdown 冒烟
```
