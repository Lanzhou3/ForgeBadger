## Context

模板模块现状（2026-08 审计）：

- **核心链路可用**：项目创建/导入写入 `projects.template_id` → `buildProjectConfigRenderPlan` 渲染（`{{var}}` 替换）→ `writeConfigPlan` 落盘。项目级配置同步（`POST /projects/:id/config/sync/preview|apply`）与合规检查（`GET /projects/:id/config/compliance`）已存在，Web 项目页已有同步 UI，Copilot 有 config-sync 提案工具。
- **缺口一（价值断层）**：模板与项目脱钩——模板方不知道哪些项目在用，没有"模板更新 → 批量重新注入"入口；`templates.usage_count` 从未自增，`usageCount` 是死字段。
- **缺口二（内容反模式）**：内置 Claude 模板 `CLAUDE.md` 205 行（`builtInClaudeMd()`，每次会话全量注入），外加 `CHANGELOG.md`/`CONTRIBUTING.md` 等与 AI CLI 指令无关的根级文档；超过社区共识的 ~100-200 行预算，稀释指令并浪费 token。
- **缺口三（反向功能+安全债）**：`POST /templates/from-project*`（从项目提取配置建模板）与 `openspec/changes/fix-data-integrity-and-consistency` 任务 2 的提取脱敏工作重叠，属"漂移反向传播"且带出机器本地配置。

约束：不新增数据库表、不做 schema 迁移；所有业务表 tenant 隔离（`user_id` 过滤由仓库层保证）；批量同步必须复用 `buildProjectConfigRenderPlan`/`writeConfigPlan` 单一链路（spec：不得引入第二套渲染/写入实现）。

## Goals / Non-Goals

**Goals:**

- 模板"活下去"：使用数实时可见、模板→项目反查、批量同步（preview/apply）、滞后标识。
- 内置模板内容对齐行业共识：CLAUDE.md ≤200 行、移除无关根级文档、模块化 rules/skills。
- 移除从项目提取链路（含服务、路由、前端区块、测试），收敛模板页为"列表 + 编辑 + 使用与同步"。
- `usageCount` 统一为实时推导值（REST + Copilot 读工具一致）。

**Non-Goals:**

- 不做模板更新自动推送（模板变更是"建议同步"，由用户在 UI 显式触发——自动覆写会越过冲突决策）。
- 不新增模板市场/目录能力，catalog 模板安装原样保留（仅页面弱化展示）。
- 不砍 clone/版本历史/导出导入（已有测试覆盖且功能有效，本次不动）。
- 不动 `templates`/`template_files` 表结构与存量行。
- 不修复 `fix-data-integrity-and-consistency` 范围内的既有缺陷，仅协调其提取脱敏任务的落点变化。

## Decisions

### D1: usageCount 由项目表实时推导（不迁移、不自增）

在 `TemplateRepository` 的 `listBuiltIn()`/`list()`/`getById()` 返回前，用子查询 `COUNT(*) FROM projects WHERE project.template_id = templates.id AND project.user_id = 当前用户` 覆盖 `usageCount` 字段（租户内计数，`readableVisibility` 语义下 shared/admin 模板对查看者也只计自己可见的项目数）。

- 备选 A（在 generate-config/sync/apply 时 `usage_count + 1`）：并发/回滚下不可靠，且 delete/import 需反向扣减，最终仍是伪计数。
- 备选 B（删列迁移）：需要 Drizzle 迁移 + 触碰 schema.ts/诊断/SQL，收益小于风险。
- 选型理由：projects 表是唯一事实源，零迁移、零竞态，Copilot 读工具与 REST 天然一致。

### D2: 批量同步 = 薄编排 + 复用项目级链路

新增服务 `packages/gateway/src/services/template-sync.ts`，三个能力：

- `buildTemplateUsage(db, userId, templateId)`：返回 `{ usageCount, projects: [{ id, name, path, aiTool, configStatus }] }`；`configStatus` 由对该项目跑一次 dry-run `buildProjectConfigRenderPlan` + `detectConfigConflicts` 得出（`stale`=有 modified/unsafe、`missing`=有新文件未写、`compliant`=全部一致）。
- `previewTemplateSync(...)`：按 projectIds（缺省=全部使用项目，上限 `MAX_SYNC_PROJECTS=20`）逐个 dry-run 渲染 + 冲突检测 + `buildConfigSyncSummary`，不写盘。
- `applyTemplateSync(...)`：逐个 `writeConfigPlan`，`decisions` 按项目分组 `Record<projectId, Record<relativePath, "skip"|"overwrite">>`；单个项目失败不中断批次；每个项目独立写 `config_sync` 审计 + 活动记录（复用项目级 recordActivity 相同语义）。返回值 `Array<{ projectId, result, summary }>`。

路由（`routes/templates.ts` 新增，权限走 `authenticate` + 模板可读性校验 + 项目 tenant 校验）：

- `GET /api/v1/templates/:id/usage`
- `POST /api/v1/templates/:id/sync/preview` body `{ projectIds?, credentialMode? }`
- `POST /api/v1/templates/:id/sync/apply` body `{ projectIds?, decisions?, credentialMode? }`

选型理由：`buildProjectConfigRenderPlan`/`writeConfigPlan`/`buildConfigSyncSummary` 已从 `routes/projects.ts` 导出（`projects.ts:906,988`），同步语义（冲突→决策→备份→回滚→活动/审计）与项目级一致，批量端只做"选项目 + 聚合 + 隔离错误"，保证 spec 的"单一链路"约束。

### D3: 内置模板瘦身（内容预算与文件集）

- `builtInClaudeMd()` 改写为 ~120 行内核，保留段：项目上下文、指令优先级、常用命令、运行模式、OpenForge 集成（hooks env、session、envelope、tmux 会话条款）、仓库导向、架构、验证契约；删除 Claude 通用机制说明段（memory/auto-memory/plugins/subagents/skills 加载原理、官方链接指引等），以一行"参考官方文档链接"替代。
- `builtInClaudeFiles()` 移除 `CHANGELOG.md`、`CONTRIBUTING.md` 两项；保留 `WORKFLOW.md`/`PLAN.md`/`.claude/rules/*`/settings/hook。
- `BUILTIN_CLAUDE_TEMPLATE_VERSION` 2.1.0 → 2.2.0（`ensureBuiltInTemplates` 会对既有文件做 upsert 覆盖，用户可借 sync 拿到新内容）。

### D4: 下线从项目提取

- 删除 `routes/templates.ts` 中 `POST /from-project/preview`、`POST /from-project` 及两个 schema；删除 `services/template-from-project.ts` 全部内容（唯一调用方是这两个路由）。
- Web：删除 `api.ts` 的 `previewTemplateFromProject`/`createTemplateFromProject`/`TemplateFromProjectPreview`；删除模板页的 source-project 状态、两个 mutation、预览渲染与"从项目创建"区块；`i18n.ts` 中不再使用的 `templates.*` key 清理。
- 测试：删除 `packages/gateway/test/template-from-project.test.ts`；`api.test.ts` 中对应 client 用例删除。
- 协调：修改 `openspec/changes/fix-data-integrity-and-consistency/tasks.md` 任务 2（提取脱敏 2.1/2.2 移除；2.3 filePath 校验、2.4 导入 manifest refine、2.5 写盘白名单保留——它们针对 import 与 `PUT /:id/files/*`，与本 change 无冲突）。若该 change 先行合并，其 `config-apply-integrity` spec 的提取场景在本 change 归档时同步移除。

### D5: 模板页结构（Web）

模板详情区新增"使用项目"子区块：

- 使用列表（来自 `GET /templates/:id/usage`）：项目名/路径/adapter + `configStatus` 徽标（compliant/stale/missing）。
- "预览同步" → 调 `POST /templates/:id/sync/preview`，按项目展示 diff 摘要与 `requiresDecision`；
- "应用同步" → 调 `POST /templates/:id/sync/apply`（`decisions` 按项目透传）。
- 将项目详情页现有同步 UI（`projects/[id]/page.tsx:200-218` 的 preview/apply/compliance 交互）抽为可复用组件（如 `components/projects/ConfigSyncDialog.tsx`），模板页与项目页共用，避免两套决策 UI。
- 目录安装入口标题降为折叠区块，不占主流程。

## Risks / Trade-offs

- [批量同步渲染成本] 对 N 个项目全量 dry-run（读盘+渲染）可能较慢 → `MAX_SYNC_PROJECTS=20` 上限 + 逐项目独立 try/catch，失败不拖垮批次；本地单用户规模下成本可控。
- [删除 from-project 与 fix-data-integrity 并行] 两个 change 同时改 `routes/templates.ts` → 本 change 含协调任务（改其 tasks.md），合并顺序以先合并者为准，后合并者做文件级取舍；提取脱敏场景随本 change 归档移除。
- [内置模板瘦身影响存量项目] 已生成的配置不会自动变化 → 正是 D2 的"stale 标识 + 用户触发同步"，行为闭环；`usageCount` 推导不影响存量数据。
- [derive 计数与 shared/admin 可见性] 非所有者查看 shared 模板时计数只含自己项目 → spec 明示"跨用户项目不计入"，避免多租户泄露使用规模。
- [usage 端点渲染成本] `GET /templates/:id/usage` 逐项目做 dry-run → 仅模板详情触发（列表页不调用）；如将来项目数大再引入缓存/异步，本期不做。

## Migration Plan

1. 无 schema 迁移；`templates.usage_count` 列保留但不再写入，语义=兼容遗留（只读推导覆盖）。
2. 部署顺序：Gateway 先行（新路由 + from-project 删除需前端同步，否则旧页面会拿到 404）→ Web 同步发布；本地开发直接双端一起改。
3. 回滚：`git revert` 本 change 即可恢复 from-project 端点与旧模板内容（`ensureBuiltInTemplates` 会随回滚的代码把内容改回原版本）。

## Open Questions

- 无阻塞项。待实现时确认：`decisions` 按键分组格式在 OpenAPI/API 文档中的示例呈现方式；Copilot 是否需要新增模板同步的提案工具（本期不做，`openforge.list_templates` 只读展示即可）。