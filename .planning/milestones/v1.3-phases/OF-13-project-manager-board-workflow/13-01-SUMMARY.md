---
phase: OF-13-project-manager-board-workflow
plan: 01
subsystem: api
tags: [project-manager, board, gateway, web-api, ledger]

provides:
  - Project Manager work items can be edited through a tenant-scoped Gateway route.
  - Project Manager work items can be deleted only with explicit confirmation.
  - Bounded batch status updates reuse the existing transition and done-evidence guardrails.
  - Web has typed API helpers for later board UI implementation.

requirements-supported: [BOARD-02, BOARD-03, BOARD-04]
completed: 2026-05-29
---

# Phase 13 Plan 01 Summary

Completed the backend/API foundation for the Project Manager board workflow.

## Delivered

- Added `ProjectManagerRepository.updateWorkItem`, `deleteWorkItem`, and `batchUpdateWorkItemStatuses`.
- Added REST endpoints:
  - `PATCH /api/v1/projects/:projectId/project-manager/work-items/:workItemId`
  - `DELETE /api/v1/projects/:projectId/project-manager/work-items/:workItemId`
  - `POST /api/v1/projects/:projectId/project-manager/work-items/batch/status`
- Added `work_item_updated` and `work_item_deleted` ledger event types.
- Preserved existing transition rules and evidence-free `done` guard for single and batch status updates.
- Added Web API helpers for edit/delete/batch status operations.
- Updated ledger event labels and `docs/API.md`.

## Verification

- `pnpm --dir packages/gateway exec node --test --import tsx test/project-manager-repository.test.ts test/project-manager-routes.test.ts` - passed, 21/21.
- `pnpm --dir packages/gateway test` - passed, 726/726.
- `pnpm --dir packages/gateway exec tsc -p tsconfig.json --noEmit --pretty false` - passed.
- `pnpm --dir packages/web exec vitest run src/lib/api.test.ts src/lib/i18n.test.ts` - passed, 50/50.
- `pnpm --dir packages/web test` - passed, 185/185.
- `pnpm --dir packages/web exec tsc -p tsconfig.json --noEmit --pretty false` - passed.
- `git diff --check` - passed.

## Remaining Phase 13 Work

- Build the board view grouped by bounded status columns.
- Add edit/delete/batch controls to the Web Project Manager surface.
- Add browser coverage proving the table/detail workflow still works after board mode lands.
