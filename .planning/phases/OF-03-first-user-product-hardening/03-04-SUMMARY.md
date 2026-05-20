---
phase: 03-first-user-product-hardening
plan: 04
subsystem: web-e2e
tags: [models-e2e, copilot-e2e, strict-mocks, selectors, secret-fixtures]

requires:
  - phase: 03-first-user-product-hardening
    provides: Copilot/provider recovery and stale run-detail coverage from 03-02
  - phase: 03-first-user-product-hardening
    provides: Trial feedback taxonomy from 03-03
provides:
  - Strict Models E2E `/api/v1/*` fallback matching Copilot's fail-fast mock contract
  - Selector cleanup for critical Copilot/provider assertions touched in Phase 3
  - Secret-like fixture cleanup for model provider credential preview values
  - Combined Models + Copilot browser verification evidence
affects: [phase-03, web-e2e, model-provider-tests, copilot-tests]

tech-stack:
  added: []
  patterns: [strict-api-mock-fallback, semantic-e2e-selectors, fake-nonsecret-fixtures]

key-files:
  created: []
  modified:
    - packages/web/e2e/models.spec.ts
    - packages/web/e2e/copilot.spec.ts

key-decisions:
  - "Models E2E now returns HTTP 404 for unhandled `/api/v1/*` routes instead of silently returning an empty success envelope."
  - "Critical Phase 3 provider blocker assertions use shorter semantic regex/accessibility selectors instead of long exact-copy selectors."
  - "Test credential previews avoid `sk-`-looking strings unless a redacted preview contract explicitly requires them."

patterns-established:
  - "Touched E2E mocks end with `{ code: 1, message: Unhandled mocked API route... }` and status 404."
  - "Copilot stale state ordering has browser coverage from 03-02 and remains part of the combined E2E suite."

requirements-completed:
  - UX-03
  - UX-05
  - UX-07

duration: 8 min
completed: 2026-05-20
---

# Phase 03 Plan 04: Web E2E Contract Hardening Summary

**Web E2E mocks now fail fast on unhandled model-provider API routes, and critical Copilot/provider assertions are less brittle.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-20T22:17:00+08:00
- **Completed:** 2026-05-20T22:21:30+08:00
- **Tasks:** 4
- **Files modified:** 2

## Accomplishments

- Replaced the permissive `mockModelsApis()` fallback with a strict HTTP 404 route error.
- Removed the remaining `hasText` filter matched by the Phase 3 selector audit in touched Copilot E2E scope.
- Shortened Phase 3 provider readiness assertions from long exact copy to semantic regex checks while preserving the Models link and disabled-send assertions.
- Replaced the `sk-`-looking model-provider `secretPreview` fixture with a clearly fake redacted value.
- Re-ran the combined Models + Copilot Playwright suite under the strict fallback.

## Task Commits

1. **Task 1-4: Web E2E contract hardening** - `f87d4e7` (test)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `packages/web/e2e/models.spec.ts` - Adds strict unhandled-route fallback and non-secret credential preview fixture.
- `packages/web/e2e/copilot.spec.ts` - Keeps strict fallback, uses less brittle Phase 3 provider assertions, and removes the remaining `hasText` selector audit hit.

## Decisions Made

- The strict fallback pattern should stay consistent across touched Web E2E specs so contract drift fails the browser test that introduced it.
- The `plaintextSecret` request body field remains asserted because it is the API contract; the value is a fake `test-minimax-token`, not a live-looking key.

## Deviations from Plan

- No new `packages/web/src/lib/copilot.test.ts` changes were needed in 03-04 because 03-02 had already added helper-level ordering tests and browser stale run-detail coverage.

## Issues Encountered

- Playwright webServer cannot bind `127.0.0.1:48732` inside the default sandbox (`listen EPERM`). E2E verification was rerun with approved local binding escalation.
- The documented `pnpm --dir packages/web ...` command shape is not accepted by this local pnpm binary. Equivalent commands were run from `/data/OpenForge/packages/web`.

## Verification

- `pnpm exec playwright test e2e/models.spec.ts --project=chromium` from `packages/web`: passed, 3 tests.
- `pnpm exec playwright test e2e/models.spec.ts e2e/copilot.spec.ts --project=chromium` from `packages/web`: passed, 30 tests.
- `pnpm vitest run src/lib/copilot.test.ts` from `packages/web`: passed, 39 tests.
- `pnpm run typecheck` from `packages/web`: passed.
- `git diff --check`: passed.
- `rg -n 'await route\\.fulfill\\(\\{ json: envelope\\(\\{\\}\\) \\}\\)|sk-minimax-test|sk-|Bearer |Authorization|JWT|attach token' packages/web/e2e/models.spec.ts packages/web/e2e/copilot.spec.ts`: no matches.
- `rg -n 'getByRole\\(\"article\"|getByRole\\('\\''article'\\''|hasText: `|hasText: \"' packages/web/e2e/models.spec.ts packages/web/e2e/copilot.spec.ts`: no matches.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 3 implementation plans are complete. Ready for Phase 3 final verification and state completion.

---
*Phase: 03-first-user-product-hardening*
*Completed: 2026-05-20*
