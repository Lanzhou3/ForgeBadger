# Phase 04: Feishu Project Manager Ledger - Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 17
**Analogs found:** 17 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/gateway/src/db/schema.ts` | model/schema | CRUD, audit projection | `packages/gateway/src/db/schema.ts` Feishu/audit tables | exact |
| `packages/gateway/src/db/migrations/0022_project_manager_ledger.sql` | migration | CRUD, audit projection | `packages/gateway/src/db/migrations/0019_feishu_integration.sql`, `0021_feishu_public_webhook.sql` | exact |
| `packages/gateway/src/db/repositories/project-manager-repository.ts` | repository | CRUD, event-driven ledger, transaction | `packages/gateway/src/db/repositories/feishu-integration-repository.ts` | exact |
| `packages/gateway/src/db/repositories/index.ts` | config/export | module export | `packages/gateway/src/db/repositories/index.ts` | exact |
| `packages/gateway/src/routes/project-manager.ts` | route/controller | request-response, CRUD | `packages/gateway/src/routes/projects.ts`, `integrations-feishu.ts` | exact |
| `packages/gateway/src/routes/index.ts` | route/config | request-response routing | `packages/gateway/src/routes/index.ts` | exact |
| `packages/gateway/src/services/copilot/read-tools.ts` | service/tool | request-response, read, pending-action prepare | `packages/gateway/src/services/copilot/read-tools.ts` | exact |
| `packages/gateway/src/routes/copilot.ts` | route/controller | request-response, pending-action approval | `packages/gateway/src/routes/copilot.ts` | exact |
| `packages/gateway/src/services/diagnostics.ts` | service/utility | transform, request-response | `packages/gateway/src/services/diagnostics.ts` | exact |
| `docs/API.md` | docs/contract | API contract | `docs/API.md` Copilot/Feishu/diagnostics sections | exact |
| `packages/gateway/test/project-manager-repository.test.ts` | test | CRUD, transaction, audit | `packages/gateway/test/feishu-integration.test.ts` | exact |
| `packages/gateway/test/project-manager-routes.test.ts` | test | request-response | `packages/gateway/test/diagnostics-routes.test.ts`, `feishu-integration.test.ts` | role-match |
| `packages/gateway/test/db-schema.test.ts` | test | migration/schema | `packages/gateway/test/db-schema.test.ts` | exact |
| `packages/gateway/test/copilot-tools.test.ts` | test | request-response tool execution | `packages/gateway/test/copilot-tools.test.ts` | exact |
| `packages/gateway/test/copilot-routes.test.ts` | test | pending-action approval | `packages/gateway/test/copilot-routes.test.ts` | exact |
| `packages/gateway/test/diagnostics.test.ts` | test | transform/redaction | `packages/gateway/test/diagnostics.test.ts` | exact |
| `packages/gateway/test/diagnostics-routes.test.ts` | test | request-response diagnostics export | `packages/gateway/test/diagnostics-routes.test.ts` | role-match |

## Pattern Assignments

### `packages/gateway/src/db/schema.ts` and `0022_project_manager_ledger.sql`

**Analog:** `packages/gateway/src/db/schema.ts`, `0019_feishu_integration.sql`, `0021_feishu_public_webhook.sql`

**Imports and table style** (`schema.ts` lines 1-2, 305-320, 481-510):
```typescript
import { randomUUID } from "node:crypto";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  // ...
}, (table) => ({ idx_projects_user_path: uniqueIndex("idx_projects_user_path").on(table.userId, table.path) }));
```

**Project/user-scoped index pattern** (`schema.ts` lines 512-531, 534-554):
```typescript
projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
// ...
idx_session_activities_user_created: index("idx_session_activities_user_created").on(table.userId, table.createdAt),
idx_session_activities_project: index("idx_session_activities_project").on(table.userId, table.projectId)
```

**Feishu/audit table pattern** (`schema.ts` lines 587-704):
```typescript
export const integrationFeishuConfigs = sqliteTable(
  "integration_feishu_configs",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    allowedChatIds: text("allowed_chat_ids").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_integration_feishu_configs_user: uniqueIndex("idx_integration_feishu_configs_user").on(table.userId)
  })
);
```

**Migration SQL style** (`0019_feishu_integration.sql` lines 1-30, `0021_feishu_public_webhook.sql` lines 13-39):
```sql
CREATE TABLE `integration_feishu_user_mappings` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `feishu_user_id` text NOT NULL,
  `openforge_user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_feishu_user_mappings_feishu_user`
ON `integration_feishu_user_mappings` (`user_id`,`feishu_user_id`);
```

**Apply:** add `project_goals`, `project_work_items`, and `project_development_events` with `user_id` on every table, `project_id` on project-scoped rows, bounded `status`/`event_type` strings, JSON text columns for bounded evidence/details, and indexes on `(user_id, project_id)`, status, and event created time. Do not add terminal-history columns.

---

### `packages/gateway/src/db/repositories/project-manager-repository.ts`

**Analog:** `packages/gateway/src/db/repositories/feishu-integration-repository.ts`, `audit-log-repository.ts`, `project-repository.ts`

**Tenant constructor and `WHERE user_id = ?` pattern** (`feishu-integration-repository.ts` lines 122-135; `project-repository.ts` lines 32-88):
```typescript
export class FeishuIntegrationRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly masterKey?: string
  ) {}

  getConfig(): FeishuIntegrationConfig {
    const row = this.db.prepare(`
      SELECT * FROM integration_feishu_configs
      WHERE user_id = ?
    `).get(this.userId) as FeishuConfigRow | undefined;
    return row ? toConfig(row) : { ...defaultConfig };
  }
}
```

**Atomic transaction pattern** (`feishu-integration-repository.ts` lines 253-314, 325-353):
```typescript
const replace = this.db.transaction(() => {
  this.db.prepare(`
    DELETE FROM integration_feishu_user_mappings
    WHERE user_id = ?
  `).run(this.userId);

  const insert = this.db.prepare(`
    INSERT INTO integration_feishu_user_mappings (
      id, user_id, feishu_user_id, openforge_user_id, display_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const mapping of mappings) {
    insert.run(randomUUID(), this.userId, mapping.feishuUserId, mapping.openforgeUserId, mapping.displayName ?? null, now, now);
  }
});
replace();
```

**Audit repository pattern** (`audit-log-repository.ts` lines 33-67):
```typescript
new AuditLogRepository(db, userId).create({
  action: "project_manager.work_item.status_change",
  resourceType: "project_manager_work_item",
  resourceId: workItemId,
  details: { projectId, fromStatus, toStatus },
  ipAddress
});
```

**Bounded normalization pattern** (`feishu-integration-repository.ts` lines 399-493):
```typescript
function normalizeAllowedChatIds(values: string[]): string[] {
  if (values.length > maxAllowedChatIds) {
    throw new Error(`Feishu allowed chat ids cannot exceed ${maxAllowedChatIds}`);
  }
  const ids = values.map((value) => value.trim()).filter((value) => value.length > 0);
  const unique = Array.from(new Set(ids));
  if (unique.some((value) => value.length > 128)) {
    throw new Error("Feishu allowed chat ids must be 128 characters or fewer");
  }
  return unique;
}
```

**Apply:** repository methods must be constructed as `new ProjectManagerRepository(db, userId)`, then always include `user_id = ?` and `project_id = ?` in project-scoped queries. Mutation methods should use a single `db.transaction()` to update the current row, insert a `project_development_events` row, and write the corresponding redacted audit row. Marking `done` must validate evidence refs or an explicit manual-completion reason before the transaction runs.

---

### `packages/gateway/src/routes/project-manager.ts` and `routes/index.ts`

**Analog:** `packages/gateway/src/routes/projects.ts`, `integrations-feishu.ts`, `routes/index.ts`

**Auth, zod, envelope, project visibility** (`projects.ts` lines 78-145, 147-195):
```typescript
export function createProjectRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ProjectRepository(db, userId);
    const project = repo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }
    res.json({ code: 0, data: { project }, message: "" });
  });
}
```

**Validated mutation with audit** (`integrations-feishu.ts` lines 316-340, 360-379):
```typescript
const parseResult = feishuConfigSchema.safeParse(req.body ?? {});
if (!parseResult.success) {
  res.status(400).json({ code: 1, message: "Invalid Feishu integration config" });
  return;
}

const userId = (req as unknown as AuthenticatedRequest).userId;
const config = new FeishuIntegrationRepository(db, userId).upsertConfig(parseResult.data);
new AuditLogRepository(db, userId).create({
  action: "feishu.config.update",
  resourceType: "feishu_integration",
  details: { enabled: config.enabled, allowedChatIdCount: config.allowedChatIds.length },
  ipAddress: req.ip
});
res.json({ code: 0, data: { config: toConfigPayload(config) }, message: "" });
```

**Route mount pattern** (`routes/index.ts` lines 36-53, 88-100):
```typescript
app.use("/api/v1/projects", createProjectRoutes(deps.db, deps.sessionManager, deps.eventBus));
app.use("/api/v1/diagnostics", createDiagnosticsRoutes({
  db: deps.db,
  masterKey: deps.masterKey,
  appVersion: deps.appVersion
}));
```

**Apply:** prefer `createProjectManagerRoutes(db)` mounted on `/api/v1/projects`, with paths like `/:projectId/project-manager/goal`, `/:projectId/project-manager/work-items`, and `/:projectId/project-manager/ledger`. Each handler must first resolve `new ProjectRepository(db, userId).getById(projectId)` and return `404 { code: 1, message: "Project not found" }` for missing or cross-tenant projects.

---

### `packages/gateway/src/services/copilot/read-tools.ts`

**Analog:** `packages/gateway/src/services/copilot/read-tools.ts`, `tool-registry.ts`

**Input schemas and imports** (`read-tools.ts` lines 1-35):
```typescript
import { z } from "zod";
import { ProjectRepository, type Project } from "../../db/repositories/project-repository.js";
import { CopilotToolValidationError, type CopilotToolContext, type CopilotToolDefinition } from "./tool-registry.js";
import { redactCopilotPayload } from "./redaction.js";

const projectDetailInput = z.object({
  projectId: z.string().min(1)
}).strict();
```

**Read tool pattern** (`read-tools.ts` lines 621-670, 828-853):
```typescript
{
  name: "openforge.get_project_detail",
  description: "Read one OpenForge project visible to the current user, including session counts.",
  risk: "read",
  requiresApproval: false,
  inputSchema: projectDetailInput,
  modelInputSchema: projectDetailModelInputSchema,
  execute: async (input, context) => {
    const { projectId } = projectDetailInput.parse(input);
    const project = new ProjectRepository(context.db, context.userId).getById(projectId);
    const sessions = project ? new SessionRepository(context.db, context.userId).listByProject(project.id) : [];
    return { project: project ? toProjectDetail(project, sessions, readRuntimeSessions(context)) : null };
  }
}
```

**Prepare tool / pending-action pattern** (`read-tools.ts` lines 861-1120, 1635-1652):
```typescript
{
  name: "openforge.propose_project_config_sync",
  description: "Prepare a project AI configuration sync for user approval. This does not write config files until the user approves it.",
  risk: "prepare",
  requiresApproval: true,
  inputSchema: proposeProjectConfigSyncInput,
  modelInputSchema: proposeProjectConfigSyncModelInputSchema,
  execute: async (input, context) => createProjectConfigSyncProposal(input, context)
}

function createPendingProposal(context: Pick<CopilotToolContext, "db" | "userId" | "runId">, type: string, input: unknown) {
  if (!context.runId) throw new Error("Copilot run is required for pending actions");
  const action = new CopilotRepository(context.db, context.userId).createPendingAction(context.runId, {
    type,
    input: safeActionInput(input)
  });
  return { actionId: action.id, type: action.type, status: action.status, summary: "Pending user approval" };
}
```

**Bounded/redacted output pattern** (`tool-registry.ts` lines 67-96, 114-125; `read-tools.ts` lines 2100-2172):
```typescript
const rawSerializedOutput = serializeToolOutput(output);
const redactedOutput = redactCopilotPayload(output);
if (hasCopilotPrivateKeyMaterial(rawSerializedOutput) || isBlockedToolOutput(redactedOutput)) {
  return fail("copilot_redaction_blocked_output", "Copilot tool output was blocked by safety policy");
}
```

**Apply:** add direct read tools for `openforge.get_project_goal`, `openforge.list_project_work_items`, `openforge.get_project_work_item`, and `openforge.get_project_development_ledger`. They should return concise records and evidence refs only. If model-origin project-manager writes are included, add `openforge.propose_project_manager_*` prepare tools that only create pending actions and validate project visibility before storing the redacted action input.

---

### `packages/gateway/src/routes/copilot.ts`

**Analog:** `packages/gateway/src/routes/copilot.ts`

**Approval route claim pattern** (`copilot.ts` lines 699-813):
```typescript
const claimed = repo.updatePendingActionIfStatus(action.id, "pending", { status: "processing" });
if (!claimed) {
  return sendPendingActionNotPending(res, "Pending action is not approvable", 409, repo.getPendingAction(action.id)?.status);
}

result = await (options.pendingActionApprover ?? approvePendingAction)(claimed, options, userIdFor(req));

const updated = repo.updatePendingActionIfStatusAndRunStatus(claimed.id, "processing", "waiting_for_approval", {
  status: "approved",
  result,
  approvedBy: userIdFor(req),
  approvedAt: Date.now()
});
```

**Approval dispatch pattern** (`copilot.ts` lines 1518-1610):
```typescript
if (action.type === "openforge.propose_project_config_sync") {
  return await approveCopilotProjectConfigSync(action, options, userId);
}
if (isFeishuPendingActionType(action.type)) {
  return await approveCopilotFeishuAction(action, options, userId);
}
return {
  error: {
    code: "copilot_pending_action_unsupported",
    message: "Copilot pending action type is unsupported"
  }
};
```

**Redacted audit for decisions** (`copilot.ts` lines 1452-1474, 1477-1488):
```typescript
new AuditLogRepository(db, userId).create({
  action: decision === "approved" ? "copilot.pending_action.approve" : "copilot.pending_action.reject",
  resourceType: "copilot_run",
  resourceId: action.runId,
  details: {
    runId: action.runId,
    actionId: action.id,
    actionType: action.type,
    decision,
    input: redactCopilotPayload(action.input),
    result: redactCopilotAuditResult(result)
  },
  ipAddress
});
```

**Feishu authority boundary pattern** (`copilot.ts` lines 1628-1698):
```typescript
const feishuRepo = new FeishuIntegrationRepository(options.db, userId);
if (!feishuRepo.canExecuteActions()) {
  return { error: { code: "feishu_integration_disabled", message: "Feishu integration is disabled" } };
}
const policy = validateFeishuOutboundPolicy(feishuRepo.getConfig(), feishuRepo.listUserMappings(), operation, action.input);
if (!policy.ok) return { error: { code: policy.code, message: policy.message } };
```

**Apply:** only touch this file if Phase 4 includes model-origin project-manager mutation proposals. Add explicit action type dispatch and approval handlers; approval must re-parse the stored payload, re-check project visibility with `ProjectRepository(db, userId)`, run the repository mutation, keep Feishu policy unchanged, and preserve unsupported-action failure behavior.

---

### `packages/gateway/src/services/diagnostics.ts`

**Analog:** `packages/gateway/src/services/diagnostics.ts`

**Bounded count summary pattern** (`diagnostics.ts` lines 120-171, 303-316):
```typescript
counts: {
  projects: countTable(input.db, projects, projects.userId, input.userId),
  sessions: countTable(input.db, sessions, sessions.userId, input.userId),
  auditLogs: countTable(input.db, auditLogs, auditLogs.userId, input.userId),
  copilotMemoryEntries: countTable(input.db, copilotMemoryEntries, copilotMemoryEntries.userId, input.userId)
},
environment: redactDiagnosticValue(pickDiagnosticEnv(input.env ?? process.env)) as Record<string, unknown>
```

**Redaction helper** (`diagnostics.ts` lines 256-278):
```typescript
export function redactDiagnosticValue(value: unknown, key = ""): unknown {
  if (sensitivePattern.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (sensitiveValuePattern.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactDiagnosticValue(entryValue, entryKey)
    ]));
  }
  return value;
}
```

**Apply:** diagnostics may add `projectManager` with counts and latest safe status markers only: goal count, work item counts by bounded status, ledger event count, latest event type/time. Do not include raw `details_json`, raw evidence payloads, terminal output, Feishu tokens/signatures, attach tokens, provider credentials, or full CLI stderr.

---

### `docs/API.md`

**Analog:** `docs/API.md` diagnostics, Feishu, Copilot, audit docs

**Diagnostics contract** (`docs/API.md` lines 96-109):
```markdown
Diagnostics export is authenticated, tenant scoped, and local-only. It returns a
redacted report with app version, Node/platform metadata, tenant resource counts...
It never uploads telemetry and redacts key, token, password, credential,
authorization, `sk-*`, and `Bearer ...` values.
```

**Copilot read/prepare contract** (`docs/API.md` lines 395-399, 478-490, 528-571):
```markdown
Read tools execute directly after Gateway-side validation. Prepare tools only
create pending actions; all mutation or terminal input still requires explicit
approval through the pending-action routes.
```

**Feishu boundary contract** (`docs/API.md` lines 121-135, 184-189):
```markdown
These endpoints do not execute Feishu writes, accept model-generated command
strings, send terminal input, approve actions from Feishu text, or start
unattended development loops.
```

**Apply:** document project-manager REST endpoints, Copilot read tools, optional prepare tools, diagnostics fields, bounded evidence refs, and the explicit non-goals: Feishu text cannot approve or mutate ledger state; terminal input/history stays out of the ledger.

---

## Test Pattern Assignments

### Repository and Migration Tests

**Analog:** `packages/gateway/test/db-schema.test.ts`, `feishu-integration.test.ts`

**Migration setup** (`db-schema.test.ts` lines 9-18, 37-80, 154-156):
```typescript
function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

assert.deepEqual(names, [
  "agents",
  "api_keys",
  "audit_logs",
  // add project-manager tables in sorted order
]);
```

**Tenant-scoped repository tests** (`feishu-integration.test.ts` lines 148-227):
```typescript
const ownerRepo = new FeishuIntegrationRepository(db, owner.id);
const otherRepo = new FeishuIntegrationRepository(db, other.id);
ownerRepo.replaceUserMappings([{ feishuUserId: " ou_1 ", openforgeUserId: owner.id }]);
assert.deepEqual(otherRepo.listUserMappings(), []);
assert.throws(() => ownerRepo.replaceUserMappings(Array.from({ length: 101 }, ...)), /user mappings/i);
```

**Route audit test pattern** (`feishu-integration.test.ts` lines 279-317, 335-366):
```typescript
const updateRes = await makeRequest(app, "PATCH", "/api/v1/integrations/feishu/config", body, {
  Authorization: `Bearer ${token}`
});
assert.equal(updateRes.status, 200);
const auditLogs = new AuditLogRepository(db, user.id).list({ action: "feishu.config.update" });
assert.equal(auditLogs.length, 1);
assert.equal(auditLogs[0].resourceType, "feishu_integration");
```

**Apply:** add tests for table creation/idempotent migrations, user/project isolation, bounded status/event enum rejection, atomic projection+event mutation, `done` evidence/manual reason requirement, and audit rows with redacted details.

### Project-Manager Route Tests

**Analog:** `packages/gateway/test/diagnostics-routes.test.ts`, `feishu-integration.test.ts`

**Authenticated test app pattern** (`diagnostics-routes.test.ts` lines 31-54, 56-78):
```typescript
app = express();
app.locals.jwtSecret = secret;
app.use(express.json());
app.use("/api/v1/diagnostics", createDiagnosticsRoutes({ db, masterKey, appVersion: "0.0.0-test" }));

const res = await makeRequest(app, "GET", "/api/v1/diagnostics/export", undefined, {
  Authorization: `Bearer ${token}`
});
assert.equal(res.status, 200);
assert.equal(res.body.code, 0);
```

**Apply:** create a route test file if project-manager routes are new. Cover authenticated success envelopes, zod 400s, missing/cross-tenant project 404s, mutation audit rows, and no raw secret/terminal-output leakage in responses.

### Copilot Tool and Approval Tests

**Analog:** `packages/gateway/test/copilot-tools.test.ts`, `copilot-routes.test.ts`

**Tool registry setup** (`copilot-tools.test.ts` lines 41-53, 94-107):
```typescript
beforeEach(() => {
  db = createTestDb();
  const users = new UserRepository(db);
  userId = users.create("copilot-tools@example.com", "hash").id;
  registry = createCopilotToolRegistry(createCopilotReadTools());
});

const result = await executeCopilotTool(registry, "openforge.list_projects", {}, context(userId));
assert.equal(result.ok, true);
assert.equal(result.requiresApproval, false);
```

**Tenant-scoped read tool tests** (`copilot-tools.test.ts` lines 399-431, 1211-1229):
```typescript
const owned = await executeCopilotTool(registry, "openforge.get_project_detail", { projectId: project.id }, context(userId));
const crossTenant = await executeCopilotTool(registry, "openforge.get_project_detail", { projectId: foreign.id }, context(userId));
assert.equal((crossTenant.output as { project: unknown }).project, null);
```

**Pending-action creation tests** (`copilot-tools.test.ts` lines 1231-1255, 1967-1986, 2010-2058):
```typescript
const result = await executeCopilotTool(
  registry,
  "openforge.propose_session_create",
  { projectId: project.id, aiTool: "claude", name: "Draft session" },
  context(userId, run.id)
);
const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
assert.equal(actions[0]?.status, "pending");
assert.equal(new SessionRepository(db, userId).list().length, 0);
```

**Approval and audit tests** (`copilot-routes.test.ts` lines 2740-2753, 3090-3158, 4593-4650):
```typescript
const res = await makeRequest(
  app,
  "POST",
  `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
  undefined,
  authHeaders()
);
const auditLogs = new AuditLogRepository(db, userId).list({
  action: "copilot.pending_action.approve",
  resourceType: "copilot_run",
  resourceId: runId
});
assert.equal(auditLogs.length, 1);
assert.doesNotMatch(JSON.stringify(auditLogs), /secret-value/);
```

**Apply:** add Copilot tests for the four project-manager read tools, redaction/size boundaries, cross-tenant null/not-found behavior, optional prepare tools creating pending actions without mutation, and approval handlers revalidating stored payloads before repository writes.

### Diagnostics Tests

**Analog:** `packages/gateway/test/diagnostics.test.ts`, `copilot-tools.test.ts`

**Redaction and tenant count pattern** (`diagnostics.test.ts` lines 30-43, 45-177, 179-209):
```typescript
assert.deepEqual(
  redactDiagnosticValue({ token: "abc", nested: { OPENFORGE_MASTER_KEY: "secret", safe: "value" } }),
  { token: "[redacted]", nested: { OPENFORGE_MASTER_KEY: "[redacted]", safe: "value" } }
);

assert.equal(report.counts.auditLogs, 1);
assert.equal(JSON.stringify(report).includes("sk-test-secret"), false);
assert.equal(JSON.stringify(report).includes("Foreign Provider"), false);
```

**Copilot diagnostics tool pattern** (`copilot-tools.test.ts` lines 650-763):
```typescript
const result = await executeCopilotTool(registry, "openforge.get_diagnostics_summary", {}, context(userId));
assert.equal(result.ok, true);
assert.equal(output.diagnostics.counts.projects, 1);
assert.equal("environment" in output.diagnostics, false);
assert.doesNotMatch(json, /sk-provider-secret|secret-header-value|Foreign Provider/);
```

**Apply:** assert project-manager diagnostics include only counts/status markers for the authenticated tenant and do not serialize raw ledger details, evidence blobs, terminal history, Feishu secrets, provider credentials, or cross-tenant names.

## Shared Patterns

### Authentication and Tenant Scope
**Source:** `packages/gateway/src/routes/projects.ts` lines 83-145; `ProjectRepository` lines 32-88.
**Apply to:** all project-manager routes and Copilot tools.

Every route starts with `router.use(authenticate)`, reads `AuthenticatedRequest.userId`, and uses repositories constructed with that `userId`. Cross-tenant project ids must return `404` or `null`, never foreign data.

### API Envelope
**Source:** `projects.ts` lines 108-118, 121-145; `audit-logs.ts` lines 19-35.
**Apply to:** all REST endpoints.

Success: `{ code: 0, data: { ... }, message: "" }`. Failure: `{ code: 1, message: "..." }`, optionally with `details.code` for product-facing error codes.

### Validation
**Source:** `integrations-feishu.ts` lines 32-54, 316-323; `read-tools.ts` lines 25-35.
**Apply to:** route params/bodies/query and Copilot tool inputs.

Use zod `.strict()`, bounded strings/arrays, `z.coerce.number()` for query limits, and bounded enums for work item status and ledger event type.

### Redaction
**Source:** `diagnostics.ts` lines 256-278; `tool-registry.ts` lines 67-96; `integrations-feishu.ts` lines 922-925.
**Apply to:** ledger details, evidence refs, diagnostics, Copilot outputs, audit details, and Feishu context.

Use existing Copilot/diagnostics redaction helpers before persistence or API/model output. Store references and summaries, not raw command output or terminal transcripts.

### Pending Actions
**Source:** `read-tools.ts` lines 1635-1652; `copilot.ts` lines 699-813, 1452-1488, 1518-1610.
**Apply to:** model-origin project-manager writes, if included.

Prepare tools create pending actions only. Approval routes claim the canonical stored action, revalidate, execute side effects once, write redacted audit rows, then complete/continue the run.

### Feishu Boundary
**Source:** `integrations-feishu.ts` lines 169-224, 388-543; `copilot.ts` lines 1628-1698; `docs/API.md` lines 121-135, 184-189.
**Apply to:** any project-manager Feishu reference or outbound notification.

Do not let Feishu text approve, mutate ledger state, send terminal input, or run shell commands. Feishu references are bounded metadata only; outbound writes stay approval-gated through existing allowlisted Feishu pending actions.

## No Analog Found

None. The codebase already has close Gateway analogs for schema/migration, tenant repositories, project-scoped routes, Copilot read/prepare tools, diagnostics redaction, and node:test coverage.

## Metadata

**Analog search scope:** `packages/gateway/src/db`, `packages/gateway/src/routes`, `packages/gateway/src/services/copilot`, `packages/gateway/src/services/diagnostics.ts`, `packages/gateway/test`, `docs/API.md`

**Files scanned:** 80+ Gateway source/test/doc files via `rg --files`; strong analogs stopped after 5 core matches plus test/doc references.

**Project-local skills:** no `.codex/skills/` or `.agents/skills/` directories found in this checkout.

**Pattern extraction date:** 2026-05-20
