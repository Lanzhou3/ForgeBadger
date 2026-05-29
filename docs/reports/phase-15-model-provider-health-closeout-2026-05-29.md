# Phase 15 Model Provider Health Closeout

Date: 2026-05-29
Scope: Phase 15 `MODEL-01` through `MODEL-04` closeout for model provider setup, readiness checks, actionable recovery, and Codex identity isolation.

## Status

| Requirement | Status | Evidence |
|-------------|--------|----------|
| MODEL-01 guided provider setup | Pass | `/models` uses a provider-first flow with Provider Catalog, Credentials, Models, Apply, Provider Health, and Codex identity surfaces. Browser coverage in `packages/web/e2e/models.spec.ts` covers catalog search, provider setup dialog, credential save, model sync, Copilot preview, and readiness selection. |
| MODEL-02 safe model readiness | Pass | `packages/gateway/test/model-provider-readiness.test.ts` and `packages/gateway/test/model-provider-routes.test.ts` cover selected provider/model/credential readiness with safe remote model-list evidence. `docs/API.md` documents the bounded `POST /api/v1/model-providers/:id/readiness` contract. |
| MODEL-03 actionable provider errors | Pass | Gateway unit coverage classifies invalid credential, timeout, provider outage, endpoint/network failure, missing model, and unavailable remote validation. Browser coverage renders `invalid_credential`, `timeout`, `provider_outage`, `endpoint_or_network_failure`, and `remote_model_missing` with next steps. |
| MODEL-04 Codex isolation | Pass | Gateway readiness returns `codex_subscription_managed` without decrypting provider credentials or calling provider endpoints. Web renders Codex subscription identity separately and marks provider apply disabled. Existing Codex provider boundary tests remain the launch-path evidence. |

## Verification Commands

Run during Phase 15:

```bash
pnpm --dir packages/gateway test test/model-provider-readiness.test.ts
pnpm --dir packages/gateway test test/model-provider-readiness.test.ts test/model-provider-routes.test.ts test/provider-model-fetch.test.ts test/model-endpoint-health.test.ts test/model-health.test.ts
pnpm --dir packages/web exec playwright test e2e/models.spec.ts --project=chromium --reporter=line
pnpm --dir packages/web exec vitest run src/lib/api.test.ts
pnpm --dir packages/web exec vitest run
pnpm --dir packages/web exec tsc --noEmit
pnpm --dir packages/gateway exec tsc --noEmit
```

## User-Facing Recovery

- First-user operators should start at `/models`, select the provider/model/credential/apply target, and click **Check readiness**.
- Support triage should collect only bounded readiness fields: status, code, remote error category, matched model id, and next-step text.
- Raw API keys, Authorization headers, provider request bodies, provider response bodies, decrypted secrets, and provider payloads must not be copied into support tickets or evidence.

## Caveats

- Phase 15 proves the product contract and mocked browser behavior. It does not convert the existing live-provider caveat into a live external pass because no disposable live provider credential was used in this closeout.
- A future live-provider evidence run should use an operator-controlled disposable credential and record only redacted command output plus bounded readiness fields.
