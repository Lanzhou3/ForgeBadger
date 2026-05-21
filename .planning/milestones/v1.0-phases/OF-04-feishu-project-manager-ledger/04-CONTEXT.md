# Phase 4: Feishu Project Manager Ledger - Context

**Gathered:** 2026-05-20T22:31:21+08:00
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds tenant-scoped, migration-backed project-manager state for project goals, work items, and ledger events. The ledger is an internal OpenForge audit and explanation layer for project status. It must not grant Feishu terminal control, pending-action approval authority, raw CLI execution, or natural-language approval semantics.

Phase 4 is backend-first. It should deliver the database/repository/API/Copilot-read/diagnostics surface needed to explain project-manager state safely. User-facing Web polish, batch authorization, autonomous loops, and remote execution stay outside this phase unless a minimal client contract is needed to prove API behavior.

</domain>

<decisions>
## Implementation Decisions

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

### the agent's Discretion

The user explicitly authorized the recommended defaults without waiting for further replies. Downstream agents may choose exact endpoint names, table names, and repository method names if they preserve the decisions above, existing repository style, tenant filtering, and API envelope contract.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product And Roadmap

- `.planning/PROJECT.md` - local-first product wedge, active constraints, and Feishu as collaboration channel only.
- `.planning/REQUIREMENTS.md` - PM-01, PM-02, PM-03 and out-of-scope boundaries.
- `.planning/ROADMAP.md` - Phase 4 scope, dependencies, success criteria, and plan list.
- `.planning/phases/OF-02-public-feishu-webhook-safety/02-VERIFICATION.md` - proof that public Feishu webhook safety completed before ledger expansion.
- `.planning/phases/OF-03-first-user-product-hardening/03-VERIFICATION.md` - current first-user hardening baseline before collaboration expansion.

### Source Of Truth Docs

- `CLAUDE.md` - architecture, API envelope, security, test, and workflow rules.
- `docs/TECH-ARCHITECTURE.md` - Gateway/Web split, persistence patterns, and terminal architecture.
- `docs/API.md` - existing Feishu endpoints, approval restrictions, audit behavior, and API envelope.
- `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md` - product model for Feishu project-manager Copilot, non-goals, tools, and approval model.
- `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md` - older broad implementation plan; use as source material, not as scope authority when it exceeds Phase 4.

### Gateway Code

- `packages/gateway/src/db/schema.ts` - current projects, sessions, Copilot, Feishu, and audit schemas.
- `packages/gateway/src/db/repositories/audit-log-repository.ts` - tenant-scoped audit repository pattern.
- `packages/gateway/src/db/repositories/feishu-integration-repository.ts` - tenant-scoped Feishu config, mappings, replay, and rate-window repository pattern.
- `packages/gateway/src/routes/integrations-feishu.ts` - Feishu config, public webhook, inbound policy, and audit implementation.
- `packages/gateway/src/routes/copilot.ts` - pending-action approval flow and Feishu outbound policy enforcement.
- `packages/gateway/src/services/copilot/read-tools.ts` - Copilot read/prepare tool registry and schema patterns.
- `packages/gateway/src/services/diagnostics.ts` - redacted diagnostics export pattern.

### Tests

- `packages/gateway/test/feishu-integration.test.ts` - Feishu safety and integration behavior tests.
- `packages/gateway/test/copilot-routes.test.ts` - pending-action and Copilot route behavior tests.
- `packages/gateway/test/copilot-tools.test.ts` - Copilot tool behavior tests.
- `packages/gateway/test/diagnostics.test.ts` - diagnostics redaction and shape tests.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `AuditLogRepository`: Already scopes list/create by `userId`; project-manager mutations should write audit rows through this repository.
- `FeishuIntegrationRepository`: Shows raw SQL repository style for tenant-owned integration tables, JSON-normalized arrays, bounded limits, and fail-closed defaults.
- `CopilotRepository` and pending actions: Existing run/event/action persistence should be referenced by ledger events instead of duplicated.
- `buildLocalDiagnosticsExport`: Existing diagnostics output includes counts, Copilot readiness, Feishu integration status, and redaction helpers. Phase 4 can add project-manager summaries here.
- `createFeishuProposal` and Feishu pending actions: Existing approval-gated outbound model should remain the only Feishu write path.

### Established Patterns

- Tenant-owned repositories are constructed with `db` and `userId`, then add `WHERE user_id = ?` internally.
- Schema tables use Drizzle definitions while repositories often use `better-sqlite3` prepared statements for focused data access.
- Copilot tools use zod input schemas, a `risk` classification, `requiresApproval` for prepare tools, and bounded serialized outputs.
- Approval handlers validate pending-action input again before executing side effects.
- Diagnostics expose capability summaries and counts, not raw secrets or operational transcripts.

### Integration Points

- New schema should sit near projects/sessions/Copilot tables in `packages/gateway/src/db/schema.ts` and be backed by a migration under the existing migrations directory.
- New repository should likely be `packages/gateway/src/db/repositories/project-manager-repository.ts`.
- New routes should mount through the existing Gateway route index and use authenticated user context.
- New Copilot tools should be added to `packages/gateway/src/services/copilot/read-tools.ts` and tested without invoking Feishu CLI.
- New pending-action approval handlers, if included, must be wired in `packages/gateway/src/routes/copilot.ts` and preserve approval/cancellation semantics.
- Diagnostics additions should update `packages/gateway/src/services/diagnostics.ts` and `packages/gateway/test/diagnostics.test.ts`.

</code_context>

<specifics>
## Specific Ideas

- Keep Phase 4 focused on a durable "project manager ledger" rather than the broader old plan's full Feishu collaboration UI and batch authorization.
- Start with backend and diagnostics surfaces because PM-01 through PM-03 are trust and audit requirements, not visual polish requirements.
- Expose state explanation through Copilot read tools before adding broader mutation flows. This makes the feature useful for status review without expanding execution authority.
- Prefer evidence references over raw evidence blobs. This matches OpenForge's control-plane role and avoids storing terminal history in SQLite.

</specifics>

<deferred>
## Deferred Ideas

- Batch authorization with budgets and stop conditions belongs in a future phase after explicit approval mode and ledger semantics have evidence.
- Feishu natural-language approvals remain out of scope. Future approval semantics require explicit OpenForge approval tokens and audit rows.
- Feishu terminal control, raw shell execution, and autonomous remote development loops remain out of scope.
- Web project-manager dashboard polish may follow after backend/API/Copilot state is stable.
- SSH/remote execution and hosted collaboration remain Phase 5 or later.

</deferred>

---

*Phase: 4-Feishu Project Manager Ledger*
*Context gathered: 2026-05-20T22:31:21+08:00*
