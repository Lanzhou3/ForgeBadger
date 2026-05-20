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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | Multiple | 5 | Moved from post-beta review cleanup to auditable GSD milestone closure. |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | Gateway and Web focused checks plus milestone audit | Not measured | Feishu webhook safety, PM ledger auditability, remote architecture boundaries |

### Top Lessons

1. Do not remove release caveats until the exact real-world evidence exists.
2. Keep product authority boundaries explicit before adding collaboration or remote-control surfaces.
