---
phase: 09
slug: project-manager-web-foundation
status: complete
created: 2026-05-21
---

# Phase 09 - Pattern Map

## Existing Patterns To Reuse

| New work | Closest existing pattern | Notes |
|----------|--------------------------|-------|
| Project-manager API helpers in `packages/web/src/lib/api.ts` | Project AI config and project Agent sequence helpers | Reuse `fetchJson`, method/body conventions, and project-scoped path helpers. |
| API helper tests in `packages/web/src/lib/api.test.ts` | Existing tests for project config and orchestration helpers | Assert path, method, body, query params, and returned envelope data. |
| Project detail tab placement | `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` tabs for sessions, agents, orchestration, skills, config, activity | Add a `project-manager` tab without adding a global route. |
| Active-tab scoped loading | Existing activity query gating in project detail page | Fetch project-manager data only when the tab is active. |
| Component extraction | Existing local component usage under `packages/web/src/components` | Add a focused project panel component to avoid growing the page file. |
| i18n strings | `packages/web/src/lib/i18n.ts` project-page translation keys | Add all visible tab, state, and command text through existing translation objects. |
| Strict E2E mock fallback | `packages/web/e2e/copilot.spec.ts` unhandled `/api/v1/*` 404 fallback | New project-manager E2E should fail unknown endpoints instead of accepting generic success. |

## Files Expected To Change

- `packages/web/src/lib/api.ts`
- `packages/web/src/lib/api.test.ts`
- `packages/web/src/app/(dashboard)/projects/[id]/page.tsx`
- `packages/web/src/components/projects/ProjectManagerPanel.tsx`
- `packages/web/src/lib/i18n.ts`
- `packages/web/e2e/project-manager.spec.ts`

## Boundaries

- Do not add Gateway routes, repositories, migrations, or business logic in
  Phase 9.
- Do not add Next.js API routes.
- Do not add a global project-manager dashboard.
- Do not make Feishu, Copilot, terminal sessions, or raw evidence blobs
  authoritative for project-manager state.
- Do not introduce a new visual palette or marketing-style page.

## Recommended Dependency Order

1. API client types and functions.
2. API client tests.
3. Project Manager tab and child panel.
4. i18n copy.
5. Strict Playwright E2E coverage.
