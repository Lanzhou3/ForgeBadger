# Phase 15 Plan 01 Summary: Model Provider Readiness Contract

**Date:** 2026-05-29
**Status:** Complete

## Scope

Added a Gateway-owned readiness contract for model provider setup and health. The contract evaluates a Provider Profile against a target adapter, selected model, selected credential, and optional safe remote model-list check.

## Changes

- Added `buildModelProviderReadiness` with stable readiness codes, check statuses, actionable remediation steps, remote failure classification, and credential redaction.
- Added `POST /api/v1/model-providers/:id/readiness` with zod validation, tenant-scoped provider/model/credential selection, safe in-memory credential decryption for remote checks, and catalog-aware model-list URLs.
- Preserved Codex subscription-managed isolation: Codex readiness returns `codex_subscription_managed`, does not decrypt provider credentials, and does not call provider endpoints.
- Documented the readiness route, request body, response codes, remote-check limits, and secret redaction rules in `docs/API.md`.
- Captured frontend follow-up from review: 15-02 should add a Provider Health & Identity panel using the readiness route and visibly explain Codex identity isolation.

## Verification

Passed:

```bash
pnpm --dir packages/gateway test test/model-provider-readiness.test.ts
pnpm --dir packages/gateway exec tsc --noEmit
pnpm --dir packages/gateway test test/model-provider-readiness.test.ts test/model-provider-routes.test.ts test/provider-model-fetch.test.ts test/model-endpoint-health.test.ts test/model-health.test.ts
```

## Next

Plan 15-02 for the Web provider health panel, guided setup checklist, and Codex subscription identity surface.
