# Phase 9: Project Manager Web Foundation - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 delivers the foundation for a project-manager Web workflow: typed Web client coverage for the existing Gateway project-manager endpoints, a first-class project-context surface in the project detail UI, and clear loading/empty/error states. It does not implement the full work item operation workflow, evidence attachment UX, ledger timeline depth, new Gateway data model, Feishu/Copilot write authority, or remote execution runtime.

</domain>

<decisions>
## Implementation Decisions

### Surface Placement

- **D-01:** Add the project-manager surface inside the existing project detail workflow, preferably as a new `project-manager` tab in `packages/web/src/app/(dashboard)/projects/[id]/page.tsx`.
- **D-02:** Keep Phase 9 as a foundation surface: visible project-manager entry point, safe read state, and clear empty/error states. Do not build a global project-manager dashboard in this phase.
- **D-03:** The first visible shape should feel like an operational control panel, not a marketing or kanban product. Use the existing dense project page style: tabs, tables, compact cards, badges, and inline status/error text.

### API Client Boundary

- **D-04:** Add typed project-manager DTOs and client functions in `packages/web/src/lib/api.ts`, reusing `fetchJson` and the existing Gateway envelope handling.
- **D-05:** Project IDs and work item IDs must be encoded in Web client paths where user-controlled identifiers are interpolated.
- **D-06:** Do not add Next.js API routes or duplicate Gateway business rules in the Web layer. The Web layer may shape forms and display known transition/evidence guidance, but Gateway remains authoritative for validation and mutation errors.
- **D-07:** Phase 9 client coverage should include every existing project-manager endpoint even if later phases use some mutations more deeply.

### Foundation UI Behavior

- **D-08:** Query project-manager data only when the project ID exists and the project-manager tab/surface is active, unless the planner finds a clear reason to prefetch lightweight summaries.
- **D-09:** The surface must show explicit loading, empty goal, empty work item, API validation/error, and not-found states. Blank content is a failure.
- **D-10:** Phase 9 may include read-only summaries or disabled/placeholder controls for Phase 10/11 actions, but it should not imply that unfinished mutations already work.

### Testing And Mocking

- **D-11:** Add focused tests for the typed Web API client functions, including URL shape, methods, bodies, and error propagation.
- **D-12:** Add a focused project-manager Web test path with strict `/api/v1/*` mock behavior. Unknown project-manager routes should fail the test, not return generic success.
- **D-13:** Reuse Playwright semantic controls or stable test IDs where needed. Avoid brittle selectors based on distant ancestor text.

### the agent's Discretion

The user previously instructed future GSD decisions to use the recommended option without waiting. The recommended Phase 9 defaults are therefore locked here: project-detail tab placement, typed client first, active-tab scoped data loading, no new Gateway model, no global dashboard, and strict test mocks.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### GSD Scope

- `.planning/PROJECT.md` — Current v1.2 milestone direction, product boundaries, and key decisions.
- `.planning/REQUIREMENTS.md` — Phase 9 requirement IDs PMAPI-01, PMAPI-02, and PMUX-01.
- `.planning/ROADMAP.md` — Phase 9 goal and success criteria.
- `.planning/research/SUMMARY.md` — Inline brownfield research for the v1.2 project-manager Web workflow.

### Project Manager Contract

- `docs/API.md` §Project Manager Ledger — Gateway-owned ledger authority, endpoint list, response envelope, allowed statuses, transition rules, evidence reference fields, and sensitive-data exclusions.
- `packages/gateway/src/routes/project-manager.ts` — Existing Gateway routes and request/response DTO shape to mirror in the Web client.
- `packages/gateway/src/db/repositories/project-manager-repository.ts` — Existing repository behavior, status transitions, evidence normalization, and ledger/audit write semantics.

### Web Integration Points

- `packages/web/src/lib/api.ts` — Existing typed API helper surface, `fetchJson`, `GatewayApiError`, and project route client functions.
- `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` — Existing project detail page, tab layout, query/mutation patterns, error rendering, and dense operational UI style.
- `packages/web/e2e/copilot.spec.ts` — Example of strict API route fallback returning 404 for unhandled `/api/v1/*` mocks.
- `packages/web/src/lib/api.test.ts` — Existing Web API client test style and URL/method/body expectations.

### Quality And Boundaries

- `.planning/codebase/architecture.md` — Gateway/Web ownership split and high-risk boundaries.
- `.planning/codebase/stack.md` — Current package stack and focused command expectations.
- `.planning/codebase/testing.md` — Test layers, strict E2E mock guidance, and focused verification implications.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` in the project detail page can host a new project-manager tab without adding a global route.
- `Card`, `Table`, `Badge`, `Button`, `Label`, and existing compact stat components match the desired operational surface.
- `fetchJson` and `GatewayApiError` in `packages/web/src/lib/api.ts` already centralize auth headers, timeout, envelope parsing, and error propagation.
- Existing project queries and mutations in `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` show the TanStack Query pattern to follow.

### Established Patterns

- Project detail data is loaded through `useQuery` with project-scoped query keys and `enabled` guards.
- Project tabs are local UI state through `activeTab`; activity data already gates fetching on tab activity.
- Errors are usually rendered near the affected surface using `error instanceof Error ? error.message : fallback`.
- E2E mocks should return 404 for unhandled `/api/v1/*` routes, following the hardened Copilot mock pattern.

### Integration Points

- Add project-manager API types and functions near existing project client helpers in `packages/web/src/lib/api.ts`.
- Add a project-manager tab trigger and tab content in `packages/web/src/app/(dashboard)/projects/[id]/page.tsx`.
- Add i18n keys in `packages/web/src/lib/i18n.ts` for any new visible labels and error/empty text.
- Add focused Web tests in `packages/web/src/lib/api.test.ts` and a narrow E2E or component path under `packages/web/e2e` or existing Web test structure.

</code_context>

<specifics>
## Specific Ideas

- Treat Phase 9 as the first visible control-plane entry point for project-manager state.
- The UI should make project-manager state inspectable before later phases add full edit/status/evidence workflows.
- The project-manager surface must not look like Feishu, Copilot, or terminal owns the ledger; OpenForge Gateway remains the authority.

</specifics>

<deferred>
## Deferred Ideas

- Global project-manager dashboard — future milestone after project-level workflow is proven.
- Kanban board or drag-and-drop workflow — future UX expansion, not Phase 9.
- Copilot or Feishu project-manager write proposals — future pending-action workflow, not Phase 9.
- Remote execution progress/evidence linking — future remote runtime milestone after the architecture package is implemented.

</deferred>

---

*Phase: 9-Project Manager Web Foundation*
*Context gathered: 2026-05-21*
