# 14-02 Web Workspace Sidecar Summary

Completed: 2026-05-29

## Scope

Exposed the Phase 14 Gateway workspace context contract in the Web console without adding Project Manager evidence mutations.

## Changes

- Added typed Web API helpers for `GET /api/v1/projects/:projectId/workspace/tree` and `GET /api/v1/projects/:projectId/workspace/file`.
- Added `WorkspaceContextPanel`, a reusable read-only project-rooted file tree and bounded file preview panel.
- Rendered the workspace sidecar in:
  - project detail `sessions` tab;
  - session detail right rail above activity, hidden in focus mode.
- Added workspace labels in `zh-CN`, `zh-TW`, and `en`.
- Added strict browser coverage for project and session workspace sidecar behavior.
- Updated affected Project Manager and Copilot E2E mocks for the newly declared workspace route calls.

## Verification

- `pnpm --dir packages/web exec vitest run src/lib/api.test.ts -t "workspace context"` — passed.
- `pnpm --dir packages/web exec tsc --noEmit` — passed.
- `pnpm --dir packages/web exec vitest run` — 29 files / 186 tests passed.
- `pnpm --dir packages/web exec playwright test e2e/workspace-context.spec.ts e2e/project-manager.spec.ts --project=chromium --reporter=line` — 14 passed.
- `pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts --project=chromium --reporter=line -g "project route context"` — 1 passed.

## Notes

- Red checks were observed before implementation:
  - API helper test failed because the helpers were not exported.
  - Workspace Playwright spec failed because the panel was absent.
- The panel is read-only. File content previews are not persisted as evidence.
- Project Manager file path, terminal snapshot marker, and session id evidence refs remain Plan 14-03.
