# Phase 9: Project Manager Web Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 9-Project Manager Web Foundation
**Areas discussed:** Surface placement, API client boundary, Foundation UI behavior, Testing and mocking

---

## Surface Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Project detail tab | Add a first-class project-manager tab inside the existing project detail workflow. | ✓ |
| Separate global page | Create a global project-manager workspace across projects. | |
| Sidebar drawer | Add a secondary drawer launched from project detail. | |

**User's choice:** Recommended option applied under standing instruction to proceed without waiting.
**Notes:** Phase 9 requirement PMUX-01 says the surface should remain in project context. A global dashboard is deferred.

---

## API Client Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Typed Web client in `api.ts` | Mirror all existing Gateway project-manager endpoints with DTOs and `fetchJson`. | ✓ |
| Component-local fetches | Put fetch calls directly in the project page. | |
| New Next.js API route | Proxy Gateway behavior through Web routes. | |

**User's choice:** Recommended option applied under standing instruction to proceed without waiting.
**Notes:** Repository rules forbid Gateway API behavior in Next.js routes. Existing client patterns already live in `packages/web/src/lib/api.ts`.

---

## Foundation UI Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Active-tab scoped loading | Load project-manager data when the surface is active, with explicit empty/error states. | ✓ |
| Always prefetch everything | Query all project-manager data whenever project detail loads. | |
| Static placeholder only | Add only navigation and no real state loading. | |

**User's choice:** Recommended option applied under standing instruction to proceed without waiting.
**Notes:** Activity tab already gates its query on `activeTab`. Phase 9 should prove real state visibility without inflating project detail load.

---

## Testing And Mocking

| Option | Description | Selected |
|--------|-------------|----------|
| Typed client tests plus strict E2E mock | Verify URL/method/body/error behavior and fail unknown `/api/v1/*` project-manager routes. | ✓ |
| E2E only | Cover through browser flow without client-level URL/body assertions. | |
| Unit only | Skip browser route/mock validation for now. | |

**User's choice:** Recommended option applied under standing instruction to proceed without waiting.
**Notes:** Prior Copilot E2E hardening moved away from permissive route fallback; Phase 9 should keep that standard.

---

## the agent's Discretion

- The user previously instructed subsequent GSD steps to use recommended choices without waiting for repeated replies.
- The agent selected the conservative options that preserve Gateway/Web separation, reuse existing project-page patterns, and defer broader product-management scope.

## Deferred Ideas

- Global project-manager dashboard.
- Kanban board or drag-and-drop workflow.
- Copilot or Feishu write proposals for project-manager state.
- Remote execution progress/evidence linking.
