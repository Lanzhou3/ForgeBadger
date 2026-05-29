---
phase: 10
slug: goal-and-work-item-operations
status: complete
created: 2026-05-22
---

# Phase 10 - Pattern Map

## Existing Patterns To Reuse

| New work | Closest existing pattern | Notes |
|----------|--------------------------|-------|
| Goal edit mutation in `ProjectManagerPanel` | Project detail `useMutation` blocks in `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` | Reuse TanStack Query mutation style and invalidate/refetch project-scoped queries after success. |
| Goal form controls | Existing `Input`, `Label`, `Button`, and local form spacing tokens | Use existing dark control-plane field styling; add a small local textarea primitive/pattern only if needed. |
| New Project Manager i18n copy | Existing `projects.projectManager*` keys in `packages/web/src/lib/i18n.ts` | Add action/form/error keys across Simplified Chinese, Traditional Chinese, and English dictionaries. |
| Work item status badges | Existing `statusBadgeVariant` and `statusLabel` helpers in `ProjectManagerPanel` | Extend/centralize helpers rather than duplicating status label maps across subcomponents. |
| Work item table | Existing `ProjectManagerWorkItemsCard` table | Expand the table into a bounded operations table with filter/action/detail affordances. |
| Work item detail | Local `Sheet` component in `packages/web/src/components/ui/sheet.tsx` | Use right-side sheet or same-tab detail panel; do not add a route. |
| Create work item flow | Local `Dialog`/`Sheet`, `Input`, `Label`, `Button` primitives | Keep form compact and inside Project Manager tab; avoid global modal state outside the panel. |
| Status action menu | Local `DropdownMenu` component | Render only allowed next transitions; avoid a free-form all-status dropdown. |
| API helper usage | Existing Project Manager helpers in `packages/web/src/lib/api.ts` | Prefer using existing typed helpers; only update API tests if additional route/body assertions are needed. |
| API helper tests | Existing project-manager block in `packages/web/src/lib/api.test.ts` | Add focused assertions for status filter query and status payload shape if current coverage is insufficient. |
| Strict E2E mock fallback | `packages/web/e2e/project-manager.spec.ts` | Extend the existing strict mock rather than adding tolerant fallback behavior. |

## Files Expected To Change

- `packages/web/src/components/projects/ProjectManagerPanel.tsx`
- `packages/web/src/lib/i18n.ts`
- `packages/web/e2e/project-manager.spec.ts`
- `packages/web/src/lib/api.test.ts` if additional client route assertions are required
- Optional: a small local UI primitive such as `packages/web/src/components/ui/textarea.tsx` if the executor chooses a reusable textarea instead of an inline `textarea` class pattern

## Files Not Expected To Change

- `packages/gateway/src/routes/project-manager.ts`
- `packages/gateway/src/db/repositories/project-manager-repository.ts`
- `packages/gateway/src/db/migrations/*`
- Next.js API routes

## Concrete Pattern Notes

### Query And Mutation Keys

- Preserve `["project-manager", projectId, "goal"]` for goal reads.
- Move work item queries from fixed `{ limit: 5 }` to a bounded key including
  `{ status, limit }`, where `status` is omitted or represented as `all` for
  the all-status filter.
- Preserve `["project-manager", projectId, "ledger", { limit: 5 }]` if the
  ledger summary remains visible.
- Invalidate all relevant `["project-manager", projectId, ...]` queries after
  create/status mutations, not unrelated project queries.

### Text List Normalization

Use the same normalization rule for goal constraints, goal acceptance criteria,
and work item acceptance criteria:

- Split on newline.
- Trim each line.
- Drop empty lines.
- Submit the resulting string array to Gateway.

Do not parse user-entered text as JSON.

### Status Transition Map

Keep one local transition map matching `docs/API.md` exactly:

- `todo`: `in_progress`, `blocked`, `cancelled`
- `in_progress`: `blocked`, `ready_for_review`, `done`, `cancelled`
- `blocked`: `todo`, `in_progress`, `cancelled`
- `ready_for_review`: `in_progress`, `done`, `cancelled`
- `done`: no actions
- `cancelled`: no actions

Gateway remains authoritative; this map only prevents presenting known-invalid
normal actions.

### Bounded References

When Phase 10 supports optional initial references, inputs must map only to
approved evidence fields from `docs/API.md`:

- `kind`
- `label`
- `status`
- `ref`
- `path`
- `sessionId`
- `copilotRunId`
- `feishuChatId`
- `feishuMessageId`
- `createdAt`

Do not provide a raw multiline paste area for evidence bodies, terminal output,
Feishu message content, or provider payloads.

## Boundaries

- Do not add Gateway routes, repositories, migrations, or business logic in
  Phase 10.
- Do not add Next.js API routes.
- Do not add a global project-manager dashboard or work item detail route.
- Do not add post-creation evidence attachment controls; Phase 11 owns that.
- Do not make Feishu, Copilot, terminal sessions, or raw evidence blobs
  authoritative for project-manager state.
- Do not introduce a new visual palette or marketing-style layout.

## Recommended Dependency Order

1. Goal edit form and mutation/refetch behavior.
2. Work item filtering and in-context inspection.
3. Work item creation with bounded initial references.
4. Status transition actions and evidence-free `done` guard.
5. i18n and strict Playwright coverage across the finished flow.
