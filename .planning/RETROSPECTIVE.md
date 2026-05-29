# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 - Post-Beta Trust Closure

**Shipped:** 2026-05-20
**Phases:** 5 | **Plans:** 13 | **Tasks:** 37

### What Was Built

- Post-beta release/source-of-truth documentation was aligned with the merged PR #2 state and explicit beta caveats.
- Public Feishu webhook ingress gained raw-body signature verification, replay/rate persistence, fail-closed tenant policy, redaction, and audit evidence.
- First-user dependency, provider, Settings, Copilot state, and Web E2E failure paths were hardened.
- Project-manager state gained a tenant-scoped Gateway ledger backend with transactional audit writes, diagnostics, and Copilot read tools.
- Remote execution was separated into an architecture, threat model, rollback plan, and verification package before runtime implementation.

### What Worked

- Caveat-first evidence kept the release honest where live provider, physical Windows/WSL, and first-user inputs were unavailable.
- GSD phase verification caught planning metadata gaps, especially the missing Phase 02 verification artifact and stale Phase 04 validation status.
- Cross-phase audit was useful because Phase 4 and Phase 5 depended on earlier Feishu and UX boundary decisions.

### What Was Inefficient

- Some validation files kept draft/pending metadata after implementation had already passed verification.
- Phase-level verification notes became stale when later audit work added missing artifacts.
- Route-bearing Gateway tests required route-capable execution outside the restricted sandbox, so evidence had to distinguish sandbox failures from product failures.

### Patterns Established

- Treat chat integrations as collaboration ingress only; approval and terminal authority stay explicit, tokenized, authenticated, and audited.
- Keep external evidence caveats visible instead of converting them into false pass claims.
- Archive milestone ROADMAP, REQUIREMENTS, and audit evidence before deleting milestone-scoped working files.

### Key Lessons

1. Verification artifacts should be created for every phase before milestone audit starts; missing verification causes later reports to make avoidable assumptions.
2. Metadata closure matters: `VALIDATION.md`, `STATE.md`, and `PROJECT.md` need the same rigor as code and tests during milestone close.
3. Remote execution should stay isolated until its threat model, rollback plan, and runtime evidence are planned as a dedicated milestone.

### Cost Observations

- Model mix: not measured for this milestone.
- Sessions: multiple Codex sessions with GSD continuation and subagent review.
- Notable: parallel specialist review helped find cross-phase drift, but final milestone archival still needed direct orchestration.

---

## Milestone: v1.1 - Beta Evidence Burn-down

**Shipped:** 2026-05-21
**Phases:** 3 | **Plans:** 6 | **Tasks:** 19

### What Was Built

- v1.1 evidence matrix with live Copilot provider caveat, redacted smoke result, and smoke/trial doc routing.
- Physical Windows/WSL terminal caveat, current-host smoke evidence, CI gate separation, and redaction gate closure.
- Secret-safe Feishu callback setup and sanitized evidence report that records the real developer-console callback as blocked, not passed.
- Feishu public webhook evidence now distinguishes real console callback blockers from automated route, topology, encrypted-payload, and authority regressions.
- First-user Quick Smoke checklist and redacted support diagnostics packet.
- v1.1 first-user readiness closeout with caveat routing and support entry points.

### What Worked

- Evidence burn-down was a better fit than feature expansion: the milestone made unresolved external inputs visible instead of trying to ship around them.
- Phase 6 and Phase 7 reports gave Phase 8 a concrete source of truth, so the closeout could route caveats without re-litigating evidence facts.
- Security review was lightweight because the plans carried explicit threat models and the artifacts had direct redaction and integrity checks.

### What Was Inefficient

- New source-of-truth docs had to be explicitly unignored because `docs/*` and `docs/reports/*` are ignored by default.
- GSD state progress needed a manual correction after `phase.complete` left `completed_phases` and percent stale.
- The verify-work flow is optimized for interactive product UAT; document/evidence phases need a clearer automated-UAT path.

### Patterns Established

- First-user readiness is a packet: trial checklist, support diagnostics, evidence matrix, closeout report, feedback form, and issue template.
- External evidence should be recorded as `Pass`, `Caveat`, or `Blocked` with owner and clearing condition, not as an internal TODO.
- Feishu public webhook exposure remains single-Gateway/local-first until shared replay/rate storage and encrypted payload decrypt support are separately implemented.

### Key Lessons

1. Keep caveats user-visible when evidence depends on external credentials, physical hosts, or third-party console actions.
2. Phase closeout should link evidence sources rather than duplicate or reinterpret them.
3. For doc-only milestones, automated `rg`/state/security checks can provide high-confidence UAT evidence without forcing artificial manual prompts.

### Cost Observations

- Model mix: not measured for this milestone.
- Sessions: multiple Codex/GSD sessions with subagent security review.
- Notable: artifact-first summaries made final archival straightforward, but complete-milestone still required direct orchestration.

---

## Milestone: v1.2 - Project Manager Web Workflow

**Shipped:** 2026-05-22
**Phases:** 3 | **Plans:** 8 | **Tasks:** 29

### What Was Built

- Typed Project Manager Web client coverage for route encoding, request bodies, query behavior, and error propagation.
- A first-class Project Manager tab in the project detail context with visible loading, empty, not-found, validation, and mutation states.
- Inline project goal editing, status-filtered work item lists, work item creation, detail inspection, and evidence-free done guardrails.
- Bounded evidence-reference attachment from the work item detail Sheet with local raw/secret-content rejection.
- Safe ledger timeline with event filters, load more, scoped ledger failure handling, and no raw event details.
- Full Project Manager workflow E2E proof plus trial checklist, support diagnostics, closeout report, UAT, security, validation, and goal verification artifacts.

### What Worked

- Building the Web workflow on top of the existing Gateway-owned ledger kept authority boundaries intact while making the project-manager state usable.
- Strict E2E route mocks caught endpoint drift and kept the frontend contract honest.
- The evidence and ledger threat models were specific enough that security review could verify mitigations directly against code and docs.

### What Was Inefficient

- `11-VALIDATION.md` initially retained pending task rows after implementation passed; final closeout needed a dedicated metadata cleanup.
- `verify-phase` helpers did not parse these plan frontmatter arrays cleanly, so goal-backward verification required manual synthesis from ROADMAP success criteria and plan must-haves.
- Playwright validation still requires host-level execution in this environment because sandboxed dev-server port binding fails.

### Patterns Established

- Project Manager evidence stays pointer-only: `kind`, `label`, `ref`, and `path`, with no raw terminal, Feishu, provider, or secret-bearing payloads.
- Ledger UI rows should show safe markers and counts only; raw reasons and reference lists remain out of the timeline.
- Milestone Web workflow closeout should include UAT, security, validation, and goal verification before milestone archival.

### Key Lessons

1. If a phase is both user-facing and security-sensitive, plan the E2E happy path, failure-path regressions, docs redaction scan, UAT, security review, and goal verification together.
2. Keep validation files current as implementation lands; stale `pending` rows undermine otherwise good evidence.
3. Strict mock fallback for `/api/v1/*` is worth preserving because it catches contract drift early in frontend milestones.

### Cost Observations

- Model mix: not measured for this milestone.
- Sessions: multiple Codex/GSD sessions with validation and security subagent review.
- Notable: Archiving was straightforward after UAT/security/verification artifacts existed, but final milestone close still required direct living-doc updates.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | Multiple | 5 | Moved from post-beta review cleanup to auditable GSD milestone closure. |
| v1.1 | Multiple | 3 | Shifted from implementation hardening to evidence burn-down and first-user readiness packaging. |
| v1.2 | Multiple | 3 | Promoted the Gateway-owned project-manager ledger into a first-class Web workflow with bounded evidence and ledger review. |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | Gateway and Web focused checks plus milestone audit | Not measured | Feishu webhook safety, PM ledger auditability, remote architecture boundaries |
| v1.1 | Phase UAT, security verification, evidence matrix checks, focused smoke/regression reports | Not measured | Trial checklist, support diagnostics packet, readiness closeout |
| v1.2 | Web typecheck, API Vitest, Project Manager Playwright E2E, UAT, security, validation, goal verification | Not measured | Project Manager Web workflow, bounded evidence attach, safe ledger timeline |

### Top Lessons

1. Do not remove release caveats until the exact real-world evidence exists.
2. Keep product authority boundaries explicit before adding collaboration or remote-control surfaces.
3. Archive evidence milestones only after UAT, security, and open-artifact scans agree there is no hidden verification debt.
4. Keep strict frontend route mocks for control-plane workflows; otherwise UI tests can quietly accept broken Gateway contracts.
