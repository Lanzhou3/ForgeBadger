---
phase: 09
slug: project-manager-web-foundation
status: complete
created: 2026-05-21
---

# Phase 09 - Research

## RESEARCH COMPLETE

Phase 9 is a Web foundation phase. It should expose existing Gateway-owned
project-manager state in the project detail workflow without changing backend
authority, adding Next.js API routes, or implying that Phase 10/11 write flows
already exist.

## Contract Findings

- Project-manager REST routes already exist under
  `/api/v1/projects/:projectId/project-manager`.
- Gateway routes authenticate every request, verify the project belongs to the
  authenticated user, zod-validate inputs, and return the canonical OpenForge
  envelope.
- Existing endpoints cover:
  - `GET` and `PUT` project goal.
  - `GET` and `POST` work item collection.
  - `GET` work item detail.
  - `PATCH` work item status.
  - `POST` work item evidence.
  - `GET` ledger events.
- Bounded work item statuses are `todo`, `in_progress`, `blocked`,
  `ready_for_review`, `done`, and `cancelled`.
- Bounded ledger event types are documented in `docs/API.md` and exported from
  the Gateway repository layer.
- Evidence references are structured pointers only. They may expose approved
  reference fields such as `kind`, `label`, `status`, `ref`, `path`,
  `sessionId`, `copilotRunId`, `feishuChatId`, `feishuMessageId`, and
  `createdAt`. Raw evidence blobs, terminal transcripts, provider payloads, and
  secrets remain out of scope.

## Implementation Findings

### API Client

Add project-manager DTOs and functions to `packages/web/src/lib/api.ts`,
following existing `fetchJson` helpers and project-scoped client functions.
The client should mirror Gateway DTOs rather than inventing alternate Web-only
shapes.

Required exported DTOs and inputs:

- `ProjectManagerEvidenceRef`
- `ProjectManagerGoal`
- `ProjectManagerGoalInput`
- `ProjectManagerWorkItemStatus`
- `ProjectManagerWorkItem`
- `ProjectManagerWorkItemInput`
- `ProjectManagerWorkItemStatusInput`
- `ProjectManagerEvidenceInput`
- `ProjectManagerLedgerEventType`
- `ProjectManagerLedgerEvent`

Required exported functions:

- `getProjectManagerGoal(projectId)`
- `updateProjectManagerGoal(projectId, input)`
- `listProjectManagerWorkItems(projectId, params?)`
- `createProjectManagerWorkItem(projectId, input)`
- `getProjectManagerWorkItem(projectId, workItemId)`
- `updateProjectManagerWorkItemStatus(projectId, workItemId, input)`
- `attachProjectManagerWorkItemEvidence(projectId, workItemId, input)`
- `listProjectManagerLedger(projectId, params?)`

All path identifiers must use `encodeURIComponent` before interpolation.
Query params should be omitted when undefined and should preserve Gateway names
such as `status`, `eventType`, and `limit`.

### Project Detail Surface

Add a first-class `project-manager` tab to
`packages/web/src/app/(dashboard)/projects/[id]/page.tsx`.

Because the project detail page is already large, the implementation should
prefer a focused child component such as
`packages/web/src/components/projects/ProjectManagerPanel.tsx` while keeping
the tab placement inside the project page. This preserves Phase 9 placement
without increasing page complexity.

The component should:

- Accept `projectId` and an `enabled` flag.
- Fetch project-manager data only when the tab is active.
- Use stable query keys scoped by project ID and resource name.
- Render visible loading, empty, error, and not-found states.
- Render bounded summaries for goal, work items, and ledger events.
- Avoid full edit, status transition, evidence attachment, or ledger filtering
  workflows unless they are disabled and clearly marked as later-phase actions.

### i18n

All new visible strings must go through `packages/web/src/lib/i18n.ts`.
Existing project-page translation objects should be extended rather than using
inline string constants. Required copy is defined in
`09-UI-SPEC.md`.

### Testing

Focused API tests belong in `packages/web/src/lib/api.test.ts`. They should
assert URL shape, methods, request bodies, query params, and error propagation
for every project-manager helper.

A narrow Playwright test should live in `packages/web/e2e/project-manager.spec.ts`
instead of expanding the large Copilot E2E file. It should use strict
`/api/v1/*` route mocks with a 404 fallback for unknown routes so endpoint
contract drift fails visibly.

## Validation Architecture

| Dimension | Coverage |
|-----------|----------|
| API routes | Vitest assertions for every helper URL, method, body, query param, and ID encoding |
| State handling | Playwright coverage for loading, empty, populated, and error states in the tab |
| Strict mocks | Playwright fallback returns 404 for unknown `/api/v1/*` routes |
| Boundary safety | No Gateway route changes and no Next.js API routes |
| i18n | New visible copy added to `packages/web/src/lib/i18n.ts` |
| Accessibility | Existing `Tabs` keyboard behavior plus visible button labels and text error states |

Recommended verification commands:

- `pnpm --dir packages/web vitest run src/lib/api.test.ts`
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium`
- `git diff --check`

## Risks

- The project detail page is already broad. A child component keeps Phase 9
  readable and reduces merge risk.
- Client DTO drift can silently break later phases. Plan 01 should test every
  helper against the documented Gateway paths.
- UI placeholders can overpromise. Phase 9 copy should make later-phase actions
  unavailable without turning the tab into an explanation page.
- Strict E2E mocks require enough baseline project/auth endpoint mocks to open
  the project page without falling through to generic success.

## Planning Recommendation

Split Phase 9 into two executable plans:

1. `09-01-PLAN.md` - typed project-manager API client and focused Web API
   tests.
2. `09-02-PLAN.md` - project detail Project Manager tab, i18n, and strict
   Playwright coverage.
