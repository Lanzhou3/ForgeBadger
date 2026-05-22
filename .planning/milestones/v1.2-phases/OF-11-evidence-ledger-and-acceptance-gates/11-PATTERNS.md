---
phase: 11
slug: evidence-ledger-and-acceptance-gates
status: complete
created: 2026-05-22
---

# Phase 11 - Pattern Map

## Existing Patterns To Reuse

| New work | Closest existing pattern | Notes |
|----------|--------------------------|-------|
| Evidence attach mutation | `ProjectManagerPanel` goal/create/status `useMutation` blocks | Keep mutation errors local, invalidate project-manager work item and ledger query keys on success. |
| Evidence attach entry point | `ProjectManagerWorkItemDetailSheet` in `ProjectManagerPanel` | Add the form inside the detail context, not table rows or a new route. |
| Bounded reference fields | `ReferenceDraftFields` and `createReference` helpers | Reuse trimming/drop-empty behavior, but expose only `kind`, `label`, `ref`, `path` for post-creation evidence. |
| Sensitive-content blocking | Gateway redaction regexes in `project-manager-repository.ts` | Mirror obvious patterns as a UX guard; Gateway remains authoritative. |
| Ledger read | Existing `listProjectManagerLedger` typed client helper | Move from fixed `limit: 5` summary to `limit: 25` plus Load more. |
| Ledger rendering | Existing `ProjectManagerLedgerCard` table and status/event label helpers | Replace five-row table with safe timeline rows/cards using existing badges and typography. |
| Ledger filters | Local status filter style in `ProjectManagerWorkItemsCard` | Use compact select or segmented buttons; keep user-facing groups stable. |
| Ledger errors | Existing `ProjectManagerError` and local mutation error callouts | Ledger load failure should be scoped to the ledger area, not blank all Project Manager content. |
| Typed client tests | Project-manager block in `packages/web/src/lib/api.test.ts` | Add focused route/body assertions for evidence and ledger parameters. |
| E2E strict mock | `packages/web/e2e/project-manager.spec.ts` | Extend existing mock state; preserve unknown `/api/v1/*` 404 recording. |
| Handoff docs | v1.1 trial/support/closeout docs | Mirror Pass/Caveat/Blocked discipline and redaction lists. |

## Files Expected To Change

- `packages/web/src/components/projects/ProjectManagerPanel.tsx`
- `packages/web/src/lib/i18n.ts`
- `packages/web/src/lib/api.test.ts`
- `packages/web/e2e/project-manager.spec.ts`
- `docs/TRIAL-CHECKLIST.md`
- `docs/SUPPORT-DIAGNOSTICS.md`
- `docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md`

## Files Not Expected To Change

- `packages/gateway/src/routes/project-manager.ts`
- `packages/gateway/src/db/repositories/project-manager-repository.ts`
- `packages/gateway/src/db/migrations/*`
- Next.js API routes
- terminal, Copilot, Feishu outbound, provider, or model-management modules

## Concrete Pattern Notes

### Query And Mutation Keys

- Preserve `["project-manager", projectId, "goal"]`.
- Preserve work items under
  `["project-manager", projectId, "work-items", { status, limit }]`.
- Change ledger query from `["project-manager", projectId, "ledger", { limit: 5 }]`
  to a key that includes the actual limit and any selected filter state.
- Evidence attach success should invalidate `["project-manager", projectId, "work-items"]`
  and `["project-manager", projectId, "ledger"]`.
- Ledger load failures should not be folded into the global `firstError` that
  controls the whole panel.

### Evidence Reference Creation

Post-creation evidence attachment uses exactly one `ProjectManagerEvidenceRef`
per submission. UI fields:

- `kind`
- `label`
- `ref`
- `path`

Do not expose these backend-supported fields in the Phase 11 form:

- `status`
- `sessionId`
- `copilotRunId`
- `feishuChatId`
- `feishuMessageId`
- `createdAt`

Do not add raw evidence body fields or multiline paste areas.

### Ledger Filter Groups

Use this stable user-facing grouping:

- `all`: all fetched events
- `status_changes`: `work_item_status_changed`
- `evidence`: `evidence_attached`
- `manual_completion`: `manual_completion_recorded`
- `blockers`: `blocker_recorded`, `blocker_resolved`

Because the current Gateway endpoint accepts a single `eventType`, local
grouping over the fetched event window is the least risky default for Phase 11.

### Safe Ledger Row Contents

Each ledger row/card should render only:

- event type label and badge
- work item title from currently loaded work items, else `workItemId`
- status badge or `-`
- evidence reference count
- Feishu reference count
- timestamp
- short static explanatory copy for manual completion or blocker events

Never render:

- raw event `details`
- raw manual completion reason
- evidence reference list from a ledger event
- terminal transcript
- Feishu message body
- provider payload
- secrets, tokens, signatures, or attach tokens

### Hook Placement

`ProjectManagerPanel` already has multiple hooks and an early `if (!enabled)`
return. New hook/state additions must keep React hook order valid. If execution
touches the nearby code, place effects before conditional returns rather than
adding hooks below a conditional branch.

## Recommended Dependency Order

1. Evidence attach form, mutation, safe guard, and typed client/E2E coverage.
2. Ledger timeline, filters, Load more, scoped error state, and E2E coverage.
3. Full v1.2 happy-path E2E, regression assertions, and handoff docs.

