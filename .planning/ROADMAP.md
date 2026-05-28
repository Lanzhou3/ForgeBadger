# Roadmap: OpenForge

## Milestones

- ✅ **v1.0 Post-Beta Trust Closure** — Phases 1-5, shipped 2026-05-20.
- ✅ **v1.1 Beta Evidence Burn-down** — Phases 6-8, shipped 2026-05-21.
- ✅ **v1.2 Project Manager Web Workflow** — Phases 9-11, shipped 2026-05-22.
- ✅ **v1.3 AI-Native Project Execution Traceability** — Phases 12-16, shipped 2026-05-29.
- 🟡 **v1.4 External Evidence Closure** — Phases 17-20, planning started 2026-05-29.

## Current Milestone: v1.4 External Evidence Closure

**Goal:** Convert remaining external release caveats into a truthful evidence gate system with runnable collection paths, redacted artifacts, and closeout decisions.

**Scope rule:** v1.4 strengthens release trust for the local-first AI CLI control plane. It does not add hosted collaboration, cloud workers, autonomous remote execution, Feishu execution authority, or Codex Web prompt/turn product workflow.

**Start readiness:** Ready to begin. v1.3 is archived and the preserved caveats are explicit in `docs/OPEN-SOURCE-READINESS.md`, `docs/reports/v1.1-readiness-closeout-2026-05-21.md`, and `.planning/STATE.md`.

### Phase 17: External Evidence Registry

**Goal:** Create one canonical gate registry and release evidence matrix before any gate can be cleared.

**Requirements:** EVPOS-01, EVPOS-02, EVPOS-03, EVID-01, EVID-02, EVID-03

**Plans:** 1 plan

Plans:

- [x] 17-01-PLAN.md — External evidence gate registry, doc links, and Phase 17 verification.

**Success criteria:**

1. A canonical registry lists every external gate, current state, owner, clearing condition, artifact shape, redaction rules, and target report/issue route.
2. Trial, support, open-source, and closeout docs link to that registry instead of duplicating stale caveat wording.
3. Closeout wording says mocked tests and template existence do not clear external gates.
4. No evidence guidance asks users to paste secrets, raw provider payloads, Feishu bodies, or raw terminal transcripts.

### Phase 18: Live Provider Evidence Rerun

**Goal:** Run or precisely block live provider evidence using a disposable credential and explicit model id.

**Requirements:** PROV-01, PROV-02, PROV-03

**Plans:** 1 plan

Plans:

- [x] 18-01-PLAN.md — Live provider smoke rerun, redacted caveat evidence, and Codex boundary closeout.

**Success criteria:**

1. `pnpm smoke:copilot-provider` has a redacted evidence artifact with provider, model id, command, result, and timestamp, or a precise blocker.
2. Failure evidence distinguishes credential/model/network/timeout/outage/product-contract classes.
3. Codex subscription-managed paths remain excluded from provider key/model override evidence.

### Phase 19: Feishu Public Callback Evidence

**Goal:** Record a real Feishu developer-console callback attempt against public HTTPS Gateway routing.

**Requirements:** FEI-LIVE-01, FEI-LIVE-02, FEI-LIVE-03

**Plans:** TBD after Phase 17.

**Success criteria:**

1. Feishu console URL verification is recorded as `Pass`, `Caveat`, or `Blocked` with environment and rerun steps.
2. Evidence covers signature/raw-body handling, replay/rate policy, tenant allowlist checks, and redaction boundaries.
3. Feishu free-form text still cannot approve pending actions, send terminal input, or mutate Project Manager state.

### Phase 20: Platform And First-User Acceptance Closure

**Goal:** Close or truthfully preserve physical Windows/WSL and first-user feedback gates, then publish a v1.4 closeout matrix.

**Requirements:** UXE-01, UXE-02, UXE-03, REL-01, REL-02

**Plans:** TBD after Phase 17.

**Success criteria:**

1. Physical Windows/WSL evidence records real WSL dependency, terminal, reconnect, Gateway restart, and cleanup behavior, or a precise blocker.
2. At least one completed first-user feedback packet is triaged into severity, owner, disposition, affected surface, and follow-up route, or the missing packet remains a caveat.
3. v1.4 closeout lists every gate as `Pass`, `Caveat`, or `Blocked` with artifact links or precise blockers.
4. Public docs continue to preserve any remaining caveats with rerun paths.

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
| 19. Feishu Public Callback Evidence | v1.4 | TBD | Planned | - |
| 20. Platform And First-User Acceptance Closure | v1.4 | TBD | Planned | - |

## Backlog

Deferred outside v1.4 unless reprioritized:

- Project-manager global dashboard and advanced analytics.
- SSH/remote execution runtime implementation from the Phase 5 architecture package.
- Encrypted Feishu payload support if a real Feishu app requires encrypted events.
- Shared replay/rate store implementation for multi-instance public Feishu webhook deployment.
- Agent marketplace and visual agent orchestration beyond the basic project-manager board workflow.
