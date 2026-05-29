# Phase 8: First-User Readiness Packet - Patterns

**Generated:** 2026-05-21T17:52:00+08:00
**Status:** Ready for planning

## Scope

Phase 8 touches first-user trial documentation, support diagnostics guidance, v1.1 closeout reporting, and GSD planning metadata. The closest patterns are Phase 6/7 evidence reports, the existing trial feedback issue/template pair, and the diagnostics export contract.

## File Pattern Map

| Target | Role | Closest Existing Analog | Pattern To Preserve |
|--------|------|-------------------------|---------------------|
| `docs/TRIAL-CHECKLIST.md` | First-user runnable trial path | Existing checklist plus `docs/SMOKE-TEST.md` | Keep a concrete checklist, but put first-user `Quick Smoke` first and move maintainer-only detail into an `Evidence Appendix`. Preserve no-secret warnings and pass/caveat/blocked wording. |
| `docs/SUPPORT-DIAGNOSTICS.md` | Unified support diagnostics packet | `docs/TRIAL-FEEDBACK.md`, `docs/SMOKE-TEST.md`, `docs/API.md` Diagnostics section | Organize by provider, runtime/terminal, and Feishu. For each section list exact commands, expected artifacts, redaction rules, and escalation boundary. |
| `docs/reports/v1.1-readiness-closeout-2026-05-21.md` | Phase 8/v1.1 readiness closeout | `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`, `docs/reports/beta-handoff-2026-05-10.md` | Use user-visible `Pass`, `Caveat`, and `Blocked` rows with owner, clearing condition, artifact, and next route. Do not remove caveats without real evidence. |
| `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` | Existing evidence source of truth | Current Phase 6/7 matrix | Add Phase 8 closeout/readiness references without reclassifying Phase 6/7 rows unless new evidence exists. |
| `docs/TRIAL-FEEDBACK.md` | Offline feedback packet template | Existing template and GitHub issue form | Prefer no structural rewrite unless the checklist/support packet needs a link or wording alignment. Keep required environment, reproduction, triage, and safety fields. |
| `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` | Structured feedback collection path | Existing issue form | Prefer no changes unless execution finds a missing field required by BETA-03. The current form already captures result, environment, core path, Copilot, severity, diagnostics, reproduction, and safety confirmation. |
| `.planning/REQUIREMENTS.md` | Requirement status | Phase 6/7 completed status updates | Mark Phase 8 requirements complete only after docs are created and caveats are routed honestly. |
| `.planning/ROADMAP.md` | Phase plan/progress annotations | Existing Phase 6/7 plan rows and dependency notes | Update plan checkboxes and wave status through GSD commands or narrow edits after planning/execution. |
| `.planning/STATE.md` | Session/progress state | Existing Phase 7/8 state records | Record ready-to-execute after planning and later complete/verify state through GSD workflow commands. |

## Command Patterns

- Whitespace check: `git diff --check`.
- Decision coverage: `gsd-sdk query check.decision-coverage-plan .planning/phases/OF-08-first-user-readiness-packet .planning/phases/OF-08-first-user-readiness-packet/08-CONTEXT.md`.
- Trial/checklist heading check: `rg -n "Quick Smoke|Evidence Appendix|docs/TRIAL-FEEDBACK.md|OpenForge first-user trial feedback" docs/TRIAL-CHECKLIST.md`.
- Support diagnostics check: `rg -n "provider|runtime|terminal|Feishu|diagnostics/export|openforge doctor|pnpm smoke:copilot-provider|pnpm smoke:feishu-public-webhook|lark-cli auth status --verify|lark-cli doctor" docs/SUPPORT-DIAGNOSTICS.md`.
- Closeout caveat check: `rg -n "live provider|Windows/WSL|Feishu developer-console callback|first-user feedback|owner|clearing condition|backlog|issue|Caveat|Blocked|Pass" docs/reports/v1.1-readiness-closeout-2026-05-21.md`.
- Redaction scan shape: targeted `rg` over modified Phase 8 docs for `sk-`, `Bearer `, `Authorization: Bearer`, `OPENFORGE_MASTER_KEY=`, `OPENFORGE_JWT_SECRET=`, `OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY=`, `OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`, `APP_SECRET`, `verification token`, `event encrypt key`, `raw provider request`, `raw provider response`, `raw callback body`, `openforge.token`, and private-key headers.

## Planning Constraints

- Use `docs/TRIAL-CHECKLIST.md` as the first-user entry point; do not create a competing trial runbook unless execution finds an unavoidable need.
- Use `docs/SUPPORT-DIAGNOSTICS.md` as the unified diagnostics packet unless execution can prove an existing doc already satisfies D-08 through D-11.
- Use `docs/reports/v1.1-readiness-closeout-2026-05-21.md` for user-visible closeout caveats and backlog routing.
- Preserve current evidence facts from Phase 6 and Phase 7. Live provider and physical Windows/WSL remain caveats; Feishu developer-console callback remains blocked until real callback evidence exists.
- First-user feedback remains caveated until a real feedback issue or redacted Markdown packet is attached or linked.
- No Phase 8 support/trial/closeout artifact may instruct users to paste raw provider keys, Feishu app secrets, JWTs, browser auth token values, sensitive terminal transcripts, or raw provider/callback bodies.
