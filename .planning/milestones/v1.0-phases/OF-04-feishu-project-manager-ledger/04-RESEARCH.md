# Phase 04: Feishu Project Manager Ledger - Research

**Researched:** 2026-05-20
**Domain:** Gateway-owned project-manager ledger, tenant-scoped SQLite persistence, Copilot read/prepare tools, Feishu-safe state explanation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

### Authority Boundary

- **D-01:** Treat the project-manager ledger as OpenForge-owned control-plane state, not Feishu-owned state. Feishu can be a source/ref channel and an approved outbound notification target, but Feishu cannot become execution authority.
- **D-02:** Do not allow Feishu free-form text to approve pending actions, send terminal input, mutate project-manager records directly, or bypass Web/Gateway approval semantics.
- **D-03:** Preserve existing pending-action execution rules. Project-manager write proposals from Copilot must become pending actions when they originate from model/tool flow; approval handlers own validation and audit.
- **D-04:** Keep terminal authority separate. Ledger events may reference sessions, run ids, evidence ids, and bounded snapshots, but must not store terminal history in SQLite or replay terminal input.

### Ledger Data Model

- **D-05:** Add migration-backed tables for project-manager state after Phase 2 Feishu bridge safety. Minimum model: project goals, work items, and ledger events.
- **D-06:** Every project-manager table must include `user_id`; project-scoped rows must include `project_id`; repositories must filter by `user_id` by construction.
- **D-07:** Work item state should use a bounded status enum such as `todo`, `in_progress`, `blocked`, `ready_for_review`, `done`, and `cancelled`. Exact enum names can be finalized in planning, but free-form state strings are not acceptable.
- **D-08:** State mutations should append a ledger event and update the current snapshot atomically. The ledger is the audit trail; the work item row is the current projection.
- **D-09:** Ledger event types must be bounded and product-facing, for example goal updated, work item created, status changed, evidence attached, blocker recorded/resolved, Copilot observation recorded, Feishu reference linked, and next step proposed.

### API And Diagnostics Surface

- **D-10:** Gateway owns all project-manager APIs under `/api/v1`; do not add Next.js API routes.
- **D-11:** Prefer project-scoped endpoints such as `/api/v1/projects/:projectId/project-manager/...` for goal, work item, and ledger queries. If planning chooses a top-level route, it must still require an explicit project id and tenant filtering.
- **D-12:** API responses must use the existing envelope contract from `CLAUDE.md` and `docs/API.md`.
- **D-13:** Diagnostics may include project-manager counts and latest safe status markers, but must not include raw ledger details that could contain sensitive prompts, tokens, terminal output, attach tokens, Feishu signatures, or provider credentials.

### Copilot And Feishu Surfaces

- **D-14:** Add read tools that explain current project-manager state, matching the design intent of `openforge.get_project_goal`, `openforge.list_project_work_items`, `openforge.get_project_work_item`, and `openforge.get_project_development_ledger`.
- **D-15:** Copilot read tools must be tenant-scoped and redacted. They should return concise state and evidence references, not unbounded logs or raw terminal transcripts.
- **D-16:** Feishu outbound updates remain approval-gated through the existing Feishu pending-action allowlist and outbound policy checks. Project-manager state does not weaken chat allowlist, identity mode, or user mapping checks.
- **D-17:** Feishu project context may include channel/task/document references only as bounded metadata. It must not expose secrets, raw webhook verification material, or cross-tenant user mapping details.

### Audit And Evidence Semantics

- **D-18:** Every project-manager mutation must write a project-manager ledger event and an `audit_logs` row with tenant-scoped, redacted details.
- **D-19:** Evidence references should be structured and bounded: command/test name, status, path/ref, session id, Copilot run id, Feishu task/doc/chat id if allowed, and timestamps. Avoid storing raw command output unless planning proves a safe size/redaction policy.
- **D-20:** Marking a work item `done` should require at least one evidence reference or an explicit "manual completion" reason in the ledger event. Silent completion is not acceptable.
- **D-21:** Audit and ledger details must never store API keys, JWTs, attach tokens, private keys, Feishu webhook tokens, event encrypt keys, provider credentials, or full CLI stderr.

### the agent's Discretion [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

The user explicitly authorized the recommended defaults without waiting for further replies. Downstream agents may choose exact endpoint names, table names, and repository method names if they preserve the decisions above, existing repository style, tenant filtering, and API envelope contract.

### Deferred Ideas (OUT OF SCOPE) [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

- Batch authorization with budgets and stop conditions belongs in a future phase after explicit approval mode and ledger semantics have evidence.
- Feishu natural-language approvals remain out of scope. Future approval semantics require explicit OpenForge approval tokens and audit rows.
- Feishu terminal control, raw shell execution, and autonomous remote development loops remain out of scope.
- Web project-manager dashboard polish may follow after backend/API/Copilot state is stable.
- SSH/remote execution and hosted collaboration remain Phase 5 or later.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PM-01 | Project-manager work item and ledger tables are introduced only after Feishu bridge safety evidence is accepted. [CITED: `.planning/REQUIREMENTS.md`] | Phase 2 validation and summary show public webhook safety completed with signature, replay, rate-limit, fail-closed policy, and tests; Phase 4 can add tables now but must keep bridge safety unchanged. [VERIFIED: `.planning/phases/OF-02-public-feishu-webhook-safety/02-VALIDATION.md`, `.planning/phases/OF-02-public-feishu-webhook-safety/02-02-SUMMARY.md`] |
| PM-02 | Project-manager state remains auditable, tenant-scoped, and separate from terminal authority. [CITED: `.planning/REQUIREMENTS.md`] | Use Gateway repository methods constructed with `userId`, `project_id` filters, atomic SQLite transactions, append-only ledger rows, `AuditLogRepository`, and evidence references instead of terminal logs. [VERIFIED: `packages/gateway/src/db/repositories/audit-log-repository.ts`, `packages/gateway/src/db/repositories/feishu-integration-repository.ts`, `packages/gateway/src/routes/copilot.ts`] |
| PM-03 | Any future Feishu approval semantics require explicit OpenForge approval tokens and audit rows, not natural language approval text. [CITED: `.planning/REQUIREMENTS.md`] | Phase 4 must not implement Feishu approvals; existing Feishu inbound and public webhook routes reject free-form approval semantics and keep pending-action approval in Gateway routes. [VERIFIED: `docs/API.md`, `packages/gateway/src/routes/integrations-feishu.ts`, `packages/gateway/src/routes/copilot.ts`] |
</phase_requirements>

## Summary

Phase 4 should be planned as a Gateway-first persistence and explanation layer: add `project_goals`, `project_work_items`, and `project_development_events` with `user_id` and `project_id` scoping, then expose read-only project-manager state through project-scoped REST routes, Copilot read tools, and redacted diagnostics. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`, `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md`]

The critical design constraint is authority separation: Feishu can trigger bounded Copilot conversations and approved outbound updates through existing policy gates, but project-manager state cannot become Feishu-controlled execution state and cannot approve pending actions or write terminal input. [CITED: `docs/API.md`, `.planning/DECISIONS-INDEX.md`, `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

The planner should split the phase into a contract/spec task and an implementation task: first lock the model, transition table, event taxonomy, evidence schema, and redaction rules; then implement migration, repository, routes, Copilot tools, diagnostics, tests, and API docs. [VERIFIED: `.planning/ROADMAP.md`, `packages/gateway/src/db/schema.ts`, `packages/gateway/src/services/copilot/read-tools.ts`, `packages/gateway/test/db-schema.test.ts`]

**Primary recommendation:** Use existing Gateway patterns: Drizzle schema + SQL migration, `better-sqlite3` repository transactions, zod request/tool schemas, `AuditLogRepository`, Copilot pending actions for model-origin writes, and bounded diagnostics summaries. [VERIFIED: `packages/gateway/package.json`, `packages/gateway/src/db/repositories/feishu-integration-repository.ts`, `packages/gateway/src/routes/copilot.ts`, `packages/gateway/src/services/diagnostics.ts`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Ledger schema and migrations | Database / Storage | API / Backend | The durable source of truth is SQLite tables and migration files; Gateway owns schema changes. [VERIFIED: `packages/gateway/src/db/schema.ts`, `packages/gateway/src/db/migrations/`] |
| Project-manager current state projection | API / Backend | Database / Storage | Repository methods should update current rows and append ledger events atomically, using tenant/project filters. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |
| Audit logging | API / Backend | Database / Storage | Mutations must write `audit_logs`; the existing audit repository is user-scoped. [VERIFIED: `packages/gateway/src/db/repositories/audit-log-repository.ts`] |
| Project-scoped REST read APIs | API / Backend | Browser / Client | Gateway serves `/api/v1` routes; Web is only a caller if a minimal client contract is needed. [VERIFIED: `AGENTS.md`, `packages/gateway/src/routes/index.ts`] |
| Copilot state explanation | API / Backend | Database / Storage | Copilot tools execute inside Gateway with zod validation and user-scoped repositories. [VERIFIED: `packages/gateway/src/services/copilot/read-tools.ts`, `packages/gateway/src/services/copilot/tool-registry.ts`] |
| Feishu-safe state explanation | API / Backend | Feishu channel | Feishu events can create Copilot runs after policy checks; the answer path should use Copilot read tools and existing approval-gated outbound Feishu actions, not direct ledger mutation. [VERIFIED: `packages/gateway/src/routes/integrations-feishu.ts`, `packages/gateway/src/routes/copilot.ts`] |
| Diagnostics summary | API / Backend | Browser / Client | Diagnostics exports bounded counts/status metadata and redacts sensitive fields before returning data. [VERIFIED: `packages/gateway/src/services/diagnostics.ts`, `docs/API.md`] |

## Project Constraints (from AGENTS.md)

- Gateway owns HTTP/WebSocket/API, repositories, diagnostics, integration behavior, and terminal/process management; Web remains a pure SPA client. [VERIFIED: `AGENTS.md`, `CLAUDE.md`]
- Do not implement Gateway API behavior in Next.js API routes; all REST APIs remain under `/api/v1`. [VERIFIED: `AGENTS.md`, `docs/API.md`]
- REST responses must use `{ "code": 0, "data": {}, "message": "" }` and `{ "code": 1, "message": "...", "details": {} }`. [VERIFIED: `AGENTS.md`, `.claude/rules/api.md`, `docs/API.md`]
- Terminal persistence remains tmux; terminal history must not be stored in SQLite and must be recovered through bounded tmux capture when needed. [VERIFIED: `AGENTS.md`, `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md`]
- Every business table must be scoped by `user_id`; repository classes should apply `WHERE user_id = ?` internally. [VERIFIED: `AGENTS.md`, `CLAUDE.md`, `.claude/rules/security.md`]
- Boundary inputs require schema validation, preferably zod; SQL must use parameterized queries or ORM-safe APIs. [VERIFIED: `AGENTS.md`, `.claude/rules/api.md`, `.claude/rules/security.md`]
- Hardcoded secrets and sensitive logs are forbidden; API keys, JWTs, attach tokens, Feishu webhook secrets, provider credentials, and plaintext CLI stderr must not appear in logs, diagnostics, audit details, or ledger details. [VERIFIED: `AGENTS.md`, `docs/API.md`]
- Backend work should follow focused functions, early returns, contextual error handling, and TDD where practical. [VERIFIED: `AGENTS.md`, `.claude/rules/backend.md`, `.claude/rules/testing.md`]
- Completion claims require relevant verification commands or explicit skip reasons. [VERIFIED: `AGENTS.md`]
- No `.codex/skills/` or `.agents/skills/` project skill directory exists in this checkout, so no project-local skill rules were loaded. [VERIFIED: shell `test -d .codex/skills`, `test -d .agents/skills`]

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Node.js | v24.14.1 installed; project engine `>=20.0.0` | Gateway runtime and `node:test` execution | Existing monorepo requires Node 20+ and uses built-in test runner for backend. [VERIFIED: `package.json`, shell `node --version`, `packages/gateway/package.json`] |
| pnpm | 10.33.2 | Monorepo package manager and test/build runner | Existing scripts and package manager pin use pnpm. [VERIFIED: `package.json`, shell `pnpm --version`] |
| TypeScript | 5.9.3 installed | Type safety for Gateway and tests | Existing Gateway/Web packages compile through `tsc`. [VERIFIED: shell `pnpm --dir packages/gateway exec tsc --version`, `packages/gateway/package.json`] |
| Express | 4.22.1 installed | Gateway REST route hosting | Existing Gateway routes are Express routers mounted under `/api/v1`. [VERIFIED: `packages/gateway/src/routes/index.ts`, shell `pnpm --dir packages/gateway list --depth 0 --json`] |
| better-sqlite3 | 11.10.0 installed | SQLite access and synchronous transaction API | Existing repositories use prepared statements and `db.transaction()` for atomic multi-step operations. [VERIFIED: `packages/gateway/src/db/repositories/feishu-integration-repository.ts`, shell `pnpm --dir packages/gateway list --depth 0 --json`] |
| Drizzle ORM | 0.36.4 installed | TypeScript schema definitions and migration runtime | Existing schema is Drizzle SQLite schema and tests run Drizzle migrator against in-memory SQLite. [VERIFIED: `packages/gateway/src/db/schema.ts`, `packages/gateway/test/db-schema.test.ts`] |
| drizzle-kit | 0.28.1 installed | SQL migration generation | Existing Gateway command uses `drizzle-kit generate`; installed CLI reports matching version. [VERIFIED: `CLAUDE.md`, shell `pnpm --dir packages/gateway exec drizzle-kit --version`] |
| zod | 3.25.76 installed | API and Copilot tool input validation | Existing Feishu routes and Copilot tools use zod `.strict()` schemas. [VERIFIED: `packages/gateway/src/routes/integrations-feishu.ts`, `packages/gateway/src/services/copilot/read-tools.ts`] |
| node:test | built into Node.js | Backend unit/integration tests | Existing backend tests import `describe`, `it`, and hooks from `node:test`; Node docs describe the test runner and process isolation. [VERIFIED: `packages/gateway/test/*.test.ts`, CITED: `https://nodejs.org/api/test.html`] |

### Supporting

| Internal Module / Tool | Version | Purpose | When to Use |
|------------------------|---------|---------|-------------|
| `AuditLogRepository` | repo-local | Tenant-scoped audit rows | Use for every project-manager mutation and pending-action decision. [VERIFIED: `packages/gateway/src/db/repositories/audit-log-repository.ts`] |
| `CopilotRepository` | repo-local | Runs, events, pending actions, conversations | Use for project-manager Copilot tools and approval flow integration. [VERIFIED: `packages/gateway/src/db/repositories/copilot-repository.ts`] |
| `FeishuIntegrationRepository` | repo-local | Feishu config, mappings, replay, rate windows | Reference its tenant-scoped repository style and transaction pattern; do not add new Feishu authority. [VERIFIED: `packages/gateway/src/db/repositories/feishu-integration-repository.ts`] |
| `buildLocalDiagnosticsExport` | repo-local | Redacted diagnostics export | Add project-manager counts/status markers here, not raw ledger content. [VERIFIED: `packages/gateway/src/services/diagnostics.ts`] |
| `redactCopilotPayload` / `redactCopilotText` | repo-local | Redaction before audit/model/diagnostic persistence | Use when serializing ledger-derived fields into tool results, audit details, or Feishu/Copilot context. [VERIFIED: `packages/gateway/src/routes/copilot.ts`, `packages/gateway/src/routes/integrations-feishu.ts`] |
| `lark-cli` | 1.0.32 installed | Existing Feishu integration executable | Phase 4 should not require new raw CLI calls; use only existing approval-gated Feishu actions if tests exercise outbound behavior. [VERIFIED: shell `lark-cli --version`, `packages/gateway/src/services/integrations/feishu-commands.ts`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Gateway-owned project-manager state | Feishu Tasks as source of truth | Rejected for Phase 4 because user decisions make OpenForge the control-plane source of truth and Feishu a channel only. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |
| Append-only ledger plus current projection | Only mutable work-item rows | Rejected because PM-02 requires auditability and D-08 makes the ledger the audit trail. [CITED: `.planning/REQUIREMENTS.md`, `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |
| Copilot pending actions for model-origin writes | Direct mutation inside Copilot tool execution | Rejected because prepare tools currently create pending actions and mutation/terminal input require approval. [CITED: `docs/API.md`, VERIFIED: `packages/gateway/src/services/copilot/read-tools.ts`, `packages/gateway/src/routes/copilot.ts`] |
| Raw terminal history in ledger | Bounded session/evidence references | Rejected because terminal history belongs to tmux and not SQLite. [VERIFIED: `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md`, `AGENTS.md`] |

**Installation:**

No new external packages are recommended for Phase 4; use the installed monorepo stack. [VERIFIED: `packages/gateway/package.json`, `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

```bash
# No npm/pnpm install required for Phase 4.
```

**Version verification:** Versions above were checked with `pnpm --dir packages/gateway list --depth 0 --json`, `pnpm --dir packages/web list --depth 0 --json`, `node --version`, `pnpm --version`, and `pnpm --dir packages/gateway exec drizzle-kit --version`. [VERIFIED: shell commands]

## Package Legitimacy Audit

No package legitimacy gate is required because this phase should not install external packages. [VERIFIED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`, `packages/gateway/package.json`]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | n/a | n/a | n/a | n/a | n/a | No new package install planned. [VERIFIED: phase scope/codebase] |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
Project Manager read request
  -> Gateway auth middleware
  -> Project visibility check by user_id + project_id
  -> ProjectManagerRepository
  -> SQLite current projection + append-only ledger rows
  -> OpenForge envelope response

Copilot run source=copilot|project|feishu
  -> Gateway Copilot tool registry
  -> project-manager read tools
  -> tenant/project-scoped repository reads
  -> redacted bounded tool output
  -> model response or pending action proposal

Model-origin project-manager write proposal
  -> prepare tool creates Copilot pending action
  -> explicit OpenForge approval route
  -> approval handler revalidates payload and project visibility
  -> db.transaction(update projection + insert ledger event + insert audit row)
  -> Copilot timeline/event response

Feishu public/inbound command
  -> existing Feishu signature/policy/user-mapping gates
  -> Copilot run source=feishu
  -> project-manager read tools for explanation
  -> optional existing Feishu outbound prepare action
  -> explicit OpenForge approval
```

All arrows stay within Gateway for enforcement; Feishu and Web are clients/channels, not execution authorities. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`, VERIFIED: `packages/gateway/src/routes/integrations-feishu.ts`, `packages/gateway/src/routes/copilot.ts`]

### Recommended Project Structure

```text
packages/gateway/src/
├── db/
│   ├── schema.ts                                # Add project-manager tables with user_id/project_id indexes. [VERIFIED: existing file]
│   ├── migrations/0022_project_manager_ledger.sql # New migration after 0021. [VERIFIED: existing migration order]
│   └── repositories/project-manager-repository.ts # Tenant-scoped projection + ledger repository. [CITED: 04-CONTEXT.md]
├── routes/
│   └── project-manager.ts                       # Project-scoped read routes, mounted under /api/v1/projects/:projectId/project-manager or equivalent. [CITED: 04-CONTEXT.md]
├── services/
│   ├── copilot/read-tools.ts                    # Add read tools and model-origin prepare tools. [VERIFIED: existing tool registry]
│   └── diagnostics.ts                           # Add safe counts/status markers only. [VERIFIED: existing diagnostics service]
└── test/
    ├── project-manager-repository.test.ts       # New repository/transition/audit tests. [CITED: 04-CONTEXT.md]
    ├── db-schema.test.ts                        # Extend expected table list. [VERIFIED: existing test]
    ├── copilot-tools.test.ts                    # Extend read/prepare tool coverage. [VERIFIED: existing test]
    ├── copilot-routes.test.ts                   # Extend approval handler coverage if prepare writes are implemented. [VERIFIED: existing test]
    └── diagnostics.test.ts                      # Extend redaction/count coverage. [VERIFIED: existing test]
```

### Pattern 1: Tenant-Scoped Repository Construction

**What:** Repository constructor accepts `db` and `userId`, then every read/write filters by `user_id`. [VERIFIED: `packages/gateway/src/db/repositories/audit-log-repository.ts`, `packages/gateway/src/db/repositories/feishu-integration-repository.ts`]

**When to use:** Every project-manager table and query. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

**Example:**

```typescript
// Source: packages/gateway/src/db/repositories/feishu-integration-repository.ts
export class ProjectManagerRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  getWorkItem(projectId: string, workItemId: string): ProjectWorkItem | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM project_work_items
      WHERE id = ? AND user_id = ? AND project_id = ?
    `).get(workItemId, this.userId, projectId) as ProjectWorkItemRow | undefined;
    return row ? toWorkItem(row) : undefined;
  }
}
```

### Pattern 2: Atomic Projection Update Plus Ledger Event

**What:** Wrap the mutable work-item update, append-only event insert, and audit-row creation in one transaction. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`; VERIFIED: `packages/gateway/src/db/repositories/feishu-integration-repository.ts`]

**When to use:** Status changes, evidence attachment, blocker changes, goal updates, and approved project-manager proposals. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

**Example:**

```typescript
// Source: better-sqlite3 transaction pattern in packages/gateway/src/db/repositories/feishu-integration-repository.ts
const mutate = this.db.transaction(() => {
  this.db.prepare(`
    UPDATE project_work_items
    SET status = ?, evidence_json = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND project_id = ?
  `).run(nextStatus, JSON.stringify(evidence), now, workItemId, this.userId, projectId);

  this.db.prepare(`
    INSERT INTO project_development_events (
      id, user_id, project_id, work_item_id, event_type, actor_type, actor_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, this.userId, projectId, workItemId, eventType, actorType, actorId, JSON.stringify(details), now);
});
mutate();
```

Drizzle documents transaction semantics as a logical unit that commits or rolls back together; local code already uses `better-sqlite3` transactions for Feishu replay/rate and mapping replacement. [CITED: `https://orm.drizzle.team/docs/transactions`; VERIFIED: `packages/gateway/src/db/repositories/feishu-integration-repository.ts`]

### Pattern 3: Zod Boundary Validation With Envelope Responses

**What:** Route request bodies and params use zod `.strict()` schemas; success and error responses use the OpenForge envelope. [VERIFIED: `packages/gateway/src/routes/integrations-feishu.ts`, `.claude/rules/api.md`, `docs/API.md`]

**When to use:** Project-manager routes and Copilot prepare-tool schemas. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

**Example:**

```typescript
// Source: packages/gateway/src/routes/integrations-feishu.ts
const listWorkItemsSchema = z.object({
  status: z.enum(["todo", "in_progress", "blocked", "ready_for_review", "done", "cancelled"]).optional(),
  limit: z.number().int().min(1).max(50).optional()
}).strict();

router.get("/projects/:projectId/project-manager/work-items", (req, res) => {
  const parsed = listWorkItemsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ code: 1, message: "Invalid project-manager query" });
    return;
  }
  res.json({ code: 0, data: { workItems: [] }, message: "" });
});
```

### Pattern 4: Copilot Read Tools Are Direct, Prepare Tools Create Pending Actions

**What:** Read tools return bounded state directly; prepare tools create pending actions and do not mutate runtime state. [VERIFIED: `packages/gateway/src/services/copilot/read-tools.ts`, `docs/API.md`]

**When to use:** Add `openforge.get_project_goal`, `openforge.list_project_work_items`, `openforge.get_project_work_item`, and `openforge.get_project_development_ledger` as read tools; model-origin writes must be prepare tools. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

**Example:**

```typescript
// Source: packages/gateway/src/services/copilot/read-tools.ts
{
  name: "openforge.list_project_work_items",
  description: "Read current project-manager work items for one visible project.",
  risk: "read",
  requiresApproval: false,
  inputSchema: z.object({
    projectId: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional()
  }).strict(),
  modelInputSchema: projectManagerWorkItemsModelInputSchema,
  execute: async (input, context) => listProjectWorkItems(input, context)
}
```

### Pattern 5: Diagnostics Counts, Not Raw Ledger

**What:** Diagnostics should add counts and latest safe markers, never raw ledger event details. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`; VERIFIED: `packages/gateway/src/services/diagnostics.ts`]

**When to use:** Extend `counts` with project-manager totals and optionally add a `projectManager` summary object with bounded statuses. [VERIFIED: `packages/gateway/src/services/diagnostics.ts`]

**Example:**

```typescript
// Source: packages/gateway/src/services/diagnostics.ts
projectManager: {
  counts: {
    goals: countProjectManagerTable(db, "project_goals", userId),
    workItems: countProjectManagerTable(db, "project_work_items", userId),
    ledgerEvents: countProjectManagerTable(db, "project_development_events", userId)
  },
  latestStatusMarkers: ["blocked", "ready_for_review"]
}
```

### Anti-Patterns to Avoid

- **Direct Feishu-to-ledger mutation:** This violates the locked authority boundary; Feishu can be source metadata or approved outbound channel only. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
- **Natural-language approval parsing:** Existing Feishu text such as `approve` or `/approve <id>` is not an approval channel. [CITED: `docs/API.md`; VERIFIED: `packages/gateway/src/routes/integrations-feishu.ts`]
- **Raw terminal transcript persistence:** Terminal history belongs to tmux capture, not SQLite ledger rows. [VERIFIED: `AGENTS.md`, `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md`]
- **Free-form statuses or event types:** Status and event type fields must be bounded enums to keep API, Copilot, and diagnostics explainable. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
- **Diagnostics as data export:** Diagnostics can expose counts/status markers, not raw ledger details, prompts, tokens, signatures, or credentials. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`; VERIFIED: `packages/gateway/src/services/diagnostics.ts`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant filtering | Ad hoc `userId` checks in route handlers only | Repository constructors with `userId` and SQL `WHERE user_id = ?` | Existing repository contract centralizes tenant isolation. [VERIFIED: `CLAUDE.md`, `packages/gateway/src/db/repositories/*`] |
| Audit trail | A JSON array on work item rows | Append-only `project_development_events` plus `audit_logs` | PM-02 requires auditability and D-08 separates projection from ledger. [CITED: `.planning/REQUIREMENTS.md`, `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |
| State transitions | Free-form status text | Bounded status enum and transition validator | Copilot, API, and diagnostics need predictable product state. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |
| Model-origin writes | Direct tool mutation | Copilot pending actions and approval handlers | Existing prepare tools defer side effects until explicit approval. [VERIFIED: `packages/gateway/src/services/copilot/read-tools.ts`, `packages/gateway/src/routes/copilot.ts`] |
| Feishu CLI integration | Model-generated command strings | Existing Gateway-owned Feishu command allowlist | Existing approval path maps only known operations to known `lark-cli` command families. [VERIFIED: `packages/gateway/src/routes/copilot.ts`, `packages/gateway/src/services/integrations/feishu-commands.ts`] |
| Terminal evidence | SQLite terminal logs | Structured evidence references and bounded tmux snapshots | Terminal history storage in SQLite is forbidden. [VERIFIED: `AGENTS.md`, `CLAUDE.md`] |
| Secret redaction | Regexes copied into each new route | Existing `redactCopilotPayload`, `redactCopilotText`, diagnostics redaction helpers | Current Copilot/diagnostics paths already redact before persistence/output. [VERIFIED: `packages/gateway/src/routes/copilot.ts`, `packages/gateway/src/services/diagnostics.ts`] |

**Key insight:** The hard part is not creating task tables; it is preserving OpenForge's authority model while making project-manager state explainable from Copilot and Feishu-origin conversations. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`, `.planning/DECISIONS-INDEX.md`]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Existing SQLite DBs will not have `project_goals`, `project_work_items`, or `project_development_events`; current migrations stop at `0021_feishu_public_webhook.sql`. [VERIFIED: `packages/gateway/src/db/migrations/`, `packages/gateway/test/db-schema.test.ts`] | Add migration `0022_project_manager_ledger.sql`, update Drizzle schema, update schema test expected tables, and ensure migration is idempotent in in-memory tests. [VERIFIED: `packages/gateway/test/db-schema.test.ts`] |
| Live service config | Existing Feishu config tables store enabled state, emergency disable, identity mode, chat allowlist, public webhook secrets, and user mappings. [VERIFIED: `packages/gateway/src/db/schema.ts`, `packages/gateway/src/db/repositories/feishu-integration-repository.ts`] | Do not change Feishu authority settings for Phase 4; only link allowed Feishu refs as bounded metadata. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |
| OS-registered state | No OS-level registration is required for this ledger; `tmux` remains terminal runtime state and should not be modified by ledger migration. [VERIFIED: `AGENTS.md`, shell `tmux -V`] | None for ledger. Keep terminal interactions behind existing session/Copilot approval paths. [VERIFIED: `packages/gateway/src/routes/copilot.ts`] |
| Secrets/env vars | Existing sensitive env vars include `OPENFORGE_MASTER_KEY`, `OPENFORGE_JWT_SECRET`, and Feishu webhook encrypted secrets stored in DB columns. [VERIFIED: `AGENTS.md`, `packages/gateway/src/db/schema.ts`] | Ledger schema must not add secret columns; evidence details must reject/redact API keys, JWTs, attach tokens, Feishu tokens, encrypt keys, signatures, provider credentials, and raw CLI stderr. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |
| Build artifacts | Build output copies `src/db/migrations` into `dist/src/db` during Gateway build. [VERIFIED: `packages/gateway/package.json`] | Ensure the new migration file is under `packages/gateway/src/db/migrations/` so existing build packaging includes it. [VERIFIED: `packages/gateway/package.json`] |

## Common Pitfalls

### Pitfall 1: Ledger Becomes A Second Approval System
**What goes wrong:** Project-manager events or Feishu text are interpreted as approval decisions. [CITED: `docs/API.md`, `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**Why it happens:** Ledger status and "done/approved" language can be confused with Copilot pending-action approval semantics. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**How to avoid:** Keep approval in `POST /api/v1/copilot/runs/:id/pending-actions/:actionId/approve`; ledger mutations from model flow must be pending actions first. [VERIFIED: `packages/gateway/src/routes/copilot.ts`]
**Warning signs:** New route or Feishu handler updates work items directly after parsing natural language. [VERIFIED: `packages/gateway/src/routes/integrations-feishu.ts` as current no-approval baseline]

### Pitfall 2: Tenant Filtering Only In API Layer
**What goes wrong:** A route checks project ownership but a repository method later reads ledger/work items without `user_id`. [CITED: `.planning/REQUIREMENTS.md`; VERIFIED: `CLAUDE.md`]
**Why it happens:** New repositories sometimes copy SQL without the established constructor-scoped `userId` pattern. [VERIFIED: existing repository patterns]
**How to avoid:** `ProjectManagerRepository(db, userId)` must include `user_id` in every query and include `project_id` for project-scoped rows. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**Warning signs:** Tests can read another user's work item by id alone. [VERIFIED: `packages/gateway/test/feishu-integration.test.ts` tenant-isolation style]

### Pitfall 3: Ledger Stores Evidence Blobs Instead Of References
**What goes wrong:** Raw command output, terminal transcript, Feishu message text, or provider request payload ends up in SQLite. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**Why it happens:** Evidence requirements are underspecified and implementation stores "helpful" raw details. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**How to avoid:** Store structured references and bounded summaries; use redaction helpers on every detail payload. [VERIFIED: `packages/gateway/src/routes/copilot.ts`, `packages/gateway/src/services/diagnostics.ts`]
**Warning signs:** New table columns named `output`, `stderr`, `transcript`, `token`, `secret`, or `signature`. [VERIFIED: `packages/gateway/test/feishu-integration.test.ts` includes schema secret scan style]

### Pitfall 4: Completing Work Items Without Evidence
**What goes wrong:** Work items move to `done` silently. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**Why it happens:** Status update validation does not special-case completion. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**How to avoid:** Repository/status transition validation should require at least one evidence reference or an explicit manual completion reason for `done`. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**Warning signs:** Tests cover `todo -> done` without evidence and pass. [CITED: `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md`]

### Pitfall 5: Diagnostics Leak Raw Ledger Details
**What goes wrong:** Diagnostics export includes event details that contain prompts, text summaries, file paths, or IDs beyond safe markers. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
**Why it happens:** Diagnostics additions copy repository list output instead of summarizing counts. [VERIFIED: `packages/gateway/src/services/diagnostics.ts` current count-summary pattern]
**How to avoid:** Add counts and status markers only; test that secret-like values are absent. [VERIFIED: `packages/gateway/test/diagnostics.test.ts`, `packages/gateway/src/services/diagnostics.ts`]
**Warning signs:** Diagnostics tests assert full ledger event objects. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

## Code Examples

### Work Item Status Transition Validator

```typescript
// Source: Phase 4 D-07/D-20 decisions in 04-CONTEXT.md
const workItemStatuses = [
  "todo",
  "in_progress",
  "blocked",
  "ready_for_review",
  "done",
  "cancelled"
] as const;

function validateWorkItemTransition(input: {
  from: WorkItemStatus;
  to: WorkItemStatus;
  evidenceRefs: EvidenceRef[];
  manualCompletionReason?: string;
}): void {
  if (input.to === "done" && input.evidenceRefs.length === 0 && !input.manualCompletionReason?.trim()) {
    throw new Error("Work item completion requires evidence or a manual completion reason");
  }
}
```

### Project-Scoped Route Mount

```typescript
// Source: packages/gateway/src/routes/index.ts and docs/API.md
app.use("/api/v1/projects", createProjectRoutes(deps.db, deps.sessionManager, deps.eventBus));
app.use("/api/v1/projects", createProjectManagerRoutes({
  db: deps.db
}));
```

### Audit Row For Approved Project-Manager Mutation

```typescript
// Source: packages/gateway/src/routes/copilot.ts recordPendingActionAudit pattern
new AuditLogRepository(db, userId).create({
  action: "project_manager.work_item.status_change",
  resourceType: "project_manager_work_item",
  resourceId: workItemId,
  details: redactCopilotPayload({
    projectId,
    fromStatus,
    toStatus,
    ledgerEventId,
    evidenceRefCount: evidenceRefs.length,
    actorType: "copilot_pending_action",
    actionId
  }),
  ipAddress
});
```

### Copilot Read Tool Output Shape

```typescript
// Source: packages/gateway/src/services/copilot/read-tools.ts bounded read-tool pattern
return {
  projectId,
  goal: goal ? {
    id: goal.id,
    status: goal.status,
    summary: goal.summary,
    acceptanceCriteria: goal.acceptanceCriteria.slice(0, 20)
  } : null,
  workItems: workItems.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    evidenceRefCount: item.evidenceRefs.length,
    linkedSessionIds: item.linkedSessionIds.slice(0, 10)
  }))
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Broad Feishu project-manager plan including batch authorization and UI panel | Phase 4 is backend-first ledger/API/Copilot-read/diagnostics; batch authorization and Web polish are deferred | Locked in Phase 4 CONTEXT on 2026-05-20 | Planner should not pull in batch budgets, natural-language approvals, or full Web dashboard polish. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |
| Guarded authenticated `/inbound` as only Feishu ingress | Public webhook route exists but is disabled by default and signature/replay/rate checked before Copilot execution | Phase 2 completed 2026-05-20 | PM-01 dependency is satisfied, but Phase 4 must not weaken webhook gates. [VERIFIED: `.planning/phases/OF-02-public-feishu-webhook-safety/02-VALIDATION.md`, `packages/gateway/src/routes/integrations-feishu.ts`] |
| Copilot tools as only platform/status helpers | Copilot already has read tools and approval-gated prepare tools; Phase 4 extends same registry for project-manager state | Existing before Phase 4 | Add tools without changing pending-action semantics. [VERIFIED: `packages/gateway/src/services/copilot/read-tools.ts`, `docs/API.md`] |
| Diagnostics only app/runtime/provider/Feishu summary | Add project-manager counts and safe status markers | Phase 4 target | Avoid raw ledger data in diagnostics. [VERIFIED: `packages/gateway/src/services/diagnostics.ts`; CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |

**Deprecated/outdated:**
- `project_batch_authorizations` from the older broad plan is out of scope for Phase 4; batch authorization is deferred. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`, `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md`]
- Feishu approval links or codes are out of scope until explicit tokenized approval semantics are designed. [CITED: `.planning/DECISIONS-INDEX.md`, `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
- Any direct Feishu terminal control remains out of scope. [CITED: `.planning/REQUIREMENTS.md`, `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

## Assumptions Log

All implementation-shaping claims in this research are sourced from project docs, current code, local package metadata, or official documentation. No `[ASSUMED]` claims are required for planning. [VERIFIED: source review]

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| none | No assumed claim recorded. | n/a | n/a |

## Open Questions (RESOLVED)

1. **Should Phase 4 include prepare tools for project-manager writes, or only read tools plus REST read APIs?**
   - What we know: Context D-03 says model-origin write proposals must become pending actions, and D-14 explicitly requires read tools. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
   - What's unclear: The success criteria can pass with durable state/read surfaces, but full project-manager write proposals may expand Plan 04-02. [CITED: `.planning/ROADMAP.md`]
   - Recommendation: Plan 04-01 should specify write proposal scope; Plan 04-02 should implement read tools first and include prepare/approval handlers only if necessary to prove mutation/audit semantics. [VERIFIED: `packages/gateway/src/services/copilot/read-tools.ts`, `packages/gateway/src/routes/copilot.ts`]
   - RESOLVED: Phase 4 implements REST mutations plus Copilot read tools only. Model-origin project-manager write prepare tools and approval handlers are deferred unless a later phase explicitly adds them; any future model-origin writes must use pending actions.

2. **Exact endpoint prefix: `/projects/:projectId/project-manager` or `/projects/:projectId/manager`?**
   - What we know: Context D-11 prefers `/api/v1/projects/:projectId/project-manager/...`; older broad plan used `/manager`. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`, `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md`]
   - What's unclear: The exact route name is discretionary if explicit project id and tenant filtering are preserved. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
   - Recommendation: Use `/api/v1/projects/:projectId/project-manager` for clarity and to match Phase 4 context. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
   - RESOLVED: Use `/api/v1/projects/:projectId/project-manager/...` for Phase 4 routes.

3. **Should manual Web editing exist now?**
   - What we know: Phase 4 is backend-first and Web polish is deferred unless minimal client contract is needed. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
   - What's unclear: Manual editing can be useful but expands frontend scope and ownership boundaries. [VERIFIED: `AGENTS.md`]
   - Recommendation: Do not plan manual Web editing in Phase 4; use API/Copilot/diagnostics proof first. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
   - RESOLVED: Do not implement manual Web editing in Phase 4; prove the backend, Copilot read tools, and diagnostics surfaces first.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Gateway tests, TypeScript tooling | yes | v24.14.1 | Project engine allows Node >=20; current version is sufficient. [VERIFIED: shell `node --version`, `package.json`] |
| pnpm | Monorepo commands | yes | 10.33.2 | None needed. [VERIFIED: shell `pnpm --version`, `package.json`] |
| drizzle-kit | Migration generation | yes | 0.28.1 | Manual SQL migration following existing files if generation is not used. [VERIFIED: shell `pnpm --dir packages/gateway exec drizzle-kit --version`, `packages/gateway/src/db/migrations/`] |
| TypeScript compiler | Typecheck | yes | 5.9.3 installed | None needed. [VERIFIED: shell `pnpm --dir packages/gateway exec tsc --version`] |
| `lark-cli` | Optional manual Feishu status/outbound smoke; not required for ledger unit tests | yes | 1.0.32 | Mock command runner in tests, as current Feishu tests do. [VERIFIED: shell `lark-cli --version`, `packages/gateway/test/feishu-integration.test.ts`] |
| `tmux` | Optional terminal evidence smoke; not required for ledger persistence | yes | 3.4 | Repository/tool tests can use evidence references without real tmux. [VERIFIED: shell `tmux -V`, `packages/gateway/test/integration/tmux.test.ts`] |
| `sqlite3` CLI | Manual DB inspection only | no | n/a | Use `better-sqlite3` and Drizzle migrator in Node tests. [VERIFIED: shell `command -v sqlite3`, `packages/gateway/test/db-schema.test.ts`] |

**Missing dependencies with no fallback:**
- None. [VERIFIED: environment probes]

**Missing dependencies with fallback:**
- `sqlite3` CLI is not installed; existing tests use in-memory `better-sqlite3` plus Drizzle migrator. [VERIFIED: shell `command -v sqlite3`, `packages/gateway/test/db-schema.test.ts`]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Gateway `node:test` with `tsx`; Web Vitest only if a minimal client contract is added. [VERIFIED: `packages/gateway/package.json`, `packages/web/package.json`] |
| Config file | `packages/gateway/package.json`, `packages/gateway/tsconfig.json`; no separate node:test config. [VERIFIED: repo files] |
| Quick run command | `pnpm --dir packages/gateway test test/db-schema.test.ts test/project-manager-repository.test.ts` [VERIFIED: existing command pattern; `test/project-manager-repository.test.ts` is Wave 0 gap] |
| Full suite command | `pnpm --dir packages/gateway test test/db-schema.test.ts test/project-manager-repository.test.ts test/copilot-tools.test.ts test/copilot-routes.test.ts test/diagnostics.test.ts && pnpm --dir packages/gateway typecheck` [VERIFIED: existing test files and scripts] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PM-01 | New tables are migration-backed, migration is idempotent, and Phase 2 Feishu webhook safety tests remain green. [CITED: `.planning/REQUIREMENTS.md`] | schema + regression | `pnpm --dir packages/gateway test test/db-schema.test.ts test/feishu-integration.test.ts` | Existing; extend `db-schema.test.ts`. [VERIFIED: `packages/gateway/test/db-schema.test.ts`, `packages/gateway/test/feishu-integration.test.ts`] |
| PM-02 | Work items/goals/ledger events are tenant/project scoped; ledger append and projection update are atomic; audit rows are written; terminal authority remains separate. [CITED: `.planning/REQUIREMENTS.md`] | repository + route + approval | `pnpm --dir packages/gateway test test/project-manager-repository.test.ts test/copilot-routes.test.ts` | `project-manager-repository.test.ts` missing; `copilot-routes.test.ts` exists. [VERIFIED: `rg --files packages/gateway/test`] |
| PM-03 | Feishu free-form text still cannot approve pending actions; future approval semantics are not introduced in this phase. [CITED: `.planning/REQUIREMENTS.md`] | regression | `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts` | Existing. [VERIFIED: `packages/gateway/test/feishu-integration.test.ts`, `packages/gateway/test/copilot-routes.test.ts`] |

### Sampling Rate

- **Per task commit:** Run the narrowest changed-area command: schema/repository tasks use `pnpm --dir packages/gateway test test/db-schema.test.ts test/project-manager-repository.test.ts`; Copilot tool tasks add `test/copilot-tools.test.ts`; diagnostics tasks add `test/diagnostics.test.ts`. [VERIFIED: existing test layout]
- **Per wave merge:** Run `pnpm --dir packages/gateway test test/db-schema.test.ts test/project-manager-repository.test.ts test/copilot-tools.test.ts test/copilot-routes.test.ts test/diagnostics.test.ts` plus `pnpm --dir packages/gateway typecheck`. [VERIFIED: existing scripts]
- **Phase gate:** Run the full suite above, `pnpm --dir packages/gateway test test/feishu-integration.test.ts`, and `git diff --check` before `$gsd-verify-work`. [VERIFIED: Phase 2 validation pattern]

### Wave 0 Gaps

- [ ] `packages/gateway/test/project-manager-repository.test.ts` — covers PM-01/PM-02 table scoping, transitions, completion evidence rule, append-only ledger, and atomic mutation. [CITED: `.planning/REQUIREMENTS.md`, `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
- [ ] `packages/gateway/src/db/repositories/project-manager-repository.ts` — repository under test. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
- [ ] `packages/gateway/src/routes/project-manager.ts` — only if Plan 04-02 exposes REST read APIs outside `projects.ts`. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
- [ ] Update `packages/gateway/test/db-schema.test.ts` expected table list for new tables. [VERIFIED: existing schema test]
- [ ] Extend `packages/gateway/test/copilot-tools.test.ts` for project-manager read tools and optional prepare tools. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]
- [ ] Extend `packages/gateway/test/diagnostics.test.ts` for safe counts and secret absence. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`]

## Security Domain

Security enforcement is enabled in `.planning/config.json`; ASVS Level 1 is configured. [VERIFIED: `.planning/config.json`] OWASP ASVS is the application security verification standard for technical security controls. [CITED: `https://owasp.org/www-project-application-security-verification-standard/`]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Reuse JWT Bearer auth for REST routes; public Feishu webhook remains separate existing protocol route. [VERIFIED: `docs/API.md`, `packages/gateway/src/routes/index.ts`] |
| V3 Session Management | no new session semantics | Do not add browser/session state for ledger; preserve existing Copilot pending-action session behavior. [VERIFIED: `packages/gateway/src/routes/copilot.ts`] |
| V4 Access Control | yes | Repository-level `user_id` and `project_id` filtering; project visibility check before every route/tool read. [VERIFIED: `CLAUDE.md`, `packages/gateway/src/db/repositories/project-repository.ts`] |
| V5 Input Validation | yes | zod schemas for route params/bodies and Copilot tool inputs; bounded enums for status and event types. [VERIFIED: `.claude/rules/api.md`, `packages/gateway/src/services/copilot/read-tools.ts`] |
| V6 Cryptography | no new crypto | Do not add secret storage to ledger; existing Feishu webhook secrets remain encrypted in existing integration config. [VERIFIED: `packages/gateway/src/db/schema.ts`, `packages/gateway/src/db/repositories/feishu-integration-repository.ts`] |
| V7 Error Handling and Logging | yes | Audit rows with redacted/bounded details; errors use envelope and non-leaking reason codes. [VERIFIED: `packages/gateway/src/routes/copilot.ts`, `packages/gateway/src/routes/integrations-feishu.ts`] |

### Known Threat Patterns for Gateway Ledger

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant ledger/work-item read | Information Disclosure | Repository `user_id` filters, project visibility checks, tests with owner/other users. [VERIFIED: existing repository/test patterns] |
| Feishu text becomes approval or terminal authority | Elevation of Privilege | Keep Feishu inbound as Copilot source only; pending action approve route remains only approval path. [VERIFIED: `docs/API.md`, `packages/gateway/src/routes/integrations-feishu.ts`, `packages/gateway/src/routes/copilot.ts`] |
| SQL injection through filters/status/search | Tampering | zod validation plus prepared statements/Drizzle APIs. [VERIFIED: `.claude/rules/api.md`, `packages/gateway/src/db/repositories/feishu-integration-repository.ts`] |
| Secret leakage in ledger/audit/diagnostics | Information Disclosure | Store evidence references, not raw blobs; redact details; diagnostics expose counts only. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`; VERIFIED: `packages/gateway/src/services/diagnostics.ts`] |
| Replay/duplicate approval of model-origin writes | Tampering | Use existing pending-action claim/update-if-status flow and idempotent not-pending failure. [VERIFIED: `packages/gateway/src/routes/copilot.ts`, `docs/API.md`] |
| Work item completion without evidence | Repudiation | Require evidence reference or manual completion reason and append ledger event. [CITED: `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md`] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md` - locked Phase 4 decisions, authority boundary, data model, API/diagnostics, Copilot/Feishu surface, audit/evidence semantics.
- `.planning/REQUIREMENTS.md` - PM-01, PM-02, PM-03 requirement text and deferred/out-of-scope boundaries.
- `.planning/STATE.md` and `.planning/ROADMAP.md` - current phase position, Phase 4 dependency, success criteria, and plan list.
- `AGENTS.md`, `CLAUDE.md`, `.claude/rules/api.md`, `.claude/rules/security.md`, `.claude/rules/backend.md`, `.claude/rules/testing.md` - project constraints and workflow rules.
- `docs/API.md` - current Feishu webhook, inbound, Copilot tool, pending-action, diagnostics, and audit contracts.
- `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md` - project-manager ledger goals, data model, tool names, safety model, and phased delivery.
- `packages/gateway/src/db/schema.ts`, `packages/gateway/src/db/repositories/*.ts`, `packages/gateway/src/routes/*.ts`, `packages/gateway/src/services/copilot/read-tools.ts`, `packages/gateway/src/services/diagnostics.ts` - current implementation patterns.
- `packages/gateway/test/db-schema.test.ts`, `packages/gateway/test/feishu-integration.test.ts`, `packages/gateway/test/copilot-tools.test.ts`, `packages/gateway/test/copilot-routes.test.ts`, `packages/gateway/test/diagnostics.test.ts` - validation architecture and regression targets.
- Official Drizzle transactions docs - transaction semantics. `https://orm.drizzle.team/docs/transactions`
- Official Node.js test runner docs - node:test behavior and execution model. `https://nodejs.org/api/test.html`
- OWASP ASVS official page - application security verification standard context. `https://owasp.org/www-project-application-security-verification-standard/`

### Secondary (MEDIUM confidence)

- `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md` - older broad implementation plan; useful for file/task suggestions but superseded by Phase 4 context where scope differs.
- `.planning/phases/OF-02-public-feishu-webhook-safety/02-VALIDATION.md` and `02-02-SUMMARY.md` - evidence that Feishu public webhook safety completed before Phase 4.
- `.planning/phases/OF-03-first-user-product-hardening/03-VERIFICATION.md` - first-user hardening baseline before collaboration expansion.

### Tertiary (LOW confidence)

- Memory lookup showed prior Feishu CLI compatibility lessons, but this research used current code/docs as source of truth and did not rely on memory for implementation facts. [VERIFIED: `/root/.codex/memories/MEMORY.md` review]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions and scripts were verified from installed packages and project files. [VERIFIED: shell commands, `package.json`]
- Architecture: HIGH - Phase 4 decisions and existing Gateway patterns align tightly. [CITED: `04-CONTEXT.md`; VERIFIED: Gateway code]
- Pitfalls: HIGH - risks are explicitly covered by context decisions, API docs, and current Feishu/Copilot implementation. [CITED: `04-CONTEXT.md`, `docs/API.md`; VERIFIED: codebase]
- External docs: MEDIUM - Context7 MCP was unavailable and `ctx7` CLI was not installed, so official docs were fetched through web search/open rather than Context7. [VERIFIED: shell `command -v ctx7`; CITED: official docs URLs]

**Research date:** 2026-05-20
**Valid until:** 2026-06-19 for repo-local architecture; re-check package/API docs before adding new external dependencies or Feishu approval semantics. [VERIFIED: current scope]
