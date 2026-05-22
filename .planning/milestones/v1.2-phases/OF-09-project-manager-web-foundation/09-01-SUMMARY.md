---
phase: 09-project-manager-web-foundation
plan: 01
subsystem: api
tags: [web, project-manager, api-client, vitest, gateway-contract]

requires:
  - phase: 04-feishu-project-manager-ledger
    provides: Gateway-owned project-manager ledger routes, DTO shape, status transitions, and evidence boundary
provides:
  - Typed Web Project Manager Ledger DTOs
  - Web API helpers for all existing project-manager Gateway endpoints
  - Focused API client tests for route shape, methods, bodies, query params, ID encoding, and error propagation
affects: [project-manager-web, project-detail-ui, project-manager-e2e]

tech-stack:
  added: []
  patterns: [typed-gateway-client, encoded-project-paths, focused-api-client-tests]

key-files:
  created: []
  modified:
    - packages/web/src/lib/api.ts
    - packages/web/src/lib/api.test.ts

key-decisions:
  - "Project-manager Web helpers return Gateway envelope data shapes such as goal, workItems, workItem, and events."
  - "Project and work item path identifiers are encoded before interpolation."
  - "Read helpers preserve Gateway error propagation through the existing fetchJson error path."

patterns-established:
  - "Project-manager client paths are built through one local path helper before calling fetchJson."
  - "Focused API tests assert every project-manager route before UI code consumes the helpers."

requirements-completed: [PMAPI-01]

duration: 5min
completed: 2026-05-21
---

# Phase 09 Plan 01 Summary

**Typed Project Manager Ledger Web client with route, body, query, encoding, and error propagation coverage**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-21T15:04:00Z
- **Completed:** 2026-05-21T15:09:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added typed Project Manager Ledger DTOs and input types to `packages/web/src/lib/api.ts`.
- Added Web helpers for goal, work item collection/detail, status update, evidence attachment, and ledger reads.
- Added focused API client tests that verify exact routes, HTTP methods, request bodies, query params, path encoding, and Gateway error propagation.
- Prepared the client-side error path required by PMAPI-02; visible UI states remain in Plan 09-02.

## Task Commits

1. **Task 2 RED: Cover project-manager API client** - `72e3154` (test)
2. **Task 1 GREEN: Add project-manager API client** - `3c8a678` (feat)

## Files Created/Modified

- `packages/web/src/lib/api.ts` - Project-manager DTOs, input types, encoded path helper, and route helpers.
- `packages/web/src/lib/api.test.ts` - Focused Project Manager Ledger route and error propagation tests.

## Decisions Made

- Kept Web helper return shapes aligned with Gateway response data keys instead of introducing alternate UI-only DTO wrappers.
- Used `encodeURIComponent` for both project IDs and work item IDs to avoid path ambiguity.
- Kept query param names aligned with Gateway schemas: `status`, `eventType`, and `limit`.
- Kept PMAPI-02 globally pending until Plan 09-02 renders visible loading, empty, validation-error, not-found, and mutation-error states.

## Deviations from Plan

### Auto-fixed Issues

None.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** Plan executed within the intended Web API client boundary.

## Issues Encountered

- `pnpm --dir packages/web vitest run src/lib/api.test.ts` is not valid for this pnpm invocation shape without `exec`; it failed with `Command "packages/web" not found`.
- The equivalent command `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` was used for verification and passed.

## Verification

- RED: `pnpm -C packages/web exec vitest run src/lib/api.test.ts` - failed as expected with `projectManagerApi.getProjectManagerGoal is not a function`.
- GREEN: `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` - PASS, 46/46 tests.
- `git diff --check` - PASS.
- `rg -n "ProjectManagerGoal|ProjectManagerWorkItem|ProjectManagerLedgerEvent|getProjectManagerGoal|listProjectManagerWorkItems|listProjectManagerLedger" packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts` - PASS.

## User Setup Required

None.

## Next Phase Readiness

Plan 09-02 can consume the typed project-manager helpers to build the project detail tab, localized visible states, and strict E2E coverage. PMAPI-02 remains pending until that visible-state work lands.

## Self-Check: PASSED

All 09-01 acceptance criteria passed. The typed helpers exist, path IDs are encoded, query params match Gateway names, errors propagate through `fetchJson`, and focused API tests cover all existing project-manager routes.

---
*Phase: 09-project-manager-web-foundation*
*Completed: 2026-05-21*
