# Phase 12: Copilot Project-Manager Traceability - Research

**Researched:** 2026-05-22  
**Domain:** Copilot pending-action approvals, Project Manager ledger/evidence traceability, Gateway/Web contract  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### PM Write Proposal Granularity

- **D-01:** Project Manager write proposals use atomic Copilot pending actions. Each pending action performs exactly one Project Manager mutation.
- **D-02:** Phase 12 supports only three PM proposal types: `create_work_item`, `update_work_item_status`, and `attach_evidence`.
- **D-03:** Cross-action dependencies are not allowed. Every action must reference existing entity IDs such as `projectId`, `workItemId`, `copilotRunId`, `pendingActionId`, and optional `sessionId`.
- **D-04:** PM action execution failure is terminal. Failed PM actions must become `failed` and require a new proposal; they must not return to `pending` and must not auto-retry.

### Traceability Anchor

- **D-05:** Traceability uses both work item `evidenceRefs` and `ledgerEvents`. Evidence refs support the work item detail view; ledger events support audit timeline and filtering.
- **D-06:** Copilot evidence refs store a minimum structured set: `copilotRunId`, `pendingActionId`, optional `sessionId`, `kind`, `label`, and `status`.
- **D-07:** Ledger events store safe trace markers: `copilotRunId`, `pendingActionId`, `actionType`, `targetType`, `targetId`, `evidenceRefCount`, `approvalStatus`, and `executionStatus`.
- **D-08:** Project Manager projection, evidence refs, ledger event, and audit row must commit in one repository transaction. If any part fails, the whole pending action fails.
- **D-09:** Traceability data must not store raw prompt text, raw terminal output, provider payloads, secrets, full approval diffs, or full execution summaries.

### Approval Card UX

- **D-10:** PM approval cards show a structured change summary: action type, target project/work item, fields to write, evidence reference count, and risk cues.
- **D-11:** PM approval cards use fixed field templates per action type. Model-generated prose must not be the primary approval summary.
- **D-12:** Approval cards show a safe chain preview: `Copilot run -> pending action -> target work item -> evidence refs / ledger event`.
- **D-13:** After approval succeeds, the user remains in Copilot and gets a `View in Project Manager` anchor from the action card.

### Completion Authority

- **D-14:** Copilot may propose `update_work_item_status -> done` only when the target work item already has trusted evidence refs. Because actions are atomic, a `done` status action must not attach new evidence itself.
- **D-15:** Only existing structured evidence refs on the target work item with trusted status semantics such as `accepted` or `verified` satisfy the Copilot `done` gate.
- **D-16:** If evidence is missing or not trusted, Copilot must first propose `attach_evidence` or another evidence-processing action, then propose `done` in a later independent action after trusted evidence exists.
- **D-17:** Work item detail must show the `done` status change together with the satisfying evidence refs, triggering Copilot run/action, and corresponding ledger event.

### the agent's Discretion

No user choices were delegated to agent discretion. Planner may choose names and internal types where the decisions above do not constrain behavior, but must preserve the approval, audit, redaction, and atomicity boundaries.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POS-01 | OpenForge remains a local-first AI CLI control plane; AI-native project management is a traceability layer on top of local AI CLI execution, not a Jira/Linear replacement. | Phase 12 must add PM traceability on existing Gateway/Web control plane, not generic PM breadth. [CITED: .planning/REQUIREMENTS.md] |
| POS-02 | Project Manager state remains Gateway-owned, tenant-scoped, audited, and bounded to structured references. | Existing PM routes verify visible projects and repositories are constructed with authenticated `user_id`; plan should extend those paths only. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] |
| POS-03 | Copilot, Feishu, and model output may propose project-manager writes only through explicit pending-action approval flows. | Existing Copilot tool system already separates read tools from prepare tools and approval execution; PM writes should enter as prepare tools and stored pending actions. [VERIFIED: packages/gateway/src/services/copilot/read-tools.ts] [VERIFIED: packages/gateway/src/routes/copilot.ts] |
| TRACE-01 | User can link a Copilot run, pending action, or safe run summary to a project-manager work item as a bounded evidence reference. | Current evidence ref schema has `copilotRunId` but not `pendingActionId`; plan must extend backend route schema, repository normalization, Web DTOs, and UI formatters. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] [VERIFIED: packages/web/src/lib/api.ts] |
| TRACE-02 | Copilot can propose project-manager work item creation, status updates, and evidence attachments through pending actions, never direct mutation. | PM write prepare tools are absent today; plan must add exactly three prepare action types and approval handlers that call existing repository methods. [VERIFIED: packages/gateway/src/services/copilot/read-tools.ts] [VERIFIED: packages/gateway/src/routes/copilot.ts] |
| TRACE-03 | Ledger events record safe traceability markers for Copilot-proposed changes, including run id, action type, status, and evidence counts without raw prompt, terminal, provider, or secret content. | Existing ledger/audit normalization redacts raw and secret-like data, but route DTO currently omits ledger details, so safe trace markers need a bounded DTO surface. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] [VERIFIED: packages/gateway/src/routes/project-manager.ts] |
| TRACE-04 | Web surfaces show how a work item moved from prompt to approval to execution evidence. | Existing Copilot cards and PM panel render generic approval/evidence/ledger surfaces; plan must add PM-specific fixed templates, success/failure summaries, and a URL-driven PM anchor. [VERIFIED: packages/web/src/components/copilot/copilot-chat-panel.tsx] [VERIFIED: packages/web/src/lib/copilot.ts] [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx] |
</phase_requirements>

## Summary

Phase 12 should be planned as a small Gateway-owned write bridge between two existing systems: Copilot pending actions and Project Manager repository transactions. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] The correct implementation path is to add exactly three Copilot prepare tools, store canonical pending-action payloads, and execute approved actions through existing `ProjectManagerRepository.createWorkItem`, `updateWorkItemStatus`, and `attachEvidence` methods. [VERIFIED: packages/gateway/src/services/copilot/read-tools.ts] [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts]

The main technical risk is not creating the PM mutations; those repository transactions already exist. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] The main risk is preserving authority and trace semantics: PM action failures must become terminal `failed` actions, `pendingActionId` must survive evidence validation/normalization/DTO rendering, safe ledger markers must be exposed without raw `details`, and Copilot-origin `done` must require existing trusted evidence refs rather than manual completion or newly attached refs. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/src/routes/project-manager.ts]

**Primary recommendation:** Implement a dedicated PM pending-action path inside the existing Copilot approval dispatcher, with PM-specific terminal failure handling, repository-backed atomic execution, safe trace marker DTOs, and Web cards/panel markers that render only fixed structured fields. [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] [VERIFIED: packages/web/src/components/copilot/copilot-chat-panel.tsx] [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PM write proposal creation | API / Backend | Database / Storage | Copilot tool execution and pending-action persistence are Gateway services and repositories; Web only displays returned actions. [VERIFIED: packages/gateway/src/services/copilot/read-tools.ts] [VERIFIED: packages/gateway/src/db/repositories/copilot-repository.ts] |
| PM approval execution | API / Backend | Database / Storage | Approval must use authenticated Gateway route logic and existing PM repository transactions; browser must not supply replacement mutation payloads. [VERIFIED: packages/gateway/src/routes/copilot.ts] [CITED: docs/API.md] |
| PM projection/evidence/ledger/audit commit | Database / Storage | API / Backend | `ProjectManagerRepository` owns one-transaction projection, ledger event, and audit writes. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] |
| Evidence ref schema and redaction | API / Backend | Browser / Client | Gateway route schemas and repository normalization enforce the boundary; Web prevalidation is only a usability layer. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx] |
| Ledger trace marker display | API / Backend | Browser / Client | Gateway must expose a safe marker DTO before Web can show PM traceability without raw details. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx] |
| PM approval card rendering | Browser / Client | API / Backend | Web owns fixed field templates and risk cues, but data must come from canonical pending-action input/result. [VERIFIED: packages/web/src/components/copilot/copilot-chat-panel.tsx] [VERIFIED: packages/web/src/lib/copilot.ts] |
| `View in Project Manager` anchor | Browser / Client | API / Backend | Project detail currently stores tab state locally, so URL-driven PM navigation belongs in the Web route/panel. [VERIFIED: packages/web/src/app/(dashboard)/projects/[id]/page.tsx] |
| Copilot-origin `done` guard | API / Backend | Database / Storage | Existing generic PM `done` accepts evidence refs or manual reason; PM approval handler must add the stricter Copilot-only trusted-evidence rule before repository mutation. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] |

## Project Constraints (from AGENTS.md)

- API responses must use the OpenForge envelope `{ "code": 0, "data": {}, "message": "" }` or `{ "code": 1, "message": "...", "details": {} }`. [CITED: AGENTS.md]
- Gateway and Web are separate tiers; Project Manager API behavior must not be implemented in Next.js API routes. [CITED: AGENTS.md] [CITED: CLAUDE.md]
- All REST APIs live under `/api/v1`, and Gateway remains the Express HTTP/WebSocket service. [CITED: AGENTS.md] [CITED: CLAUDE.md]
- Project Manager writes must stay in Gateway routes/services/repositories; Web owns display, hooks, API client, and responsive behavior only. [CITED: AGENTS.md]
- Input validation is mandatory at API, HTML, shell, path, and WebSocket boundaries, preferably with zod. [CITED: AGENTS.md] [CITED: .claude/rules/api.md] [CITED: .claude/rules/security.md]
- All business tables must be scoped by `user_id`, and repository classes should apply tenant filtering internally. [CITED: AGENTS.md] [CITED: CLAUDE.md]
- SQL must use parameterized queries or ORM-safe APIs, and user input must not be concatenated into SQL or shell commands. [CITED: AGENTS.md] [CITED: .claude/rules/security.md]
- Hardcoded secrets are forbidden, and logs/audit/details must not contain passwords, tokens, API keys, decrypted secrets, or plaintext credentials. [CITED: AGENTS.md] [CITED: .claude/rules/security.md]
- Backend functions should stay focused, usually under 50 lines, with nesting under 4 levels and contextual structured logging without sensitive data. [CITED: AGENTS.md] [CITED: .claude/rules/backend.md]
- Frontend components use PascalCase, hooks start with `use`, server state uses React Query, and loading/empty/error states are required. [CITED: AGENTS.md] [CITED: .claude/rules/frontend.md]
- Testing must follow Arrange/Act/Assert, cover boundary/error paths, and avoid mocking internal implementation only to make tests pass. [CITED: AGENTS.md] [CITED: .claude/rules/testing.md]
- Substantial work follows the three-gate flow: plan review, implementation review, testing, zero-trust acceptance, docs and commit. [CITED: AGENTS.md] [CITED: .claude/skills/plan-workflow.md] [CITED: .claude/skills/review-workflow.md] [CITED: .claude/skills/verify-workflow.md]
- No project-defined `.codex/skills` or `.agents/skills` SKILL.md files were found in this workspace. [VERIFIED: codebase grep]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | `>=20.0.0`; local runtime `v24.14.1` | Gateway runtime and backend tests | Repository engine requires Node 20+, and local runtime satisfies it. [VERIFIED: package.json] [VERIFIED: local command] |
| pnpm | package manager `pnpm@10.33.2`; local `10.33.2` | Monorepo scripts and dependency resolution | Repository declares pnpm 10.33.2 and local tool matches. [VERIFIED: package.json] [VERIFIED: local command] |
| Express | `^4.19.2` | Gateway REST API | Existing Gateway routes are Express routes under `/api/v1`. [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/gateway/src/routes/copilot.ts] |
| better-sqlite3 | `^11.7.0` | SQLite storage and transaction boundary | Existing PM repository uses `db.transaction` for projection, ledger, and audit writes. [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] |
| zod | Gateway `^3.24.1`, Web `^3.25.76` | Input schemas and API validation | Existing PM and Copilot routes use zod schemas for request and action payloads. [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/web/package.json] [VERIFIED: packages/gateway/src/routes/project-manager.ts] |
| Next.js App Router | `^16.0.0` | Web console route surfaces | Project detail and Copilot pages are App Router client pages. [VERIFIED: packages/web/package.json] [VERIFIED: packages/web/src/app/(dashboard)/projects/[id]/page.tsx] |
| React Query | `^5.100.5` | Web server-state cache and invalidation | ProjectManagerPanel and Copilot panel use React Query queries/mutations. [VERIFIED: packages/web/package.json] [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx] [VERIFIED: packages/web/src/components/copilot/copilot-chat-panel.tsx] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:test | built into Node | Gateway unit/integration tests | Use for Copilot route/tool and PM repository tests. [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/gateway/test/copilot-routes.test.ts] |
| Vitest | `^2.1.8` | Web unit tests | Use for API DTO/client and Copilot summary helpers. [VERIFIED: packages/web/package.json] [VERIFIED: packages/web/src/lib/copilot.test.ts] |
| Playwright | `^1.59.1` | Web E2E tests | Use for Copilot approval card and Project Manager traceability flow coverage. [VERIFIED: packages/web/package.json] [VERIFIED: packages/web/e2e/copilot.spec.ts] [VERIFIED: packages/web/e2e/project-manager.spec.ts] |
| lucide-react | `^0.468.0` | Web icons | Use for PM trace markers and approval-card affordances if existing UI patterns need icons. [VERIFIED: packages/web/package.json] [CITED: AGENTS.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing Copilot pending actions | Direct PM route calls from model tools | Rejected by locked decisions because model output may only propose writes and approval must use canonical stored pending-action payloads. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] [CITED: docs/API.md] |
| Existing PM repository transactions | New PM mutation service with separate audit writes | Rejected because existing repository already performs projection, ledger, and audit in one transaction. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] |
| Safe structured evidence refs | Raw prompt/terminal/provider blobs | Rejected because Phase 12 and current API docs forbid raw prompt, terminal, provider, and secret-bearing evidence. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] [CITED: docs/API.md] |

**Installation:**

No new external packages are required for this phase. [VERIFIED: package.json] [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/web/package.json]

**Version verification:** Versions above were read from repository package manifests and local runtime commands because Phase 12 does not install packages. [VERIFIED: package.json] [VERIFIED: local command]

## Package Legitimacy Audit

No Package Legitimacy Gate is required because this phase should not install external packages. [VERIFIED: package.json] [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/web/package.json]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | n/a | n/a | n/a | n/a | n/a | No install planned. [VERIFIED: package.json] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: package.json]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
Copilot model tool call
  -> Gateway Copilot tool registry
  -> PM prepare tool validates bounded payload
  -> CopilotRepository creates canonical pending action
  -> Web Copilot fixed PM approval card
  -> User approves through /api/v1/copilot/runs/:runId/pending-actions/:actionId/approve
  -> Gateway claims pending action as processing
  -> PM approval handler revalidates stored payload and tenant/project/work item visibility
  -> ProjectManagerRepository transaction
       -> projection update
       -> evidenceRefs update when applicable
       -> ledger event with safe trace markers
       -> audit row with redacted/count details
  -> Copilot pending action becomes approved or terminal failed
  -> Web Copilot result summary + View in Project Manager anchor
  -> ProjectManagerPanel detail/ledger shows safe Copilot trace markers
```

This flow matches the existing Copilot approval and Project Manager repository separation; the new work is the PM prepare/approval glue and safe DTO/UI trace markers. [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] [VERIFIED: packages/web/src/components/copilot/copilot-chat-panel.tsx]

### Recommended Project Structure

```text
packages/gateway/src/services/copilot/
├── read-tools.ts                  # Add PM prepare tool definitions and proposal creators.
├── tool-registry.ts               # Reuse existing tool execution/redaction model.
└── redaction.ts                   # Reuse Copilot redaction helpers.

packages/gateway/src/routes/
├── copilot.ts                     # Add PM approval dispatcher and terminal-failed handling.
└── project-manager.ts             # Extend evidence ref and safe ledger trace DTOs.

packages/gateway/src/db/repositories/
├── project-manager-repository.ts  # Extend evidence ref keys/details marker normalization.
└── copilot-repository.ts          # Reuse generic pending-action status updates.

packages/web/src/lib/
├── api.ts                         # Extend PM evidence/ledger DTOs and Copilot action status types.
└── copilot.ts                     # Add fixed PM labels/summaries/result summaries.

packages/web/src/components/
├── copilot/copilot-chat-panel.tsx  # Render PM-specific approval/result cards.
└── projects/ProjectManagerPanel.tsx # Render Copilot trace markers in detail and ledger.
```

This structure follows existing ownership boundaries and avoids Next.js API routes for Gateway-owned behavior. [CITED: AGENTS.md] [VERIFIED: codebase grep]

### Pattern 1: Prepare Tool Creates Canonical Pending Action

**What:** A PM prepare tool validates model input, verifies visible project/work item state when applicable, and calls `createPendingProposal` instead of mutating PM state. [VERIFIED: packages/gateway/src/services/copilot/read-tools.ts]

**When to use:** Use for `openforge.propose_project_manager_create_work_item`, `openforge.propose_project_manager_update_work_item_status`, and `openforge.propose_project_manager_attach_evidence` or equivalent internal names; external semantics must still map to locked `create_work_item`, `update_work_item_status`, and `attach_evidence`. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]

**Example:**

```typescript
// Source: packages/gateway/src/services/copilot/read-tools.ts
// Planner should mirror createPendingProposal-style flow, not execute PM writes here.
const proposal = createPendingProposal(context, {
  type: "openforge.propose_project_manager_attach_evidence",
  input: safeStructuredInput,
  summary: "Attach bounded evidence reference"
});
```

### Pattern 2: Approval Handler Revalidates Stored Payload

**What:** The approval route must use the stored pending-action `input`, parse it through a PM-specific schema, re-check tenant/project/work item visibility, and then call the existing PM repository. [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/src/routes/project-manager.ts]

**When to use:** Use on every approved PM pending action, because client approval requests do not carry replacement mutation payloads. [CITED: docs/API.md]

**Example:**

```typescript
// Source: packages/gateway/src/routes/copilot.ts + project-manager-repository.ts
// PM branch should call existing repository methods after stored-payload validation.
const repo = new ProjectManagerRepository(db, userId);
const workItem = repo.updateWorkItemStatus(projectId, workItemId, {
  status: "ready_for_review",
  details: safeTraceMarker
});
```

### Pattern 3: PM Execution Failure Is Terminal

**What:** PM action execution failures must update the pending action from `processing` to `failed` with a redacted safe result and must not reset it to `pending`. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]

**When to use:** Use only for PM action execution failures; the existing generic approval path currently restores `processing` actions to `pending` after thrown approval execution errors, so this needs a PM-specific branch. [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/test/copilot-routes.test.ts]

**Example:**

```typescript
// Source: packages/gateway/src/routes/copilot.ts
// Planner should add a PM-specific failure branch before generic restore-to-pending logic.
copilotRepo.updatePendingActionIfStatus(actionId, "processing", {
  status: "failed",
  result: { code: "project_manager_action_failed", message: "Project Manager action failed" }
});
```

### Pattern 4: Safe Trace Marker DTO

**What:** Ledger storage may keep normalized `details`, but the route should expose a bounded `trace` object containing only the D-07 marker fields. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] [VERIFIED: packages/gateway/src/routes/project-manager.ts]

**When to use:** Use for ledger rows created by PM-approved Copilot actions; do not expose arbitrary `details` JSON to Web. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/test/project-manager-routes.test.ts]

**Example:**

```typescript
// Source: docs/API.md + packages/gateway/src/routes/project-manager.ts
interface ProjectManagerLedgerTraceDto {
  copilotRunId?: string;
  pendingActionId?: string;
  actionType?: string;
  targetType?: "work_item";
  targetId?: string;
  evidenceRefCount?: number;
  approvalStatus?: "approved";
  executionStatus?: "succeeded" | "failed";
}
```

### Pattern 5: Copilot-Origin Done Guard

**What:** For PM pending action `update_work_item_status -> done`, approval must inspect existing work item evidence refs and require at least one trusted status such as `accepted` or `verified`. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]

**When to use:** Use only in Copilot PM approval path; keep manual Web completion behavior separate unless product decisions change it. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx]

**Example:**

```typescript
// Source: 12-CONTEXT.md + project-manager-repository.ts
const trusted = new Set(["accepted", "verified"]);
const hasTrustedEvidence = workItem.evidenceRefs.some((ref) => ref.status && trusted.has(ref.status));
if (nextStatus === "done" && !hasTrustedEvidence) {
  return terminalPmFailure("project_manager_done_requires_trusted_evidence");
}
```

### Anti-Patterns to Avoid

- **Direct model-origin PM mutation:** It bypasses explicit pending-action approval and violates POS-03. [CITED: .planning/REQUIREMENTS.md]
- **Approval request body as mutation source:** Existing approval semantics use canonical stored pending-action payloads, not client replacement payloads. [CITED: docs/API.md]
- **Generic restore-to-pending for PM execution failure:** This conflicts with D-04 and would let a failed PM mutation be retried implicitly. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] [VERIFIED: packages/gateway/src/routes/copilot.ts]
- **Raw ledger details in Web DTO:** Existing route tests expect raw details and secret-like values to be omitted from route responses. [VERIFIED: packages/gateway/test/project-manager-routes.test.ts]
- **Model-generated prose as approval summary:** D-11 requires fixed field templates per action type. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Approval lifecycle | A new PM-specific approval queue | Existing `copilot_pending_actions` and Copilot approve/reject routes | Current system already handles canonical payloads, pending/processing/approved/rejected statuses, audit, and run continuation. [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/src/db/repositories/copilot-repository.ts] |
| PM transaction atomicity | Manual multi-step route writes | `ProjectManagerRepository` transaction methods | Existing methods commit projection, ledger, and audit together. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] |
| Evidence redaction | Ad hoc string stripping in Web | Gateway route zod schemas and repository normalization | Server-side validation/normalization is the enforcement boundary, and Web can only provide prevalidation. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] |
| PM detail/ledger state fetch | New custom state store | Existing Web API client + React Query queries | ProjectManagerPanel already uses React Query for PM goal/work-items/ledger and invalidations. [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx] |
| Tool safety | Raw shell/CLI/Feishu commands | Existing Copilot tool registry and zod schemas | Tool execution already validates input, catches failures, redacts output, and fails closed on sensitive output. [VERIFIED: packages/gateway/src/services/copilot/tool-registry.ts] |

**Key insight:** Phase 12 is a traceability integration, not a new PM subsystem; custom queues, custom transaction code, or raw evidence storage would duplicate existing safety boundaries and increase authority risk. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] [CITED: docs/API.md]

## Common Pitfalls

### Pitfall 1: Adding prepare tools without approval handlers

**What goes wrong:** Copilot can create PM pending actions, but approval returns unsupported-action errors. [VERIFIED: packages/gateway/src/routes/copilot.ts]  
**Why it happens:** Prepare tools live in `read-tools.ts`, while approval dispatch lives in `routes/copilot.ts`. [VERIFIED: packages/gateway/src/services/copilot/read-tools.ts] [VERIFIED: packages/gateway/src/routes/copilot.ts]  
**How to avoid:** Plan paired backend tasks: tool definition/proposal creation plus approval dispatcher and route tests. [VERIFIED: packages/gateway/test/copilot-tools.test.ts] [VERIFIED: packages/gateway/test/copilot-routes.test.ts]  
**Warning signs:** `copilot_pending_action_unsupported` appears for a new PM action type. [VERIFIED: packages/gateway/test/copilot-routes.test.ts]

### Pitfall 2: PM execution failure returns to pending

**What goes wrong:** A failed PM execution can be approved again without a new proposal, violating D-04. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]  
**Why it happens:** Existing approval failure tests intentionally restore `processing` to `pending` for generic thrown approval failures. [VERIFIED: packages/gateway/test/copilot-routes.test.ts]  
**How to avoid:** Add PM-specific terminal failure semantics before generic approval restore branches. [VERIFIED: packages/gateway/src/routes/copilot.ts]  
**Warning signs:** Failed PM approval response leaves `copilot_pending_actions.status = "pending"`. [VERIFIED: packages/gateway/src/db/repositories/copilot-repository.ts]

### Pitfall 3: `pendingActionId` is rejected or stripped

**What goes wrong:** Evidence refs show `copilotRunId` but lose `pendingActionId`, breaking the prompt -> approval -> evidence chain. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]  
**Why it happens:** Current route schema is strict and current repository `evidenceRefKeys` does not include `pendingActionId`. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts]  
**How to avoid:** Extend route zod schema, repository type/key allowlist, Web DTO, formatter, tests, and docs in one task group. [VERIFIED: packages/gateway/test/project-manager-routes.test.ts] [VERIFIED: packages/web/src/lib/api.test.ts]  
**Warning signs:** Route returns 400 for evidence refs with `pendingActionId`, or Web detail omits it after attach. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx]

### Pitfall 4: Ledger trace markers are stored but invisible

**What goes wrong:** The database has safe marker details, but Web ledger rows cannot render the Copilot link. [VERIFIED: packages/gateway/src/routes/project-manager.ts]  
**Why it happens:** Current ledger DTO returns counts and event identity fields, not `details` or trace markers. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/web/src/lib/api.ts]  
**How to avoid:** Add a bounded trace DTO from normalized details and extend Web API types/rendering. [VERIFIED: packages/gateway/src/routes/project-manager.ts]  
**Warning signs:** `ProjectManagerPanel` ledger row can show evidence count but not Copilot run/action ids. [VERIFIED: packages/web/src/components/projects/ProjectManagerPanel.tsx]

### Pitfall 5: Copilot `done` uses manual completion or new evidence

**What goes wrong:** Copilot can mark a work item done without pre-existing trusted evidence, weakening completion authority. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]  
**Why it happens:** Existing PM repository supports generic manual completion and status updates with evidence refs; Phase 12 locks stricter Copilot-origin semantics. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts]  
**How to avoid:** Validate Copilot-origin `done` in the PM approval handler before calling the repository, and pass no manual reason from Copilot PM status actions. [VERIFIED: packages/gateway/src/routes/copilot.ts]  
**Warning signs:** A PM pending action with `status: "done"` also carries `manualCompletionReason` or new `evidenceRefs`. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]

### Pitfall 6: View anchor cannot open the PM tab

**What goes wrong:** The approved action shows a link, but it lands on the project detail default `sessions` tab. [VERIFIED: packages/web/src/app/(dashboard)/projects/[id]/page.tsx]  
**Why it happens:** Project detail currently keeps `activeTab` in local state and does not initialize it from `searchParams`. [VERIFIED: packages/web/src/app/(dashboard)/projects/[id]/page.tsx]  
**How to avoid:** Plan a small URL-state change for `tab=project-manager` and optional `workItemId` selection before adding the Copilot anchor. [VERIFIED: packages/web/src/app/(dashboard)/projects/[id]/page.tsx]  
**Warning signs:** E2E link checks land on `/projects/:id` but PM panel is not enabled. [VERIFIED: packages/web/e2e/project-manager.spec.ts]

### Pitfall 7: Safe redaction is treated as permission to store raw blobs

**What goes wrong:** Raw terminal/provider/prompt content reaches storage and is merely redacted after the fact, violating D-09. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]  
**Why it happens:** Existing repository normalization can redact suspicious strings, but Phase 12 forbids raw content as evidence blobs in the first place. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts]  
**How to avoid:** PM action schemas should accept only structured refs and marker fields, not free-form raw summaries or provider payloads. [CITED: docs/API.md]  
**Warning signs:** New PM action inputs include fields named `prompt`, `terminalOutput`, `providerPayload`, `raw`, `stdout`, or `stderr`. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts]

## Code Examples

Verified patterns from current codebase:

### Repository Transaction Boundary

```typescript
// Source: packages/gateway/src/db/repositories/project-manager-repository.ts
// Existing PM methods use db.transaction for projection + ledger + audit.
const run = this.db.transaction(() => {
  // insert/update projection
  // insert ledger event
  // write audit row
  return updatedWorkItem;
});
```

### Pending Action Claim Before Approval

```typescript
// Source: packages/gateway/src/routes/copilot.ts
// Existing approval flow claims pending actions as processing before execution.
const claimed = copilotRepo.updatePendingActionIfStatus(action.id, "pending", {
  status: "processing"
});
```

### Existing Evidence Ref Shape to Extend

```typescript
// Source: packages/gateway/src/routes/project-manager.ts
// Add pendingActionId to every server and Web schema that uses this shape.
const evidenceRefSchema = z.object({
  kind: z.string(),
  label: z.string().optional(),
  status: z.string().optional(),
  ref: z.string().optional(),
  path: z.string().optional(),
  sessionId: z.string().optional(),
  copilotRunId: z.string().optional()
}).strict();
```

### Web Summary Helper Extension Point

```typescript
// Source: packages/web/src/lib/copilot.ts
// Add PM action labels and summaries here, then render them from PendingActionCard.
getCopilotPendingActionSummary({
  type: "openforge.propose_project_manager_attach_evidence",
  input: { projectId, workItemId, evidenceRefs }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Copilot was read-heavy with approval-gated platform operations. | Copilot now includes conversations, memory, read tools, proposal tools, pending actions, terminal snapshots, and approval-gated continuation. | Existing implementation before Phase 12. [VERIFIED: packages/gateway/src/services/copilot/read-tools.ts] [VERIFIED: packages/gateway/src/routes/copilot.ts] | PM traceability should reuse the existing proposal/approval model instead of inventing a new one. [VERIFIED: codebase grep] |
| Historical PM plan used broader/stale tool names such as project goal update and run next step. | Phase 12 locks exactly `create_work_item`, `update_work_item_status`, and `attach_evidence`. | Phase 12 discussion on 2026-05-22. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] | Planner must not copy old plan names blindly from 2026-05-17 docs. [CITED: docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md] |
| PM route DTOs omitted ledger details entirely. | Phase 12 needs safe trace marker visibility without raw details. | Phase 12 planned. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] | Add bounded `trace` fields, not arbitrary `details`. [VERIFIED: packages/gateway/src/routes/project-manager.ts] |
| Generic approval execution failure could restore `processing` action to `pending`. | PM execution failure must be terminal `failed`. | Phase 12 locked decision. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] | Add PM-specific failure handling and route tests. [VERIFIED: packages/gateway/test/copilot-routes.test.ts] |

**Deprecated/outdated:**

- Historical route names under `/api/v1/projects/:id/manager` in the 2026-05-17 plan are stale for current code; current routes are under `/api/v1/projects/:projectId/project-manager`. [CITED: docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md] [VERIFIED: packages/gateway/src/routes/project-manager.ts]
- Historical prepare-tool breadth from the Feishu PM plan is broader than Phase 12 scope; Phase 12 must implement only the three locked PM proposal types. [CITED: docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md] [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]

## Assumptions Log

All claims in this research were verified from repository code, planning artifacts, local commands, or cited project docs. [VERIFIED: codebase grep]

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| none | No unverified assumptions were used. | n/a | n/a |

## Open Questions

1. **Exact PM pending-action type names**
   - What we know: User locked semantic action types `create_work_item`, `update_work_item_status`, and `attach_evidence`. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]
   - What's unclear: The exact tool names are left to planner discretion. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md]
   - Recommendation: Use names consistent with existing prepare tools, for example `openforge.propose_project_manager_create_work_item`, while storing a bounded `actionType` marker equal to the locked semantic type. [VERIFIED: packages/gateway/src/services/copilot/read-tools.ts]

2. **Project Manager anchor URL shape**
   - What we know: Project detail has a `project-manager` tab but `activeTab` is currently local state initialized to `sessions`. [VERIFIED: packages/web/src/app/(dashboard)/projects/[id]/page.tsx]
   - What's unclear: No existing URL contract opens the PM tab or detail sheet directly. [VERIFIED: packages/web/src/app/(dashboard)/projects/[id]/page.tsx]
   - Recommendation: Plan `?tab=project-manager&workItemId=...` or equivalent URL state before E2E coverage for `View in Project Manager`. [VERIFIED: packages/web/e2e/project-manager.spec.ts]

3. **Trusted evidence status vocabulary**
   - What we know: Context names `accepted` and `verified` as trusted examples, and current schemas accept arbitrary bounded `status` strings. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] [VERIFIED: packages/gateway/src/routes/project-manager.ts]
   - What's unclear: The repository does not currently enforce an enum for evidence ref status. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts]
   - Recommendation: Define a local trusted set for Copilot-origin `done` approval and leave existing manual/evidence attach status compatibility unchanged. [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Gateway/Web tests and builds | yes | `v24.14.1` | None needed; satisfies `>=20.0.0`. [VERIFIED: local command] [VERIFIED: package.json] |
| pnpm | Monorepo scripts | yes | `10.33.2` | None needed; matches package manager declaration. [VERIFIED: local command] [VERIFIED: package.json] |
| tmux | Existing terminal/Copilot integration tests if full suite runs | yes | `tmux 3.4` | Skip tmux integration tests only if environment policy blocks pty/tmux. [VERIFIED: local command] |
| sqlite3 CLI | Manual DB inspection only | no | n/a | Use in-memory `better-sqlite3` tests; project does not require sqlite3 CLI for test runs. [VERIFIED: local command] [VERIFIED: packages/gateway/test/project-manager-repository.test.ts] |

**Missing dependencies with no fallback:** none for Phase 12 planning. [VERIFIED: local command]

**Missing dependencies with fallback:** `sqlite3` CLI is absent, but tests use `better-sqlite3` in-memory databases. [VERIFIED: local command] [VERIFIED: packages/gateway/test/project-manager-repository.test.ts]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Backend `node:test` via `node --test --import tsx`; Web Vitest `^2.1.8`; E2E Playwright `^1.59.1`. [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/web/package.json] |
| Config file | Backend package script; Web `packages/web/vitest.config.ts`; Playwright package script/config exists through E2E tests. [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/web/package.json] [VERIFIED: packages/web/e2e/copilot.spec.ts] |
| Quick run command | `pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts test/project-manager-repository.test.ts test/project-manager-routes.test.ts` and `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts`. [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/web/package.json] |
| Full suite command | `pnpm -r test` plus `pnpm -r typecheck`; run focused Playwright specs with `pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts e2e/project-manager.spec.ts` if E2E coverage is changed. [VERIFIED: package.json] [VERIFIED: packages/web/package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| POS-01 | PM traceability does not become generic PM suite or direct AI execution. | route/tool contract + docs check | `pnpm --dir packages/gateway test test/copilot-tools.test.ts` | Existing file, new cases needed. [VERIFIED: packages/gateway/test/copilot-tools.test.ts] |
| POS-02 | PM state remains Gateway-owned, tenant-scoped, audited, and bounded. | repository + route integration | `pnpm --dir packages/gateway test test/project-manager-repository.test.ts test/project-manager-routes.test.ts` | Existing files, extend cases. [VERIFIED: packages/gateway/test/project-manager-repository.test.ts] [VERIFIED: packages/gateway/test/project-manager-routes.test.ts] |
| POS-03 | PM writes can only execute through explicit Copilot pending-action approval. | Copilot route/tool integration | `pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts` | Existing files, extend cases. [VERIFIED: packages/gateway/test/copilot-routes.test.ts] |
| TRACE-01 | Copilot run/action safe refs link to PM work item evidence refs. | route + repository + Web API | `pnpm --dir packages/gateway test test/project-manager-routes.test.ts && pnpm --dir packages/web test src/lib/api.test.ts` | Existing files, extend cases. [VERIFIED: packages/web/src/lib/api.test.ts] |
| TRACE-02 | Three PM proposal types create pending actions and never mutate directly. | Copilot tool tests | `pnpm --dir packages/gateway test test/copilot-tools.test.ts` | Existing file, extend cases. [VERIFIED: packages/gateway/test/copilot-tools.test.ts] |
| TRACE-03 | PM ledger events expose safe trace markers without raw prompt/terminal/provider/secrets. | repository + route + redaction tests | `pnpm --dir packages/gateway test test/project-manager-repository.test.ts test/project-manager-routes.test.ts test/copilot-routes.test.ts` | Existing files, extend cases. [VERIFIED: packages/gateway/test/project-manager-repository.test.ts] |
| TRACE-04 | Web shows prompt -> approval -> execution evidence chain. | Web helper + E2E | `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts && pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts e2e/project-manager.spec.ts` | Existing files, extend cases. [VERIFIED: packages/web/src/lib/copilot.test.ts] [VERIFIED: packages/web/e2e/copilot.spec.ts] |

### Sampling Rate

- **Per task commit:** Run the narrow backend or Web command for touched files. [CITED: .claude/skills/verify-workflow.md]
- **Per wave merge:** Run `pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts test/project-manager-repository.test.ts test/project-manager-routes.test.ts` and `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts`. [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/web/package.json]
- **Phase gate:** Run `pnpm -r typecheck`, `pnpm -r test`, and focused Playwright specs for Copilot/Project Manager if UI changed. [VERIFIED: package.json] [CITED: .claude/skills/verify-workflow.md]

### Wave 0 Gaps

- [ ] Add PM prepare-tool tests in `packages/gateway/test/copilot-tools.test.ts` for exactly three proposal types and no direct mutation. [VERIFIED: packages/gateway/test/copilot-tools.test.ts]
- [ ] Add PM approval-route tests in `packages/gateway/test/copilot-routes.test.ts` for success, invalid stored payload, cross-tenant ids, terminal `failed`, no restore-to-pending, and Copilot `done` trusted evidence gate. [VERIFIED: packages/gateway/test/copilot-routes.test.ts]
- [ ] Add PM repository/route tests for `pendingActionId` evidence refs and safe ledger trace marker DTOs. [VERIFIED: packages/gateway/test/project-manager-repository.test.ts] [VERIFIED: packages/gateway/test/project-manager-routes.test.ts]
- [ ] Add Web API/helper tests for PM action labels, summaries, result summaries, failed action status, evidence `pendingActionId`, and ledger trace DTO. [VERIFIED: packages/web/src/lib/api.test.ts] [VERIFIED: packages/web/src/lib/copilot.test.ts]
- [ ] Add focused E2E coverage for PM approval card, approved result summary, `View in Project Manager` anchor, PM detail marker, and ledger marker. [VERIFIED: packages/web/e2e/copilot.spec.ts] [VERIFIED: packages/web/e2e/project-manager.spec.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | JWT Bearer auth on Gateway routes; Web does not self-approve actions. [CITED: CLAUDE.md] [VERIFIED: packages/gateway/src/routes/copilot.ts] |
| V3 Session Management | limited | No new browser session model; preserve existing JWT and event/session behavior. [CITED: CLAUDE.md] |
| V4 Access Control | yes | Project visibility checks plus user-scoped repositories for Copilot and PM data. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/src/db/repositories/copilot-repository.ts] |
| V5 Input Validation | yes | zod schemas for PM routes, Copilot action payloads, and Web-safe API DTO expectations. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/src/routes/copilot.ts] |
| V6 Cryptography | limited | Phase 12 should not add crypto; existing credential encryption and no-secret logging rules still apply. [CITED: AGENTS.md] [CITED: CLAUDE.md] |

### Known Threat Patterns for OpenForge Phase 12

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant PM mutation by forged `projectId` or `workItemId` | Elevation of Privilege | Revalidate project/work item through authenticated user-scoped repositories at approval time. [VERIFIED: packages/gateway/src/routes/project-manager.ts] [VERIFIED: packages/gateway/src/routes/copilot.ts] |
| Approval payload replacement from browser | Tampering | Ignore client mutation fields on approval; use canonical stored pending-action payload. [CITED: docs/API.md] [VERIFIED: packages/gateway/src/routes/copilot.ts] |
| Raw prompt/terminal/provider content persisted as evidence | Information Disclosure | Accept only bounded structured refs and safe markers; reject or redact raw-like fields before persistence. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] |
| Secret leakage in ledger/audit/result summaries | Information Disclosure | Use existing Copilot and PM redaction helpers and expose safe trace DTOs only. [VERIFIED: packages/gateway/src/services/copilot/redaction.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] |
| Duplicate approval or concurrent approval race | Tampering | Claim pending action via status transition to `processing`; duplicate approval returns not-pending conflict. [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/test/copilot-routes.test.ts] |
| Stored XSS via PM labels/summaries | Spoofing/Tampering | Render structured text through React, keep fixed templates, and avoid raw HTML. [CITED: AGENTS.md] [VERIFIED: packages/web/src/components/copilot/copilot-chat-panel.tsx] |
| PM action failure retry ambiguity | Repudiation | Store PM failure as terminal `failed` with redacted result and require new pending action. [VERIFIED: .planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md` - locked Phase 12 decisions, scope, action granularity, trace markers, redaction, and terminal failure semantics. [VERIFIED: codebase grep]
- `.planning/REQUIREMENTS.md` - POS-01, POS-02, POS-03, TRACE-01, TRACE-02, TRACE-03, TRACE-04. [VERIFIED: codebase grep]
- `.planning/STATE.md` - v1.3 status, PM authority decisions, Phase 11 evidence/ledger context. [VERIFIED: codebase grep]
- `.planning/ROADMAP.md` - Phase 12 goal and success criteria. [VERIFIED: codebase grep]
- `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*.md`, `.claude/skills/*.md` - project architecture, workflow, security, frontend/backend/testing constraints. [CITED: AGENTS.md] [CITED: CLAUDE.md]
- `docs/API.md` - current PM and Copilot API contracts, route paths, pending-action lifecycle, redaction rules, evidence refs, status transitions, and audit semantics. [CITED: docs/API.md]
- `packages/gateway/src/routes/copilot.ts` - current approve/reject lifecycle, processing claim, restore-to-pending failure behavior, dispatcher, audit/event writes. [VERIFIED: codebase grep]
- `packages/gateway/src/services/copilot/read-tools.ts` - current read tools, PM read tools, prepare-tool pattern, pending proposal creation. [VERIFIED: codebase grep]
- `packages/gateway/src/db/repositories/project-manager-repository.ts` - PM transaction, evidence normalization, ledger/audit writes, status transitions, redaction. [VERIFIED: codebase grep]
- `packages/gateway/src/routes/project-manager.ts` - PM REST schemas and DTOs. [VERIFIED: codebase grep]
- `packages/web/src/components/copilot/copilot-chat-panel.tsx`, `packages/web/src/lib/copilot.ts`, `packages/web/src/components/projects/ProjectManagerPanel.tsx`, `packages/web/src/lib/api.ts` - Web Copilot and PM surfaces. [VERIFIED: codebase grep]
- `packages/gateway/test/*project-manager*`, `packages/gateway/test/copilot-*.test.ts`, `packages/web/src/lib/*test.ts`, `packages/web/e2e/*.spec.ts` - existing validation surfaces. [VERIFIED: codebase grep]

### Secondary (MEDIUM confidence)

- `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md` - historical design intent for approval-gated PM Copilot and evidence-backed completion; current Phase 12 decisions supersede broad/stale scope. [CITED: docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md]
- `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md` - historical implementation plan; route/tool names may be stale and must not override current code or Phase 12 context. [CITED: docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md]

### Tertiary (LOW confidence)

- None. [VERIFIED: codebase grep]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - package manifests and local runtime commands verify versions and scripts. [VERIFIED: package.json] [VERIFIED: packages/gateway/package.json] [VERIFIED: packages/web/package.json] [VERIFIED: local command]
- Architecture: HIGH - current Gateway/Web/PM/Copilot boundaries are directly visible in code and project docs. [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/src/db/repositories/project-manager-repository.ts] [CITED: CLAUDE.md]
- Pitfalls: HIGH - key risks map to existing code paths and tests, especially restore-to-pending approval failure and strict evidence schema. [VERIFIED: packages/gateway/src/routes/copilot.ts] [VERIFIED: packages/gateway/test/copilot-routes.test.ts] [VERIFIED: packages/gateway/src/routes/project-manager.ts]

**Research date:** 2026-05-22  
**Valid until:** 2026-06-21 for codebase-local architecture; re-check before planning if Copilot or PM routes change.
