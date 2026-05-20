# Milestones

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
