---
phase: 11-evidence-ledger-and-acceptance-gates
plan: 02
subsystem: ui
tags: [react, project-manager, ledger, filters, playwright]
requires:
  - phase: 11-evidence-ledger-and-acceptance-gates
    plan: 01
    provides: Evidence attachment mutation with ledger query invalidation
provides:
  - Safe Project Manager ledger timeline with 25-event default query window
  - Manual Load more control that expands the ledger query by 25 events
  - Stable user-facing ledger filter groups for status, evidence, manual completion, and blockers
  - Scoped ledger load failure handling that preserves goal and work item surfaces
affects: [project-manager-web-workflow, evidence-ledger, acceptance-gates]
tech-stack:
  added: []
  patterns:
    - Ledger filters are local UI groups mapped to existing Gateway event types.
    - Ledger rows render safe markers and counts only; raw event details are not exposed.
key-files:
  created:
    - .planning/phases/OF-11-evidence-ledger-and-acceptance-gates/11-02-SUMMARY.md
  modified:
    - packages/web/src/components/projects/ProjectManagerPanel.tsx
    - packages/web/src/lib/i18n.ts
    - packages/web/e2e/project-manager.spec.ts
key-decisions:
  - "Ledger review is a timeline area inside the Project Manager tab, not a new route or dashboard."
  - "Ledger filters stay local and bounded to existing event types; blocker filtering includes both blocker_recorded and blocker_resolved."
  - "Ledger load failure is scoped to the ledger card so goal and work item operations remain usable."
patterns-established:
  - "Project Manager ledger rows resolve loaded work item titles and fall back to work item IDs without rendering raw details."
  - "Ledger Load more changes the query limit and relies on the TanStack Query key to refetch."
requirements-completed: [PMEV-02, PMEV-03, PMQA-01]
duration: 10min
completed: 2026-05-22
---

# Phase 11 Plan 02: Ledger Timeline Summary

**Safe Project Manager ledger timeline with bounded filters and scoped failure handling**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-22T06:41:00Z
- **Completed:** 2026-05-22T06:51:09Z
- **Tasks:** 4
- **Files modified:** 3

## Accomplishments

- Replaced the fixed five-row ledger table with an in-tab timeline area.
- Changed ledger reads to default to 25 events and added `Load more` to request 25 additional events at a time.
- Added local filter groups: All, Status changes, Evidence, Manual completion, and Blockers.
- Rendered safe ledger rows with event label, work item title or ID, status badge, evidence count, Feishu count, and timestamp.
- Added static notes for manual completion and blocker events without rendering raw manual reasons or event details.
- Scoped ledger load failures to the ledger card while keeping goal and work item cards visible.
- Extended strict Playwright coverage for default limit, load more, filters, manual/blocker events, and scoped failure.

## Task Commits

1. **Tasks 1-4: Ledger timeline, filters, scoped error, and E2E coverage** - `21b38bc` (feat)

Tasks were committed together because the timeline UI, localized copy, and strict mock expectations are coupled.

## Files Created/Modified

- `packages/web/src/components/projects/ProjectManagerPanel.tsx` - Ledger limit state, filters, timeline rows, scoped error, and Load more.
- `packages/web/src/lib/i18n.ts` - Ledger filter labels, Load more, scoped error, empty state, and static event notes.
- `packages/web/e2e/project-manager.spec.ts` - Ledger default limit, filter, Load more, manual/blocker, and scoped failure coverage.

## Decisions Made

- Followed the plan: local filter grouping uses only fetched Gateway events and does not invent new backend query semantics.
- Kept timeline rows intentionally non-expandable to avoid exposing raw ledger details, evidence reference lists, or manual reasons.
- Reused existing Project Manager refresh copy for the ledger scoped retry control.

## Deviations from Plan

None - plan scope executed as written. Task commit packaging was consolidated for type-safe UI and E2E coupling.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- RED check passed as expected: the new ledger E2E failed because the existing implementation requested `limit=5` and had no timeline/filter controls.
- Existing E2E selectors for work item titles became ambiguous after ledger rows also rendered work item titles; selectors were narrowed to table rows/cells.
- Playwright still requires escalation in this environment because the sandbox blocks local dev-server port binding with `listen EPERM`.

## Verification

- RED: `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium --grep "renders ledger timeline"` - failed as expected on `limit=5` and missing filter controls.
- `pnpm --dir packages/web run typecheck` - pass.
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - pass, 9/9.
- `git diff --check` - pass.
- `gsd-sdk query verify.schema-drift 11` - pass, `drift_detected: false`.
- `rg -n "LEDGER_PAGE_SIZE|LedgerFilter|projectManagerLedgerFilter|projectManagerLoadMoreLedger|projectManagerLedgerLoadFailed" packages/web/src/components/projects/ProjectManagerPanel.tsx packages/web/src/lib/i18n.ts packages/web/e2e/project-manager.spec.ts` - pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 11-03. The next plan can exercise the full goal/work-item/evidence/ledger workflow and produce the trial/support closeout docs.

---
*Phase: 11-evidence-ledger-and-acceptance-gates*
*Completed: 2026-05-22*
