# Roadmap: OpenForge

## Milestones

- ✅ **v1.0 Post-Beta Trust Closure** — Phases 1-5, shipped 2026-05-20.
- ✅ **v1.1 Beta Evidence Burn-down** — Phases 6-8, shipped 2026-05-21.
- ✅ **v1.2 Project Manager Web Workflow** — Phases 9-11, shipped 2026-05-22.
- 🟡 **v1.3 AI-Native Project Execution Traceability** — Phases 12-16, planning started 2026-05-22.

## Current Milestone: v1.3 AI-Native Project Execution Traceability

**Goal:** Extend the v1.2 Project Manager workflow into an AI-native execution traceability layer that links Copilot, terminal context, evidence, provider readiness, and open-source trust without changing OpenForge into a generic project-management suite.

**Scope rule:** v1.3 strengthens the local-first AI CLI control plane. Copilot and Feishu may propose project-manager writes only through explicit pending-action approval; Gateway remains the project-manager authority.

**Start readiness:** Ready to begin. v1.2 is archived and requirements are defined in `.planning/REQUIREMENTS.md`. Before this v1.3 planning update, tracked code was clean; the current tracked changes are the v1.3 planning documents, and unrelated untracked `upload_img/` remains outside milestone scope.

### Phase 12: Copilot Project-Manager Traceability

**Goal:** Link Copilot runs, approvals, and safe summaries to project-manager work items and ledger events without granting direct mutation authority.

**Requirements:** POS-01, POS-02, POS-03, TRACE-01, TRACE-02, TRACE-03, TRACE-04

**Plans:** 4 plans

Plans:
**Wave 1**

- [x] 12-01-PLAN.md — Project Manager trace DTOs, pendingActionId evidence refs, safe ledger trace contract, and API docs.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 12-02-PLAN.md — Gateway Copilot PM prepare tools, canonical approval handlers, terminal failed semantics, and trusted-evidence done gate.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 12-03-PLAN.md — Web DTOs, fixed PM Copilot summaries, result summaries, and localized trace copy.

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 12-04-PLAN.md — PM approval cards, View in Project Manager anchor, PM detail/ledger markers, and browser coverage.

**Success criteria:**

1. Copilot can propose project-manager work item creation, status updates, and evidence attachment through pending actions.
2. Approved proposals mutate project-manager state through existing Gateway routes/repositories with tenant scoping and audit rows.
3. Work item detail and ledger surfaces show safe Copilot traceability markers.
4. Raw prompts, terminal output, provider payloads, and secrets are not stored as evidence blobs.

### Phase 13: Project Manager Board Workflow

**Goal:** Add a visual board workflow while preserving the existing dense table/detail project-manager flow.

**Requirements:** BOARD-01, BOARD-02, BOARD-03, BOARD-04

**Success criteria:**

1. Work items are visible in bounded status columns.
2. Status movement follows Gateway transition rules and evidence-free completion guardrails.
3. Edit, delete, and bounded batch actions produce ledger/audit evidence and visible errors.
4. Existing table/detail interactions and v1.2 E2E coverage do not regress.

### Phase 14: Terminal Workspace Context

**Goal:** Make terminal sessions more project-aware by adding safe file context and bounded evidence references.

**Requirements:** CTX-01, CTX-02, CTX-03, CTX-04

**Success criteria:**

1. Project/session views expose a safe project-rooted file tree sidecar.
2. File reads reject traversal, symlink escape, and sensitive system paths.
3. Users can attach file path, terminal snapshot marker, and session id references to work items.
4. Terminal scrollback remains tmux-owned and is not stored in SQLite.

### Phase 15: Model Provider Setup And Health

**Goal:** Simplify provider setup and make model readiness checks actionable.

**Requirements:** MODEL-01, MODEL-02, MODEL-03, MODEL-04

**Success criteria:**

1. Provider setup explains provider, credential, and model profile relationships in one guided flow.
2. Health checks can validate credential/model readiness with safe lightweight provider calls where supported.
3. Error states distinguish invalid credentials, endpoint/network failure, unsupported model, timeout, and provider outage.
4. Codex subscription-managed paths remain isolated from provider key/model injection.

### Phase 16: Open Source Readiness Packet

**Goal:** Prepare the repository for trust-building open-source use while preserving beta caveats and local-first boundaries.

**Requirements:** OSS-01, OSS-02, OSS-03

**Success criteria:**

1. License selection and rationale are documented.
2. README, CONTRIBUTING, SECURITY, and issue templates describe local-first scope, prerequisites, support boundaries, and safe feedback handling.
3. Release/readiness docs keep live-provider, Windows/WSL, Feishu callback, and first-user feedback caveats visible with rerun paths.

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

<details>
<summary>✅ v1.2 Project Manager Web Workflow (Phases 9-11) — SHIPPED 2026-05-22</summary>

- [x] Phase 9: Project Manager Web Foundation — 2/2 plans completed 2026-05-21.
- [x] Phase 10: Goal And Work Item Operations — 3/3 plans completed 2026-05-22.
- [x] Phase 11: Evidence, Ledger, And Acceptance Gates — 3/3 plans completed 2026-05-22.

Full archive:

- `.planning/milestones/v1.2-ROADMAP.md`
- `.planning/milestones/v1.2-REQUIREMENTS.md`
- `.planning/milestones/v1.2-phases/`

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
| 12. Copilot Project-Manager Traceability | v1.3 | 4/4 | Complete   | 2026-05-22 |
| 13. Project Manager Board Workflow | v1.3 | 0/0 | Planned | — |
| 14. Terminal Workspace Context | v1.3 | 0/0 | Planned | — |
| 15. Model Provider Setup And Health | v1.3 | 0/0 | Planned | — |
| 16. Open Source Readiness Packet | v1.3 | 0/0 | Planned | — |

## Backlog

Deferred outside v1.3 unless reprioritized:

- Project-manager global dashboard and advanced analytics.
- SSH/remote execution runtime implementation from the Phase 5 architecture package.
- Encrypted Feishu payload support if a real Feishu app requires encrypted events.
- Shared replay/rate store implementation for multi-instance public Feishu webhook deployment.
- Agent marketplace and visual agent orchestration beyond the basic project-manager board workflow.
