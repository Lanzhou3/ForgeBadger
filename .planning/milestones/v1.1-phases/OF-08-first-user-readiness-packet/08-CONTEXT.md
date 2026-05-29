# Phase 8: First-User Readiness Packet - Context

**Gathered:** 2026-05-21T17:33:07+08:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 packages the v1.1 first-user readiness handoff. It turns the remaining first-user feedback, trial checklist, support diagnostics, and closeout caveats into maintainable documents that a maintainer and trial user can run without exposing secrets or mistaking missing real-world evidence for a pass.

This phase does not add runtime capabilities, Feishu authority, provider integrations, remote execution, project-manager Web UI, or new smoke infrastructure unless planning discovers a small documentation or script gap required to make the readiness packet runnable.

</domain>

<decisions>
## Implementation Decisions

### First-User Feedback Packet

- **D-01:** Completed first-user feedback is currently not present. Phase 8 must record this as an explicit `Caveat` or blocked evidence item, not substitute the existing feedback template as if real feedback had been collected.
- **D-02:** Feedback caveat owner is `maintainer/operator`.
- **D-03:** Accepted collection paths are the GitHub `OpenForge first-user trial feedback` issue form or a redacted Markdown packet following `docs/TRIAL-FEEDBACK.md`.
- **D-04:** The caveat can be cleared only when at least one complete real first-user feedback packet is attached or linked from the v1.1 closeout report with reproducible steps, affected surfaces, owner, severity, and mapped follow-up disposition.

### Trial Path Packaging

- **D-05:** `docs/TRIAL-CHECKLIST.md` should be reorganized around a short `Quick Smoke` path for first users plus an `Evidence Appendix` for deeper validation.
- **D-06:** The quick path must cover setup, dependency checks, provider readiness, terminal smoke, Copilot smoke, Feishu smoke when available, and feedback capture without making the first user parse every maintainer-only gate.
- **D-07:** The evidence appendix should preserve deeper maintainer details, manual evidence boundaries, diagnostics export expectations, Feishu live-callback status, provider caveats, and Windows/WSL caveats.

### Support Diagnostics Packet

- **D-08:** Phase 8 should produce one unified support diagnostics packet instead of three unrelated runbooks or checklist-only notes.
- **D-09:** The packet should be internally organized by provider failures, runtime/terminal failures, and Feishu failures.
- **D-10:** Each diagnostics section must include exact commands, expected artifacts, redaction guidance, and escalation boundaries.
- **D-11:** Diagnostics artifacts must not ask users to expose raw provider keys, Feishu app secrets, JWTs, plaintext credentials, provider request/response bodies, sensitive terminal output, or unrelated project secrets.

### v1.1 Closeout Risk Routing

- **D-12:** The v1.1 closeout report must include a user-visible caveat table plus backlog or issue routing.
- **D-13:** Remaining live-provider, physical Windows/WSL, Feishu real-console callback, and completed first-user feedback caveats must be stated explicitly with owner, clearing condition, current evidence status, and next route.
- **D-14:** The closeout report must not collapse caveats into ambiguous TODOs or imply first-user readiness gates passed when only templates, mocked tests, or local regression evidence exist.

### Agent Discretion

- The planner may decide whether the unified diagnostics packet is a new dedicated document or a first-class section in the v1.1 closeout/readiness report, as long as it is directly discoverable from the trial checklist and closeout report.
- The planner may decide exact heading names for `Quick Smoke` and `Evidence Appendix`, but the short first-user path and deeper evidence appendix must remain distinct.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope and Requirements

- `.planning/ROADMAP.md` — Phase 8 goal, dependencies, success criteria, and planned waves.
- `.planning/REQUIREMENTS.md` — BETA-03, READY-01, READY-02, and READY-03 requirements plus out-of-scope boundaries.
- `.planning/STATE.md` — Current v1.1 readiness status and remaining caveats.
- `.planning/MILESTONES.md` — v1.0 closure summary and known deferred evidence items.
- `.planning/RETROSPECTIVE.md` — Evidence-first lessons and caveat handling patterns from v1.0.

### Trial and Feedback Documents

- `docs/TRIAL-CHECKLIST.md` — Existing trial checklist to reorganize into quick path plus evidence appendix.
- `docs/TRIAL-FEEDBACK.md` — Required first-user feedback packet shape and redaction guidance.
- `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` — Structured GitHub feedback path referenced by the Markdown template.

### Evidence and Product Readiness Baselines

- `docs/reports/beta-handoff-2026-05-10.md` — Earlier beta handoff and prototype boundary baseline.
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md` — Copilot first-release product contract, residual gaps, and manual evidence caveats.
- `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` — Current v1.1 evidence matrix entry point from Phase 6.
- `.planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-CONTEXT.md` — Live provider, Windows/WSL, evidence matrix, and redaction decisions.
- `.planning/phases/OF-07-feishu-live-callback-readiness/07-CONTEXT.md` — Feishu real callback, deployment topology, encrypted payload, and authority-boundary decisions.

### Diagnostics and Smoke References

- `docs/SMOKE-TEST.md` — Maintainer smoke procedures and pass criteria.
- `docs/CI-CD-PLAN.md` — CI/core smoke, `gate-d`, tmux integration, and rerun rules.
- `docs/API.md` — Provider/Copilot/diagnostics/Feishu API contracts and public webhook caveats.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `docs/TRIAL-CHECKLIST.md`: existing checklist already covers account setup, project/config checks, Claude Code session, diagnostics, Copilot smoke, Feishu live callback readiness, and manual evidence boundaries.
- `docs/TRIAL-FEEDBACK.md`: existing feedback template already defines dependency versions, diagnostics export, reproduction steps, expected/actual behavior, triage, browser evidence, logs, and forbidden secret classes.
- `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`: current evidence matrix should remain the source for live-provider, Windows/WSL, CI, tmux, and Feishu caveat status.
- Gateway and Web diagnostics routes already exist and should be referenced rather than reinvented in Phase 8 docs.

### Established Patterns

- v1.1 evidence uses explicit `Pass`, `Caveat`, and `Blocked` states. Phase 8 must preserve that pattern.
- Green automated tests are not a substitute for real live-provider credentials, physical Windows/WSL evidence, real Feishu developer-console callbacks, or real first-user feedback.
- Feishu remains collaboration ingress only. Trial/support docs must not describe Feishu as terminal control, shell execution, or free-form approval authority.
- Evidence and support docs must record exact commands and artifact shapes while redacting secrets and sensitive output.

### Integration Points

- Update `docs/TRIAL-CHECKLIST.md` to provide the first-user quick path and move deeper maintainer evidence into an appendix.
- Update or create a support diagnostics packet that links from the trial checklist and closeout report.
- Create or update a v1.1 closeout report under `docs/reports/` that routes remaining risks to user-visible caveats and backlog/issue destinations.
- If requirement status changes, update `.planning/REQUIREMENTS.md` and `.planning/STATE.md` through the normal GSD execution and verification flow.

</code_context>

<specifics>
## Specific Ideas

- The feedback caveat should name the expected artifact shape: one complete GitHub feedback issue or redacted Markdown packet with reproducible steps, affected surfaces, severity, owner, and mapped follow-up disposition.
- The trial checklist should start with a concise path that a first user can complete, then link to an evidence appendix for maintainer-grade validation.
- The support packet should have three clear sections: provider, runtime/terminal, and Feishu. Each section should state what to collect, what success or failure looks like, what to redact, and when to escalate.
- The closeout report should make caveats readable by a first user or maintainer, not only by a developer reading internal planning files.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within Phase 8 scope.

</deferred>

---

*Phase: 8-First-User Readiness Packet*
*Context gathered: 2026-05-21T17:33:07+08:00*
