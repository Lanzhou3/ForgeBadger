---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: First-User Trial Operations
status: phase_complete
stopped_at: Phase 31 trial readiness preflight bundle complete; real first-user packet collection pending
last_updated: 2026-05-29T07:45:00+08:00
last_activity: 2026-05-29
progress:
  total_phases: 11
  completed_phases: 11
  total_plans: 11
  completed_plans: 11
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-29)

**Core value:** Developers can reliably control and recover local AI CLI coding sessions from a browser while release claims stay backed by concrete, redacted external evidence.
**Current focus:** Phase 31 added a read-only trial readiness preflight bundle that runs intake, issue-route, and gate-registry checks together. The next concrete step is collecting a real first-user trial packet through the validated runbook, checklist, template, issue form, draft helper, readiness preflight, audit helper, and gate validator while preserving v1.4 external gate states until real artifacts exist.

## Current Position

Phase: 31. Trial Readiness Preflight Bundle
Plan: 31-01 complete
Status: Phase Complete
Last activity: 2026-05-29

## Performance Metrics

**Velocity:**

- Total plans completed: 43
- Average duration: n/a
- Total execution time: n/a

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Beta Evidence Closure | 4/4 | 54min | 13.5min |
| 2. Public Feishu Webhook Safety | 2/2 | 67min | 33.5min |
| 3. First-User Product Hardening | 4/4 | - | - |
| 4. Feishu Project Manager Ledger | 2/2 | - | - |
| 5. Remote Execution Architecture | 1/1 | - | - |
| 6. Live Provider and Platform Smoke Evidence | 2/2 | - | - |
| 7. Feishu Live Callback Readiness | 2/2 | - | - |
| 8. First-User Readiness Packet | 2/2 | - | - |
| 9. Project Manager Web Foundation | 2/2 | - | - |
| 10. Goal And Work Item Operations | 3/3 | - | - |
| 11. Evidence, Ledger, And Acceptance Gates | 3/3 | - | - |
| 12. Copilot Project-Manager Traceability | 4/4 | - | - |
| 13. Project Manager Board Workflow | 3/3 | - | - |
| 14. Terminal Workspace Context | 3/3 | - | - |
| 15. Model Provider Setup And Health | 3/3 | - | - |
| 16. Open Source Readiness Packet | 1/1 | - | - |
| 17. External Evidence Registry | 1/1 | - | - |
| 18. Live Provider Evidence Rerun | 1/1 | - | - |
| 19. Feishu Public Callback Evidence | 1/1 | - | - |
| 20. Platform And First-User Acceptance Closure | 1/1 | - | - |
| 21. First-User Trial Operations | 1/1 | - | - |
| 22. Operator Trial Dry Run | 1/1 | - | - |
| 23. Source Env Override Preservation | 1/1 | - | - |
| 24. Trial Feedback Intake Contract | 1/1 | - | - |
| 25. Tokenless Trial Diagnostics | 1/1 | - | - |
| 26. Trial Feedback Draft Generator | 1/1 | - | - |
| 27. Trial Feedback Packet Audit | 1/1 | - | - |
| 28. External Evidence Gate Drift Guard | 1/1 | - | - |
| 29. Trial Materials Consistency Guard | 1/1 | - | - |
| 30. Trial Issue Route Preflight | 1/1 | - | - |
| 31. Trial Readiness Preflight Bundle | 1/1 | - | - |

## Accumulated Context

### Decisions

Decisions are logged in `.planning/PROJECT.md` and `.planning/DECISIONS-INDEX.md`.
Recent decisions affecting current work:

- Keep the local-first AI CLI control plane as the product wedge.
- Close external evidence before expanding remote/autonomous features.
- Keep Codex app-server prompt/turn input disabled by default.
- Treat Feishu as a controlled Copilot collaboration channel, not execution authority.
- Treat AI-native project management as execution traceability, not a generic PM suite.
- [Milestone v1.3]: Copilot, Feishu, and model output may propose Project Manager writes only through explicit pending-action approval; Gateway remains the authority.
- [Phase 14]: Workspace context file reads stay bounded UTF-8 previews and reject traversal, absolute paths, binary files, and symbolic links; raw file content is not persisted as project-manager evidence.
- [Phase 15]: Gateway model-provider readiness is a structured, tenant-scoped contract with actionable codes and Codex subscription-managed isolation.
- [Phase 16]: Open-source readiness is complete with MIT rationale, root contribution/security entry points, safe GitHub issue routing, and caveat-preserving closeout.
- [Milestone v1.4]: External evidence closure must create a single evidence gate registry before any preserved caveat can be reclassified as `Pass`.
- [Phase 17]: `docs/EXTERNAL-EVIDENCE-GATES.md` is the canonical registry for `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and `FIRST-USER-FEEDBACK`; mocked tests, docs, and empty templates do not clear those gates.
- [Phase 18]: `pnpm smoke:copilot-provider` rerun produced redacted skipped JSON with `missing_provider_credential`; `LIVE-PROVIDER` remains `Caveat`, not `Pass`.
- [Phase 19]: Feishu CLI bot preflight and endpoint checks passed, and Feishu/Copilot boundary regression passed 183 tests, but `FEISHU-CALLBACK` remains `Blocked` because no public HTTPS Gateway route, operator webhook setup environment, or Feishu developer-console URL verification action was available.
- [Phase 20]: v1.4 closeout records current host as Linux `not_wsl`, keeps `WINDOWS-WSL` as `Caveat`, keeps `FIRST-USER-FEEDBACK` as `Caveat` because no completed feedback packet is attached, and publishes `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`.
- [Milestone v1.5]: First-user trial operations is the next milestone. It operationalizes real trial evidence and feedback collection before remote/runtime expansion.
- [Phase 21]: The minimum first-user trial packet must capture affected surface, severity, owner, disposition or next action, environment summary, reproduction detail, diagnostics status, follow-up route or no-action rationale, and redaction review. Phase 21 also updates `docs/TRIAL-FEEDBACK.md` and the GitHub issue template to remove first-user browser-token fallback and replace raw log/output requests with bounded summaries.
- [Phase 22]: Operator dry-run records the current host as Linux `not_wsl`, dependency checks as usable for local tmux terminals, Gateway/Web loopback startup as healthy, provider smoke as skipped with `missing_provider_credential`, and source dev-script `.env` override behavior as a docs/support gap. It does not clear `FIRST-USER-FEEDBACK` or any other external gate.
- [Phase 23]: Source fallback Gateway/Web scripts now load root `.env` through `scripts/run-with-root-env.mjs`, preserving command-prefix env values over `.env`. Red/green tests, CI script harness coverage, Gateway `OPENFORGE_DB_PATH` prefix smoke, and Web `OPENFORGE_WEB_PORT` prefix smoke passed. External gates remain unchanged.
- [Phase 24]: First-user trial feedback intake is now a machine-verified contract through `scripts/validate-trial-feedback-intake.mjs`, covering required issue-form fields/types/options, Markdown sections, triage routing, redaction language, and unsafe raw-evidence wording. CI script harness coverage includes the validator. External gates remain unchanged.
- [Phase 25]: The first-user runbook no longer asks users to retrieve browser auth tokens from developer tools. Diagnostics guidance now uses Settings -> Export diagnostics JSON, with local API fallback labeled maintainer-only, and the validator rejects token fallback wording. External gates remain unchanged.
- [Phase 26]: `pnpm trial:feedback-draft` generates a local Markdown draft with bounded metadata, redacts token-shaped values, and explicitly states the draft is not submitted, not reviewed, and not gate-clearing evidence. External gates remain unchanged.
- [Phase 27]: `pnpm trial:feedback-audit` rejects generated drafts, placeholder-only packets, missing required fields, and obvious secret-like content before maintainer triage. Passing audit means ready for maintainer triage only; `gateClearingEvidence` remains false and external gates remain unchanged.
- [Phase 28]: `pnpm evidence:gates-validate` verifies the external evidence registry keeps required gate rows, exact current states, and concrete rerun/target anchors. External gates remain unchanged.
- [Phase 29]: `pnpm trial:intake-validate` verifies the trial runbook, checklist, feedback template, and GitHub issue form remain aligned on audit commands, gate-routing commands, redaction review, and browser-token safety boundaries. External gates remain unchanged.
- [Phase 30]: `pnpm trial:issue-routes-validate` verifies GitHub issue #3, #4, and #5 are readable, open, and mapped to their expected route titles/labels. The live preflight passed and returned `gateClearingEvidence: false`. External gates remain unchanged.
- [Phase 31]: `pnpm trial:readiness-validate` aggregates trial intake, issue-route, and external gate registry validators. The live preflight passed and returned `gateClearingEvidence: false`. External gates remain unchanged.

### Pending Todos

Next steps:

- Collect a real first-user trial packet through the validated runbook, template, issue form, or draft helper.
- Run `pnpm trial:intake-validate` after changing trial intake materials.
- Run `pnpm trial:issue-routes-validate` before routing a real collection round to the existing GitHub follow-up issues.
- Run `pnpm trial:readiness-validate` before starting a real first-user collection round.
- Run `pnpm trial:feedback-audit -- <packet.md>` before maintainer triage of any completed Markdown packet.
- Run `pnpm evidence:gates-validate` before changing any external gate registry state.
- Use the v1.5 trial-operations loop for the next real first-user trial packet.
- Prepare Feishu developer-console callback evidence only when public HTTPS Gateway routing is available.
- Collect physical Windows/WSL and first-user feedback evidence when those external environments/users are available.
- Rerun live provider evidence only after a disposable provider credential and explicit model id are available.

### Blockers/Concerns

- Live Copilot provider evidence remains `Caveat` until a disposable provider credential and explicit model id are available; Phase 18 produced a safe skipped result, not a live pass.
- Physical Windows/WSL evidence remains `Caveat` until a real Windows/WSL host completes the terminal checklist.
- Completed first-user feedback remains `Caveat` until attached and mapped.
- Public Feishu webhook live exposure still needs real developer-console HTTP callback verification; Phase 19 records usable bot CLI preflight and passing local regression, but the missing public HTTPS URL, webhook setup environment, and Feishu console URL verification action remain blockers.
- Remote execution remains architecture-only until a separate implementation milestone is planned.
- `upload_img/` remains unrelated untracked local data and must stay out of commits unless the user explicitly says otherwise.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Remote execution | SSH/remote execution implementation | Separate architecture phase | GSD bootstrap |
| Codex app-server | Web prompt/turn input | Disabled until transcript/security design | GSD bootstrap |
| Feishu | Free-form approvals and terminal input | Out of scope | GSD bootstrap |
| Feishu | Encrypted event payload decrypt support | Future security-reviewed phase | v1.4 planning |
| Feishu | Shared replay/rate store for multi-instance deployment | Future deployment-hardening phase | v1.4 planning |

## Session Continuity

Last session: 2026-05-29T07:45:00+08:00
Stopped at: Phase 31 trial readiness preflight bundle complete; real first-user packet collection pending
Resume file: None

## Operator Next Steps

- Collect a real first-user trial packet through the validated tokenless runbook, checklist, intake contract, draft helper, readiness preflight, packet audit helper, and external gate validator, then triage it through the v1.5 operating loop and the external evidence gate registry.
