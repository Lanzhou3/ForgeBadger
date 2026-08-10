## ADDED Requirements

### Requirement: 下线从项目创建模板

从项目提取配置创建模板的端点（`POST /api/v1/templates/from-project/preview`、`POST /api/v1/templates/from-project`）及 `services/template-from-project.ts` SHALL 移除；Web 模板页的"从项目创建"区块与对应 api client SHALL 移除；相关测试文件 SHALL 移除或改写。移除后不残留任何指向提取链路的路由、服务或 UI 文案。

**Reason**: 从项目提取是"配置漂移反向传播"功能——项目配置本就是模板注入的产物，回提既复制了项目内的人工改动（含未脱敏的机器本地配置），又与 `fix-data-integrity-and-consistency` 的提取脱敏改造重复产生安全债。

**Migration**: 该功能移除前创建的自定义模板不受影响，仍可编辑/克隆/导出/用于项目；如需保存项目内的人工配置修改，请直接在模板页编辑模板文件或使用模板克隆。

#### Scenario: 端点不存在

- **WHEN** 用户请求 `POST /api/v1/templates/from-project` 或 `.../from-project/preview`
- **THEN** 返回 404

#### Scenario: 模板页无提取入口

- **WHEN** 用户打开模板页
- **THEN** 页面上不存在"从项目创建模板"相关的表单、按钮或文案

#### Scenario: 既有自定义模板可用

- **WHEN** 用户打开此前从项目创建的自定义模板
- **THEN** 模板文件可正常查看、编辑、克隆、导出，并可用于项目配置生成

### Requirement: 模板页交互收敛

模板页界面 SHALL 收敛为"模板列表 + 文件夹编辑 + 使用项目与同步"三个核心区块；不再展示从项目创建区块，目录（catalog）模板安装入口 SHALL 保留但不得成为页面主流程的一部分（折叠或静态列表即可）。

#### Scenario: 页面主流程

- **WHEN** 用户打开模板页
- **THEN** 主操作路径为：选择模板 → 查看/编辑文件 → 查看使用该模板的项目 → 预览/应用同步

### Requirement: 内置模板内容预算

内置模板 SHALL 遵守内容预算：内置 Claude 模板的 `CLAUDE.md` MUST 不超过 200 行且不包含与 AI CLI 指令无关的根级文档文件（如 `CHANGELOG.md`、`CONTRIBUTING.md` MUST 从内置文件集移除）；模板主体内容保持模块化（指令放入 `CLAUDE.md` 内核，细则放入 `.claude/rules/*.md`，可复用流程放入 skills）；内置模板版本号 MUST 在内容变更时升级。

#### Scenario: 内置模板行数预算

- **WHEN** 校验内置 Claude 模板的 CLAUDE.md 文件
- **THEN** 其总行数不超过 200 行

#### Scenario: 无无关根级文档

- **WHEN** 校验内置模板文件集
- **THEN** 不存在 `CHANGELOG.md`、`CONTRIBUTING.md` 等非指令文件

#### Scenario: 内容更新伴随版本升级

- **WHEN** 内置模板内容被修改
- **THEN** 对应模板的 `version` 字段随之提升

### Requirement: usageCount 字段语义修正

`templates.usage_count` 列 SHALL 不再作为写入来源（保留列以兼容存量数据），所有 API 返回的 `usageCount` MUST 为实时推导值；内部代码（含 Copilot 读工具 `openforge.list_templates`、`toTemplateSummary`）MUST 统一收敛到推导值，消除"计数器从未自增"的死数据。

#### Scenario: Copilot 读取一致

- **WHEN** 用户通过 Copilot 读工具 `openforge.list_templates` 查看模板
- **THEN** 返回的 `usageCount` 与 REST 列表推导值一致

#### Scenario: 存量数据不回归

- **WHEN** 数据库中存在旧的无项目引用的 usage_count 值
- **THEN** API 返回的 usageCount 仍以实时推导为准，不展示历史存量值