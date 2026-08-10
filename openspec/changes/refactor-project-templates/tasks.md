## 1. usageCount 实时推导（Gateway）

- [x] 1.1 `TemplateRepository.listBuiltIn()`/`list()`/`getById()` 返回前用租户内 `COUNT(projects WHERE template_id && user_id)` 子查询覆盖 `usageCount` 字段（`packages/gateway/src/db/repositories/template-repository.ts`）
- [x] 1.2 确认 `services/copilot/read-tools.ts` 的 `list_templates`/`toTemplateSummary` 随仓库返回值自动得到推导计数，无额外改动点
- [x] 1.3 单测：新建/删除项目后列表 `usageCount` 随动；跨用户项目不计入；存量 usage_count 列值不影响返回（`test/template-usage.test.ts`）

## 2. 模板使用反查与批量同步（Gateway）

- [x] 2.1 新增 `services/project-config-render.ts`：从 `routes/projects.ts` 抽离 `buildProjectConfigRenderPlan`/`buildConfigSyncSummary`/`normalizeTemplateFilesForProject`/`getGatewayUrl`/`ProjectConfigSkillSync`（routes 侧 re-export 保持既有测试与 `config-compliance` 兼容）
- [x] 2.2 新增 `services/template-sync.ts`：`buildTemplateUsage`（逐项目 dry-run 渲染 + 冲突检测 → configStatus: compliant/stale/missing，仅按模板自身文件判定，忽略注入的本地 skills）、`previewTemplateSync`（不写盘）、`applyTemplateSync`（逐项目独立成败 + 逐项目 config_sync 活动/审计，decisions 按 projectId 分组，`MAX_SYNC_PROJECTS=20`）
- [x] 2.3 `routes/templates.ts` 新增 `GET /:id/usage`、`POST /:id/sync/preview`、`POST /:id/sync/apply`（模板可读性 + 项目 tenant 校验 + zod schema；`routes/index.ts` 向模板路由透传 eventBus）
- [x] 2.4 路由测试：usage 反查 compliant/stale/missing 判定与 projectIds 过滤；他人项目/不可见模板 404；显式与隐式超上限 400；preview 不写盘；apply 写缺失文件 + 活动/审计落库、skip 决策、单项目失败不中断批次（`test/template-sync.test.ts`，12 用例通过）

## 3. 内置模板瘦身（Gateway）

- [ ] 3.1 `builtInClaudeMd()` 改写为 ≤200 行内核（保留 OpenForge 集成/命令/架构/验证契约，删除 Claude 通用机制说明，官方链接改为一行指引）
- [ ] 3.2 `builtInClaudeFiles()` 移除 `CHANGELOG.md`、`CONTRIBUTING.md`；`BUILTIN_CLAUDE_TEMPLATE_VERSION` 升至 2.2.0
- [ ] 3.3 单测：内置 Claude 模板 CLAUDE.md ≤200 行；文件集不含 CHANGELOG.md/CONTRIBUTING.md；版本号已提升（`test/template-builtin-content.test.ts`）

## 4. 下线从项目创建模板

- [ ] 4.1 删除 `services/template-from-project.ts` 及 `routes/templates.ts` 中 `POST /from-project/preview`、`POST /from-project` 与对应 schema
- [ ] 4.2 删除 `test/template-from-project.test.ts`；清理 `api.test.ts` 中 from-project client 用例
- [ ] 4.3 Web：删除 `lib/api.ts` 的 `previewTemplateFromProject`/`createTemplateFromProject`/`TemplateFromProjectPreview`；模板页删除 source-project 状态、mutations 与"从项目创建"区块；清理 `i18n.ts` 无用 key

## 5. Web 模板页：使用与同步区块

- [x] 5.2 模板页新增"Sync to projects"区块（`components/templates/TemplateSyncPanel.tsx`）：usage 列表 + configStatus 徽标；"Preview changes" 接入 `POST /templates/:id/sync/preview`，"Apply to N projects" 接入 `sync/apply`（按项目勾选 overwrite 决策透传）；`lib/api.ts` 新增 `getTemplateUsage`/`previewTemplateSync`/`applyTemplateSync` 及对应类型
- [ ] 5.1 将项目详情页同步交互抽为可复用组件（如 `components/projects/ConfigSyncDialog.tsx`），项目页改用该组件（行为不变）
- [ ] 5.3 目录安装入口降为折叠区块；模板页主流程收敛为"列表 + 编辑 + 使用与同步"
- [ ] 5.4 前端测试：模板页渲染使用列表与同步交互；项目页复用组件后原有测试保持绿（`packages/web/src/app/(dashboard)/templates/*.test.tsx`）

## 6. 文档与协调

- [ ] 6.1 更新 `docs/API.md`：模板 usage/sync 端点、from-project 端点移除、usageCount 语义（实时推导）
- [ ] 6.2 协调 `openspec/changes/fix-data-integrity-and-consistency/tasks.md`：任务 2 移除提取脱敏（2.1/2.2），保留 filePath 校验/导入 manifest refine/写盘白名单（2.3-2.5）；若其已合并且 spec 含提取场景，在本 change 归档时移除对应场景
- [ ] 6.3 全仓验证：`pnpm -r typecheck`、`pnpm -r test`；前端单测/路由测试全绿后提交（Gateway 与 Web 改动按包拆分 commit）

## 7. 验收（Gate 3）

- [ ] 7.1 对照两份 spec 逐条核对场景：usage 推导、反查、批量 preview/apply、内置模板预算、from-project 404、页面收敛
- [ ] 7.2 E2E 冒烟：模板页查看使用列表 → 改模板文件 → 预览同步 → 带决策应用 → 项目页 compliance 显示 compliant；`docs`/`CLAUDE.md` 相关描述如需更新一并提交