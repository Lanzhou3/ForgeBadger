## ADDED Requirements

### Requirement: 模板使用统计实时推导

模板的 `usageCount` SHALL 由使用该模板的项目数实时推导（`projects.template_id` 的 COUNT），不复用从未自增的存储计数器；模板列表与详情 API 返回的 `usageCount` MUST 等于当前用户可见项目中使用该模板的数量。内置模板与共享模板对非所有者同样按可见性返回推导值。

#### Scenario: 列表返回推导的使用计数

- **WHEN** 用户请求 `GET /api/v1/templates`
- **THEN** 每个模板的 `usageCount` 等于数据库中 `template_id` 指向该模板的项目数（跨用户项目不计入）

#### Scenario: 新建项目后计数自增

- **WHEN** 用户以模板 T 创建或导入项目
- **THEN** 再次请求模板列表时 T 的 `usageCount` 比之前多 1

#### Scenario: 项目删除后计数回落

- **WHEN** 用户删除使用模板 T 的最后一个项目
- **THEN** 再次请求模板列表时 T 的 `usageCount` 为 0

### Requirement: 模板使用项目反查

`GET /api/v1/templates/:id/usage` SHALL 返回使用该模板的项目列表；项目条目 MUST 包含 `id`、`name`、`path`、`aiTool`，以及该项目的配置滞后状态（`stale`、`missing`、`compliant` 之一，基于该项目的配置合规检查结果）。无权读取该模板的用户 MUST 收到 404。

#### Scenario: 查询使用模板的项目

- **WHEN** 用户请求某模板的 usage 端点
- **THEN** 响应 `data.projects` 包含所有使用该模板且对用户可见的项目，`data.usageCount` 与列表推导值一致

#### Scenario: 模板不可读

- **WHEN** 用户请求一个对其不可见（非本人、非 shared、非 admin）模板的 usage 端点
- **THEN** 返回 404 且不泄露模板是否存在

#### Scenario: 项目配置已滞后

- **WHEN** 项目实际配置与模板当前内容不一致（渲染计划存在 modified/unsafe 差异）
- **THEN** 该项目在 usage 响应中被标记为 `stale`

### Requirement: 模板批量同步预览

`POST /api/v1/templates/:id/sync/preview` SHALL 对指定（或全部使用中的）项目批量生成 dry-run 渲染计划；每条项目结果 MUST 包含该项目的 `config/sync` 摘要（missing/identical/modified/unsafe 文件分类与 `requiresDecision`）。该操作 MUST 不写入任何文件。

#### Scenario: 预览全部使用项目

- **WHEN** 用户不带 projectIds 调用 sync/preview
- **THEN** 响应为按项目分组的计划与冲突摘要，且服务端未发生任何文件写入

#### Scenario: 预览指定项目

- **WHEN** 用户仅指定部分 projectIds 调用 sync/preview
- **THEN** 仅这些项目被渲染预览，未指定项目不出现于响应

#### Scenario: 模板不可读或项目不可见

- **WHEN** 用户对不可见模板或不属于自己的项目调用 sync/preview
- **THEN** 相应条目返回错误且不泄露他人数据

### Requirement: 模板批量同步应用

`POST /api/v1/templates/:id/sync/apply` SHALL 按项目执行真实配置写入，复用现有配置写入链路（渲染、冲突检测、决策、备份/回滚、活动与审计记录）；每个项目 MUST 接受独立的 `decisions`（skip/overwrite），且 MUST 遵循租户过滤（只处理当前用户的项目）。写入结果 MUST 复用现有 `WriteResult` 语义（applied/rolled_back/rollback_failed）并按项目返回。

#### Scenario: 应用同步到全部项目

- **WHEN** 用户调用 sync/apply 且不带 projectIds
- **THEN** 所有使用该模板的项目逐个写入配置，响应按项目列出结果；仅处理当前用户拥有的项目

#### Scenario: 冲突需决策

- **WHEN** 某项目存在 modified/unsafe 冲突且未提供对应 decisions
- **THEN** 该项目在响应中标记为需要决策且不写入冲突文件（与 `config/sync/apply` 行为一致）

#### Scenario: 写入失败可回滚

- **WHEN** 某项目写入中途失败
- **THEN** 该项目返回 `rolled_back` 或 `rollback_failed` 结果并保留备份，活动/审计记录同步落库

#### Scenario: 同步活动被记录

- **WHEN** 批量同步应用成功
- **THEN** 每个处理的项目生成 `config_sync` 类型的审计与活动记录，`details.templateId` 指向当前模板

### Requirement: 逐项目复用配置同步能力

批量同步的执行逻辑 SHALL 复用 `buildProjectConfigRenderPlan` 与 `writeConfigPlan`（与 `POST /projects/:id/config/sync/*` 同一链路），不得为批量场景引入第二套渲染/写入实现。

#### Scenario: 单项目结果一致

- **WHEN** 对同一项目分别调用模板批量同步与项目级 `config/sync/apply`（相同 decisions）
- **THEN** 两者产生相同的写入结果与审计记录