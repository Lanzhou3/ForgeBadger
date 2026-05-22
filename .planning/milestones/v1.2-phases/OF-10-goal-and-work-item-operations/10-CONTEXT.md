# Phase 10: Goal And Work Item Operations - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 10 turns the Phase 9 read-only Project Manager tab into a daily operations surface for project goals and work items. Users should be able to update the project goal, create/filter/inspect work items, and move work items through Gateway-authorized status transitions while staying inside the project detail workflow. This phase does not add a new Gateway data model, a global project-manager dashboard, a kanban board, Feishu/Copilot write authority, post-creation evidence attachment UX, raw evidence storage, or ledger timeline deep review.

</domain>

<decisions>
## Implementation Decisions

### Goal Editing

- **D-01:** Keep goal editing inside the existing Project Manager tab, attached to the current goal card/surface. Do not add a separate route or global goal editor.
- **D-02:** Use a compact edit mode that can both create the first goal and update an existing goal through `PUT /goal`. The visible fields are summary, constraints, acceptance criteria, and status.
- **D-03:** Represent constraints and acceptance criteria as newline-separated textareas in the Web form, normalized into string arrays before calling Gateway. This is the simplest fit for the current API and avoids building a larger list-editor abstraction in Phase 10.
- **D-04:** Treat goal `status` as a short text/status field with `active` as the default rather than inventing a Web-only enum. Gateway remains authoritative for schema errors.

### Work Item Browsing And Inspection

- **D-05:** Upgrade the work item read surface from the Phase 9 five-row summary into a bounded operational table with status filtering. The filter should use the existing Gateway `status` query and a reasonable bounded limit, not client-only filtering over an unbounded list.
- **D-06:** Keep inspection in project context through an in-tab detail panel or sheet, not a route change. The detail view should show title, description, status, priority, acceptance criteria, updated time, evidence count, and Feishu reference count.
- **D-07:** Phase 10 inspection should emphasize reference counts and safe identifiers only. Do not turn evidence refs into a full evidence review/attachment workflow; that belongs to Phase 11.

### Work Item Creation And Initial References

- **D-08:** Add a compact create-work-item action in the Project Manager tab. It should collect title, description, priority, acceptance criteria, and optional status with `todo` as the default.
- **D-09:** Support optional initial references only as bounded `evidenceRefs` / `feishuRefs` values using the approved fields from `docs/API.md`. Do not accept pasted raw terminal output, Feishu message content, provider payloads, secrets, or unbounded blobs.
- **D-10:** Keep post-creation evidence attachment out of Phase 10. If a work item needs evidence after creation, Phase 10 may surface the existing count and done guard, but the attachment control is Phase 11.

### Status Movement And Done Guard

- **D-11:** Show status movement as explicit next actions derived from the documented Gateway transition table, rather than a free-form all-status dropdown. Gateway still enforces the transition.
- **D-12:** Treat `done` and `cancelled` as terminal in the Web experience, matching the current `docs/API.md` contract and repository transition map.
- **D-13:** When the user marks a work item `done` and the item has no evidence references, require a non-empty manual completion reason before submitting the mutation. Surface the Gateway error clearly if the server still rejects the request.
- **D-14:** After goal, create, or status mutations, invalidate/refetch the relevant Project Manager queries so persisted refresh is visible without leaving the tab.

### Testing And Verification

- **D-15:** Add focused Web tests for mutation client calls and Project Manager panel behavior: goal save success/error, create work item success/error, status filter query shape, status transition success/error, and done guard with manual reason.
- **D-16:** Extend strict Playwright coverage so unknown `/api/v1/*` routes still fail fast while the happy path proves goal update, work item creation, filtering/inspection, and a done transition path.

### the agent's Discretion

The user previously instructed future GSD decisions to use the recommended option without waiting. The recommended Phase 10 defaults are therefore locked here: inline goal edit, table plus in-context detail, bounded create form, optional initial references only, no post-creation evidence attachment, explicit allowed transition actions, terminal done/cancelled states, and manual completion reason for evidence-free `done`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### GSD Scope

- `.planning/PROJECT.md` — v1.2 milestone direction, current product boundaries, and active Project Manager requirements.
- `.planning/REQUIREMENTS.md` — Phase 10 requirement IDs PMUX-02, PMUX-03, PMUX-04, and PMUX-05.
- `.planning/ROADMAP.md` — Phase 10 goal and success criteria.
- `.planning/DECISIONS-INDEX.md` — Current architecture and product authority decisions.
- `.planning/phases/OF-09-project-manager-web-foundation/09-CONTEXT.md` — Prior locked decisions for Project Manager tab placement, Gateway/Web boundary, and strict mocks.
- `.planning/phases/OF-09-project-manager-web-foundation/09-VERIFICATION.md` — Passed Phase 9 baseline and intentionally absent Phase 10/11 controls.

### Project Manager Contract

- `docs/API.md` §Project Manager Ledger — Gateway-owned authority, endpoints, status transitions, evidence reference fields, terminal states, and sensitive-data exclusions.
- `packages/gateway/src/routes/project-manager.ts` — Current zod schemas and route payloads for goal, work item creation, status update, evidence, and ledger endpoints.
- `packages/gateway/src/db/repositories/project-manager-repository.ts` — Current repository transition rules, done guard, audit/ledger writes, and evidence normalization.

### Web Integration Points

- `packages/web/src/components/projects/ProjectManagerPanel.tsx` — Existing Phase 9 read-only Project Manager panel to extend.
- `packages/web/src/lib/api.ts` — Existing typed Project Manager DTOs and client helpers for goal, work item, status, evidence, and ledger calls.
- `packages/web/src/lib/i18n.ts` — Existing localized Project Manager labels and status/event copy.
- `packages/web/e2e/project-manager.spec.ts` — Strict project-manager E2E mock pattern and existing read-surface coverage.
- `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` — Existing project detail tab wiring and mutation/query style.

### Quality And Boundaries

- `.planning/codebase/architecture.md` — Gateway/Web ownership split and high-risk boundaries.
- `.planning/codebase/stack.md` — Current Web/Gateway stack and focused command expectations.
- `.planning/codebase/testing.md` — Web test layers, strict E2E mock guidance, and verification implications.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `ProjectManagerPanel` already fetches goal, work items, and ledger only when the tab is enabled. Phase 10 should preserve the `enabled`/`canLoad` guard.
- `updateProjectManagerGoal`, `createProjectManagerWorkItem`, `getProjectManagerWorkItem`, `updateProjectManagerWorkItemStatus`, and `listProjectManagerWorkItems` already exist in `packages/web/src/lib/api.ts`.
- Existing UI primitives include `Button`, `Badge`, `Card`, `Dialog`, `Sheet`, `Input`, `Label`, `Table`, and `Tabs`. There is no shared textarea/select component yet, so Phase 10 may need a small local textarea/select pattern or reusable primitive if the planner decides it is worth it.
- Existing i18n already covers Project Manager read labels, statuses, and event names; mutation controls and validation copy will need new localized keys.

### Established Patterns

- Project detail uses TanStack Query for project-scoped state and `useMutation` for side effects; Phase 10 should follow that pattern with query invalidation after mutations.
- Web client helpers use `fetchJson`, canonical Gateway envelopes, `GatewayApiError`, and encoded path segments for user-controlled IDs.
- E2E mocks should reject unexpected `/api/v1/*` requests with 404 and record the route for assertion.
- Gateway owns validation, tenant scoping, transition enforcement, ledger rows, and audit rows. Web can guide the user but must not become the authority.

### Integration Points

- Extend `packages/web/src/components/projects/ProjectManagerPanel.tsx` for goal edit, work item filtering, create action, detail inspection, and status movement.
- Update `packages/web/src/lib/i18n.ts` for new Project Manager action labels, form labels, validation hints, and error text.
- Extend `packages/web/src/lib/api.test.ts` for Phase 10 mutation call coverage if current tests do not already cover those helpers deeply enough.
- Extend `packages/web/e2e/project-manager.spec.ts` for the strict route-contract happy/error paths.

</code_context>

<specifics>
## Specific Ideas

- Keep the UI quiet and operational: dense table, status badges/actions, compact forms, and explicit error states.
- Prefer explicit status action buttons or a compact action menu over a generic status dropdown so invalid transitions are not presented as normal choices.
- Manual completion reason is a guardrail, not a notes feature; it should only appear when completing without evidence.

</specifics>

<deferred>
## Deferred Ideas

- Post-creation evidence attachment and evidence reference management — Phase 11.
- Ledger timeline filtering/deep event review — Phase 11.
- Global project-manager dashboard — future milestone after the project-level workflow is proven.
- Kanban board or drag-and-drop workflow — future UX expansion, not Phase 10.
- Copilot or Feishu project-manager write proposals — future pending-action workflow, not Phase 10.

</deferred>

---

*Phase: 10-Goal And Work Item Operations*
*Context gathered: 2026-05-22*
