---
phase: 09-project-manager-web-foundation
plan: 02
subsystem: web
tags: [web, project-manager, ui, i18n, e2e]

requires:
  - phase: 09-project-manager-web-foundation
    plan: 01
    provides: Typed project-manager Web API helpers and DTOs
provides:
  - Project Manager tab inside project detail
  - Project Manager summary panel with loading, empty, not-found, generic error, and refresh states
  - Localized Project Manager UI copy for zh-CN, zh-TW, and en
  - Strict authenticated Playwright coverage for populated and not-found states
affects: [project-detail-ui, project-manager-web, web-i18n, e2e]

tech-stack:
  added: []
  patterns: [tanstack-query-tab-gating, shadcn-control-panel, strict-playwright-api-mocks]

key-files:
  created:
    - packages/web/src/components/projects/ProjectManagerPanel.tsx
    - packages/web/e2e/project-manager.spec.ts
  modified:
    - packages/web/src/app/(dashboard)/projects/[id]/page.tsx
    - packages/web/src/lib/i18n.ts

key-decisions:
  - "Project-manager data loads only when the project detail tab is active and the project ID exists."
  - "Phase 9 renders safe summaries, counts, statuses, and timestamps; mutation affordances remain absent or disabled."
  - "Project Manager E2E uses exact project-manager API routes plus a 404 fallback for unknown /api/v1/* calls."

patterns-established:
  - "Project-context operational surfaces can be added as project detail tabs with tab-gated queries."
  - "Project-manager Web tests should mock global project-detail baseline calls and keep project-manager endpoints exact."

requirements-completed: [PMAPI-02, PMUX-01]

duration: 25min
completed: 2026-05-21
---

# Phase 09 Plan 02 Summary

**Project Manager tab, visible API states, localized copy, and strict E2E coverage**

## Performance

- **Duration:** 25 min
- **Started:** 2026-05-21T15:10:00Z
- **Completed:** 2026-05-21T15:25:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added `ProjectManagerPanel` under the existing project detail workflow.
- Wired a keyboard-reachable `Project Manager` tab that passes `projectId` and `enabled={activeTab === "project-manager"}`.
- Added TanStack Query reads for goal, work items, and ledger, scoped by project ID and disabled until the tab is active.
- Rendered explicit loading, empty goal, empty work item, not-found, generic API error, and refresh/retry states.
- Rendered safe project-manager summary fields only: goal summary, counts, statuses, priorities, evidence/Feishu reference counts, and timestamps.
- Added zh-CN, zh-TW, and en strings for the new tab and panel states.
- Added strict Playwright coverage for populated and not-found project-manager states, with exact project-manager route mocks and a 404 fallback for unknown `/api/v1/*` routes.

## Task Commits

1. **Task 3 RED: Cover Project Manager tab E2E** - `2fbfa29` (test)
2. **Tasks 1-3 GREEN: Add Project Manager tab, panel, i18n, and E2E fixes** - `11aad98` (feat)
3. **Review fix: Guard refresh when project ID is unavailable** - `858febd` (fix)

## Files Created/Modified

- `packages/web/src/components/projects/ProjectManagerPanel.tsx` - Project Manager tab panel, tab-gated queries, visible states, safe summaries.
- `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` - Project Manager tab trigger and tab content wiring.
- `packages/web/src/lib/i18n.ts` - New Project Manager copy for supported locales.
- `packages/web/e2e/project-manager.spec.ts` - Authenticated strict E2E flow for populated and not-found states.

## Decisions Made

- Kept the surface inside project detail instead of adding a global Project Manager page.
- Kept edit, status transition, evidence attachment, and ledger filtering controls out of Phase 9.
- Used `retry: false` for panel queries so visible error and not-found states appear deterministically.
- Scoped E2E selectors to `project-manager-panel` to avoid accidental matches with project-level headings.

## Deviations from Plan

### Auto-fixed Issues

- Added `/api/v1/notifications` to the E2E baseline mocks after strict fallback exposed AppShell notification loading as a required project-detail dependency.
- Scoped duplicate `Refresh project manager` E2E selectors after the error state intentionally rendered both the primary refresh command and error recovery command.

---

**Total deviations:** 2 auto-fixed.
**Impact on plan:** The strict E2E contract became more complete without broadening the Project Manager implementation scope.

## Issues Encountered

- Playwright web server startup requires elevated local listen permission in this sandbox; the same command passes when allowed to bind `127.0.0.1:48732`.
- `pnpm --dir packages/web vitest run src/lib/api.test.ts` is not valid for this pnpm invocation shape without `exec`; it failed with `Command "packages/web" not found`.

## Verification

- RED: `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - failed as expected because `Project Manager` tab was missing.
- `pnpm --dir packages/web run typecheck` - PASS.
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - PASS, 2/2 tests.
- `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` - PASS, 46/46 tests.
- `git diff --check` - PASS.
- `gsd-sdk query verify.schema-drift 09` - PASS, no drift detected.
- `rg -n "project-manager|ProjectManagerPanel|projectManager|Unhandled mocked API route" packages/web/src/app/\(dashboard\)/projects/\[id\]/page.tsx packages/web/src/components/projects/ProjectManagerPanel.tsx packages/web/src/lib/i18n.ts packages/web/e2e/project-manager.spec.ts` - PASS.

## User Setup Required

None.

## Next Phase Readiness

Phase 10 can build on the tab-gated Project Manager surface to add goal editing, work item create/list/detail/filter, status transitions, and mutation error coverage without changing Gateway authority boundaries.

## Self-Check: PASSED

All 09-02 acceptance criteria passed. The project detail workflow exposes the Project Manager surface, queries are tab-gated, visible loading/empty/error/not-found states are present, unsupported write actions are not executable, and strict E2E mocks fail unknown project-manager API routes.

---
*Phase: 09-project-manager-web-foundation*
*Completed: 2026-05-21*
