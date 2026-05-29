---
phase: 10
slug: goal-and-work-item-operations
status: complete
created: 2026-05-22
---

# Phase 10 - Research

## RESEARCH COMPLETE

Phase 10 is a Web workflow phase. It should extend the existing
`ProjectManagerPanel` from a read-only summary into a compact project-scoped
operations surface for goal editing, work item creation/filtering/inspection,
and Gateway-authorized status movement. The backend Project Manager Ledger
contract already exists; Phase 10 should not add a new Gateway model, Next.js
API route, raw evidence storage, post-creation evidence attachment workflow, or
Feishu/Copilot write authority.

## Contract Findings

- Project-manager REST endpoints already exist under
  `/api/v1/projects/:projectId/project-manager`.
- Gateway routes authenticate, verify the project belongs to the authenticated
  user, zod-validate inputs, and return the canonical OpenForge envelope.
- Goal editing uses `PUT /goal` with `summary`, `constraints`,
  `acceptanceCriteria`, and optional `status`.
- Work item creation uses `POST /work-items` with `title`, optional
  `description`, optional `status`, optional `priority`, optional
  `acceptanceCriteria`, optional `evidenceRefs`, and optional `feishuRefs`.
- Work item listing accepts bounded `status` and `limit` query params.
- Work item detail uses `GET /work-items/:workItemId`.
- Status movement uses `PATCH /work-items/:workItemId/status`.
- Allowed work item statuses are `todo`, `in_progress`, `blocked`,
  `ready_for_review`, `done`, and `cancelled`.
- The documented and implemented transitions are:
  - `todo` -> `in_progress`, `blocked`, `cancelled`
  - `in_progress` -> `blocked`, `ready_for_review`, `done`, `cancelled`
  - `blocked` -> `todo`, `in_progress`, `cancelled`
  - `ready_for_review` -> `in_progress`, `done`, `cancelled`
  - `done` -> terminal
  - `cancelled` -> terminal
- Marking a work item `done` requires at least one evidence reference or a
  non-empty `manualCompletionReason`.
- Evidence references are structured pointers only. Approved fields are
  `kind`, `label`, `status`, `ref`, `path`, `sessionId`, `copilotRunId`,
  `feishuChatId`, `feishuMessageId`, and `createdAt`.
- Raw terminal transcripts, Feishu content, provider payloads, secrets, attach
  tokens, and unbounded evidence blobs remain out of scope.

## Implementation Findings

### Existing Web Surface

`packages/web/src/components/projects/ProjectManagerPanel.tsx` already:

- Accepts `projectId` and `enabled`.
- Uses `canLoad = enabled && projectId.length > 0`.
- Fetches goal, work items, and ledger through TanStack Query.
- Renders visible loading, not-found, generic error, empty, and populated
  states.
- Uses existing `Card`, `Table`, `Badge`, and `Button` primitives.
- Contains local helpers for status labels, status badge variants, event
  labels, and timestamp formatting.

Phase 10 should preserve the enabled guard and query key scoping, but the panel
is likely to grow enough that local subcomponents/helpers should be split inside
the file or moved to adjacent component files if readability becomes poor.

### API Client

The typed client functions already exist in `packages/web/src/lib/api.ts`:

- `getProjectManagerGoal`
- `updateProjectManagerGoal`
- `listProjectManagerWorkItems`
- `createProjectManagerWorkItem`
- `getProjectManagerWorkItem`
- `updateProjectManagerWorkItemStatus`
- `attachProjectManagerWorkItemEvidence`
- `listProjectManagerLedger`

`packages/web/src/lib/api.test.ts` already has route-shape coverage for these
helpers and error propagation. Phase 10 does not need a new API client layer,
but it should add or refine focused assertions if the UI needs additional
client behavior, especially status filter query shape and status mutation
payloads.

### Goal Editing

The lowest-risk implementation is an inline goal edit mode in the existing goal
card. Use local controlled state or a small reducer for:

- `summary`
- newline text for `constraints`
- newline text for `acceptanceCriteria`
- `status` string with `active` default

Before calling `updateProjectManagerGoal`, normalize newline text into trimmed
non-empty string arrays. Keep Gateway as the final validation authority and
surface `GatewayApiError.message` near the form.

### Work Item Browse And Detail

Work item listing should move from the Phase 9 fixed `limit: 5` summary to a
bounded operational query, for example `limit: 50` plus an optional status
filter. The filter should call `listProjectManagerWorkItems(projectId,
{ status, limit })` rather than client-filtering an unbounded response.

Inspection should stay inside the project detail workflow. A right-side `Sheet`
is available and fits the current component set. The detail view should show
safe values only: title, description, status, priority, acceptance criteria,
updated timestamp, evidence count, Feishu reference count, and safe reference
identifiers if already returned. It should not expose a post-creation evidence
attachment form in this phase.

### Work Item Creation And Initial References

The create action can use an existing `Dialog` or `Sheet`. The form should
collect:

- `title` (required)
- `description` (optional)
- `priority` (number, default can remain modest such as `0` or current UI
  convention if discovered during implementation)
- newline text for `acceptanceCriteria`
- optional initial status, defaulting to `todo`
- optional bounded initial references

Because Phase 11 owns post-creation evidence attachment, initial references
should be intentionally small and structured. If the executor decides the
reference editor creates too much UI complexity for Phase 10, it should still
support the requirement with a minimal bounded text/field pattern and avoid raw
evidence blobs.

### Status Movement And Done Guard

Do not use a generic all-status dropdown. Define a Web-side transition map that
matches `docs/API.md` and the repository contract, then render only allowed next
actions. Gateway remains authoritative, but the Web should not present known
invalid moves as normal operations.

When a user attempts to move an item to `done`:

- If the selected work item has `evidenceRefCount > 0`, submit the status
  update directly.
- If `evidenceRefCount === 0`, require a non-empty manual completion reason
  before calling `updateProjectManagerWorkItemStatus`.
- Surface the server error if Gateway still rejects the transition.

After goal updates, work item creation, or status changes, invalidate/refetch:

- `["project-manager", projectId, "goal"]` for goal changes.
- `["project-manager", projectId, "work-items", ...]` for create/status
  changes.
- `["project-manager", projectId, "ledger", ...]` if the existing ledger
  summary remains visible in Phase 10.
- Any selected work item detail query if detail fetching is used.

### i18n

All visible strings must be added to `packages/web/src/lib/i18n.ts` across
simplified Chinese, traditional Chinese, and English dictionaries. Existing
Project Manager keys cover read-only labels, statuses, and ledger event names,
but Phase 10 needs action/form/error copy for:

- edit/save/cancel goal
- create work item
- filter by status
- inspect work item
- status action labels
- done manual reason prompt
- validation and mutation error text

### UI-SPEC Gate

Phase 10 is a frontend-heavy phase. The plan-phase workflow treats UI phases as
requiring a `*-UI-SPEC.md` design contract unless explicitly skipped. No Phase
10 UI-SPEC exists yet, so planning should stop at the UI gate and run
`$gsd-ui-phase 10` before producing executable PLAN.md files.

## Validation Architecture

| Dimension | Coverage |
|-----------|----------|
| Goal mutation | Component/Vitest or E2E coverage that editing summary, constraints, criteria, and status calls `PUT /goal`, then refreshed data is visible |
| Work item creation | Component/Vitest or E2E coverage that create form posts title, description, priority, acceptance criteria, status, and bounded initial refs |
| Status filtering | Route-contract test that list query includes bounded `status` and `limit`; UI shows filtered status state |
| Detail inspection | UI test proves selected work item details remain inside project context and show safe fields/counts only |
| Status movement | UI/E2E coverage for allowed transition action, mutation payload, refetch, and server-error display |
| Done guard | UI/E2E coverage that evidence-free `done` requires manual completion reason before submit |
| Strict mocks | Playwright fallback returns 404 for unknown `/api/v1/*` routes |
| Boundary safety | No Next.js API routes, no Gateway data model changes, no post-creation evidence attachment controls |
| i18n | New visible copy exists in all `packages/web/src/lib/i18n.ts` dictionaries |

Recommended verification commands:

- `pnpm --dir packages/web run typecheck`
- `pnpm --dir packages/web exec vitest run src/lib/api.test.ts`
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium`
- `git diff --check`
- `gsd-sdk query verify.schema-drift 10`

## Risks

- `ProjectManagerPanel` can become too large if all forms, tables, filters, and
  detail views are added without local decomposition.
- Web-side status transition guidance must match Gateway exactly. If it drifts,
  users see actions that Gateway rejects or miss actions Gateway permits.
- Optional initial references can accidentally become raw evidence intake.
  Keep inputs bounded to approved fields and short values.
- Manual completion reason should be treated as a guardrail for evidence-free
  completion, not a general comment feature.
- Strict E2E mocks need updates for every new mutation route; otherwise the
  route-contract test will correctly fail.
- Missing UI-SPEC is a planning blocker under the current GSD workflow defaults.

## Planning Recommendation

Run `$gsd-ui-phase 10` before executable planning. After UI-SPEC exists, split
Phase 10 into focused plans:

1. `10-01-PLAN.md` - goal editing workflow, normalization, mutation error
   handling, refresh behavior, and focused UI/API tests.
2. `10-02-PLAN.md` - work item list/filter/detail/create workflow, bounded
   initial references, i18n, and strict route-contract coverage.
3. `10-03-PLAN.md` - status transition actions, evidence-free done guard,
   mutation/refetch behavior, and Playwright happy/error coverage.
