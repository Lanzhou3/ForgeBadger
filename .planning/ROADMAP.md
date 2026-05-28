# Roadmap: OpenForge

## Milestones

- ✅ **v1.0 Post-Beta Trust Closure** — Phases 1-5, shipped 2026-05-20.
- ✅ **v1.1 Beta Evidence Burn-down** — Phases 6-8, shipped 2026-05-21.
- ✅ **v1.2 Project Manager Web Workflow** — Phases 9-11, shipped 2026-05-22.
- ✅ **v1.3 AI-Native Project Execution Traceability** — Phases 12-16, shipped 2026-05-29.
- ✅ **v1.4 External Evidence Closure** — Phases 17-20, shipped 2026-05-29.
- 🟡 **v1.5 First-User Trial Operations** — Phase 21 foundation complete; real trial packet collection pending.

## Current Milestone: v1.5 First-User Trial Operations

**Goal:** Turn cautious local-first readiness into an operator-run first-user
trial loop with redacted evidence routing, feedback triage, and truthful gate
decisions.

**Scope rule:** v1.5 operationalizes real trial collection for the existing
local-first AI CLI control plane. It does not add hosted collaboration, cloud
workers, autonomous remote execution, Feishu execution authority, or Codex Web
prompt/turn product workflow.

**Entry condition:** v1.4 is complete with `LIVE-PROVIDER`, `WINDOWS-WSL`, and
`FIRST-USER-FEEDBACK` preserved as `Caveat`, and `FEISHU-CALLBACK` preserved as
`Blocked`.

### Phase 21: First-User Trial Operations

**Goal:** Select the next milestone, define the first-user trial packet, and
pin the routing rules that turn trial outcomes into evidence, issues, or
explicitly preserved caveats.

**Requirements:** TRIALOPS-01, TRIALOPS-02, TRIALOPS-03, TRIALOPS-04,
TRIALOPS-05, TRIALOPS-06, TRIALSAFE-01, TRIALSAFE-02, TRIALSAFE-03,
PLAN-21-01, PLAN-21-02, PLAN-21-03

**Plans:** 1 plan

Plans:

- [x] 21-01-PLAN.md — v1.5 selection, first-user trial packet, evidence routing, and gate-preserving verification.

**Success criteria:**

1. The active source-of-truth docs name v1.5 and Phase 21 as the current
   direction instead of leaving the next milestone unselected.
2. A minimum first-user trial packet is defined with severity, owner,
   disposition, environment, reproduction, diagnostics status, follow-up route,
   and redaction review.
3. Trial outcomes route to `docs/EXTERNAL-EVIDENCE-GATES.md`,
   `docs/TRIAL-FEEDBACK.md`, the GitHub feedback issue template, and the
   existing follow-up issue/report destinations.
4. `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and
   `FIRST-USER-FEEDBACK` keep their v1.4 states unless a real required
   artifact exists.
5. Phase 21 introduces no runtime expansion, no raw evidence storage, and no
   request for secrets, raw provider payloads, raw Feishu bodies, or raw
   terminal transcripts.

## Archived Milestones

<details>
<summary>✅ v1.4 External Evidence Closure (Phases 17-20) — SHIPPED 2026-05-29</summary>

- [x] Phase 17: External Evidence Registry — 1/1 plan completed 2026-05-29.
- [x] Phase 18: Live Provider Evidence Rerun — 1/1 plan completed as
  `Complete (Caveat)` 2026-05-29.
- [x] Phase 19: Feishu Public Callback Evidence — 1/1 plan completed as
  `Complete (Blocked)` 2026-05-29.
- [x] Phase 20: Platform And First-User Acceptance Closure — 1/1 plan completed
  as `Complete (Caveat)` 2026-05-29.

Full archive:

- `.planning/milestones/v1.4-ROADMAP.md`
- `.planning/milestones/v1.4-REQUIREMENTS.md`
- `.planning/milestones/v1.4-phases/`

</details>

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

<details>
<summary>✅ v1.3 AI-Native Project Execution Traceability (Phases 12-16) — SHIPPED 2026-05-29</summary>

- [x] Phase 12: Copilot Project-Manager Traceability — 4/4 plans completed 2026-05-22.
- [x] Phase 13: Project Manager Board Workflow — 3/3 plans completed 2026-05-29.
- [x] Phase 14: Terminal Workspace Context — 3/3 plans completed 2026-05-29.
- [x] Phase 15: Model Provider Setup And Health — 3/3 plans completed 2026-05-29.
- [x] Phase 16: Open Source Readiness Packet — 1/1 plan completed 2026-05-29.

Full archive:

- `.planning/milestones/v1.3-ROADMAP.md`
- `.planning/milestones/v1.3-REQUIREMENTS.md`
- `.planning/milestones/v1.3-phases/`

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
| 9. Project Manager Web Foundation | v1.2 | 2/2 | Complete | 2026-05-21 |
| 10. Goal And Work Item Operations | v1.2 | 3/3 | Complete | 2026-05-22 |
| 11. Evidence, Ledger, And Acceptance Gates | v1.2 | 3/3 | Complete | 2026-05-22 |
| 12. Copilot Project-Manager Traceability | v1.3 | 4/4 | Complete | 2026-05-22 |
| 13. Project Manager Board Workflow | v1.3 | 3/3 | Complete | 2026-05-29 |
| 14. Terminal Workspace Context | v1.3 | 3/3 | Complete | 2026-05-29 |
| 15. Model Provider Setup And Health | v1.3 | 3/3 | Complete | 2026-05-29 |
| 16. Open Source Readiness Packet | v1.3 | 1/1 | Complete | 2026-05-29 |
| 17. External Evidence Registry | v1.4 | 1/1 | Complete | 2026-05-29 |
| 18. Live Provider Evidence Rerun | v1.4 | 1/1 | Complete (Caveat) | 2026-05-29 |
| 19. Feishu Public Callback Evidence | v1.4 | 1/1 | Complete (Blocked) | 2026-05-29 |
| 20. Platform And First-User Acceptance Closure | v1.4 | 1/1 | Complete (Caveat) | 2026-05-29 |
| 21. First-User Trial Operations | v1.5 | 1/1 | Complete | 2026-05-29 |

## Backlog

Deferred outside v1.5 unless reprioritized:

- Project-manager global dashboard and advanced analytics.
- SSH/remote execution runtime implementation from the Phase 5 architecture package.
- Encrypted Feishu payload support if a real Feishu app requires encrypted events.
- Shared replay/rate store implementation for multi-instance public Feishu webhook deployment.
- Agent marketplace and visual agent orchestration beyond the basic project-manager board workflow.
