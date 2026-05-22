---
phase: 10
slug: goal-and-work-item-operations
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-22
verified: 2026-05-22
---

# Phase 10 - Security

Per-phase security contract: threat register, accepted risks, and audit trail.

## Scope

Phase 10 added Web UI operations for Project Manager goals and work items. It did
not add Gateway routes, database migrations, Next.js API routes, Feishu write
authority, Copilot write authority, or post-creation evidence attachment.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Web form to Gateway REST client | Goal, work item create, and status mutation payloads leave the browser through typed `packages/web/src/lib/api.ts` helpers. | User-entered goal text, work item metadata, bounded evidence and Feishu reference identifiers, status mutation payloads |
| Gateway-owned Project Manager state | `docs/API.md` defines Project Manager Ledger as Gateway-owned, tenant-scoped state. | Authenticated project-manager goal, work item, evidence reference, and ledger state |
| Evidence and collaboration references | Phase 10 accepts only structured identifiers for initial refs. | `kind`, `label`, `ref`, `path`, `feishuMessageId` from UI; no raw evidence blobs, transcripts, provider payloads, or Feishu message bodies |
| Status movement guard | Web renders allowed next actions and submits mutations to Gateway, which remains authoritative. | Bounded work item status values and optional manual completion reason for evidence-free `done` |

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-10-01 | Integrity | Goal edit form | mitigate | `saveGoal` trims summary, normalizes constraints and acceptance criteria with `parseProjectManagerTextList`, and submits only `summary`, `constraints`, `acceptanceCriteria`, and `status` through `updateProjectManagerGoal`. | closed |
| T-10-02 | Information disclosure | Goal mutation errors | mitigate | Goal mutation errors render inside the goal card through `projectManagerMutationMessage`; no request payload logging or raw payload display was added. | closed |
| T-10-03 | Availability | Project Manager tab state | mitigate | Queries keep `enabled`/`canLoad` guards; mutation error handlers set local error state without clearing existing query data. | closed |
| T-10-04 | Integrity | Work item filters | mitigate | Work item listing uses `listProjectManagerWorkItems(projectId, createWorkItemQueryParams(...))` with `WORK_ITEM_LIMIT = 50`; bounded statuses send Gateway `status`, `all` omits it. | closed |
| T-10-05 | Information disclosure | Work item detail and references | mitigate | Detail sheet renders title, description, status, priority, counts, timestamps, acceptance criteria, and formatted structured refs only; no post-creation evidence attachment control exists in Phase 10 UI. | closed |
| T-10-06 | Integrity | Work item creation | mitigate | Create payload assembly uses required title, normalized acceptance criteria, numeric priority, bounded status, and at most one initial `evidenceRefs` plus one `feishuRefs` entry built from approved identifier fields. | closed |
| T-10-07 | Integrity | Web status transition map | mitigate | `PROJECT_MANAGER_STATUS_TRANSITIONS` matches `docs/API.md`; status actions are rendered from this map and terminal `done`/`cancelled` states render no action menu. | closed |
| T-10-08 | Integrity | Done guard | mitigate | `requestStatusChange` opens the manual reason dialog for evidence-free `done`; `confirmDoneWithReason` blocks empty or whitespace-only reasons before submitting `{ status: "done", manualCompletionReason }`. | closed |
| T-10-09 | Information disclosure | Manual completion reason | mitigate | The manual completion reason is used only in the guarded status mutation dialog and is not shown in ledger/detail output; UI copy does not invite secrets, transcripts, provider payloads, or Feishu message bodies. | closed |

Status: open or closed. Disposition: mitigate, accept, or transfer.

## Evidence

| Evidence | Result |
|----------|--------|
| `docs/API.md` Project Manager Ledger contract | Gateway owns project-manager state, validates inputs, defines status transitions, and limits evidence references to structured fields. |
| `packages/web/src/components/projects/ProjectManagerPanel.tsx` | Implements bounded goal/work item mutation payloads, filtered list query, safe detail rendering, transition map, and done guard. |
| `packages/web/src/lib/api.ts` | Provides typed Project Manager REST helpers under `/api/v1/projects/:projectId/project-manager`. |
| `packages/web/src/lib/api.test.ts` | Asserts bounded work item query and create/status payload shapes. |
| `packages/web/e2e/project-manager.spec.ts` | Strict route mock verifies normalized goal arrays, `limit=50`, bounded create refs, exact status PATCH bodies, blank done reason blocking, and no unhandled API routes. |
| `gsd-sdk query verify.schema-drift 10` | `drift_detected: false`, `blocking: false`. |
| `gsd-sdk query audit-open --json` | `has_open_items: false`; all tracked open-item counts were zero. |

## Accepted Risks Log

No accepted risks.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-22 | 9 | 9 | 0 | Codex secure-phase orchestrator |

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

Approval: verified 2026-05-22
