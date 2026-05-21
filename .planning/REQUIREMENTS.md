# Requirements: OpenForge v1.1 Beta Evidence Burn-down

**Defined:** 2026-05-21
**Core Value:** Developers can reliably control and recover local AI CLI coding sessions from a browser without losing tenant isolation, credential boundaries, terminal persistence, or auditability.
**Milestone Goal:** Convert remaining v1.0 external evidence caveats into reproducible pass/caveat/blocker records for first-user readiness.

## Current Milestone Requirements

### Real-World Beta Evidence

- [ ] **BETA-01**: Maintainer can run a disposable live Copilot provider smoke and record provider, model, command, result, redaction, and rerun instructions without leaking credentials.
- [ ] **BETA-02**: Maintainer can run the physical Windows/WSL terminal smoke on a real host and record pass/caveat/blocker evidence for project launch, tmux persistence, reconnect, and recovery behavior.
- [ ] **BETA-03**: Maintainer can attach completed first-user feedback with reproducible steps, affected surfaces, owner, severity, and mapped follow-up disposition.
- [ ] **BETA-04**: Release, trial, and handoff docs consistently distinguish `Pass`, `Caveat`, and `Blocked` evidence states and do not remove caveats without real evidence.
- [ ] **BETA-05**: CI/release gate documentation reconciles automated CI, local browser smoke, tmux integration, and manual real-host gates with exact skip or rerun instructions.

### Feishu Live Exposure Readiness

- [ ] **FEI-01**: Operator can verify a real Feishu developer-console public webhook callback using the existing public route and record URL verification or a precise blocker.
- [ ] **FEI-02**: Public Feishu live exposure has an explicit deployment decision for encrypted payloads, shared replay/rate storage, and single-Gateway versus multi-instance topology.
- [ ] **FEI-03**: Live Feishu exposure evidence confirms free-form chat text cannot approve pending actions, send terminal input, or bypass tenant/audit policy.

### First-User Readiness Packet

- [ ] **READY-01**: First-user trial checklist gives maintainers a single runnable path for setup, dependency checks, provider readiness, terminal smoke, Copilot smoke, and feedback capture.
- [ ] **READY-02**: Support diagnostics packet lets maintainers reproduce provider, runtime, and Feishu failures with redacted logs, exact commands, expected artifacts, and escalation boundaries.
- [ ] **READY-03**: v1.1 closeout report summarizes remaining risks as explicit user-facing caveats or next-milestone backlog items, not ambiguous internal TODOs.

## Future Requirements

### Project Manager UX

- **PMUX-01**: Add a first-class Web workflow for project-manager goals, work items, ledger history, and evidence references if the ledger becomes a daily user surface.

### Remote Execution Runtime

- **REMOTE-01**: Implement SSH execution target registry, remote agent protocol, dependency discovery, terminal transport, diagnostics, and rollback gates from the Phase 5 architecture package.

### Feishu Production Hardening

- **FEI-FUTURE-01**: Add encrypted Feishu payload support when a real Feishu app requires encrypted events and the decrypt path has a dedicated security review.
- **FEI-FUTURE-02**: Add shared replay/rate store support before enabling public Feishu webhook handling in multi-instance deployments.

## Out of Scope

| Feature | Reason |
|---------|--------|
| SSH/remote execution runtime implementation | v1.1 is evidence burn-down; remote runtime requires its own implementation milestone and security gates. |
| Project-manager Web UI | Useful, but less urgent than removing first-user trust caveats. |
| Feishu terminal control | Feishu remains a collaboration channel, not execution authority. |
| Free-form Feishu approvals | Approval semantics must remain explicit, tokenized, authenticated, and audited. |
| Removing live-provider or Windows caveats without evidence | The milestone exists to replace uncertainty with real evidence, not optimistic documentation. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BETA-01 | TBD | Not started |
| BETA-02 | TBD | Not started |
| BETA-03 | TBD | Not started |
| BETA-04 | TBD | Not started |
| BETA-05 | TBD | Not started |
| FEI-01 | TBD | Not started |
| FEI-02 | TBD | Not started |
| FEI-03 | TBD | Not started |
| READY-01 | TBD | Not started |
| READY-02 | TBD | Not started |
| READY-03 | TBD | Not started |

**Coverage:**
- Current milestone requirements: 11 total
- Mapped to phases: 0
- Future requirements: 4 total
- Unmapped: 11

---
*Requirements defined: 2026-05-21 for v1.1 Beta Evidence Burn-down*
