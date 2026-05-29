# Roadmap: OpenForge

## Milestones

- ✅ **v1.0 Post-Beta Trust Closure** — Phases 1-5, shipped 2026-05-20.
- ✅ **v1.1 Beta Evidence Burn-down** — Phases 6-8, shipped 2026-05-21.
- 🟡 **v1.2 Project Manager Web Workflow** — Phases 9-11, planning started 2026-05-21.

## Current Milestone: v1.2 Project Manager Web Workflow

**Goal:** Turn the existing Gateway-owned project-manager ledger into a first-class Web workflow for project goals, work items, evidence references, and ledger review.

**Scope rule:** v1.2 is a Web workflow milestone. Do not add Feishu/Copilot direct write authority, remote execution runtime, or raw evidence blob storage.

### Phase 9: Project Manager Web Foundation

**Goal:** Add the typed Web client and project-context surface that makes project-manager state visible without changing the Gateway authority model.

**Requirements:** PMAPI-01, PMAPI-02, PMUX-01

**Success criteria:**

1. `packages/web/src/lib/api.ts` exports typed project-manager DTOs and functions for goal, work items, status updates, evidence attachment, and ledger reads.
2. Project detail UI exposes a first-class project-manager tab or equivalent project-context surface.
3. Loading, empty, not-found, validation, and mutation errors are visible and do not collapse into blank UI.
4. Frontend tests or strict E2E mocks fail on unknown project-manager API routes.

### Phase 10: Goal And Work Item Operations

**Goal:** Make project goals and work items usable for daily planning, tracking, and status movement.

**Requirements:** PMUX-02, PMUX-03, PMUX-04, PMUX-05

**Success criteria:**

1. User can view and update goal summary, constraints, acceptance criteria, and status with persisted refresh.
2. User can create work items with title, description, priority, acceptance criteria, and optional initial references.
3. User can list, filter, and inspect work items by bounded status while preserving project context.
4. Status transitions follow the documented Gateway transition rules, and `done` clearly requires evidence or a manual completion reason.

### Phase 11: Evidence, Ledger, And Acceptance Gates

**Goal:** Close the project-manager workflow with bounded evidence attachment, safe ledger review, tests, and handoff notes.

**Requirements:** PMEV-01, PMEV-02, PMEV-03, PMQA-01, PMQA-02

**Success criteria:**

1. User can attach evidence references using only the approved fields from `docs/API.md`.
2. Ledger timeline shows safe event markers, status, evidence counts, Feishu reference counts, and timestamps without raw sensitive details.
3. Manual completion, evidence attachment, blocker, and status-change events are distinguishable in the UI.
4. Verification covers typed client behavior, component states, strict E2E mocks, and one goal/work-item/evidence/ledger happy path.
5. Trial or maintainer docs explain the v1.2 workflow boundaries and sensitive-data rules.

## Archived Milestones

<details>
<summary>✅ v1.0 Post-Beta Trust Closure (Phases 1-5) — SHIPPED 2026-05-20</summary>

- [x] Phase 1: Beta Evidence Closure — 4/4 plans completed 2026-05-19.
- [x] Phase 2: Public Feishu Webhook Safety — 2/2 plans completed 2026-05-20.
- [x] Phase 3: First-User Product Hardening — 4/4 plans completed 2026-05-20.
- [x] Phase 4: Feishu Project Manager Ledger — 2/2 plans completed 2026-05-20.
- [x] Phase 5: Remote Execution Architecture — 1/1 plan completed 2026-05-20.

Full archive:

- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.0-REQUIREMENTS.md`
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md`
- `.planning/milestones/v1.0-phases/`

</details>

<details>
<summary>✅ v1.1 Beta Evidence Burn-down (Phases 6-8) — SHIPPED 2026-05-21</summary>

- [x] Phase 6: Live Provider and Platform Smoke Evidence — 2/2 plans completed 2026-05-21.
- [x] Phase 7: Feishu Live Callback Readiness — 2/2 plans completed 2026-05-21.
- [x] Phase 8: First-User Readiness Packet — 2/2 plans completed 2026-05-21.

Full archive:

- `.planning/milestones/v1.1-ROADMAP.md`
- `.planning/milestones/v1.1-REQUIREMENTS.md`
- `.planning/milestones/v1.1-phases/`

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Beta Evidence Closure | v1.0 | 4/4 | Complete | 2026-05-19 |
| 2. Public Feishu Webhook Safety | v1.0 | 2/2 | Complete | 2026-05-20 |
| 3. First-User Product Hardening | v1.0 | 4/4 | Complete | 2026-05-20 |
| 4. Feishu Project Manager Ledger | v1.0 | 2/2 | Complete | 2026-05-20 |
| 5. Remote Execution Architecture | v1.0 | 1/1 | Complete | 2026-05-20 |
| 6. Live Provider and Platform Smoke Evidence | v1.1 | 2/2 | Complete | 2026-05-21 |
| 7. Feishu Live Callback Readiness | v1.1 | 2/2 | Complete | 2026-05-21 |
| 8. First-User Readiness Packet | v1.1 | 2/2 | Complete | 2026-05-21 |
| 9. Project Manager Web Foundation | v1.2 | 2/2 | Complete   | 2026-05-21 |
| 10. Goal And Work Item Operations | v1.2 | 3/3 | Complete   | 2026-05-22 |
| 11. Evidence, Ledger, And Acceptance Gates | v1.2 | 3/3 | Complete   | 2026-05-22 |

## Backlog

Deferred after v1.2 unless reprioritized:

- Project-manager global dashboard, kanban board, and advanced analytics.
- SSH/remote execution runtime implementation from the Phase 5 architecture package.
- Encrypted Feishu payload support if a real Feishu app requires encrypted events.
- Shared replay/rate store implementation for multi-instance public Feishu webhook deployment.
- Copilot or Feishu project-manager write proposals through explicit pending-action workflows.
