# macOS Session Server 验收记录

日期：2026-09-10。分支：`feat/custom-session-server`，基于 `39073564` 的当前工作区。

结论：当前 macOS 终端生命周期验收通过；包括构建产物和全新 npm 安装后的真实 PTY 链路。独立 Gate 2/3 通过。

## 范围与环境

验收当前 macOS 的终端生命周期，不将结果外推到 Windows/Linux，也不将本地终端输入等同于模型请求成功。

- macOS 26.6.2（25G83），arm64；Node 24.16.0，pnpm 10.33.2。
- 使用构建后的 Gateway、独立 Session Server、真实 node-pty、真实 CLI 和 Chromium 中的 ForgeBadger 终端页面。
- 测试专用数据库、账户和项目位于临时目录。会话由正式 `POST /api/v1/sessions` 创建，页面通过正式 connect API 获取 attach token。
- CLI 使用宿主配置；仅操作本地确认界面和输入框，没有提交模型任务。Codex 的可选 Hook 信任未启用，本次不验收 Hook 执行。

## CLI 生命周期结果

| CLI | 版本 | 原进程 PID | 输入显示 | 实际 PTY resize | 刷新回放 | Gateway SIGKILL 后保活及继续输入 | stop / delete |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | 2.1.263 | 17254 | 通过 | 通过 | 通过 | 通过 | 通过 |
| Codex | 0.153.4 | 17354 | 通过 | 通过 | 通过 | 通过 | 通过 |
| OpenCode | 1.18.29 | 17462 | 通过 | 通过 | 通过 | 通过 | 通过 |
| Kimi Code | 0.42.0 | 17578 | 通过 | 通过 | 通过 | 通过 | 通过 |

可观察证据：

1. 四个 CLI 的输入框显示 `MAC_ACCEPT_<tool>`，未发送 Enter 提交任务。
2. 窗口由 1440×900 改为 1180×760；通过各真实 TTY 上的 `stty size` 确认尺寸从 52 行×102 列变为 43 行×72 列。不是仅检查浏览器 resize 消息。
3. 页面刷新后有新的输出和渲染 ACK，原输入草稿保留。
4. SIGKILL Gateway 后，以同一状态目录和端口启动新 Gateway。独立管理连接重新握手，daemon PID 17200 和四个 CLI PID 均保持不变。
5. 恢复后刷新页面，再输入 `_AFTER_RESTART`；四份终端 capture 均包含完整标记，且产生新的输出和 ACK。此步骤证明刷新恢复，不单独证明自动重连时序。
6. 正式 stop API 后 daemon 中会话消失；delete API 后会话列表不再包含记录。测试进程、临时项目与测试数据库已清理。
7. 所有记录的页面 JavaScript 异常和 terminal_error 均为空。

## 验收中修复的阻塞

构建后的 daemon 曾在创建终端时返回 `spawn is not a function`。隔离对照发现同一进程、同一模块路径下，ESM namespace 中的 spawn 不可用，而 CommonJS require 的 spawn 为函数。没有将 Node 内部 namespace 形成原因视为已确认。

最终在创建 PTY 时通过 `createRequire(import.meta.url)` 延迟加载固定的 `node-pty` 依赖，移除不成立的 default fallback。新增 `session-server-compiled.test.ts`，直接以普通 Node 启动构建后的 daemon，验证真实 PTY 创建、输出和停止；与 tsx 路径共 11 项通过，无跳过。独立复审另行执行 compiled 回归，1 项通过。

`pnpm smoke:npm` 已增强为安装后的 daemon 必须完成真实 PTY spawn、输入回显和停止，防止只验证服务/API 启动而漏掉终端创建。

增强 smoke 还捕获了发布包的 `posix_spawnp failed`：原始 node-pty 1.1.0 tarball 中两个 Darwin 架构的 `spawn-helper` 均为 `0644`。仓库的权限修复此前没有覆盖 npm 发布包。现发布 `postinstall.mjs`，无需 dist 或编译依赖，只为本包解析到的当前 Darwin 架构 helper 增加执行位；不安装系统软件，doctor 仍只读。入口使用规范路径比较，覆盖 `/var` 别名和符号链接目录执行。CLI 75 项测试、类型检查和构建通过。

## 验证状态与限制

- 工作区 typecheck：通过。
- 普通 Node / tsx 相关回归及独立 Gate 2：通过。
- 包结构及 smoke runner 回归：19 项通过，校验安装脚本必须发布且正确接入 postinstall。
- 四 CLI 本机生命周期与独立 Gate 3：通过。
- 最终 `pnpm smoke:npm`：exit 0。完成重新构建、打包、全新安装、doctor、服务/API 启动，以及安装后的真实 daemon PTY spawn/input/output/stop；`pnpm verify:npm` 通过。
- 安装 hook 独立定向复审：5 项通过，无失败或跳过。文档门禁、品牌校验与 diff whitespace 检查通过。
- Codex 界面提示 `xcode` MCP 启动握手失败。本次未定位该集成问题，不将终端验收结论扩展为 CLI/MCP 全功能通过。
- OpenCode 首屏有短时空白。独立构建产物实验中，无浏览器、resize 或输入，2/4/6 秒 capture 为空，8 秒自然显示 TUI。未发现持续性终端回归；首轮更长等待的具体原因未确认，未添加猜测性重绘修复。
- 本次未验收模型请求、长时间压力、原生 IME、其他操作系统。上一轮 Gateway 全量的两项 HEAD 既有失败（会话排序、模板默认值）未因此变为通过。

## 本机证据位置

- `/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-mac-evidence/results.json`：逐步骤计数、TTY 尺寸、PID、停止删除结果。
- `/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-mac-evidence/*-post-crash-input.png`：四个 CLI 重启后输入画面；同名 `.txt` 为 capture。
- `/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-mac-acceptance.mjs`、`/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-mac-gateway.mjs`：本次驱动脚本与隔离启动夹具。
- `/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-native-import-final-tests.log`：11 项回归。
- `/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-opencode-probe-summary.md`：OpenCode 首屏隔离实验。
- `/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-mac-typecheck.log`、`/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-mac-npm-smoke-final.log`：类型检查和最终安装包验证日志。
- `/Users/lanzhou/Project/ForgeBadger/docs/local-evidence/terminal-2026-09-10/fb-node-pty-tarball-modes.log`：原始依赖包 helper 权限证据。

原始证据已归档至本机 `docs/local-evidence/terminal-2026-09-10/`（未纳入 Git），tmp 中的工作副本已清理。本记录保留环境、验收步骤、结果和限制，不包含凭据或模型会话内容。


## 升级复用缺口（2026-09-10）

用户实际启动暴露 `Session Server attach timed out after 5000ms`：凌晨启动的旧 daemon 与新 Gateway 均声明协议 v1，但旧 daemon 没有新 attach receipt 语义。此前独立新 daemon 验收未覆盖这个升级场景，因此不能证明旧进程复用可用。

最终按用户“全部改造为新的，不用对旧的兼容”要求切换：wire protocol、socket、named pipe、token 全部使用 v2，无旧路径探测或回退。已显式停止旧 daemon（PID 32854），新 daemon PID 41924 使用 `~/.forgebadger/session-server-v2.sock`，旧 token 已清理。历史数据库字段没有做破坏性迁移。

新版本相关测试 43/43，compiled daemon 真实 PTY 测试 1/1，Gateway typecheck/build 通过。旧协议拒绝测试继续保留，作用是拒绝不兼容服务，不是兼容旧运行时。

实际用户环境已恢复验收：在用户 Chrome 的会话列表显式启动原 Codex 会话，连接后显示 Codex 0.153.4；使用 Down + Enter 跳过更新提示，输入 `terminal-input-check` 可见回显，刷新后终端快照恢复，最后用 Backspace 清空测试文字。未提交模型请求。Gateway 健康接口正常，页面保留运行中的 Codex 供用户继续使用。


## 终端字段命名清理（2026-09-10）

活动源码、API 与 Web 统一使用 `runtimeSessionName`；迁移 `0076_session_runtime_names` 原位将 sessions / session_snapshots 两表的列改为 `runtime_session_name`，不保留旧 API 字段别名。快照模式为 `attach_runtime`。已发布历史迁移与旧字段拒绝测试保留，避免破坏数据库升级链。

已通过 SQLite backup API 备份本机库，并在副本上验证 103 张业务表的数据逐行摘要一致（包含 1 条会话、31 条快照），外键、完整性和重复迁移均通过。本机启动已应用 0076，实际 sessions/snapshots API 不再返回旧字段。Gateway 重启后原 daemon PID 41924 / Codex PID 42566 保持不变，用户 Chrome 页面重连、输入回显成功，测试输入已清除。

验证：Web 454/454；全工作区 typecheck/build；迁移测试与校验器；快照/重连等 focused 15/15；npm build/verify/smoke（真实安装后的 PTY 输入输出与停止）均通过。后端全量本轮 1168 通过、3 失败、1 跳过；其中夹具被自动发现而误启本机环境的问题已修复，相关 focused 复验通过；其余两项是先前已复现的会话排序与项目默认模板断言失败，未在命名清理中扩大范围修改。

本机备份及验证日志保存在 `docs/local-evidence/terminal-2026-09-10/naming/`（忽略 Git，备份权限 0600）。
