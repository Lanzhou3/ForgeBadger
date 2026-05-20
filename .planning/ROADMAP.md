# Roadmap: OpenForge

## Overview

OpenForge v1.0 Post-Beta Trust Closure shipped on 2026-05-20. The completed milestone turned the post-beta Copilot and Feishu work into audited evidence, hardened first-user recovery paths, added a safe project-manager ledger backend, and separated remote execution into an architecture-only future milestone.

For the full shipped milestone details, see:

- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.0-REQUIREMENTS.md`
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md`
- `.planning/MILESTONES.md`

## Milestones

- **v1.0 Post-Beta Trust Closure** - Shipped 2026-05-20; Phases 1-5, 13 plans, 23 traced requirements, audit passed.
- **v1.1 Next Milestone** - Not planned yet. Recommended direction: remove remaining real-world beta caveats before broadening runtime scope.

## Phases

<details>
<summary>v1.0 Post-Beta Trust Closure (Phases 1-5) - SHIPPED 2026-05-20</summary>

- [x] Phase 1: Beta Evidence Closure - 4/4 plans completed 2026-05-19.
- [x] Phase 2: Public Feishu Webhook Safety - 2/2 plans completed 2026-05-20.
- [x] Phase 3: First-User Product Hardening - 4/4 plans completed 2026-05-20.
- [x] Phase 4: Feishu Project Manager Ledger - 2/2 plans completed 2026-05-20.
- [x] Phase 5: Remote Execution Architecture - 1/1 plan completed 2026-05-20.

**Closeout:** `.planning/v1.0-MILESTONE-AUDIT.md` was archived to `.planning/milestones/v1.0-MILESTONE-AUDIT.md` with `status: passed`, 23/23 requirements satisfied, 5/5 phases verified, and no integration blockers.

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Beta Evidence Closure | v1.0 | 4/4 | Complete | 2026-05-19 |
| 2. Public Feishu Webhook Safety | v1.0 | 2/2 | Complete | 2026-05-20 |
| 3. First-User Product Hardening | v1.0 | 4/4 | Complete | 2026-05-20 |
| 4. Feishu Project Manager Ledger | v1.0 | 2/2 | Complete | 2026-05-20 |
| 5. Remote Execution Architecture | v1.0 | 1/1 | Complete | 2026-05-20 |

## Backlog

Candidate directions for the next milestone:

- Remove explicit beta evidence caveats with disposable live-provider smoke, physical Windows/WSL terminal smoke, and completed first-user feedback.
- Decide whether public Feishu webhook exposure is ready for a real app callback, including encrypted payload handling and shared replay/rate storage for multi-instance deployment.
- Add a product-facing project-manager workflow if the ledger is meant to become a daily user surface rather than a Copilot/diagnostics-only backend.
- If remote execution is prioritized, plan the runtime milestone from the Phase 5 architecture package: SSH target registry, remote agent protocol, dependency discovery, terminal transport, and rollback gates.
