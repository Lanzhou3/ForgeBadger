---
phase: OF-12-copilot-project-manager-traceability
plan: 01
subsystem: api
tags: [project-manager, copilot, traceability, gateway, zod]

requires:
  - phase: 11-evidence-ledger-and-acceptance-gates
    provides: Project Manager Web workflow, evidence refs, and ledger surface
provides:
  - Project Manager evidence refs preserve Copilot pending action ids.
  - Ledger route DTOs expose bounded trace markers without raw details.
  - API docs define the Phase 12 PM trace contract and three PM prepare tools.
affects: [phase-12, copilot, project-manager, web-dtos]

tech-stack:
  added: []
  patterns:
    - Existing Project Manager JSON evidence/details storage with route-level DTO allowlists
    - TDD RED/GREEN contract for PM traceability behavior

key-files:
  created:
    - .planning/phases/OF-12-copilot-project-manager-traceability/12-01-SUMMARY.md
  modified:
    - docs/API.md
    - packages/gateway/src/db/repositories/project-manager-repository.ts
    - packages/gateway/src/routes/project-manager.ts
    - packages/gateway/test/project-manager-repository.test.ts
    - packages/gateway/test/project-manager-routes.test.ts

key-decisions:
  - "Use existing Project Manager JSON details/evidence storage; no schema or migration files are required for pendingActionId and trace DTOs."
  - "Expose ledger trace only through a D-07 allowlist and keep raw ledger details absent from REST DTOs."
  - "Document exactly three Project Manager prepare-tool semantics for Phase 12: create_work_item, update_work_item_status, and attach_evidence."

patterns-established:
  - "ProjectManagerLedgerTrace: route DTO copied from allowlisted ledger details fields only."
  - "Project Manager evidence refs include pendingActionId with the same route size class as copilotRunId."

requirements-completed: [POS-01, POS-02, TRACE-01, TRACE-03]

duration: 9min
completed: 2026-05-22
---

# Phase 12 Plan 01: Project Manager Trace Contract Summary

**Project Manager evidence and ledger routes now carry Copilot pending-action traceability through bounded DTOs without exposing raw ledger details.**

## Performance

- **Duration:** 9min
- **Started:** 2026-05-22T14:58:21Z
- **Completed:** 2026-05-22T15:06:55Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added RED backend tests for `pendingActionId`, safe ledger trace markers, tenant scoping, canonical envelopes, and raw-data exclusions.
- Preserved `pendingActionId` through repository normalization, route validation, and evidence DTOs.
- Added `ProjectManagerLedgerTrace` route extraction for D-07 fields only; raw `details` remains absent from ledger REST DTOs.
- Updated `docs/API.md` with the Phase 12 traceability contract and the three Project Manager prepare tool names.

## Task Commits

1. **Task 1: Add backend trace contract tests first** - `921e3ff` (test)
2. **Task 2: Implement Project Manager trace refs and safe ledger DTOs** - `194ef7f` (feat)

## Files Created/Modified

- `docs/API.md` - Documents `pendingActionId`, `ProjectManagerLedgerTrace`, raw-content exclusions, and exactly three PM prepare tools.
- `packages/gateway/src/db/repositories/project-manager-repository.ts` - Preserves `pendingActionId` and carries normalized trace markers into ledger details.
- `packages/gateway/src/routes/project-manager.ts` - Validates and returns `pendingActionId`; maps ledger details to allowlisted `trace`.
- `packages/gateway/test/project-manager-repository.test.ts` - Covers repository trace preservation across create, status update, and evidence attach.
- `packages/gateway/test/project-manager-routes.test.ts` - Covers route evidence DTOs, ledger trace DTOs, tenant non-leakage, and raw-data exclusion.
- `.planning/phases/OF-12-copilot-project-manager-traceability/12-01-SUMMARY.md` - Execution summary and verification evidence.

## Decisions Made

- Reused existing JSON details and evidence refs for trace markers instead of adding schema or migration files.
- Kept `trace` as a route DTO allowlist rather than exposing stored `details`.
- Scoped this plan to backend/docs only; Copilot approval handlers and Web rendering remain later Phase 12 plans.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Sandbox blocked route-test HTTP listeners with `listen EPERM` on `127.0.0.1`; the required focused gateway tests were rerun in the approved non-sandbox environment.

## Verification

- `pnpm --dir packages/gateway test test/project-manager-repository.test.ts test/project-manager-routes.test.ts` - passed, 18/18 tests.
- `rg -n "pendingActionId|ProjectManagerLedgerTrace|openforge\\.propose_project_manager_create_work_item|openforge\\.propose_project_manager_update_work_item_status|openforge\\.propose_project_manager_attach_evidence" docs/API.md packages/gateway/src/db/repositories/project-manager-repository.ts packages/gateway/src/routes/project-manager.ts packages/gateway/test/project-manager-repository.test.ts packages/gateway/test/project-manager-routes.test.ts` - passed.
- `pnpm --dir packages/gateway typecheck` - passed.
- `git diff --check HEAD~2..HEAD` - passed.
- No schema or migration files were created.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 12-02 can add Copilot Project Manager prepare tools and approval handlers against this backend contract. The route DTO and docs now define the safe trace surface that later Web DTO/rendering plans can consume.

## Self-Check: PASSED

- Verified all key files exist.
- Verified task commits `921e3ff` and `194ef7f` exist in git history.
- Verified required focused tests and rg checks passed.
- Verified unrelated untracked `upload_img/` was not staged or committed.

---
*Phase: OF-12-copilot-project-manager-traceability*
*Completed: 2026-05-22*
