## Why

模板管理模块存在"虚胖与死角并存"：同一套规范需写入 CLAUDE.md/AGENTS.md/opencode.json 等多格式（社区公认跨工具规则漂移是最痛点），模板本应是"单一规范源 → 各适配器生成"，但当前模板与项目脱钩——项目创建后模板即死，`usageCount` 永远是 0，模板页 787 行堆了 8+ 功能但真实使用场景只是"创建项目时选一个"；内置 Claude 模板 CLAUDE.md 205 行（每次会话全量注入，违反 <200 行社区共识，稀释指令）；从项目提取模板是反向功能（配置漂移反向传播 + 未清的密钥泄露债，与 `fix-data-integrity-and-consistency` 任务 2 重叠）。

## What Changes

- 模板使用可见：`GET /templates/:id/usage` 返回使用该模板的项目列表与滞后状态；模板列表/详情的 `usageCount` 改为从 projects 表实时推导（单一事实源），不再依赖从未自增的计数器字段。
- 模板批量同步（补上最缺的价值）：新增 `POST /templates/:id/sync/preview`（按项目返回 dry-run 计划与冲突摘要）与 `POST /templates/:id/sync/apply`（按项目逐个执行，复用现有 `config/sync` 的渲染/冲突/写入链路）；模板页新增"使用此模板的项目"区块与一键同步入口。
- 内置模板瘦身：内置 Claude 模板 CLAUDE.md 从 205 行收敛到 ≤200 行目标（按社区共识 50-100 行内核 + 模块化 rules/skills），移除与 AI CLI 指令无关的根级文档文件（CHANGELOG.md、CONTRIBUTING.md），版本升至 2.2.0。
- **BREAKING** 下线"从项目创建模板"（`POST /templates/from-project`、`POST /templates/from-project/preview` 与 `services/template-from-project.ts`），移除对应前端区块与 api client；与 `fix-data-integrity-and-consistency` 协调：其提取脱敏任务（2.1/2.2）失去落点，路径白名单任务（2.3-2.5）保留给导入 manifest 与文件编辑。
- 模板页收敛为"列表 + 编辑 + 使用与同步"，删除从项目提取区块。

## Capabilities

### New Capabilities

- `template-usage-and-sync`: 模板使用统计（实时推导）、模板→项目反查、批量同步（preview/apply）与滞后标识的可验证行为。
- `template-surface-reduction`: 从项目提取功能下线、模板页交互收敛、内置模板内容预算（行数/文件集）的可验证行为。

### Modified Capabilities

<!-- 无存量规格（openspec/specs/ 为空），全部为新能力 -->

## Impact

- Gateway：`routes/templates.ts`（新增 usage/sync 路由，删除 from-project 路由）、`db/repositories/template-repository.ts`（usageCount 推导、内置模板内容/版本）、`services/template-from-project.ts`（删除）、`routes/projects.ts`（复用 `buildProjectConfigRenderPlan`/`writeConfigPlan` 的编排封装）、`services/copilot/read-tools.ts`（usageCount/toTemplateSummary 语义）、`services/catalog-sync.ts`（templatePackage 保留，不依赖 from-project）。
- Web：`app/(dashboard)/templates/page.tsx`（删除从项目区块，新增使用/同步区块）、`lib/api.ts`（新增 usage/sync client，删除 from-project client）、`lib/i18n.ts` 文案、`components/`（配置同步 preview/apply 弹窗从项目页抽为可复用组件）。
- 测试：新增 template-usage-and-sync、template-sync 路由测试；删除 `template-from-project.test.ts`；更新 `security.test.ts`、`catalog-template-install.test.ts`（如受影响）；清理 `openspec/changes/fix-data-integrity-and-consistency/tasks.md` 任务 2 的提取部分。
- 无 schema 迁移（`usageCount` 列保留，改为只读展示字段；不新增表）。