---
phase: 11
slug: evidence-ledger-and-acceptance-gates
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-22
updated: 2026-05-22T15:15:28+08:00
---

# Phase 11 - Validation Strategy

Per-phase validation contract for bounded evidence attachment, safe ledger
review, and v1.2 acceptance handoff.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Vitest for Web API client coverage; Playwright for Project Manager E2E coverage |
| Config file | `packages/web/vitest.config.ts`, `packages/web/playwright.config.ts` |
| Quick run command | `pnpm --dir packages/web run typecheck` plus the focused Vitest or Playwright command for the touched slice |
| Full suite command | `pnpm --dir packages/web run typecheck`, `pnpm --dir packages/web exec vitest run src/lib/api.test.ts`, and `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` |
| Estimated runtime | ~90-300 seconds depending on local Playwright server startup |

## Sampling Rate

- After every task commit: run `pnpm --dir packages/web run typecheck` plus
  the narrow command tied to the changed behavior.
- After every plan wave: run the plan's verification command set.
- Before `$gsd-verify-work`: run the full suite command set, `git diff --check`,
  and `gsd-sdk query verify.schema-drift 11`.
- Max feedback latency: one task.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | PMEV-01 | T-11-01, T-11-02 | Evidence form exposes only bounded fields and blocks obvious unsafe raw/secret values before submit | type/e2e | `pnpm --dir packages/web run typecheck` and Project Manager Playwright evidence test | yes | covered |
| 11-01-02 | 01 | 1 | PMEV-01, PMQA-01 | T-11-03 | Evidence attach uses exact typed client route and preserves recoverable Sheet state on failure | vitest/e2e | `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` and Project Manager Playwright evidence failure test | yes | covered |
| 11-02-01 | 02 | 2 | PMEV-02, PMEV-03 | T-11-04, T-11-05 | Ledger timeline renders safe event markers, counts, status, timestamps, and short static explanations only | type/e2e | `pnpm --dir packages/web run typecheck` and Project Manager Playwright ledger test | yes | covered |
| 11-02-02 | 02 | 2 | PMEV-02, PMQA-01 | T-11-06 | Ledger load failure is scoped to ledger area and strict mock catches endpoint drift | e2e | `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` | yes | covered |
| 11-03-01 | 03 | 3 | PMQA-01 | T-11-07 | Full v1.2 happy path proves goal/work-item/evidence/status/ledger workflow under strict mocks | e2e | `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` | yes | covered |
| 11-03-02 | 03 | 3 | PMQA-02 | T-11-08 | Trial/support/closeout docs state forbidden content and acceptable reference examples without secrets | docs/static | `rg -n "Project Manager|forbidden|acceptable evidence|raw terminal|provider payload" docs/TRIAL-CHECKLIST.md docs/SUPPORT-DIAGNOSTICS.md docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md` | yes | covered |

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- `packages/web/src/lib/api.test.ts` exists for typed client route tests.
- `packages/web/e2e/project-manager.spec.ts` exists for strict route-contract
  E2E tests.
- Local UI primitives needed by the planned UI already exist.
- No new test framework or Gateway schema push is required.

## Manual-Only Verifications

All Phase 11 acceptance behaviors have automated verification paths. A
maintainer may do optional visual review of the Project Manager tab, but visual
review is not the only acceptance path.

## Validation Sign-Off

- [x] All anticipated tasks have automated verification or existing
  infrastructure.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency is one task.
- [x] `nyquist_compliant: true` set in frontmatter.

Approval: approved 2026-05-22

## Validation Audit 2026-05-22

| Metric | Count |
|--------|-------|
| Requirements audited | 5 |
| Per-task checks | 6 |
| Automated covered | 6 |
| Manual-only | 0 |
| Gaps found | 0 |

Commands rerun during phase closure:

- `pnpm --dir packages/web run typecheck` - pass.
- `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` - pass, 46/46.
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - pass, 10/10.
- `gsd-sdk query verify.schema-drift 11` - pass, `drift_detected: false`.
- `rg -n "Project Manager Workflow|Project Manager Failures|v1.2 Project Manager|forbidden|acceptable evidence" docs/TRIAL-CHECKLIST.md docs/SUPPORT-DIAGNOSTICS.md docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md` - pass.
