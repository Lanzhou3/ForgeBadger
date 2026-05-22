---
phase: 10-goal-and-work-item-operations
plan: 03
subsystem: ui
tags: [react, project-manager, status-transitions, done-guard, playwright]
requires:
  - phase: 10-goal-and-work-item-operations
    provides: Work item list/detail/create UI from Plan 10-02
provides:
  - Explicit work item status transition actions from the documented transition map
  - Gateway-backed work item status mutation handling
  - Evidence-free done guard requiring manual completion reason
affects: [project-manager-web-workflow, phase-11-evidence-ledger]
tech-stack:
  added: []
  patterns:
    - Terminal statuses render no next-status actions in the Web UI.
    - Evidence-free done transitions require a local non-empty manual reason before Gateway submission.
key-files:
  created: []
  modified:
    - packages/web/src/components/projects/ProjectManagerPanel.tsx
    - packages/web/src/lib/i18n.ts
    - packages/web/e2e/project-manager.spec.ts
key-decisions:
  - "The Web UI renders explicit next actions from a local map matching docs/API.md; Gateway remains authoritative on mutation."
  - "Done without evidence is blocked locally until a non-empty manual completion reason is provided."
patterns-established:
  - "Status movement actions are rendered from a single transition map rather than a free-form all-status selector."
  - "Manual completion reason is used only as a completion guard and is not displayed as raw ledger detail."
requirements-completed: [PMUX-05]
duration: 7min
completed: 2026-05-22
---

# Phase 10 Plan 03: Status Movement Summary

**Documented Project Manager status transitions with evidence-free done guard**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-22T03:43:00Z
- **Completed:** 2026-05-22T03:50:14Z
- **Tasks:** 4
- **Files modified:** 3

## Accomplishments

- Added a local `PROJECT_MANAGER_STATUS_TRANSITIONS` map matching `docs/API.md`.
- Rendered status actions in the work item table and detail sheet, with no actions for `done` or `cancelled`.
- Wired `updateProjectManagerWorkItemStatus` mutations and query invalidation for list/detail/ledger refresh.
- Added the manual completion reason dialog for evidence-free `done` and strict E2E coverage for blank/non-empty behavior.

## Task Commits

1. **Task 1: Add allowed transition actions** - `3177cdd` (feat)
2. **Task 2: Implement status mutation and done manual reason guard** - `3177cdd` (feat)
3. **Task 3: Localize status movement and done guard copy** - `3177cdd` (feat)
4. **Task 4: Cover status transitions and done guard in E2E** - `0e76808` (test)

Tasks 1-3 share one commit because the transition UI, mutation guard, and typed localized copy must compile together.

## Files Created/Modified

- `packages/web/src/components/projects/ProjectManagerPanel.tsx` - Transition map, status actions, mutation flow, done reason dialog.
- `packages/web/src/lib/i18n.ts` - Status action and done guard copy in Simplified Chinese, Traditional Chinese, and English.
- `packages/web/e2e/project-manager.spec.ts` - E2E coverage for PATCH status transition and evidence-free done reason guard.

## Decisions Made

- Followed the plan: no free-form status movement dropdown; only documented next statuses are rendered.
- Kept Gateway as final authority for mutation rejection while adding local pre-submit validation for empty manual reasons.

## Deviations from Plan

None - plan scope executed as written. Task commit packaging was consolidated for type-safe UI and i18n coupling.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- Playwright still requires escalation in this environment because the sandbox blocks local dev-server port binding with `listen EPERM`.

## Verification

- `pnpm --dir packages/web run typecheck` - pass
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - pass, 5/5
- `git diff --check` - pass
- `gsd-sdk query verify.schema-drift 10` - pass, `drift_detected: false`
- `rg -n "PROJECT_MANAGER_STATUS_TRANSITIONS|updateProjectManagerWorkItemStatus|manualCompletionReason|projectManagerDoneReason" packages/web/src/components/projects/ProjectManagerPanel.tsx packages/web/src/lib/i18n.ts packages/web/e2e/project-manager.spec.ts` - pass

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 10 implementation is ready for phase-level verification. Phase 11 can build evidence attachment and ledger acceptance gates on top of these goal/work item operations.

---
*Phase: 10-goal-and-work-item-operations*
*Completed: 2026-05-22*
