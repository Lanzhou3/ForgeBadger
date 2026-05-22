---
phase: 10-goal-and-work-item-operations
plan: 02
subsystem: ui
tags: [react, project-manager, work-items, vitest, playwright]
requires:
  - phase: 10-goal-and-work-item-operations
    provides: Inline goal editing patterns and strict Project Manager E2E mock
provides:
  - Bounded status-filtered work item list in the Project Manager tab
  - In-context work item detail sheet with safe fields and counts
  - Compact create work item dialog with bounded initial evidence and Feishu refs
affects: [project-manager-web-workflow, phase-10-status-movement, phase-11-evidence-ledger]
tech-stack:
  added: []
  patterns:
    - Work item list queries use project-scoped React Query keys with status/all and limit 50.
    - Work item creation accepts one bounded evidence ref group and one bounded Feishu ref group.
key-files:
  created: []
  modified:
    - packages/web/src/components/projects/ProjectManagerPanel.tsx
    - packages/web/src/lib/i18n.ts
    - packages/web/src/lib/api.test.ts
    - packages/web/e2e/project-manager.spec.ts
key-decisions:
  - "Work item inspection stays in the Project Manager tab through a sheet; no detail route was added."
  - "Phase 10 create flow supports bounded initial refs only and does not add post-creation evidence attachment."
patterns-established:
  - "Project Manager work item filters are Gateway query params, not unbounded client-only filtering."
  - "Strict E2E mocks mutate local test state so create and refetch behavior is verified."
requirements-completed: [PMUX-03, PMUX-04]
duration: 9min
completed: 2026-05-22
---

# Phase 10 Plan 02: Work Item Operations Summary

**Status-filtered Project Manager work items with in-context detail and bounded creation**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-22T03:34:00Z
- **Completed:** 2026-05-22T03:42:57Z
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments

- Replaced the fixed 5-item work item summary query with status/all filtering and a bounded `limit: 50`.
- Added a Project Manager work item detail sheet showing safe fields, counts, timestamps, and structured evidence references.
- Added a create work item dialog with title, description, priority, status, acceptance criteria, and bounded initial evidence/Feishu references.
- Added API helper and strict E2E coverage for filter, detail, and create contracts.

## Task Commits

1. **Task 1: Add status-filtered work item listing and in-context detail** - `43c1a07` (feat)
2. **Task 2: Add compact create work item flow with bounded initial refs** - `43c1a07` (feat)
3. **Task 3: Localize work item operations copy** - `43c1a07` (feat)
4. **Task 4: Extend API and E2E coverage for filter/detail/create** - `e8fb57c` (test)

Tasks 1-3 share one commit because the component behavior and typed localized copy must land together for a compilable tree.

## Files Created/Modified

- `packages/web/src/components/projects/ProjectManagerPanel.tsx` - Status filter, detail sheet, create dialog, bounded ref payload assembly.
- `packages/web/src/lib/i18n.ts` - Work item operation copy across Simplified Chinese, Traditional Chinese, and English.
- `packages/web/src/lib/api.test.ts` - API helper assertions for blocked status filter and bounded create payload.
- `packages/web/e2e/project-manager.spec.ts` - E2E coverage for filter, detail sheet, create dialog, and strict mock route handling.

## Decisions Made

- Followed the plan: no global work item route, no Gateway changes, no post-creation evidence attachment workflow.
- Kept Feishu create inputs limited to structured identifiers and did not add raw message body inputs.

## Deviations from Plan

None - plan scope executed as written. Task commit packaging was consolidated for type-safe UI and i18n coupling.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- Playwright still requires escalation in this environment because the sandbox blocks local dev-server port binding with `listen EPERM`.

## Verification

- `pnpm --dir packages/web run typecheck` - pass
- `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` - pass, 46/46
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - pass, 4/4
- `git diff --check` - pass
- `rg -n "projectManagerCreateWorkItem|projectManagerFilterByStatus|createProjectManagerWorkItem|evidenceRefs|feishuRefs" packages/web/src/components/projects/ProjectManagerPanel.tsx packages/web/src/lib/i18n.ts packages/web/src/lib/api.test.ts packages/web/e2e/project-manager.spec.ts` - pass

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Plan 10-03: status movement actions can attach to the work item table and detail sheet using the existing Gateway status mutation helper.

---
*Phase: 10-goal-and-work-item-operations*
*Completed: 2026-05-22*
