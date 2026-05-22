---
phase: 09
slug: project-manager-web-foundation
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-21
---

# Phase 09 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Vitest for Web API client tests; Playwright for Web E2E |
| Config file | `packages/web/vitest.config.ts`, `packages/web/playwright.config.ts` |
| Quick run command | `pnpm --dir packages/web vitest run src/lib/api.test.ts` |
| Full suite command | `pnpm --dir packages/web vitest run src/lib/api.test.ts` and `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` |
| Estimated runtime | ~60-180 seconds depending on local Web server startup |

---

## Sampling Rate

- After every task commit: run the quick Vitest API client command when `api.ts`
  or `api.test.ts` changed.
- After every plan wave: run the plan's full verification command set.
- Before `$gsd-verify-work`: run the full suite command and `git diff --check`.
- Max feedback latency: one task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | PMAPI-01 | T-09-01, T-09-02, T-09-03 | Client uses Gateway envelope helpers, encodes IDs, and exposes bounded DTOs only | unit/static | `pnpm --dir packages/web vitest run src/lib/api.test.ts` | yes | pending |
| 09-01-02 | 01 | 1 | PMAPI-01, PMAPI-02 | T-09-03 | Tests fail on wrong method, body, route, query params, or error propagation | unit | `pnpm --dir packages/web vitest run src/lib/api.test.ts` | yes | pending |
| 09-02-01 | 02 | 2 | PMUX-01, PMAPI-02 | T-09-04, T-09-05, T-09-06 | Tab renders project-manager state with visible loading, empty, not-found, and error states | e2e | `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` | planned | pending |
| 09-02-02 | 02 | 2 | PMUX-01, PMAPI-02 | T-09-04, T-09-06 | Strict mocks fail unknown project-manager routes instead of returning generic success | e2e | `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` | planned | pending |

*Status: pending, green, red, or flaky.*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- `packages/web/src/lib/api.test.ts` already exists for focused client tests.
- `packages/web/e2e` already exists for Playwright E2E tests.
- No test framework installation is part of Phase 9.

---

## Manual-Only Verifications

All Phase 9 behaviors have automated verification paths. A maintainer may still
perform an optional visual review of the Project Manager tab after E2E passes,
but that is not the only acceptance path.

---

## Validation Sign-Off

- [x] All tasks have automated verification or existing infrastructure.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency is one task.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-21
