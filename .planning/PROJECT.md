# OpenForge

## What This Is

OpenForge is a local-first AI programming IDE control platform for developers who run AI CLI tools such as Claude Code, OpenCode, and Codex on their own machine or development host. The product combines a Gateway service and a Web console for project setup, config injection, session management, terminal access, provider/model management, Copilot assistance, Feishu collaboration entry points, diagnostics, and release evidence.

The current product stage is v1.5 First-User Trial Operations. v1.0 Post-Beta Trust Closure was archived on 2026-05-20; v1.1 completed on 2026-05-21 with a first-user readiness packet that preserves unresolved external evidence as explicit caveats rather than broadening runtime scope; v1.2 shipped on 2026-05-22 with the Project Manager Web workflow; v1.3 shipped on 2026-05-29 with Copilot-linked execution traceability, board-level project management, terminal workspace context, provider setup clarity, and open-source readiness; v1.4 shipped on 2026-05-29 with a canonical external evidence registry and closeout matrix. v1.5 turns that evidence posture into an operator-run first-user trial loop, completed an operator dry-run on the current host, fixed the source fallback env override support gap found by that dry-run, added machine validation for the trial feedback intake contract, removed browser-token fallback guidance from the first-user runbook, added a local feedback draft helper, added a local packet audit that keeps incomplete or unsafe Markdown packets out of maintainer triage, added a gate registry drift guard, extended the intake validator to keep the first-user checklist aligned with runbook/template/issue-form/audit/gate instructions, added a read-only GitHub issue route preflight for follow-up issues #3, #4, and #5, added a readiness preflight bundle that runs the trial intake, issue-route, and gate-registry checks together, and added a read-only GitHub issue-form feedback audit path.

## Current Milestone

v1.5 First-User Trial Operations has completed its foundation phase, an
operator dry-run, the source fallback env override fix, trial feedback intake
contract validation, tokenless runbook diagnostics guidance, a local feedback
draft helper, a local feedback packet audit, and an external evidence gate
drift guard. The trial checklist is now covered by the same intake validation
loop, the existing GitHub follow-up issue routes have a read-only preflight
command, and maintainers can run a combined readiness preflight before a real
collection round. GitHub issue-form feedback can now be audited directly before
triage. The remaining work is real first-user trial packet collection and
maintainer triage.

**Last shipped:** v1.4 External Evidence Closure on 2026-05-29.

**Current milestone goal:** Make first-user trial execution auditable: run the local-first trial, collect redacted evidence, route feedback, and decide whether each result clears a gate, remains a caveat/blocker, or becomes a follow-up defect.

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
- [x] v1.4 creates a canonical external evidence gate registry before any preserved caveat can be cleared.
- [x] v1.4 records live provider evidence with disposable credential/model metadata or a precise blocker.
- [x] v1.4 records Feishu developer-console callback evidence with public HTTPS routing or a precise blocker.
- [x] v1.4 records physical Windows/WSL terminal evidence from a real host or a precise blocker.
- [x] v1.4 maps completed first-user feedback into severity, owner, disposition, and follow-up routing, or keeps the missing packet as a caveat.
- [x] v1.4 publishes a release closeout matrix that keeps any remaining external gaps visible.
- [x] v1.5 validates first-user trial intake materials across runbook,
  checklist, feedback template, and GitHub issue form without treating
  templates as completed first-user evidence.
- [x] v1.5 validates GitHub follow-up issue routes #3, #4, and #5 without
  treating issue availability as completed first-user evidence.
- [x] v1.5 validates trial readiness across intake materials, issue routes,
  and external gate registry without treating readiness as completed first-user
  evidence.
- [x] v1.5 audits GitHub issue-form feedback without treating an issue audit
  pass as external gate clearance.

### Active

- [x] v1.5 selects First-User Trial Operations as the next milestone without expanding runtime authority.
- [x] v1.5 defines a minimum first-user trial packet with affected surface, severity, owner, disposition, environment, reproduction, diagnostics status, follow-up route, and redaction review.
- [x] v1.5 routes trial outcomes through the existing external evidence registry, trial feedback docs, GitHub issue template, and follow-up issue/report destinations.
- [x] v1.5 preserves `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and `FIRST-USER-FEEDBACK` states until registry-required artifacts exist.
- [x] v1.5 keeps first-user guidance secret-safe and avoids raw evidence blob storage.
- [x] v1.5 operator dry-run records current-host dependency/startup/provider-smoke evidence without pretending it is first-user feedback.
- [x] v1.5 source fallback scripts preserve command-prefix env overrides while still loading repository root `.env`.
- [x] v1.5 trial feedback issue form and Markdown template are machine-validated for required packet fields, routing, and safety language.
- [x] v1.5 first-user runbook diagnostics guidance uses Web Settings export and rejects browser-token/devtools fallback wording.
- [x] v1.5 local feedback draft helper pre-fills bounded metadata without collecting raw evidence or clearing gates.
- [x] v1.5 local feedback packet audit rejects generated drafts, placeholders, missing required fields, and obvious secret-like content before maintainer triage.
- [x] v1.5 external evidence gate registry is machine-validated against accidental status drift.
- [x] v1.5 readiness preflight aggregates trial intake, issue-route, and gate
  registry checks for maintainers before a real collection round.
- [x] v1.5 GitHub issue-form feedback audit reuses the local packet audit for
  issue bodies before maintainer triage.

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
- External evidence caveats remain tracked in the readiness reports and gate
  registry and should not be silently reclassified during v1.5.
- Phase 18 reran `pnpm smoke:copilot-provider`; no disposable provider credential was available, so `LIVE-PROVIDER` remains `Caveat` with `missing_provider_credential`.
- Phase 19 reran Feishu CLI preflight, `pnpm smoke:feishu-public-webhook`, Feishu/Copilot regression, and Gateway typecheck. Bot CLI preflight and local regression passed, but `FEISHU-CALLBACK` remains `Blocked` because no public HTTPS Gateway route, operator webhook setup environment, or Feishu developer-console URL verification action was available.
- Phase 20 closed v1.4 with `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`; `WINDOWS-WSL` and `FIRST-USER-FEEDBACK` remain `Caveat` because no real WSL host or completed feedback packet was available.
- v1.5 selected First-User Trial Operations. Phase 21 defined the trial packet,
  evidence routing, and verification loop; updated feedback intake docs; and
  preserved all external gate states. The next task is collecting a real
  first-user trial packet.
- Phase 22 ran a maintainer/operator dry-run on the current host. It recorded
  Linux `not_wsl`, usable tmux-backed local dependencies, healthy Gateway/Web
  source startup on loopback, provider smoke skipped with
  `missing_provider_credential`, and a source-startup `.env` override
  docs/support gap. It did not clear any external gate.
- Phase 23 fixed the source-startup `.env` override support gap with
  `scripts/run-with-root-env.mjs`, Gateway/Web package script wiring, CI
  harness coverage, runbook/smoke/troubleshooting docs, and real Gateway/Web
  command-prefix smoke evidence.
- Phase 24 added `scripts/validate-trial-feedback-intake.mjs` and CI harness
  coverage so the first-user trial feedback issue form and Markdown template
  cannot silently drop required fields, triage routing, or redaction language.
  It did not clear `FIRST-USER-FEEDBACK` because no completed first-user packet
  was collected.
- Phase 25 extended the intake validator to cover `docs/TRIAL-RUNBOOK.md` and
  replaced first-user browser-token diagnostics fallback with Web Settings
  diagnostics export plus maintainer-only local API fallback wording. It did
  not clear `FIRST-USER-FEEDBACK`.
- Phase 26 added `pnpm trial:feedback-draft`, a local Markdown draft helper
  that pre-fills bounded local metadata and leaves evidence, triage, and
  redaction fields for humans. It did not clear `FIRST-USER-FEEDBACK`.
- Phase 27 added `pnpm trial:feedback-audit`, a local Markdown packet audit
  that rejects generated drafts, placeholder content, missing required fields,
  and obvious secret-like content before maintainer triage. It does not clear
  `FIRST-USER-FEEDBACK`.
- Phase 28 added `pnpm evidence:gates-validate`, a registry validator that
  keeps external gate rows, current Caveat/Blocked states, and concrete rerun
  anchors from drifting without reviewed source changes. It does not clear any
  external gate.
- Phase 29 added `pnpm trial:intake-validate`, extending the trial intake
  validator to cover `docs/TRIAL-CHECKLIST.md` so checklist edits cannot drop
  audit commands, gate-routing commands, redaction review, or browser-token
  safety boundaries. It does not clear any external gate.
- Phase 30 added `pnpm trial:issue-routes-validate`, a read-only GitHub CLI
  preflight that checks issue #3, #4, and #5 are open and mapped to expected
  trial routes. The live preflight passed and returned
  `gateClearingEvidence: false`.
- Phase 31 added `pnpm trial:readiness-validate`, a read-only aggregate
  preflight that runs trial intake, issue-route, and external gate registry
  validators together. The live preflight passed and returned
  `gateClearingEvidence: false`.
- Phase 32 added `pnpm trial:feedback-issue-audit -- --issue=<number>`, a
  read-only GitHub issue-form feedback audit that maps issue bodies into the
  existing packet audit. The command rejects tracker issue #5 as incomplete
  feedback and returns `gateClearingEvidence: false`.
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
| Close external evidence before expanding scope | Open-source readiness exposes the repository, but live provider, Windows/WSL, Feishu callback, and first-user feedback still need real artifacts | Shipped in v1.4 as truthful caveat/blocker closeout |
| Operationalize first-user trial before runtime expansion | The remaining risk is evidence collection and user feedback routing, not another broad runtime surface | Selected for v1.5 |
| Run operator dry-run before real first-user collection | Maintainers should prove the collection loop, redaction boundary, and startup path are understandable before asking a real user for feedback | Good - Phase 22 recorded bounded evidence and one docs/support gap |
| Preserve command-prefix env over root `.env` in source fallback | Operators need disposable state for trial/smoke runs without editing or leaking local `.env` | Good - Phase 23 added a preserving env runner and real startup proof |
| Validate trial feedback intake before collection | Required fields and redaction guidance should not drift before real first users submit packets | Good - Phase 24 added contract tests and CI harness coverage without clearing gates |
| Keep first-user diagnostics tokenless | Asking first users to retrieve browser tokens is a support and security liability | Good - Phase 25 moved the runbook to Settings export and validator coverage |
| Generate feedback drafts without collecting evidence | Drafts reduce first-user friction but must not become false gate evidence | Good - Phase 26 adds bounded draft generation and explicit caveat language |
| Audit feedback packets before maintainer triage | Completed Markdown packets need a local completeness and redaction check before they are treated as actionable intake | Good - Phase 27 rejects drafts, placeholders, missing fields, and obvious secret-like content while keeping gate clearance manual |
| Validate external gate registry drift | Gate status changes should be deliberate and reviewable because CI-green, templates, and local checks do not clear external evidence | Good - Phase 28 adds a validator for exact gate states and rerun anchors |
| Validate trial checklist drift | The checklist is the first-user entry point and must not silently drop audit, gate-routing, or safety instructions | Good - Phase 29 folds checklist validation into the existing intake contract |
| Validate trial issue routes | First-user trial feedback needs live follow-up issue destinations that remain open and correctly labeled | Good - Phase 30 adds a read-only preflight and mocked CI coverage |
| Validate trial readiness | Maintainers need one command that proves local intake, issue routes, and gate registry are aligned before a real collection round | Good - Phase 31 adds a read-only aggregate preflight with mocked CI coverage |
| Audit GitHub issue-form feedback | Maintainers need to apply the same packet audit to filed GitHub issue feedback without copy/paste or issue mutation | Good - Phase 32 adds a read-only issue audit with mocked CI coverage |

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
*Last updated: 2026-05-29 after completing Phase 32 Trial Feedback Issue Audit.*
