# OpenForge

## What This Is

OpenForge is a local-first AI programming IDE control platform for developers who run AI CLI tools such as Claude Code, OpenCode, and Codex on their own machine or development host. The product combines a Gateway service and a Web console for project setup, config injection, session management, terminal access, provider/model management, Copilot assistance, Feishu collaboration entry points, diagnostics, and release evidence.

The current product stage is v1.4 External Evidence Closure planning. v1.0 Post-Beta Trust Closure was archived on 2026-05-20; v1.1 completed on 2026-05-21 with a first-user readiness packet that preserves unresolved external evidence as explicit caveats rather than broadening runtime scope; v1.2 shipped on 2026-05-22 with the Project Manager Web workflow; v1.3 shipped on 2026-05-29 with Copilot-linked execution traceability, board-level project management, terminal workspace context, provider setup clarity, and open-source readiness. v1.4 now focuses on converting the remaining live-provider, physical Windows/WSL, Feishu developer-console callback, and first-user feedback caveats into truthful evidence-gate decisions.

## Current Milestone

v1.4 External Evidence Closure is selected. Phase 17 External Evidence Registry is complete, Phase 18 Live Provider Evidence Rerun is complete as `Caveat`, and Phase 19 Feishu Public Callback Evidence is next.

**Last shipped:** v1.3 AI-Native Project Execution Traceability on 2026-05-29.

**Next milestone goal:** Convert preserved external caveats into a canonical evidence gate system with runnable collection paths, redacted artifacts, and `Pass`/`Caveat`/`Blocked` closeout decisions.

**Shipped v1.2 features:**
- Project detail Web surface for project-manager goal, work item, status, evidence, and ledger state.
- Typed Web API client and UI state handling for the existing `/api/v1/projects/:projectId/project-manager/*` endpoints.
- Goal editing, work item creation, status transitions, filtering, and completion guardrails.
- Bounded evidence-reference attachment and ledger review without exposing raw terminal, Feishu, provider, or secret-bearing data.
- Focused backend/frontend/E2E coverage for the daily project-manager workflow and failure states.

**Shipped v1.3 features:**
- Copilot can propose Project Manager changes through pending-action approval while Gateway remains authoritative.
- Project Manager has board workflow, edit/delete, and bounded batch status operations.
- Project/session views expose safe workspace context and bounded file/session/terminal evidence references.
- Provider setup exposes structured readiness checks and clearer provider/model/credential recovery paths.
- Open-source readiness packet adds MIT rationale, contribution/security entry points, safe issue routing, and caveat-preserving closeout.

## Core Value

Developers can reliably control and recover local AI CLI coding sessions from a browser without losing tenant isolation, credential boundaries, terminal persistence, or auditability, and can turn AI-assisted work into traceable project state.

## Requirements

### Validated

- [x] Local-first Gateway/Web split with all product APIs under `/api/v1`.
- [x] tmux-backed terminal persistence with browser reconnect and Gateway restart recovery.
- [x] Project create/import, config preview/apply, templates, Agents, Skills, model/provider management, and diagnostics have shipped with repository tests and smoke reports.
- [x] Codex Background Tasks are accepted only as an observable control-plane prototype; Web prompt/turn input remains disabled by default.
- [x] Platform AI Copilot first-release contract is provider-backed, read-heavy, approval-gated, tenant-scoped, redacted, and regression-gated.
- [x] Feishu integration supports safe diagnostics, tenant configuration, user mappings, approval-gated outbound actions, and a guarded inbound command bridge.
- [x] v1.0 closed stale release/source-of-truth drift and aligned post-beta documentation with the merged PR #2 state.
- [x] v1.0 recorded live-provider, physical Windows/WSL, and first-user evidence as explicit caveats with owners and rerun paths instead of false pass claims.
- [x] v1.0 implemented public Feishu webhook boundary controls with raw-body signature verification, replay/rate persistence, fail-closed policy gates, redaction, and audit rows.
- [x] v1.0 hardened dependency, adapter, provider, Settings, Copilot, and Web E2E failure states for first-user recovery.
- [x] v1.0 added a tenant-scoped project-manager ledger backend with atomic audit writes, safe diagnostics, and Copilot read tools.
- [x] v1.0 produced a remote execution architecture, threat model, rollback plan, and verification report while keeping runtime implementation deferred.
- [x] v1.1 records live Copilot provider evidence as `Complete (Caveat)` with a disposable-credential rerun path.
- [x] v1.1 records physical Windows/WSL terminal evidence as `Complete (Caveat)` with a real-host rerun path.
- [x] v1.1 records completed first-user feedback as `Complete (Caveat)` with `docs/TRIAL-FEEDBACK.md` and `OpenForge first-user trial feedback` collection paths.
- [x] v1.1 records Feishu public webhook live exposure as complete with the real developer-console callback still `Blocked`, plus single-Gateway/shared-store/encrypted-payload boundaries.
- [x] v1.1 adds a first-user readiness packet: `docs/TRIAL-CHECKLIST.md`, `docs/SUPPORT-DIAGNOSTICS.md`, and `docs/reports/v1.1-readiness-closeout-2026-05-21.md`.
- [x] v1.2 adds typed Project Manager Web client coverage and a first-class project-context Project Manager tab.
- [x] v1.2 lets Web users view and edit the project-manager goal from the project context.
- [x] v1.2 lets Web users create, filter, and inspect project-manager work items without leaving the project page.
- [x] v1.2 lets Web users move work items through allowed status transitions, with completion blocked unless evidence or a manual completion reason is present.
- [x] v1.2 lets Web users attach bounded evidence references and review the ledger event timeline without raw sensitive details.
- [x] v1.2 closes the Project Manager Web workflow with typed client coverage, strict E2E coverage, UAT, security verification, validation coverage, goal verification, and handoff docs.
- [x] v1.3 keeps AI-native project management scoped to execution traceability, not a generic PM suite.
- [x] v1.3 links Copilot runs, pending actions, summaries, and evidence references to Project Manager state through explicit approval gates.
- [x] v1.3 adds a board workflow, work item edit/delete, and bounded batch actions without regressing dense table/detail workflow.
- [x] v1.3 adds safe project-rooted workspace context and bounded file/session/terminal evidence references.
- [x] v1.3 simplifies provider setup and adds actionable provider/model health checks while preserving Codex subscription boundaries.
- [x] v1.3 adds open-source readiness docs, root contribution/security entry points, issue templates, and caveat-preserving closeout.

### Active

- [x] v1.4 creates a canonical external evidence gate registry before any preserved caveat can be cleared.
- [x] v1.4 records live provider evidence with disposable credential/model metadata or a precise blocker.
- [ ] v1.4 records Feishu developer-console callback evidence with public HTTPS routing or a precise blocker.
- [ ] v1.4 records physical Windows/WSL terminal evidence from a real host or a precise blocker.
- [ ] v1.4 maps completed first-user feedback into severity, owner, disposition, and follow-up routing, or keeps the missing packet as a caveat.
- [ ] v1.4 publishes a release closeout matrix that keeps any remaining external gaps visible.

### Out of Scope

- Hosted collaboration, cloud deployment, billing, hosted marketplace, and telemetry — require separate architecture and security review.
- Autonomous remote execution, raw shell execution, direct filesystem writes, unattended terminal control, or self-directed coding loops — outside the current local-first beta scope.
- Codex app-server Web prompt/turn workflow — `/turn` stays default-disabled behind `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1` and is not a user-facing workflow.
- Provider API-key/model override injection for Codex launch paths — Codex remains subscription/SDK-managed.
- Feishu free-form approvals, Feishu terminal input, or Feishu as execution authority — Feishu is only a controlled collaboration channel into Copilot.
- SSH/remote execution runtime implementation — now architecture-reviewed, but still not part of the local-first beta unless selected as a separate future milestone.

## Context

- Source of truth docs: `CLAUDE.md`, `MEMORY.md`, `docs/DEVELOPMENT-PLAN.md`, `docs/TECH-ARCHITECTURE.md`, `docs/TEST-PLAN.md`, `docs/CI-CD-PLAN.md`, `docs/API.md`, and the relevant `docs/reports/*.md`.
- Approved post-RC sequence was A -> B -> C: close local-first RC evidence, guarded Codex app-server prototype, then product experience hardening.
- PR #2 (`post-beta-release-gates`) merged on 2026-05-19 after Copilot/Feishu release-gate hardening and green remote CI.
- v1.0 Post-Beta Trust Closure is archived in `.planning/milestones/` with a passed milestone audit and 23/23 traced requirements satisfied.
- Remaining acceptance gaps are explicit external evidence caveats and later-scope product decisions, not broad local implementation gaps.
- v1.2 promotes the already-implemented project-manager ledger backend into a Web workflow before remote runtime expansion, because it converts the control-plane audit model into a daily user surface.
- v1.2 shipped the Project Manager Web workflow and archived its roadmap, requirements, phase artifacts, UAT, security, validation, and verification evidence under `.planning/milestones/`.
- v1.3 was selected from the PM review audit triage: AI-native project management is now the near-term differentiator, but only as an execution traceability layer on top of the local AI CLI control plane.
- v1.3 shipped and is archived under `.planning/milestones/v1.3-*`.
- External v1.1 caveats remain tracked in the readiness reports and should not be silently reclassified during v1.4.
- Phase 18 reran `pnpm smoke:copilot-provider`; no disposable provider credential was available, so `LIVE-PROVIDER` remains `Caveat` with `missing_provider_credential`.
- Root `MEMORY.md` remains the project progress memory for non-GSD sessions.

## Constraints

- **Architecture**: Gateway owns HTTP/WebSocket/API behavior; Web remains a pure SPA client.
- **API**: REST endpoints stay under `/api/v1` and use `{ code, data, message }` / `{ code, message, details }` envelopes.
- **Terminal**: tmux is the persistence layer; terminal history is recovered from tmux, not SQLite.
- **Security**: all tenant-owned rows require `user_id` scoping; all boundary inputs require schema validation; no hardcoded secrets or secret logs.
- **Credential Boundary**: stored provider keys are encrypted; Codex subscription-managed flows do not consume provider API keys.
- **Product Scope**: first-user trust, local diagnostics, and release evidence outrank new autonomous or hosted capabilities.
- **Evidence**: do not remove caveats until the documented real-host/manual evidence exists.
- **Testing**: CI-green is not sufficient when release docs require a real provider, real terminal, or physical platform smoke.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Preserve local-first AI CLI control plane as the product wedge | The strongest validated value is reliable browser control over local AI CLI sessions | Good |
| Keep Codex app-server as observable prototype only | Prompt/turn workflows add transcript, retention, and autonomy risks | Good |
| Treat Copilot as approval-gated assistant, not autonomous agent | Reduces blast radius while still enabling operational help and bounded proposals | Good |
| Treat Feishu as collaboration ingress, not execution authority | Prevents chat messages from becoming terminal or approval control | Good |
| Close external evidence before expanding scope | CI-green is not enough for live provider, physical Windows/WSL, or first-user trust | Good - caveats preserved and next actions recorded in v1.0 |
| Track SSH/remote execution separately | Remote execution changes threat model and should not be bundled into local beta hardening | Good - Phase 5 kept it architecture-only |
| Require public Feishu ingress to fail closed before exposure | Chat input must not become approval, terminal, or cross-tenant authority | Good |
| Keep project-manager state OpenForge-owned | Ledger events need auditability and tenant scope, not Feishu text authority | Good |
| Burn down real-world evidence before runtime expansion | First-user readiness depends on live provider, physical terminal, and actual feedback evidence more than new runtime scope | Good - v1.1 converted gaps into pass/caveat/blocker evidence |
| Package v1.1 as a cautious first-user handoff | Phase 8 readiness packet makes trial/support/closeout inspectable while preserving caveats | Good - v1.1 completed with explicit caveats |
| Promote project-manager ledger to Web before remote runtime work | The backend ledger is already tenant-scoped and audited, but first users need a visible project workflow before higher-risk remote execution | Good - v1.2 shipped project-context Project Manager UI with evidence, ledger, and handoff gates |
| Treat AI-native project management as execution traceability, not generic PM | The product differentiation is linking prompts, approvals, terminal context, evidence, and ledger state to AI CLI work | Selected for v1.3 |
| Close external evidence before expanding scope | Open-source readiness exposes the repository, but live provider, Windows/WSL, Feishu callback, and first-user feedback still need real artifacts | Selected for v1.4 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-29 after selecting v1.4 External Evidence Closure.*
