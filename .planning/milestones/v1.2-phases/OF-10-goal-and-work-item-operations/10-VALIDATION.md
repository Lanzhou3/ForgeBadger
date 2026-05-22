---
phase: 10
slug: goal-and-work-item-operations
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-22
---

# Phase 10 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Vitest for Web API/client-component coverage; Playwright for Web E2E route-contract coverage |
| Config file | `packages/web/vitest.config.ts`, `packages/web/playwright.config.ts` |
| Quick run command | `pnpm --dir packages/web run typecheck` and focused Vitest/E2E command for the touched slice |
| Full suite command | `pnpm --dir packages/web run typecheck`, `pnpm --dir packages/web exec vitest run src/lib/api.test.ts`, and `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` |
| Estimated runtime | ~90-240 seconds depending on local Web server startup |

---

## Sampling Rate

- After every task commit: run `pnpm --dir packages/web run typecheck` plus the
  narrow Vitest or Playwright command tied to the changed behavior.
- After every plan wave: run the plan's full verification command set.
- Before `$gsd-verify-work`: run the full suite command set, `git diff --check`,
  and `gsd-sdk query verify.schema-drift 10`.
- Max feedback latency: one task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | PMUX-02 | T-10-01, T-10-02 | Goal form normalizes arrays, uses Gateway client, and surfaces server errors without client-side authority drift | component/e2e | `pnpm --dir packages/web run typecheck` and `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` | planned | pending |
| 10-01-02 | 01 | 1 | PMUX-02 | T-10-02 | Goal update refetches persisted data and preserves tab-scoped loading/error behavior | e2e | `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` | planned | pending |
| 10-02-01 | 02 | 2 | PMUX-03 | T-10-03 | Work item list uses bounded Gateway status query rather than unbounded client filtering | unit/e2e | `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` and project-manager Playwright test | yes | pending |
| 10-02-02 | 02 | 2 | PMUX-03 | T-10-04 | Work item inspection remains in project context and exposes safe fields/counts only | e2e | `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` | planned | pending |
| 10-02-03 | 02 | 2 | PMUX-04 | T-10-05, T-10-06 | Work item creation accepts bounded fields and prevents raw evidence/blob intake | e2e/static | `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` and `rg -n "textarea|evidenceRefs|manualCompletionReason" packages/web/src/components/projects/ProjectManagerPanel.tsx` | planned | pending |
| 10-03-01 | 03 | 3 | PMUX-05 | T-10-07 | Status actions are derived from allowed transition map and do not show known-invalid moves | unit/e2e | `pnpm --dir packages/web run typecheck` and project-manager Playwright test | planned | pending |
| 10-03-02 | 03 | 3 | PMUX-05 | T-10-08 | Evidence-free `done` requires a non-empty manual completion reason before mutation | e2e | `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` | planned | pending |

*Status: pending, green, red, or flaky.*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- `packages/web/src/lib/api.test.ts` already exists for focused client tests.
- `packages/web/e2e/project-manager.spec.ts` already exists for strict
  route-contract E2E tests.
- No new test framework installation is part of Phase 10.

---

## Manual-Only Verifications

All Phase 10 acceptance behaviors have automated verification paths. A
maintainer may still perform an optional visual review of the Project Manager
tab after UI-SPEC implementation, but that is not the only acceptance path.

---

## Validation Sign-Off

- [x] All anticipated tasks have automated verification or existing
  infrastructure.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency is one task.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-22
