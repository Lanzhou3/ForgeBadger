---
phase: 10-goal-and-work-item-operations
plan: 01
subsystem: ui
tags: [react, project-manager, goal-edit, playwright]
requires:
  - phase: 09-project-manager-web-entrypoint
    provides: Project Manager tab entry point and read-only state panel
provides:
  - Inline Project Manager goal create/edit/save/cancel flow
  - Local textarea primitive for Project Manager forms
  - Strict E2E coverage for PUT goal payload normalization
affects: [project-manager-web-workflow, phase-10-work-item-operations]
tech-stack:
  added: []
  patterns:
    - React Query mutations invalidate project-manager goal, work-items, and ledger queries after successful writes.
    - Newline-separated textareas are normalized to trimmed arrays before Gateway submission.
key-files:
  created:
    - packages/web/src/components/ui/textarea.tsx
  modified:
    - packages/web/src/components/projects/ProjectManagerPanel.tsx
    - packages/web/src/lib/i18n.ts
    - packages/web/e2e/project-manager.spec.ts
key-decisions:
  - "Goal editing remains inside the existing Project Manager tab and uses Gateway PUT /goal authority."
  - "Goal list fields are represented as newline-separated textarea input and submitted as arrays."
patterns-established:
  - "Project Manager writes use local form state plus React Query mutation invalidation."
  - "Strict E2E route mocks assert request payload shape and keep unknown API routes failing fast."
requirements-completed: [PMUX-02]
duration: 28min
completed: 2026-05-22
---

# Phase 10 Plan 01: Goal Editing Summary

**Inline Project Manager goal editing with array-normalized textareas and strict route-contract coverage**

## Performance

- **Duration:** 28 min
- **Started:** 2026-05-22T03:05:00Z
- **Completed:** 2026-05-22T03:33:06Z
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments

- Added a local `Textarea` primitive matching existing `Input` styling and invalid-state tokens.
- Added inline goal edit/create/save/cancel behavior to the Project Manager tab.
- Localized goal edit labels, validation, and mutation error copy across all existing dictionaries.
- Extended strict Project Manager E2E coverage to assert `PUT /goal` submits normalized arrays and status.

## Task Commits

1. **Task 1: Add reusable textarea styling** - `02eb4ad` (feat)
2. **Task 2: Implement inline goal edit/create flow** - `8681757` (feat)
3. **Task 3: Add localized goal edit copy** - `8681757` (feat)
4. **Task 4: Cover goal edit in strict Project Manager E2E** - `a232826` (test)

Task 2 and Task 3 share one commit because `ProjectManagerPanel` uses typed translation keys; keeping component references and dictionary keys together preserves a compilable tree.

## Files Created/Modified

- `packages/web/src/components/ui/textarea.tsx` - Local textarea primitive for Project Manager forms.
- `packages/web/src/components/projects/ProjectManagerPanel.tsx` - Goal edit state, mutation, validation, and query invalidation.
- `packages/web/src/lib/i18n.ts` - Goal edit copy in Simplified Chinese, Traditional Chinese, and English.
- `packages/web/e2e/project-manager.spec.ts` - Strict `PUT /goal` body assertions and save workflow coverage.

## Decisions Made

- Followed the plan: Gateway remains authoritative for goal mutation errors and persisted state.
- Used newline parsing helpers in the component so constraints and acceptance criteria submit arrays, not raw text blobs.

## Deviations from Plan

None - plan scope executed as written. The only execution packaging adjustment was combining Task 2 and Task 3 in one commit to keep typed translation keys and component code in sync.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- Playwright could not start the Next dev server inside the sandbox due `listen EPERM` on `127.0.0.1:48732`; reran the same command with escalation and it passed.

## Verification

- `pnpm --dir packages/web run typecheck` - pass
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - pass, 3/3
- `git diff --check` - pass
- `rg -n "updateProjectManagerGoal|projectManagerEditGoal|Textarea|projectManagerGoalMutationError" packages/web/src/components/projects/ProjectManagerPanel.tsx packages/web/src/components/ui/textarea.tsx packages/web/src/lib/i18n.ts packages/web/e2e/project-manager.spec.ts` - pass

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Plan 10-02: work item filtering, in-context detail inspection, and bounded work item creation can build on the goal edit form patterns and strict E2E mock.

---
*Phase: 10-goal-and-work-item-operations*
*Completed: 2026-05-22*
