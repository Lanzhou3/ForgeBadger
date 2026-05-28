# Milestones

## v1.5 First-User Trial Operations (Active: 2026-05-29)

**Phases planned:** 9 phases, 9 plans

**Goal:**

Turn cautious local-first readiness into an operator-run first-user trial loop
with redacted evidence routing, feedback triage, and truthful gate decisions.

**Current phases:**

- [x] Phase 21: First-User Trial Operations — 1/1 plans complete.
- [x] Phase 22: Operator Trial Dry Run — 1/1 plans complete.
- [x] Phase 23: Source Env Override Preservation — 1/1 plans complete.
- [x] Phase 24: Trial Feedback Intake Contract — 1/1 plans complete.
- [x] Phase 25: Tokenless Trial Diagnostics — 1/1 plans complete.
- [x] Phase 26: Trial Feedback Draft Generator — 1/1 plans complete.
- [x] Phase 27: Trial Feedback Packet Audit — 1/1 plans complete.
- [x] Phase 28: External Evidence Gate Drift Guard — 1/1 plans complete.
- [x] Phase 29: Trial Materials Consistency Guard — 1/1 plans complete.

**Acceptance boundary:**

- No new runtime authority, remote execution, hosted collaboration, Codex Web
  turn workflow, or Feishu execution authority.
- `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and
  `FIRST-USER-FEEDBACK` keep their v1.4 states until the required artifacts in
  `docs/EXTERNAL-EVIDENCE-GATES.md` exist.
- Operator dry-run evidence can improve the collection loop, but it is not a
  substitute for a completed first-user packet.
- Intake contract validation can prevent feedback-template drift, but it is
  not a substitute for completed first-user feedback.
- Tokenless runbook diagnostics guidance reduces first-user support risk, but
  it is not a substitute for a completed first-user packet.
- A generated feedback draft reduces collection friction, but it is not a
  substitute for a completed, redacted, linked first-user packet.
- A passing feedback packet audit means ready for maintainer triage only; it is
  not a substitute for maintainer gate-clearance judgment or linked external
  evidence.
- External evidence gate validation prevents accidental status drift, but it is
  not a substitute for the real artifacts required to move a gate to `Pass`.
- Trial materials consistency validation prevents checklist/runbook/template
  drift, but it is not a substitute for a completed, redacted, linked
  first-user packet.

---

## v1.4 External Evidence Closure (Shipped: 2026-05-29)

**Phases completed:** 4 phases, 4 plans

**Key accomplishments:**

- Canonical external evidence registry for live provider, physical Windows/WSL,
  Feishu public callback, and first-user feedback gates.
- Live provider smoke rerun recorded as `Caveat` with
  `missing_provider_credential` and Codex subscription boundary preserved.
- Feishu callback evidence refreshed with usable bot CLI preflight and passing
  local regression, while preserving the real developer-console callback as
  `Blocked`.
- v1.4 closeout matrix preserves `LIVE-PROVIDER`, `WINDOWS-WSL`, and
  `FIRST-USER-FEEDBACK` as `Caveat`, and `FEISHU-CALLBACK` as `Blocked`.

**Archived:**

- `.planning/milestones/v1.4-ROADMAP.md`
- `.planning/milestones/v1.4-REQUIREMENTS.md`
- `.planning/milestones/v1.4-phases/`

**Known deferred items at close:**

- Disposable live provider credential/model evidence.
- Physical Windows/WSL terminal evidence.
- Public HTTPS Feishu developer-console callback verification.
- Completed first-user feedback packet.

**What's next:** v1.5 First-User Trial Operations has been selected; collect
one of the remaining external evidence packets through that operating loop.

---

## v1.3 AI-Native Project Execution Traceability (Shipped: 2026-05-29)

**Phases completed:** 5 phases, 15 plans

**Key accomplishments:**

- Copilot-to-Project-Manager traceability through pending-action approval.
- Project Manager board workflow, edit/delete, and bounded batch status actions.
- Safe terminal workspace context and bounded file/session/terminal evidence references.
- Provider setup and health checks with Codex subscription boundaries preserved.
- Open-source readiness packet with contribution, security, issue templates, and caveat-preserving closeout.

**Archived:**

- `.planning/milestones/v1.3-ROADMAP.md`
- `.planning/milestones/v1.3-REQUIREMENTS.md`
- `.planning/milestones/v1.3-phases/`

**Known deferred items at close:**

- Real external evidence remained for live provider, physical Windows/WSL,
  Feishu developer-console callback, and completed first-user feedback; v1.4
  was selected to close those truthfully.

---

## v1.2 Project Manager Web Workflow (Shipped: 2026-05-22)

**Phases completed:** 3 phases, 8 plans, 29 tasks

**Key accomplishments:**

- Typed Project Manager Ledger Web client with route, body, query, encoding, and error propagation coverage
- Project Manager tab, visible API states, localized copy, and strict E2E coverage
- Inline Project Manager goal editing with array-normalized textareas and strict route-contract coverage
- Status-filtered Project Manager work items with in-context detail and bounded creation
- Documented Project Manager status transitions with evidence-free done guard
- Bounded evidence pointer attachment from Project Manager work item details
- Safe Project Manager ledger timeline with bounded filters and scoped failure handling
- Full Project Manager workflow proof plus first-user trial, support, and closeout documentation

**Archived:**

- `.planning/milestones/v1.2-ROADMAP.md`
- `.planning/milestones/v1.2-REQUIREMENTS.md`
- `.planning/milestones/v1.2-phases/`

**Known deferred items at close:**

- Live Copilot provider, physical Windows/WSL terminal, Feishu developer-console callback, and completed first-user feedback remain explicit v1.1 caveats.
- Project-manager global dashboard, kanban board, advanced analytics, remote runtime, encrypted Feishu payload support, and multi-instance shared replay/rate stores remain backlog scope.

**What's next:** v1.3 has been selected; continue with `$gsd-plan-phase 12`.

---

## v1.1 Beta Evidence Burn-down (Shipped: 2026-05-21)

**Phases completed:** 3 phases, 6 plans, 19 tasks

**Key accomplishments:**

- v1.1 evidence matrix with live Copilot provider caveat, redacted smoke result, and smoke/trial doc routing
- Physical Windows/WSL terminal caveat, current-host smoke evidence, CI gate separation, and redaction gate closure
- Secret-safe Feishu callback setup and sanitized evidence report that records the real developer-console callback as blocked, not passed
- Feishu public webhook evidence now distinguishes real console callback blockers from automated route, topology, encrypted-payload, and authority regressions
- First-user Quick Smoke checklist and redacted support diagnostics packet
- v1.1 first-user readiness closeout with caveat routing and support entry points

---

## v1.0 Post-Beta Trust Closure (Shipped: 2026-05-20)

**Delivered:** Audited post-beta trust closure for Copilot, Feishu ingress, first-user recovery, project-manager ledger, and remote-execution architecture boundaries.

**Phases completed:** 5 phases, 13 plans, 37 tasks

**Audit:** Passed in `.planning/milestones/v1.0-MILESTONE-AUDIT.md` with 23/23 requirements, 5/5 phases, 5/5 integration checks, and 5/5 user-flow checks.

**Key accomplishments:**

- Post-merge source-of-truth documents now reflect Phase 1 beta evidence closure and merged PR #2 status without rewriting historical evidence.
- Copilot live-provider smoke is recorded as a credential-missing Caveat with redacted evidence handling and a concrete rerun path.
- Windows/WSL and first-user feedback gates now have explicit Caveat evidence, triage fields, owners, and next actions.
- Terminal release evidence now distinguishes CI mvp1 smoke, current-host gate-d browser E2E, and explicit tmux integration results.
- Runtime dependency and adapter failure states now point first users to visible recovery actions instead of false-green or empty UI states.
- Copilot recovery is now more specific for provider setup blockers, and active-run UI state has stronger monotonic regression coverage.
- First-user trial feedback now maps issues to Phase 3 UX requirements with caveat ownership and secret-removal checks.
- Web E2E mocks now fail fast on unhandled model-provider API routes, and critical Copilot/provider assertions are less brittle.
- Gateway-owned project-manager ledger contract with exact tables, routes, status transitions, evidence references, Copilot read tools, diagnostics limits, and Feishu/terminal authority boundaries.
- Migration-backed, tenant-scoped project-manager ledger with atomic audit writes, REST routes, Copilot read tools, and safe diagnostics summaries
- SSH remote execution architecture package with threat model, rollback plan, and caveated verification evidence before runtime work

**Archived:**

- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.0-REQUIREMENTS.md`
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md`

**Known deferred items at close:**

- Live provider, physical Windows/WSL, and completed first-user feedback remain explicit evidence caveats.
- Public Feishu live deployment, project-manager Web UX, and remote execution runtime remain later-scope decisions.

**What's next:** Plan v1.1 around removing the remaining real-world beta caveats before expanding runtime scope.

---
