# Provider Health And Identity Web Surface Summary

Date: 2026-05-29

## Completed

- Added typed Web API support for `POST /api/v1/model-providers/:id/readiness`.
- Added a `/models` Provider Health card that checks the selected provider, adapter, model, credential, and remote model list through the Gateway readiness contract.
- Added a Codex subscription identity card that keeps Codex subscription-managed identity separate from third-party provider apply flows.
- Added English, Simplified Chinese, and Traditional Chinese labels for provider health and Codex identity states.
- Added Playwright coverage for ready remote model evidence, actionable remote validation failures, request payload shape, and secret non-disclosure.

## Verification

```bash
pnpm --dir packages/web exec playwright test e2e/models.spec.ts --project=chromium --reporter=line -g "provider readiness"
pnpm --dir packages/web exec playwright test e2e/models.spec.ts --project=chromium --reporter=line
pnpm --dir packages/web exec vitest run
pnpm --dir packages/web exec tsc --noEmit
git diff --check
```

Results:

- Provider readiness Playwright subset: 2 passed.
- Full models Playwright spec: 5 passed.
- Web Vitest: 29 files passed, 186 tests passed.
- TypeScript check: exit 0.
- Diff whitespace check: exit 0.

## Notes

- Readiness checks request `includeRemoteCheck: true` with a 5000ms timeout.
- The health card renders status/code/check summaries and bounded remote evidence only.
- The Codex card shows subscription identity source and SDK status, but provider apply remains disabled for Codex.
- Phase 15 still needs 15-03 for broader browser coverage, docs closeout, and final MODEL-01 through MODEL-04 verification.
