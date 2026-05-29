---
phase: OF-12-copilot-project-manager-traceability
plan: 02
subsystem: api
tags: [project-manager, copilot, traceability, gateway, approval]

requires:
  - phase: OF-12-copilot-project-manager-traceability
    provides: Plan 12-01 pendingActionId evidence refs and safe Project Manager ledger trace DTOs
provides:
  - Exactly three Copilot Project Manager prepare tools for create, status update, and evidence attach proposals.
  - Stored-payload-only Project Manager approval handlers with tenant and target revalidation.
  - Terminal failed semantics for Project Manager execution errors and trusted-evidence gating for Copilot-origin done.
affects: [phase-12, copilot, project-manager, pending-actions]

tech-stack:
  added: []
  patterns:
    - Existing Copilot pending-action prepare/approve lifecycle with zod schemas
    - Project Manager repository mutations as the only approved PM write path
    - Safe result and ledger trace markers using IDs, counts, statuses, copilotRunId, and pendingActionId only

key-files:
  created:
    - .planning/phases/OF-12-copilot-project-manager-traceability/12-02-SUMMARY.md
  modified:
    - packages/gateway/src/services/copilot/read-tools.ts
    - packages/gateway/src/routes/copilot.ts
    - packages/gateway/test/copilot-tools.test.ts
    - packages/gateway/test/copilot-routes.test.ts

key-decisions:
  - "Project Manager write proposals are limited to exactly three prepare tools; read-tools creates pending actions only and never mutates PM state."
  - "Approval executes only from stored pending-action input, then revalidates project and work item visibility through user-scoped repositories."
  - "Copilot-origin done requires existing accepted or verified evidence; attaching evidence and completing work remain separate approved actions."
  - "Project Manager approval failures are terminal failed pending actions with safe details instead of restored pending actions."

patterns-established:
  - "CopilotProjectManagerPrepareTool: strict model input schema, semantic actionType, server-known copilotRunId, and pending action creation only."
  - "CopilotProjectManagerApproval: stored payload parse, tenant/project/workItem revalidation, repository mutation, bounded result markers."
  - "ProjectManagerTerminalFailure: PM approval errors update pending actions to failed with project_manager_action_failed or specific safe codes."

requirements-completed: [POS-02, POS-03, TRACE-01, TRACE-02, TRACE-03]

duration: 16min
completed: 2026-05-22
---

# Phase 12 Plan 02: Copilot Project Manager Approval Bridge Summary

**Copilot can now propose Project Manager writes through three pending-action tools and execute them only after stored-payload approval with trace-safe results.**

## Performance

- **Duration:** 16min
- **Started:** 2026-05-22T15:15:16Z
- **Completed:** 2026-05-22T15:30:41Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added RED backend tests for the three Project Manager prepare tools, approval authority, duplicate approval handling, terminal PM failure, and trusted-evidence completion gating.
- Added exactly three prepare tools: `openforge.propose_project_manager_create_work_item`, `openforge.propose_project_manager_update_work_item_status`, and `openforge.propose_project_manager_attach_evidence`.
- Implemented Project Manager approval dispatch from stored `action.input` only, with user-scoped project/work-item revalidation before repository mutation.
- Preserved Plan 12-01 traceability by stamping `pendingActionId`, `copilotRunId`, semantic action type, target IDs, evidence counts, and execution status into bounded PM result/ledger markers.
- Enforced D-14/D-15: Copilot-origin `done` requires existing `accepted` or `verified` evidence refs and cannot attach new evidence in the same status action.

## Task Commits

1. **Task 1: Add PM prepare and approval backend tests** - `ddc8fd6` (test)
2. **Task 2: Implement PM prepare tools and approval handlers** - `c12d5b3` (feat)

## Files Created/Modified

- `packages/gateway/test/copilot-tools.test.ts` - Covers exact PM prepare-tool surface, pending-action creation, and no direct PM mutation.
- `packages/gateway/test/copilot-routes.test.ts` - Covers stored payload approval, tenant/target revalidation, duplicate approvals, terminal failures, and trusted evidence gating.
- `packages/gateway/src/services/copilot/read-tools.ts` - Adds strict schemas and three PM prepare tools that create pending actions only.
- `packages/gateway/src/routes/copilot.ts` - Adds PM approval schemas, dispatcher, repository-backed execution, safe trace/result builders, and terminal failure updates.
- `.planning/phases/OF-12-copilot-project-manager-traceability/12-02-SUMMARY.md` - Execution summary and verification evidence.

## Decisions Made

- Reused the existing Copilot pending-action lifecycle instead of adding a direct Project Manager mutation tool.
- Kept browser approval bodies non-authoritative; approved PM mutations parse only the stored pending-action payload.
- Required existing accepted/verified evidence for Copilot-origin completion, making evidence attachment and `done` separate auditable actions.
- Used bounded PM result and trace details only; raw prompt, terminal output, provider payloads, full diffs, and full summaries remain excluded.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Sandbox blocked route-test HTTP listeners with `listen EPERM` on `127.0.0.1`; the required focused gateway route tests were rerun in the approved non-sandbox environment.
- Sandbox blocked writing `.git/index.lock`; task commits were created through approved git execution with normal hooks and without `--no-verify`.

## Verification

- `pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts` - RED pass showed expected failures before implementation, then passed after implementation.
- `pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts test/project-manager-repository.test.ts test/project-manager-routes.test.ts` - passed, 212/212 tests.
- `rg -n "openforge\\.propose_project_manager_create_work_item|openforge\\.propose_project_manager_update_work_item_status|openforge\\.propose_project_manager_attach_evidence|project_manager_action_failed|accepted|verified" packages/gateway/src/services/copilot/read-tools.ts packages/gateway/src/routes/copilot.ts packages/gateway/test/copilot-tools.test.ts packages/gateway/test/copilot-routes.test.ts` - passed.
- `pnpm --dir packages/gateway typecheck` - passed.
- `git diff --check -- packages/gateway/src/services/copilot/read-tools.ts packages/gateway/src/routes/copilot.ts` - passed before implementation commit.

## Known Stubs

None. Stub-pattern scan found only existing error-message text such as "not available" and local test collection initializers; no placeholder UI/data stubs were introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 12-03 can consume the approved PM pending-action contract from Copilot. The backend now exposes the locked write proposal surface and protects completion with trusted evidence, terminal failure semantics, and safe trace details.

## Self-Check: PASSED

- Verified all key source and test files exist.
- Verified task commits `ddc8fd6` and `c12d5b3` exist in git history.
- Verified required focused tests, rg check, typecheck, and whitespace check passed.
- Verified no tracked files were deleted.
- Verified unrelated untracked `upload_img/` was not staged or committed.

---
*Phase: OF-12-copilot-project-manager-traceability*
*Completed: 2026-05-22*
