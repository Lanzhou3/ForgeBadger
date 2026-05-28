---
phase: OF-12-copilot-project-manager-traceability
plan: 04
subsystem: ui
tags: [copilot, project-manager, traceability, playwright, nextjs]
requires:
  - phase: OF-12-copilot-project-manager-traceability
    plan: 12-02
    provides: Project Manager backend trace DTOs and pending action execution bridge
  - phase: OF-12-copilot-project-manager-traceability
    plan: 12-03
    provides: Web Copilot summary helpers and Project Manager anchor builder
provides:
  - PM approval cards with fixed trace summaries, safe risk cues, and disabled unsafe done approval
  - Approved PM result anchors to `/projects/:id?tab=project-manager&workItemId=:workItemId`
  - Project Manager deep-link state and bounded work item detail/ledger trace markers
affects: [copilot-ui, project-manager-ui, phase-12-traceability]
tech-stack:
  added: []
  patterns:
    - React renders structured Copilot PM markers from helper summaries instead of model prose
    - Project detail URL state is allowlisted before it mutates tab/detail UI state
key-files:
  created:
    - .planning/phases/OF-12-copilot-project-manager-traceability/12-04-SUMMARY.md
  modified:
    - packages/web/src/components/copilot/copilot-chat-panel.tsx
    - packages/web/src/components/projects/ProjectManagerPanel.tsx
    - packages/web/src/app/(dashboard)/projects/[id]/page.tsx
    - packages/web/e2e/copilot.spec.ts
    - packages/web/e2e/project-manager.spec.ts
key-decisions:
  - "PM approval UI uses existing Plan 12-03 summary metadata as the rendering contract."
  - "Project Manager trace display stays marker-only and never renders arbitrary ledger `details` payloads."
patterns-established:
  - "CopilotSummaryMarkers: shared compact rendering for PM card/result markers, message keys, risk cues, and anchors."
  - "ProjectManagerPanel selectedWorkItemId prop: URL-selected work items open after scoped work items load."
requirements-completed: [POS-01, POS-03, TRACE-01, TRACE-02, TRACE-03, TRACE-04]
duration: 1h 25m
completed: 2026-05-22
---

# Phase 12 Plan 04: PM Traceability UI Summary

**Copilot approval cards and Project Manager deep links now expose a safe run/action/evidence/ledger trace chain without raw payload rendering.**

## Performance

- **Duration:** 1h 25m
- **Started:** 2026-05-22T15:02:00Z
- **Completed:** 2026-05-22T16:27:04Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added Playwright coverage for PM approval cards, trusted-evidence gating, approved result anchors, failed PM action summaries, URL-selected Project Manager work items, and ledger/detail trace markers.
- Rendered PM Copilot summaries from structured helper output, including fixed marker rows, `Trace`, risk cue, trusted-evidence error copy, failed action markers, and `View in Project Manager`.
- Added project detail URL state for `tab=project-manager` and `workItemId`, then used it to open/highlight the selected work item inside `ProjectManagerPanel`.
- Added bounded Project Manager trace marker grids sourced from evidence refs and `ProjectManagerLedgerEvent.trace`; raw `details`, terminal output, provider payloads, and model prose remain hidden.

## Task Commits

1. **Task 1: Add Web E2E coverage for PM traceability surfaces** - `c4f44ce` (test)
2. **Task 2: Implement PM approval cards, anchors, and PM trace markers** - `a74dc7e` (feat)

**Plan metadata:** final docs committed in `ed7c19a`.

## Files Created/Modified

- `packages/web/e2e/copilot.spec.ts` - Adds PM pending-action, approval-anchor, and failed-action E2E assertions.
- `packages/web/e2e/project-manager.spec.ts` - Adds deep-link work item detail and ledger trace marker E2E coverage.
- `packages/web/src/components/copilot/copilot-chat-panel.tsx` - Renders structured PM markers, anchors, risk cues, trusted-evidence blocking, and failed PM actions.
- `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` - Syncs allowlisted `tab` URL state and passes `workItemId` into Project Manager.
- `packages/web/src/components/projects/ProjectManagerPanel.tsx` - Opens/highlights selected work items and renders safe Copilot trace cells from evidence and ledger DTOs.

## Decisions Made

- Used the existing Plan 12-03 Copilot helper output as the PM card/result rendering contract so the UI does not parse raw JSON or model prose.
- Kept URL-driven `workItemId` as view state only; data still comes from existing tenant-scoped Gateway routes.
- Rendered trace labels in compact existing border/list patterns rather than adding nested cards or new layout primitives.

## Deviations from Plan

None - plan executed within the requested ownership scope.

## Issues Encountered

- Playwright could not start the local Next.js server inside the sandbox: `listen EPERM: operation not permitted 127.0.0.1:48732`. The same Playwright commands passed after sandbox escalation for local server/browser permissions.
- Initial RED run also surfaced selector ambiguity in the new tests; selectors were tightened to exact/scoped matches before the GREEN pass.

## Verification

- `pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts e2e/project-manager.spec.ts` - 40 passed.
- `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts` - 92 passed.
- `pnpm --dir packages/web typecheck` - passed.
- `rg -n "View in Project Manager|tab=project-manager|workItemId|Copilot trace|pendingActionId" ...` - passed with matches in owned source/tests.

## Known Stubs

None.

## Threat Flags

None. The plan threat model already covered the URL state, PM action summary rendering, and ledger/evidence DTO display boundaries.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 12 can now rely on browser-proven TRACE-04 UI behavior: Copilot remains the approval surface, approved PM actions link into the selected Project Manager work item, and Project Manager displays bounded trace markers for user trust review.

## Self-Check: PASSED

- Summary file created at `.planning/phases/OF-12-copilot-project-manager-traceability/12-04-SUMMARY.md`.
- Task commits found: `c4f44ce`, `a74dc7e`.
- No tracked file deletions occurred in either task commit.

---
*Phase: OF-12-copilot-project-manager-traceability*
*Completed: 2026-05-22*
